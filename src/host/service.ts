import {GenerationPreflight} from './generation-preflight.ts';
import {generationPolicy} from './generation-policy.ts';
import {recoveryPlan,validateRecovery,generateRecovery} from './recovery.ts';
import type {RecoveryRequest} from './recovery.ts';
import {assertModelRoute,modelCatalog,parseBackgroundOptions as parseMemoryOptions,parseModelRoute as parseRoute} from "./module-framework.ts";
import { generatePrivate, withBackground } from './private-generation.ts';
import type { MemoryService } from './memory-service.ts';
import type { MemorySnapshot } from '../shared/memory.ts';
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm/message';
import { RuleRegistry, freezeJson, isJsonValue } from '../core/rules.ts';
import type { DivinationRule, EnvironmentContributor } from '../core/types.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import type { Catalog, ConversationTurn, ModelRoute, PluginConfig, Reading, RpcResult } from '../shared/protocol.ts';
import type { HostContext } from './platform.ts';
import { INTERPRETATION_SYSTEM, interpretationInput } from './prompt.ts';
import { object, parseInput, text } from './validation.ts';
import type { GenerationGate } from './generation-gate.ts';
import { conversationMessages, followupSystem, generateConversation, validateCancellation, validateFollowup } from './conversation.ts';

/** One current reading and one first interpretation; lifetime belongs to the plugin. */
export class MeihuaService {
  readonly rules = new RuleRegistry();
  private readonly contributors = new Map<string,EnvironmentContributor>();
  private current:Reading | null = null;
  private readonly preflight:GenerationPreflight;
  private controller:AbortController | undefined;
  private job:Promise<void> | undefined;
  private disposed = false;
  private background:MemorySnapshot|undefined;
  private readonly readingPreferences=new WeakMap<Reading,{forOthers?:boolean;route?:ModelRoute;epoch?:number}>();
  private invalidate:(()=>void)|undefined;
  constructor(private readonly ctx:HostContext, readonly config:PluginConfig, private readonly gate?:GenerationGate,private readonly memory?:MemoryService) {
    this.preflight=new GenerationPreflight(config.interpretationTimeoutMs,gate);
    this.invalidate=memory?.onInvalidate(()=>{this.preflight.abort('私人资料已锁定或清空');this.controller?.abort(new Error('私人资料已锁定或清空'));this.current=null;this.background=undefined;});
  }

