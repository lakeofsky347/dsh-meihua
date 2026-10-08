import type { ModuleId } from "../shared/modules.ts";
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm/message';
import { readingIsBusy } from '../shared/protocol.ts';
import type { ConversationTurn, GenerationInfo, ModelRoute, PluginConfig, Reading, TarotReading } from '../shared/protocol.ts';
import type { DurableMessage, HostContext } from './platform.ts';
import { generatePrivate } from './private-generation.ts';
import type { MemoryService } from './memory-service.ts';

export type ConversationReading={status:string;text:string;route?:ModelRoute;error?:{code:string;message:string};conversation?:ConversationTurn[];generation?:GenerationInfo};
const MAX_CONTEXT_CHARACTERS=60000;

export { followupSystem } from './interpretation-prompts.ts';

/** Validate before the async catalog read, and again afterwards before claiming the generation slot. */
export function validateFollowup(reading:ConversationReading,question:unknown,expectedTurnCount:unknown):string {
  if(readingIsBusy(reading))throw Object.assign(new Error('请等待本次解读或追问结束，或先取消'),{code:'GENERATION_BUSY'});
  if(reading.status!=='complete'&&reading.status!=='failed'&&reading.status!=='cancelled')throw new Error('请先完成首次解读，再继续追问');
  if(!reading.text.trim()||!reading.route)throw new Error('首次解读尚无文字，请重新起卦或抽牌后解读');
  if(typeof question!=='string'||question.length>2000||!question.trim())throw Object.assign(new Error('追问须为 1 至 2000 个字符的文字'),{code:'INVALID_QUESTION'});
  if(typeof expectedTurnCount!=='number'||!Number.isSafeInteger(expectedTurnCount)||expectedTurnCount<0||expectedTurnCount!==(reading.conversation?.length??0))throw Object.assign(new Error('对话已变化，请刷新后再发送追问'),{code:'CONVERSATION_CHANGED'});
  return question.trim();
}

/** A stale window must never cancel a newer follow-up that shares the same reading ID. */
export function validateCancellation(reading:ConversationReading,turnId?:string,expectedAttempt?:unknown):boolean {
  if(!readingIsBusy(reading))return false;
  const activeTurn=reading.conversation?.find(turn=>turn.status==='streaming');
  const target=reading.status==='streaming'&&turnId===undefined?reading:activeTurn;
  const attempt=target?.generation?.attempt??0;
  if(target&&((expectedAttempt===undefined&&attempt!==0)||(expectedAttempt!==undefined&&expectedAttempt!==attempt)))throw Object.assign(new Error('生成次数已变化，请刷新后再取消'),{code:'CONVERSATION_CHANGED'});
  if(reading.status==='streaming'&&turnId===undefined)return true;
  if(!activeTurn||turnId!==activeTurn.id)throw Object.assign(new Error('对话已变化，请刷新后再取消当前追问'),{code:'CONVERSATION_CHANGED'});
  return true;
}

function answerText(text:string,status:string,error?:{code:string;message:string}):string {
  if(status==='complete')return text;
  return `【这份回答未完成；状态：${status==='cancelled'?'已取消':'失败'}${error?`；原因：${error.message}`:''}。以下仅为已收到的部分文字，不能当作完整结论。】\n${text||'【这一轮没有收到文字回答。】'}`;
}

/** Full role-ordered history; no hidden truncation or summary replaces previous answers. */
export function conversationMessages(reading:ConversationReading,input:string,question:string,system:string,maxCharacters=MAX_CONTEXT_CHARACTERS):DurableMessage[] {
  const route=reading.route!;
  const user=(value:string)=>createUserMessage({content:[{type:'text',text:value}],source:{kind:'user'}});
  const assistant=(value:string,source:ModelRoute)=>createAssistantMessage({content:[{type:'text',text:value}],source});
  const messages=[user(input),assistant(answerText(reading.text,reading.status,reading.error),route)];
  for(const turn of reading.conversation??[]){
    messages.push(user(turn.question),assistant(answerText(turn.text,turn.status,turn.error),turn.route));
  }
  messages.push(user(question));
  const length=system.length+messages.reduce((total,message)=>total+message.content.reduce((sum,block)=>sum+block.text.length,0),0);
  if(length>maxCharacters)throw Object.assign(new Error(`完整对话已超过 ${maxCharacters} 字符，未发送本次追问。请保存现有记录后开始新的一次`),{code:'CONTEXT_LIMIT'});
  return messages;
}

/** Every follow-up retains the role-ordered request in the encrypted private audit. */
export async function generateConversation(ctx:HostContext,config:PluginConfig,turn:ConversationTurn,messages:DurableMessage[],system:string,controller:AbortController,memory?:MemoryService,epoch?:number,backgroundRevision?:number,moduleId?:ModuleId):Promise<void> {
  const result=await generatePrivate(ctx,config,{id:turn.id,moduleId:moduleId??(turn.id.startsWith('tarot-')?'tarot':'meihua'),kind:'followup',route:turn.route,messages,system,epoch,backgroundRevision,onText:text=>{turn.text=text;},onGeneration:info=>{turn.generation=info;}},controller,memory);
  Object.assign(turn,result);
}
