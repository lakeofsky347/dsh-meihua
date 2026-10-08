import type { CallConfig, DurableMessage, HostContext, ModelInfo, PreparedCall } from './platform.ts';
import type { GenerationInfo, ModelRoute, PluginConfig } from '../shared/protocol.ts';

export interface GenerationPolicy {
  config:CallConfig;
  info?:ModelInfo;
  display:Pick<GenerationInfo,'reasoningLabel'|'reasoningStatus'|'maxTokens'|'budgetSource'|'outputTokenAccounting'|'contextCharacters'|'contextLimitCharacters'>;
}

/** A conservative UTF-8 estimate, not a tokenizer or an exact provider token count. */
export function contextSize(messages:readonly DurableMessage[],system:string):{characters:number;estimatedTokens:number} {
  const strings=[system,...messages.flatMap(message=>message.content.map(block=>block.text))];
  return {characters:strings.reduce((sum,value)=>sum+value.length,0),estimatedTokens:strings.reduce((sum,value)=>sum+Buffer.byteLength(value,'utf8'),0)+(messages.length+1)*32};
}

/** Legacy adapters expose named levels but not their order; unfamiliar ids remain unknown. */
function maximumEffort(info:ModelInfo|undefined):{effort?:string;label?:string;status:GenerationInfo['reasoningStatus']} {
  const reasoning=info?.reasoning;
  if(!reasoning||reasoning.efforts.every(value=>value.id==='off'))return {status:'unavailable',label:'该路由未开放思考档位'};
  let maximum=reasoning.maxEffort;
  const standard=['off','minimal','low','medium','high','xhigh','max','ultra'];
  if(!maximum&&reasoning.efforts.every(value=>standard.includes(value.id))){
    maximum=standard.filter(id=>reasoning.efforts.some(value=>value.id===id)).at(-1);
  }
  const supported=reasoning.efforts.find(value=>value.id===maximum);
  if(!supported||supported.id==='off')return {status:'unknown',label:'最高思考档位未知 · 使用宿主默认'};
  return {effort:supported.id,label:supported.name,status:'maximum'};
}

/** Resolve output allowance from declared capability; never interpret a default as a maximum. */
export async function generationPolicy(ctx:HostContext,config:PluginConfig,route:ModelRoute,messages:readonly DurableMessage[],system:string,signal?:AbortSignal):Promise<GenerationPolicy> {
  const info=await ctx.llm.resolveModelInfo?.(route.provider,route.model,signal);
  return policyFromInfo(info,config,route,messages,system);
}

function policyFromInfo(info:ModelInfo|undefined,config:PluginConfig,route:ModelRoute,messages:readonly DurableMessage[],system:string):GenerationPolicy {
  const size=contextSize(messages,system),fallbackLimit=config.maxContextCharacters??60000;
  const window=info?.context?.contextWindow,safety=config.contextSafetyTokens??4096;
  let room:number|undefined,limit=fallbackLimit;
  if(window!==undefined){
    room=Math.floor(window-size.estimatedTokens-safety);
    limit=Math.max(size.characters,size.characters+Math.floor((room-256)/3));
    if(room<256)throw Object.assign(new Error('完整对话接近模型上下文容量，未发送本次请求。已保留全部原文，请保存后开始新一轮。容量按保守估算检查。'),{code:'CONTEXT_LIMIT'});
  }else if(size.characters>fallbackLimit){
    throw Object.assign(new Error(`完整对话已超过 ${fallbackLimit} 字符，模型未声明上下文容量，未发送本次请求。请保存现有记录后开始新的一次。`),{code:'CONTEXT_LIMIT'});
  }
  const mode=config.maxOutputTokens;
  const requested=typeof mode==='number'?mode:info?.maxOutputTokens??info?.defaultMaxTokens;
  const budgetSource:GenerationInfo['budgetSource']=typeof mode==='number'?'fallback':info?.maxOutputTokens!==undefined?'model-maximum':'host-default';
  const maxTokens=requested===undefined?undefined:Math.min(requested,info?.maxOutputTokens??Number.MAX_SAFE_INTEGER,room??Number.MAX_SAFE_INTEGER);
  const effort=info?maximumEffort(info):{status:'unknown' as const,label:'宿主未提供思考能力信息'};
  return {info,config:{...route,...(maxTokens===undefined?{}:{maxTokens}),...(effort.effort?{reasoningEffort:effort.effort}:{})},
    display:{reasoningStatus:effort.status,...(effort.label?{reasoningLabel:effort.label}:{}),...(maxTokens===undefined?{}:{maxTokens}),budgetSource,...(info?.outputTokenAccounting?{outputTokenAccounting:info.outputTokenAccounting}:{}),
      contextCharacters:size.characters,contextLimitCharacters:limit}};
}