  registerRule(rule:DivinationRule):()=>void { return this.rules.register(rule); }
  registerEnvironment(id:string, contributor:EnvironmentContributor):()=>void {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || this.contributors.has(id)) throw new Error('环境信息来源标识无效或重复');
    this.contributors.set(id,contributor);
    return () => { if (this.contributors.get(id) === contributor) this.contributors.delete(id); };
  }
  snapshot():Reading | null { if(!this.current)return null;const preflight=this.preflight.snapshot(this.current.id);return freezeJson({...this.current,...(preflight?{preflight}:{})}); }
  async catalog():Promise<Catalog> {
    const groups = await modelCatalog(this.ctx);
    return { rules:this.rules.list(), providers:groups, config:this.config };
  }
  async cast(payload:unknown):Promise<Reading> {
    if (this.disposed) throw new Error('插件已停止');
    this.preflight.assertIdle();this.gate?.assertLocalIdle();
    if (readingIsBusy(this.current)) throw new Error('请等待本次解读结束，或先取消');
    const input = parseInput(payload,this.config);
    const extra=object(payload),options=parseMemoryOptions(extra.options),selectedRoute=parseRoute(extra.route);
    for (const [id,contribute] of this.contributors) {
      const details = await contribute(freezeJson(input.environment));
      if (!isJsonValue(details) || Array.isArray(details) || details === null || typeof details !== 'object' || JSON.stringify(details).length > 4000) throw new Error(`环境来源 ${id} 返回了无效信息`);
      input.environment.details[id] = details;
    }
    if (this.disposed || readingIsBusy(this.current)) throw new Error('插件状态已变化，请重新起卦');
    if(this.memory&&extra.epoch!==undefined)this.memory.assertCurrentEpoch(extra.epoch);
    this.preflight.assertIdle();this.gate?.assertLocalIdle();
    const previous=this.current;this.background=undefined;
    this.current = { id:`meihua-${randomUUID()}`, result:this.rules.calculate(input), status:'ready', text:'',backgroundOptions:options??{useBackground:true,forOthers:false} };
    this.readingPreferences.set(this.current,{forOthers:options?.forOthers,route:selectedRoute,epoch:this.memory?.currentEpoch});
    void this.checkpointReading(previous).catch(()=>{});
    return this.snapshot()!;
  }
  async interpret(id:string, route:ModelRoute,options?:{useBackground?:boolean;forOthers?:boolean}):Promise<Reading> {
    const reading = this.requireReading(id);this.preflight.assertIdle();
    if (readingIsBusy(reading)) throw new Error('请等待本次解读或追问结束，或先取消');
    if (reading.status !== 'ready') throw new Error('每卦只保留第一次解读，请重新起卦开始新的一次');
    if (!this.ctx.llm.listProviders().some(p=>p.id === route.provider)) throw new Error('所选供应商已不可用');
    const models = await this.ctx.llm.listModels(route.provider);
    if (!models.some(m=>m.id === route.model)) throw new Error('所选模型已不可用，请刷新模型目录');
    const preferences=options??reading.backgroundOptions??{useBackground:true,forOthers:false};
    const background=await this.memory?.freeze(preferences);
    if (this.current !== reading || reading.status !== 'ready' || readingIsBusy(reading) || this.disposed) throw new Error('本次卜算状态已变化');
    const release = this.gate?.acquire(reading.id);
    this.background=background;if(background){const {markdown,...usage}=background;reading.memory=usage;}
    reading.backgroundOptions=preferences;
    this.readingPreferences.set(reading,{forOthers:preferences.forOthers??false,route:{...route},epoch:background?.epoch??this.memory?.currentEpoch});
    reading.status = 'streaming'; reading.route = { ...route };
    this.controller = new AbortController();
    this.job = this.generate(reading,this.controller).finally(()=>release?.());
    return this.snapshot()!;
  }
  async followup(id:string,question:unknown,expectedTurnCount:unknown):Promise<Reading> {
    this.memory?.assertUnlocked();
    const reading=this.requireReading(id),parsed=validateFollowup(reading,question,expectedTurnCount),route=reading.route!;
    const system=followupSystem('meihua'),messages=conversationMessages(reading,withBackground(interpretationInput(reading.result),this.background),parsed,system,Infinity);
    return this.preflight.run(reading.id,async signal=>{
      await assertModelRoute(this.ctx,route);signal.throwIfAborted();
      await generationPolicy(this.ctx,this.config,route,messages,system,signal);
    },(controller,release)=>{
      if(this.current!==reading||this.disposed)throw new Error('本轮状态已变化');
      validateFollowup(reading,question,expectedTurnCount);this.memory?.assertUnlocked();
      const turn:ConversationTurn={id:`${reading.id}-followup-${randomUUID()}`,question:parsed,text:'',status:'streaming',route:{...route},createdAt:new Date().toISOString()};
      (reading.conversation??=[]).push(turn);this.controller=controller;
      this.job=generateConversation(this.ctx,this.config,turn,messages,system,controller,this.memory,this.background?.epoch,this.background?.revision).finally(release);
      return this.snapshot()!;
    });
  }
  async resume(id:string,request:RecoveryRequest):Promise<Reading> {
    this.memory?.assertUnlocked();
    const reading=this.requireReading(id);validateRecovery(reading,request);
    const plan=recoveryPlan(reading,withBackground(interpretationInput(reading.result),this.background),'meihua',request);
    return this.preflight.run(reading.id,async signal=>{
      await assertModelRoute(this.ctx,plan.target.route!);signal.throwIfAborted();
      await generationPolicy(this.ctx,this.config,plan.target.route!,plan.messages,plan.system,signal);
    },(controller,release)=>{
      if(this.current!==reading||this.disposed)throw new Error('本轮状态已变化');
      validateRecovery(reading,request);this.memory?.assertUnlocked();this.controller=controller;
      this.job=generateRecovery(this.ctx,this.config,reading,'meihua',plan,controller,this.memory,this.background).finally(release);
      return this.snapshot()!;
    });
  }
  cancel(id:string,turnId?:unknown,expectedAttempt?:unknown,preflightId?:unknown):Reading {
    const reading = this.requireReading(id);
    if (!this.preflight.cancel(id,preflightId)&&validateCancellation(reading,turnId===undefined?undefined:text(turnId,160),expectedAttempt)) this.controller?.abort(new Error('已取消解读'));
    return this.snapshot()!;
  }
  private requireReading(id:string):Reading {
    if(this.disposed)throw new Error('插件已停止');
    if (!this.current || this.current.id !== id) throw new Error('本次卜算已不存在，请重新起卦');
    return this.current;
  }
  private async generate(reading:Reading,controller:AbortController):Promise<void> {
    try {
      const messages=[createUserMessage({content:[{type:'text',text:withBackground(interpretationInput(reading.result),this.background)}],source:{kind:'user'}})];
      const result=await generatePrivate(this.ctx,this.config,{id:reading.id,moduleId:'meihua',kind:'initial',route:reading.route!,messages,system:INTERPRETATION_SYSTEM,epoch:this.background?.epoch,backgroundRevision:this.background?.revision,onText:text=>{reading.text=text;},onGeneration:info=>{reading.generation=info;}},controller,this.memory);
      Object.assign(reading,result);
    } finally {}
  }
  private async checkpointReading(reading:Reading|null,options?:{useBackground?:boolean;forOthers?:boolean},route?:ModelRoute,retry=false):Promise<void> {
    if(!reading||!this.memory||readingIsBusy(reading))return;
    if(!reading.memory&&options){
      reading.backgroundOptions={...options};
      this.readingPreferences.set(reading,{forOthers:options.forOthers,route:route??this.readingPreferences.get(reading)?.route,epoch:this.readingPreferences.get(reading)?.epoch});
    }
    if(reading.memory?.forOthers??this.readingPreferences.get(reading)?.forOthers)return;
    await this.memory.checkpoint({moduleId:'meihua',readingId:reading.id,route:reading.route??route??this.readingPreferences.get(reading)?.route,epoch:reading.memory?.epoch??this.readingPreferences.get(reading)?.epoch,retry,
      messages:[{id:reading.id+'-question',text:reading.result.input.question},...(typeof reading.result.input.environment.details.observation==='string'?[{id:reading.id+'-observation',text:reading.result.input.environment.details.observation}]:[]),...(reading.conversation??[]).map(turn=>({id:turn.id,text:turn.question}))]});
  }
  async rpc(endpoint:string,payload:unknown):Promise<RpcResult> {
    try {
      if (this.disposed) throw new Error('插件已停止');
      if(this.memory&&['cast','interpret','followup','resume','cancel','checkpoint','preferences'].includes(endpoint)){
        const data=object(payload);await this.memory.ready;this.memory.assertCurrentEpoch(data.epoch);
      }
      switch (endpoint) {
        case 'catalog': return {ok:true,value:await this.catalog()};
        case 'current': return {ok:true,value:this.snapshot()};
        case 'cast': return {ok:true,value:await this.cast(payload)};
        case 'preferences': {
          const data=object(payload),reading=this.requireReading(text(data.id,100)),options=parseMemoryOptions(data.options);
          if(!options||reading.memory||readingIsBusy(reading))throw new Error('本次背景选择已冻结');
          reading.backgroundOptions=options;this.readingPreferences.set(reading,{...this.readingPreferences.get(reading),forOthers:options.forOthers});
          return {ok:true,value:this.snapshot()};
        }
        case 'checkpoint': {const data=object(payload);if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new Error('重试选项无效');await this.checkpointReading(this.requireReading(text(data.id,100)),parseMemoryOptions(data.options),parseRoute(data.route),data.retry===true);return {ok:true,value:await this.memory?.status()};}
        case 'interpret': {
          const data = object(payload);
          return {ok:true,value:await this.interpret(text(data.id,100),{provider:text(data.provider,100),model:text(data.model,200)},parseMemoryOptions(data.options))};
        }
        case 'followup': { const data=object(payload); return {ok:true,value:await this.followup(text(data.id,100),data.question,data.expectedTurnCount)}; }
        case 'resume': {const data=object(payload);return {ok:true,value:await this.resume(text(data.id,100),{expectedTurnCount:data.expectedTurnCount,expectedAttempt:data.expectedAttempt,turnId:data.turnId===undefined?undefined:text(data.turnId,160)})};}
        case 'cancel': { const data=object(payload); return {ok:true,value:this.cancel(text(data.id,100),data.turnId,data.expectedAttempt,data.preflightId)}; }
        default: return {ok:false,error:{code:'NOT_FOUND',message:'未找到插件操作',details:{}}};
      }
    } catch (error) { return {ok:false,error:{code:errorCode(error),message:error instanceof Error ? error.message : '操作未完成',details:{}}}; }
  }
  /** Await the owned generation before unregistering the Host contribution. */
  async dispose():Promise<void> { this.disposed = true;this.invalidate?.(); this.controller?.abort(new Error('插件已停止')); await Promise.all([this.preflight.dispose(),this.job]); this.contributors.clear(); }
}
function errorCode(error:unknown):string { return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'MEIHUA_ERROR'; }
