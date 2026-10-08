import {GenerationPreflight} from './generation-preflight.ts';
import {generationPolicy} from './generation-policy.ts';
import {recoveryPlan,validateRecovery,generateRecovery} from './recovery.ts';
import type {RecoveryRequest} from './recovery.ts';
import {assertModelRoute,modelCatalog,parseBackgroundOptions as parseMemoryOptions,parseModelRoute as parseRoute} from "./module-framework.ts";
import { generatePrivate, withBackground } from './private-generation.ts';
import type { MemoryService } from './memory-service.ts';
import type { MemorySnapshot } from '../shared/memory.ts';
import { randomInt, randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm/message';
import { freezeJson } from '../core/rules.ts';
import { TAROT_DECK, TAROT_SPREADS, shuffleTarotDeck, tarotSpread } from '../tarot/index.ts';
import type { TarotHiddenCard } from '../tarot/types.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import type { ConversationTurn, ModelRoute, PluginConfig, RpcResult, TarotCatalog, TarotReading } from '../shared/protocol.ts';
import type { HostContext } from './platform.ts';
import type { GenerationGate } from './generation-gate.ts';
import { object, text } from './validation.ts';
import { conversationMessages, followupSystem, generateConversation, validateCancellation, validateFollowup } from './conversation.ts';

import { TAROT_INTERPRETATION_SYSTEM } from './interpretation-prompts.ts';
export { TAROT_INTERPRETATION_SYSTEM } from './interpretation-prompts.ts';

/** The hidden 78-card order belongs only to the Host and survives page navigation. */
export class TarotService {
  private current:TarotReading|null=null;
  private hiddenDeck:readonly TarotHiddenCard[]=[];
  private drawn:TarotHiddenCard[]=[];
  private readonly preflight:GenerationPreflight;
  private controller:AbortController|undefined;
  private job:Promise<void>|undefined;
  private disposed=false;
  private background:MemorySnapshot|undefined;
  private readonly readingPreferences=new WeakMap<TarotReading,{forOthers?:boolean;route?:ModelRoute;epoch?:number}>();
  private invalidate:(()=>void)|undefined;
  constructor(private readonly ctx:HostContext,readonly config:PluginConfig,private readonly gate?:GenerationGate,private readonly memory?:MemoryService){
    this.preflight=new GenerationPreflight(config.interpretationTimeoutMs,gate);
    this.invalidate=memory?.onInvalidate(()=>{this.preflight.abort('私人资料已锁定或清空');this.controller?.abort(new Error('私人资料已锁定或清空'));this.current=null;this.background=undefined;this.hiddenDeck=[];this.drawn=[];});
  }

  snapshot():TarotReading|null{if(!this.current)return null;const preflight=this.preflight.snapshot(this.current.id);return freezeJson({...this.current,...(preflight?{preflight}:{})});}
  async catalog():Promise<TarotCatalog>{
    this.assertActive();
    const providers=await Promise.all(this.ctx.llm.listProviders().map(async provider=>{
      try{return {...provider,models:(await this.ctx.llm.listModels(provider.id)).map(({id,name})=>({id,name}))};}
      catch{return {...provider,models:[],error:'模型目录读取失败'};}
    }));
    return {spreads:TAROT_SPREADS,providers,config:this.config,deck:TAROT_DECK};
  }
  start(payload:unknown):TarotReading{
    this.assertActive();this.preflight.assertIdle();this.gate?.assertLocalIdle();
    if(readingIsBusy(this.current))throw new Error('请等待本次解读结束，或先取消');
    const data=object(payload),spread=tarotSpread(text(data.spreadId,80));
    if(typeof data.includeReversed!=='boolean')throw new Error('正逆位选项无效');
    const question=text(data.question,500,'当下指引')||'当下指引';
    const options=parseMemoryOptions(data.options),selectedRoute=parseRoute(data.route);
    const previous=this.current;this.background=undefined;
    this.hiddenDeck=shuffleTarotDeck(data.includeReversed,randomInt);this.drawn=[];
    this.current={id:`tarot-${randomUUID()}`,moduleId:'tarot',algorithmVersion:'tarot-v1',spread,
      question,includeReversed:data.includeReversed,createdAt:new Date().toISOString(),selectionCount:0,
      selectedSlots:[],cards:[],status:'selecting',text:'',backgroundOptions:options??{useBackground:true,forOthers:false}};
    this.readingPreferences.set(this.current,{forOthers:options?.forOthers,route:selectedRoute,epoch:this.memory?.currentEpoch});
    void this.checkpointReading(previous).catch(()=>{});
    return this.snapshot()!;
  }
  select(id:string,slot:number):TarotReading{
    const reading=this.requireReading(id);
    if(reading.status!=='selecting')throw new Error('本次选牌已结束，请查看已选牌位');
    if(!Number.isInteger(slot)||slot<0||slot>=78)throw new Error('所选卡牌位置无效');
    if(reading.selectedSlots.includes(slot))throw new Error('这张牌已被选取，请选择其他牌');
    const positionIndex=reading.selectionCount;
    this.drawn.push(this.hiddenDeck[slot]!);
    reading.selectedSlots.push(slot);reading.selectionCount++;
    reading.cards.push({positionIndex,positionLabel:reading.spread.positions[positionIndex]!,revealed:false});
    if(reading.selectionCount===reading.spread.cardCount)reading.status='revealing';
    return this.snapshot()!;
  }
  reveal(id:string,position?:number,all=false):TarotReading{
    const reading=this.requireReading(id);
    if(reading.status!=='revealing'&&reading.status!=='ready')throw new Error('请先按牌阵选齐所有卡牌');
    if(typeof all!=='boolean')throw new Error('翻牌方式无效');
    if(!all&&(!Number.isInteger(position)||position!<0||position!>=reading.cards.length))throw new Error('牌位无效');
    if(!all&&!reading.cards[position!]!.revealed&&position!==reading.cards.findIndex(card=>!card.revealed))throw new Error('请按牌位顺序翻开下一张牌');
    const positions=all?reading.cards.map((_,index)=>index):[position!];
    for(const index of positions){
      const publicCard=reading.cards[index]!,hidden=this.drawn[index]!;
      if(!publicCard.revealed){publicCard.card=hidden.card;publicCard.orientation=hidden.orientation;publicCard.revealed=true;}
    }
    if(reading.cards.every(card=>card.revealed))reading.status='ready';
    return this.snapshot()!;
  }
  async interpret(id:string,route:ModelRoute,options?:{useBackground?:boolean;forOthers?:boolean}):Promise<TarotReading>{
    const reading=this.requireReading(id);this.preflight.assertIdle();
    if(readingIsBusy(reading))throw new Error('请等待本次解读或追问结束，或先取消');
    if(reading.status!=='ready')throw new Error(reading.status==='selecting'||reading.status==='revealing'?'请先选齐并翻开全部卡牌':'每次牌阵只保留第一次解读，请重新抽牌开始新的一次');
    if(!this.ctx.llm.listProviders().some(provider=>provider.id===route.provider))throw new Error('所选供应商已不可用');
    const models=await this.ctx.llm.listModels(route.provider);
    if(!models.some(model=>model.id===route.model))throw new Error('所选模型已不可用，请刷新模型目录');
    const preferences=options??reading.backgroundOptions??{useBackground:true,forOthers:false};
    const background=await this.memory?.freeze(preferences);
    if(this.current!==reading||reading.status!=='ready'||readingIsBusy(reading)||this.disposed)throw new Error('本次抽牌状态已变化');
    const release=this.gate?.acquire(reading.id);
    this.background=background;if(background){const {markdown,...usage}=background;reading.memory=usage;}
    reading.backgroundOptions=preferences;
    this.readingPreferences.set(reading,{forOthers:preferences.forOthers??false,route:{...route},epoch:background?.epoch??this.memory?.currentEpoch});
    reading.status='streaming';reading.route={...route};
    this.controller=new AbortController();this.job=this.generate(reading,this.controller,release);
    return this.snapshot()!;
  }
  async followup(id:string,question:unknown,expectedTurnCount:unknown):Promise<TarotReading> {
    this.memory?.assertUnlocked();
    const reading=this.requireReading(id),parsed=validateFollowup(reading,question,expectedTurnCount),route=reading.route!;
    const system=followupSystem('tarot'),messages=conversationMessages(reading,withBackground(tarotInterpretationInput(reading),this.background),parsed,system,Infinity);
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
  async resume(id:string,request:RecoveryRequest):Promise<TarotReading> {
    this.memory?.assertUnlocked();
    const reading=this.requireReading(id);validateRecovery(reading,request);
    const plan=recoveryPlan(reading,withBackground(tarotInterpretationInput(reading),this.background),'tarot',request);
    return this.preflight.run(reading.id,async signal=>{
      await assertModelRoute(this.ctx,plan.target.route!);signal.throwIfAborted();
      await generationPolicy(this.ctx,this.config,plan.target.route!,plan.messages,plan.system,signal);
    },(controller,release)=>{
      if(this.current!==reading||this.disposed)throw new Error('本轮状态已变化');
      validateRecovery(reading,request);this.memory?.assertUnlocked();this.controller=controller;
      this.job=generateRecovery(this.ctx,this.config,reading,'tarot',plan,controller,this.memory,this.background).finally(release);
      return this.snapshot()!;
    });
  }
  cancel(id:string,turnId?:unknown,expectedAttempt?:unknown,preflightId?:unknown):TarotReading{
    const reading=this.requireReading(id);
    if(!this.preflight.cancel(id,preflightId)&&validateCancellation(reading,turnId===undefined?undefined:text(turnId,160),expectedAttempt))this.controller?.abort(new Error('已取消解读'));
    return this.snapshot()!;
  }
  private assertActive():void{if(this.disposed)throw new Error('插件已停止');}
  private requireReading(id:string):TarotReading{
    this.assertActive();
    if(!this.current||this.current.id!==id)throw new Error('本次塔罗抽牌已不存在，请重新抽牌');
    return this.current;
  }
  private async generate(reading:TarotReading,controller:AbortController,release?:()=>void):Promise<void> {
    try {
      const messages=[createUserMessage({content:[{type:'text',text:withBackground(tarotInterpretationInput(reading),this.background)}],source:{kind:'user'}})];
      const result=await generatePrivate(this.ctx,this.config,{id:reading.id,moduleId:'tarot',kind:'initial',route:reading.route!,messages,system:TAROT_INTERPRETATION_SYSTEM,epoch:this.background?.epoch,backgroundRevision:this.background?.revision,onText:text=>{reading.text=text;},onGeneration:info=>{reading.generation=info;}},controller,this.memory);
      Object.assign(reading,result);
    } finally {release?.();}
  }
  private async checkpointReading(reading:TarotReading|null,options?:{useBackground?:boolean;forOthers?:boolean},route?:ModelRoute,retry=false):Promise<void> {
    if(!reading||!this.memory||readingIsBusy(reading))return;
    if(!reading.memory&&options){
      reading.backgroundOptions={...options};
      this.readingPreferences.set(reading,{forOthers:options.forOthers,route:route??this.readingPreferences.get(reading)?.route,epoch:this.readingPreferences.get(reading)?.epoch});
    }
    if(reading.memory?.forOthers??this.readingPreferences.get(reading)?.forOthers)return;
    await this.memory.checkpoint({moduleId:'tarot',readingId:reading.id,route:reading.route??route??this.readingPreferences.get(reading)?.route,epoch:reading.memory?.epoch??this.readingPreferences.get(reading)?.epoch,retry,
      messages:[{id:reading.id+'-question',text:reading.question},...(reading.conversation??[]).map(turn=>({id:turn.id,text:turn.question}))]});
  }
  async rpc(endpoint:string,payload:unknown):Promise<RpcResult>{
    try{
      this.assertActive();
      if(this.memory&&['start','select','reveal','interpret','followup','resume','cancel','checkpoint','preferences'].includes(endpoint)){
        const data=object(payload);await this.memory.ready;this.memory.assertCurrentEpoch(data.epoch);
      }
      switch(endpoint){
        case 'catalog':return {ok:true,value:await this.catalog()};
        case 'current':return {ok:true,value:this.snapshot()};
        case 'start':return {ok:true,value:this.start(payload)};
        case 'select':{const data=object(payload);return {ok:true,value:this.select(text(data.id,100),data.slot as number)};}
        case 'reveal':{const data=object(payload);return {ok:true,value:this.reveal(text(data.id,100),data.position as number|undefined,(data.all??false) as boolean)};}
        case 'preferences': {
          const data=object(payload),reading=this.requireReading(text(data.id,100)),options=parseMemoryOptions(data.options);
          if(!options||reading.memory||readingIsBusy(reading))throw new Error('本次背景选择已冻结');
          reading.backgroundOptions=options;this.readingPreferences.set(reading,{...this.readingPreferences.get(reading),forOthers:options.forOthers});
          return {ok:true,value:this.snapshot()};
        }
        case 'checkpoint': {const data=object(payload);if(data.retry!==undefined&&typeof data.retry!=='boolean')throw new Error('重试选项无效');await this.checkpointReading(this.requireReading(text(data.id,100)),parseMemoryOptions(data.options),parseRoute(data.route),data.retry===true);return {ok:true,value:await this.memory?.status()};}
        case 'interpret':{const data=object(payload);return {ok:true,value:await this.interpret(text(data.id,100),{provider:text(data.provider,100),model:text(data.model,200)},parseMemoryOptions(data.options))};}
        case 'followup':{const data=object(payload);return {ok:true,value:await this.followup(text(data.id,100),data.question,data.expectedTurnCount)};}
        case 'resume': {const data=object(payload);return {ok:true,value:await this.resume(text(data.id,100),{expectedTurnCount:data.expectedTurnCount,expectedAttempt:data.expectedAttempt,turnId:data.turnId===undefined?undefined:text(data.turnId,160)})};}
        case 'cancel':{const data=object(payload);return {ok:true,value:this.cancel(text(data.id,100),data.turnId,data.expectedAttempt,data.preflightId)};}
        default:return {ok:false,error:{code:'NOT_FOUND',message:'未找到塔罗操作',details:{}}};
      }
    }catch(error){return {ok:false,error:{code:errorCode(error),message:error instanceof Error?error.message:'操作未完成',details:{}}};}
  }
  async dispose():Promise<void>{this.disposed=true;this.invalidate?.();this.controller?.abort(new Error('插件已停止'));await Promise.all([this.preflight.dispose(),this.job]);this.hiddenDeck=[];this.drawn=[];}
}
function tarotInterpretationInput(reading:TarotReading):string{
  const input={moduleId:'tarot',algorithmVersion:reading.algorithmVersion,deck:TAROT_DECK,
    question:reading.question,createdAt:reading.createdAt,includeReversed:reading.includeReversed,
    spread:reading.spread,cards:reading.cards};
  return `请根据以下固定抽牌记录完成解读：\n${JSON.stringify(input,null,2)}`;
}
function errorCode(error:unknown):string{return error!==null&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'TAROT_ERROR';}
