import {randomUUID} from 'node:crypto';
import {createAssistantMessage,createUserMessage} from '@deepseek-ai/dsh-llm/message';
import type {ConversationTurn,GenerationInfo,ModelRoute,PluginConfig} from '../shared/protocol.ts';
import {readingIsBusy} from '../shared/protocol.ts';
import type {ModuleId} from '../shared/modules.ts';
import type {MemorySnapshot} from '../shared/memory.ts';
import type {HostContext,DurableMessage} from './platform.ts';
import type {MemoryService} from './memory-service.ts';
import {conversationMessages} from './conversation.ts';
import {CONTINUATION_INSTRUCTION,RETRY_INSTRUCTION,interpretationSystem} from './interpretation-prompts.ts';
import {generatePrivate} from './private-generation.ts';

interface RecoveryTarget {id:string;status:string;text:string;route?:ModelRoute;error?:{code:string;message:string};generation?:GenerationInfo;logSessionId?:string}
export interface RecoveryReading extends RecoveryTarget {conversation?:ConversationTurn[]}
export interface RecoveryRequest {expectedTurnCount:unknown;expectedAttempt:unknown;turnId?:string}
export interface RecoveryPlan {target:RecoveryTarget;system:string;messages:DurableMessage[];attempt:number;prefix:string}

/** Recovery only changes the latest answer, with independent conversation and attempt checks. */
export function validateRecovery(reading:RecoveryReading,request:RecoveryRequest):RecoveryTarget {
  if(readingIsBusy(reading))throw Object.assign(new Error('请等待本次解读结束，或先取消'),{code:'GENERATION_BUSY'});
  const turns=reading.conversation??[];
  const changed=()=>Object.assign(new Error('对话或生成次数已变化，请刷新后重试'),{code:'CONVERSATION_CHANGED'});
  if(request.expectedTurnCount!==turns.length)throw changed();
  const target=request.turnId===undefined?reading:turns.at(-1);
  if(!target||(request.turnId===undefined?turns.length!==0:target.id!==request.turnId))throw changed();
  if(request.expectedAttempt!==(target.generation?.attempt??0))throw changed();
  if(!target.route||!['failed','cancelled'].includes(target.status))throw Object.assign(new Error('只有最近一次未完成回答可以继续或重试'),{code:'NOT_RECOVERABLE'});
  return target;
}

/** Preserve every prior message and the exact incomplete prefix; never recast or summarize. */
export function recoveryPlan(reading:RecoveryReading,input:string,moduleId:ModuleId,request:RecoveryRequest):RecoveryPlan {
  const target=validateRecovery(reading,request),system=interpretationSystem(moduleId,request.turnId?'followup':'initial');
  const user=(text:string)=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
  const messages=request.turnId===undefined?[user(input)]:conversationMessages({...reading,conversation:reading.conversation!.slice(0,-1)},input,reading.conversation!.at(-1)!.question,system,Infinity);
  if(target.text.trim())messages.push(createAssistantMessage({content:[{type:'text',text:target.text}],source:target.route!}),user(CONTINUATION_INSTRUCTION));
  else messages.push(user(RETRY_INSTRUCTION));
  return {target,system,messages,attempt:(target.generation?.attempt??0)+1,prefix:target.text};
}

/** Each explicit recovery gets a new encrypted audit, while the displayed answer retains its prefix. */
export async function generateRecovery(ctx:HostContext,config:PluginConfig,reading:RecoveryReading,moduleId:ModuleId,plan:RecoveryPlan,controller:AbortController,memory?:MemoryService,background?:MemorySnapshot):Promise<void> {
  const target=plan.target;
  target.status='streaming';delete target.error;
  const joined=(text:string)=>plan.prefix&&text?plan.prefix+'\n\n'+text:plan.prefix||text;
  const result=await generatePrivate(ctx,config,{id:`${reading.id}-resume-${randomUUID()}`,moduleId,kind:target===reading?'initial':'followup',route:target.route!,
    system:plan.system,messages:plan.messages,attempt:plan.attempt,epoch:background?.epoch,backgroundRevision:background?.revision,
    onText:text=>{target.text=joined(text);},onGeneration:info=>{target.generation=info;}},controller,memory);
  Object.assign(target,result,{text:joined(result.text)});
}