/** Validate the immutable dispatch snapshot before writing request logs or starting its stream. */
export function preparedGenerationPolicy(policy:GenerationPolicy,prepared:PreparedCall,config:PluginConfig,messages:readonly DurableMessage[],system:string):GenerationPolicy {
  const call=prepared.config,previous=policy.info;
  const changed=():never=>{throw Object.assign(new Error('模型能力已变化，本次未发送，请重试本轮'),{code:'MODEL_CHANGED'});};
  if(call.provider!==policy.config.provider||call.model!==policy.config.model)changed();
  if(policy.config.maxTokens!==undefined&&call.maxTokens!==policy.config.maxTokens)changed();
  if(policy.config.reasoningEffort!==undefined&&call.reasoningEffort!==policy.config.reasoningEffort)changed();
  // Context is part of the original prepared API. Losing a known window also invalidates the estimate.
  if(previous?.context&&prepared.context?.contextWindow!==previous.context.contextWindow)changed();
  // Older hosts omit these newer fields. Their absence alone is not evidence of a capability change.
  if(previous?.maxOutputTokens!==undefined&&prepared.maxOutputTokens!==undefined&&previous.maxOutputTokens!==prepared.maxOutputTokens)changed();
  if(previous?.outputTokenAccounting!==undefined&&prepared.outputTokenAccounting!==undefined&&previous.outputTokenAccounting!==prepared.outputTokenAccounting)changed();
  if(previous?.reasoning&&prepared.reasoning&&reasoningSignature(previous.reasoning)!==reasoningSignature(prepared.reasoning))changed();
  const info:ModelInfo={
    ...(previous??{provider:call.provider,id:call.model,name:call.model}),
    ...(prepared.context?{context:prepared.context}:{}),
    ...(prepared.maxOutputTokens!==undefined?{maxOutputTokens:prepared.maxOutputTokens}:{}),
    ...(prepared.reasoning?{reasoning:prepared.reasoning}:{}),
    ...(prepared.outputTokenAccounting?{outputTokenAccounting:prepared.outputTokenAccounting}:{}),
  };
  const route={provider:call.provider,model:call.model};
  const actual=(()=>{try{return policyFromInfo(info,config,route,messages,system);}catch{return changed();}})();
  const window=info.context?.contextWindow;
  const room=window===undefined?undefined:Math.floor(window-contextSize(messages,system).estimatedTokens-(config.contextSafetyTokens??4096));
  if(call.maxTokens!==undefined&&(!Number.isSafeInteger(call.maxTokens)||call.maxTokens<=0))changed();
  // prepareCall may fill in a host default that was absent from resolveModelInfo.
  // It is still an output request and must fit the frozen window and hard output capability.
  if(room!==undefined&&(call.maxTokens===undefined||call.maxTokens>room))changed();
  if(info.maxOutputTokens!==undefined&&(call.maxTokens===undefined||call.maxTokens>info.maxOutputTokens))changed();
  if(actual.config.maxTokens!==undefined&&call.maxTokens!==actual.config.maxTokens)changed();
  if(actual.config.reasoningEffort!==undefined&&call.reasoningEffort!==actual.config.reasoningEffort)changed();
  if(info.reasoning&&call.reasoningEffort!==undefined&&!info.reasoning.efforts.some(effort=>effort.id===call.reasoningEffort))changed();
  // Labels and reported budgets follow the dispatch snapshot, including a safely added host default.
  return {...actual,config:call,display:{...actual.display,
    ...(!previous&&!prepared.reasoning?{reasoningStatus:policy.display.reasoningStatus,reasoningLabel:policy.display.reasoningLabel}:{}),
    ...(call.maxTokens===undefined?{}:{maxTokens:call.maxTokens})}};
}

function reasoningSignature(reasoning:NonNullable<ModelInfo['reasoning']>):string {
  return JSON.stringify({efforts:reasoning.efforts.map(effort=>effort.id).sort(),maxEffort:reasoning.maxEffort,defaultEffort:reasoning.defaultEffort});
}
