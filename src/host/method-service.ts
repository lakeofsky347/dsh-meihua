import {GenerationPreflight} from './generation-preflight.ts';
import {generationPolicy} from './generation-policy.ts';
import {recoveryPlan,validateRecovery,generateRecovery} from './recovery.ts';
import {randomInt,randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm/message';
import {freezeJson} from '../core/rules.ts';
import {wallTimeToInstant} from '../core/calendar.ts';
import {calculateXiaoliu} from '../xiaoliu/index.ts';
import {calculateLiuyao,liuyaoCalendar} from '../liuyao/index.ts';
import {createLenormandDeck,calculateLenormand,LENORMAND_SPREADS} from '../lenormand/index.ts';
import type {MethodCatalog,MethodReading} from '../shared/methods.ts';
import type {NewMethodId} from '../shared/modules.ts';
import {moduleInfo} from '../shared/modules.ts';
import type {MemorySnapshot} from '../shared/memory.ts';
import type {ConversationTurn,ModelRoute,PluginConfig,RpcResult} from '../shared/protocol.ts';
import {readingIsBusy} from '../shared/protocol.ts';
import type {HostContext} from './platform.ts';
import type {MemoryService} from './memory-service.ts';
import type {GenerationGate} from './generation-gate.ts';
import {object,text} from './validation.ts';
import {parseBackgroundOptions,parseModelRoute,assertModelRoute,modelCatalog} from './module-framework.ts';
import {conversationMessages,validateCancellation,validateFollowup,generateConversation} from './conversation.ts';
import {generatePrivate,withBackground} from './private-generation.ts';

import { methodSystem } from './interpretation-prompts.ts';
export { methodSystem } from './interpretation-prompts.ts';

/** Common new-module lifecycle. Each local method keeps its own rules and result schema. */
export class MethodService {
  private current:MethodReading|null=null;
  private background?:MemorySnapshot;
  private hiddenDeck:readonly number[]=[];
  private route?:ModelRoute;
  private readingEpoch?:number;
  private readonly preflight:GenerationPreflight;
  private controller?:AbortController;
  private job?:Promise<void>;
  private disposed=false;
  private readonly invalidate:()=>void;
  constructor(readonly moduleId:NewMethodId,private readonly ctx:HostContext,readonly config:PluginConfig,private readonly gate:GenerationGate,private readonly memory:MemoryService) {
    this.preflight=new GenerationPreflight(config.interpretationTimeoutMs,gate);
    this.invalidate=memory.onInvalidate(()=>{this.preflight.abort('私人资料已锁定或清空');this.controller?.abort(new Error('私人资料已锁定或清空'));this.current=null;this.hiddenDeck=[];this.background=undefined;this.route=undefined;this.readingEpoch=undefined;});
  }
  snapshot():MethodReading|null{if(!this.current)return null;const preflight=this.preflight.snapshot(this.current.id);return freezeJson({...this.current,...(preflight?{preflight}:{})});}
  async catalog():Promise<MethodCatalog>{return {moduleId:this.moduleId,providers:await modelCatalog(this.ctx),config:this.config,...(this.moduleId==='lenormand'?{spreads:LENORMAND_SPREADS.map(spread=>({id:spread.id,name:spread.name,count:spread.cardCount}))}:{})};}
  private require(id:unknown):MethodReading {
    if(this.disposed)throw new Error('插件已停止');
    if(!this.current||this.current.id!==text(id,100))throw new Error('本轮已不存在，请重新开始');return this.current;
  }
  private idle():void {if(this.disposed)throw new Error('插件已停止');this.preflight.assertIdle();this.gate.assertLocalIdle();if(readingIsBusy(this.current))throw new Error('请等待解读结束或先取消');}
  private input(reading:MethodReading):string{return JSON.stringify({moduleId:this.moduleId,question:reading.question,result:reading.result});}
  private async checkpointReading(reading:MethodReading|null,epoch:number|undefined,route:ModelRoute|undefined,retry=false):Promise<void> {
    if(!reading||readingIsBusy(reading)||reading.memory?.forOthers||reading.backgroundOptions.forOthers)return;
    await this.memory.checkpoint({moduleId:this.moduleId,readingId:reading.id,epoch:reading.memory?.epoch??epoch,route:reading.route??route,retry,messages:[{id:reading.id+'-question',text:reading.question},...(reading.conversation??[]).map(turn=>({id:turn.id,text:turn.question}))]});
  }
  private start(data:Record<string,unknown>):MethodReading {
    this.idle();const question=text(data.question,500,'当下指引')||'当下指引';
    const wall=text(data.wallTime,30),instant=wall?wallTimeToInstant(wall,this.config.timeZone):new Date().toISOString();
    const environment={capturedAt:instant,timeZone:this.config.timeZone,details:{}};
    const options=parseBackgroundOptions(data.options)??{useBackground:true,forOthers:false};
    const route=parseModelRoute(data.route),epoch=this.memory.currentEpoch;
    const reading:MethodReading={id:`${this.moduleId}-${randomUUID()}`,moduleId:this.moduleId,question,createdAt:instant,environment,wallTime:wall,selectedRoute:route,status:'ready',result:null,text:'',backgroundOptions:options,selectedSlots:[],selectionCount:0,coins:[]};
    let deck:readonly number[]=[];
    if(this.moduleId==='xiaoliu')reading.result=calculateXiaoliu({question,environment});
    else if(this.moduleId==='liuyao'){
      liuyaoCalendar(environment);
      if(data.values!==undefined){if(!Array.isArray(data.values))throw new Error('须输入六条爻值');reading.result=calculateLiuyao({question,environment,values:data.values});reading.coins=data.values.map(value=>({value,faces:[]}));}
      else reading.status='collecting';
    }else{
      const spread=LENORMAND_SPREADS.find(spread=>spread.id===text(data.spreadId,40,'line-3'));if(!spread)throw new Error('雷诺曼牌阵无效');
      reading.spreadId=spread.id;reading.selectionCount=spread.cardCount;reading.status='selecting';deck=createLenormandDeck(max=>randomInt(max));
    }
    const previous=this.current,previousEpoch=this.readingEpoch,previousRoute=this.route;
    this.current=reading;this.hiddenDeck=deck;this.route=route;this.readingEpoch=epoch;this.background=undefined;
    void this.checkpointReading(previous,previousEpoch,previousRoute).catch(()=>{});return this.snapshot()!;
  }
  private localAction(endpoint:string,data:Record<string,unknown>):MethodReading {
    this.idle();const reading=this.require(data.id);
    if(this.moduleId==='liuyao'&&['toss','record'].includes(endpoint)){
      if(reading.status!=='collecting'||reading.coins.length>=6)throw new Error('六次投币已固定，请另起一轮');
      if(data.expectedCount!==reading.coins.length)throw new Error('投币记录已变化，请刷新后再记录');
      const faces=endpoint==='toss'?Array.from({length:3},()=>randomInt(2)+2):[];
      const value=endpoint==='toss'?faces.reduce((sum,face)=>sum+face,0):data.value;
      if(typeof value!=='number'||![6,7,8,9].includes(value))throw new Error('爻值须为6、7、8或9');
      const nextCoins=[...reading.coins,{faces,value}];
      const result=nextCoins.length===6?calculateLiuyao({question:reading.question,environment:reading.environment,values:nextCoins.map(coin=>coin.value)}):null;
      reading.coins=nextCoins;if(result){reading.result=result;reading.status='ready';}
    }else if(this.moduleId==='lenormand'&&endpoint==='select'){
      if(reading.status!=='selecting')throw new Error('背牌选择已固定');const slot=data.slot;
      if(data.expectedCount!==reading.selectedSlots.length)throw new Error('牌序已变化，请刷新后再选择');
      if(typeof slot!=='number'||!Number.isInteger(slot)||slot<1||slot>36||reading.selectedSlots.includes(slot))throw new Error('请选择尚未抽取的背牌');
      reading.selectedSlots.push(slot);if(reading.selectedSlots.length===reading.selectionCount)reading.status='revealing';
    }else if(this.moduleId==='lenormand'&&endpoint==='reveal'){
      if(reading.status!=='revealing')throw new Error('尚未选齐或已经揭示');
      reading.result=calculateLenormand({question:reading.question,spreadId:reading.spreadId as 'line-3'|'line-5',cardIds:reading.selectedSlots.map(slot=>this.hiddenDeck[slot-1]!),createdAt:reading.createdAt});reading.status='ready';
    }else throw new Error('本模块不支持该本地操作');return this.snapshot()!;
  }
  private async interpret(data:Record<string,unknown>):Promise<MethodReading> {
    this.memory.assertUnlocked();this.preflight.assertIdle();const reading=this.require(data.id);if(reading.status!=='ready'||readingIsBusy(reading)||!reading.result)throw new Error('请先完成本地结果；每轮只保留首次解读');
    const route={provider:text(data.provider,100),model:text(data.model,200)};await assertModelRoute(this.ctx,route);
    const options=parseBackgroundOptions(data.options)??reading.backgroundOptions;
    const background=await this.memory.freeze(options);
    if(this.current!==reading||reading.status!=='ready'||this.disposed||readingIsBusy(reading))throw new Error('本轮状态已变化');
    const release=this.gate.acquire(reading.id);this.background=background;const {markdown,...usage}=background;
    reading.memory=usage;reading.backgroundOptions=options;reading.route=route;this.route=route;this.readingEpoch=background.epoch;reading.status='streaming';
    const controller=new AbortController();this.controller=controller;
    const messages=[createUserMessage({content:[{type:'text',text:withBackground(this.input(reading),background)}],source:{kind:'user'}})];
    this.job=generatePrivate(this.ctx,this.config,{id:reading.id,moduleId:this.moduleId,kind:'initial',route,messages,system:methodSystem(this.moduleId),epoch:background.epoch,backgroundRevision:background.revision,onText:value=>{reading.text=value;},onGeneration:info=>{reading.generation=info;}},controller,this.memory).then(result=>{Object.assign(reading,result);}).finally(release);
    return this.snapshot()!;
  }
  private async followup(data:Record<string,unknown>):Promise<MethodReading> {
    this.memory.assertUnlocked();const reading=this.require(data.id),question=validateFollowup(reading,data.question,data.expectedTurnCount);
    const system=methodSystem(this.moduleId,true),messages=conversationMessages(reading,withBackground(this.input(reading),this.background),question,system,Infinity);
    return this.preflight.run(reading.id,async signal=>{
      await assertModelRoute(this.ctx,reading.route!);signal.throwIfAborted();
      await generationPolicy(this.ctx,this.config,reading.route!,messages,system,signal);
    },(controller,release)=>{
      if(this.current!==reading||this.disposed)throw new Error('本轮状态已变化');
      validateFollowup(reading,data.question,data.expectedTurnCount);this.memory.assertUnlocked();
      const turn:ConversationTurn={id:`${reading.id}-followup-${randomUUID()}`,question,text:'',status:'streaming',route:{...reading.route!},createdAt:new Date().toISOString()};
      (reading.conversation??=[]).push(turn);this.controller=controller;
      this.job=generateConversation(this.ctx,this.config,turn,messages,system,controller,this.memory,this.background?.epoch,this.background?.revision,this.moduleId).finally(release);
      return this.snapshot()!;
    });
  }
  private async resume(data:Record<string,unknown>):Promise<MethodReading> {
    this.memory.assertUnlocked();const reading=this.require(data.id);
    const request={expectedTurnCount:data.expectedTurnCount,expectedAttempt:data.expectedAttempt,turnId:data.turnId===undefined?undefined:text(data.turnId,160)};
    validateRecovery(reading,request);
    const plan=recoveryPlan(reading,withBackground(this.input(reading),this.background),this.moduleId,request);
    return this.preflight.run(reading.id,async signal=>{
      await assertModelRoute(this.ctx,plan.target.route!);signal.throwIfAborted();
      await generationPolicy(this.ctx,this.config,plan.target.route!,plan.messages,plan.system,signal);
    },(controller,release)=>{
      if(this.current!==reading||this.disposed)throw new Error('本轮状态已变化');
      validateRecovery(reading,request);this.memory.assertUnlocked();this.controller=controller;
      this.job=generateRecovery(this.ctx,this.config,reading,this.moduleId,plan,controller,this.memory,this.background).finally(release);
      return this.snapshot()!;
    });
  }
  async rpc(endpoint:string,payload:unknown):Promise<RpcResult>{
    try{
      if(this.disposed)throw new Error('插件已停止');
      if(endpoint==='catalog')return {ok:true,value:await this.catalog()};if(endpoint==='current')return {ok:true,value:this.snapshot()};
      const data=object(payload);await this.memory.ready;this.memory.assertCurrentEpoch(data.epoch);
      if(endpoint==='start')return {ok:true,value:this.start(data)};
      if(['toss','record','select','reveal'].includes(endpoint))return {ok:true,value:this.localAction(endpoint,data)};
      if(endpoint==='interpret')return {ok:true,value:await this.interpret(data)};
      if(endpoint==='followup')return {ok:true,value:await this.followup(data)};
      if(endpoint==='resume')return {ok:true,value:await this.resume(data)};
      const reading=this.require(data.id);
      if(endpoint==='cancel'){if(!this.preflight.cancel(reading.id,data.preflightId)&&validateCancellation(reading,data.turnId===undefined?undefined:text(data.turnId,160),data.expectedAttempt))this.controller?.abort(new Error('已取消解读'));return {ok:true,value:this.snapshot()};}
      if(endpoint==='preferences'){
        if(reading.memory||readingIsBusy(reading))throw new Error('本次背景选择已冻结');if(data.route!==undefined){this.route=parseModelRoute(data.route);reading.selectedRoute=this.route;}reading.backgroundOptions=parseBackgroundOptions(data.options)??reading.backgroundOptions;return {ok:true,value:this.snapshot()};
      }
      if(endpoint==='checkpoint'){
        if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new Error('重试选项无效');
        if(!reading.memory){reading.backgroundOptions=parseBackgroundOptions(data.options)??reading.backgroundOptions;this.route=parseModelRoute(data.route)??this.route;reading.selectedRoute=this.route;}
        await this.checkpointReading(reading,this.readingEpoch,this.route,data.retry===true);return {ok:true,value:await this.memory.status()};
      }
      return {ok:false,error:{code:'NOT_FOUND',message:'未找到模块操作',details:{}}};
    }catch(error){return {ok:false,error:{code:error&&typeof error==='object'&&'code'in error?String(error.code):'METHOD_ERROR',message:error instanceof Error?error.message:'操作未完成',details:{}}};}
  }
  async dispose():Promise<void>{this.disposed=true;this.invalidate();this.controller?.abort(new Error('插件已停止'));await Promise.all([this.preflight.dispose(),this.job]);this.current=null;this.hiddenDeck=[];this.background=undefined;}
}
