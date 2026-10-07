import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivate, withBackground } from '../src/host/private-generation.ts';
import type { PrivateGeneration } from '../src/host/private-generation.ts';
import type { MemoryService } from '../src/host/memory-service.ts';
import type { GenerateOptions, HostContext, LlmChunk, LogEvent, LogSession } from '../src/host/platform.ts';
import type { PluginConfig } from '../src/shared/protocol.ts';

const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:1000,maxOutputTokens:3000,pollIntervalMs:100};
const canary='SYNTHETIC_PRIVATE_CONTEXT_20261006';
const output='SYNTHETIC_PRIVATE_ANSWER_20261006';
const errorEcho='SYNTHETIC_PROVIDER_ERROR_ECHO_20261006';
const request:PrivateGeneration={id:'synthetic-request-01',moduleId:'meihua',kind:'initial',route:{provider:'fixture',model:'local'},system:'中文解读规则',messages:[{id:'synthetic-user-01',role:'user',source:{kind:'user'},content:[{type:'text',text:canary}]}]};

function setup(stream:(options:GenerateOptions)=>AsyncIterable<LlmChunk>){
  const events:LogEvent[]=[],calls:GenerateOptions[]=[];
  let flushed=false;
  const ctx:HostContext={
    llm:{listProviders:()=>[],listModels:async()=>[],stream:options=>{assert.ok(flushed);assert.equal(options.sessionId,undefined);calls.push(options);return stream(options);}},
    sessions:{prepare:id=>new Session(id!,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},
    sessionPersistence:{create:async()=>({append:async rows=>{events.push(...rows);},flush:async()=>{flushed=true;},close:async()=>{}})},
    connection:{fetch:{register:()=>async()=>{}}},reflect:{provide:()=>async()=>{}},effect:factory=>factory(),
  };
  return {ctx,events,calls};
}
function assertPrivateLog(events:LogEvent[]){
  assert.deepEqual(events.map(event=>event.type),['turn/start','step/start','request/header','private/request','private/result','step/end','turn/end']);
  const log=JSON.stringify(events);
  for(const marker of [canary,output,errorEcho])assert.ok(!log.includes(marker),`ordinary log leaked ${marker}`);
  assert.ok(!events.some(event=>['system/message','user/message','assistant/message','assistant/attempt'].includes(event.type)));
  assert.ok(events.filter(event=>event.type.startsWith('private/')).every(event=>(event as LogEvent&{ignorable?:boolean}).ignorable===true));
}

test('私人生成首解只向模型传完整资料，普通日志只含元信息及安全计量',async()=>{
  const s=setup(async function*(){
    yield {type:'text-delta',index:0,text:output};
    yield {type:'usage',usage:{inputTokens:20,outputTokens:10,privateEcho:canary,extra:{description:output}}};
    yield {type:'finish',reason:{kind:'stop'}};
  });
  const result=await generatePrivate(s.ctx,config,{...request,backgroundRevision:17},new AbortController());
  assert.equal(result.status,'complete');assert.equal(result.text,output);assert.equal(s.calls.length,1);
  assert.equal(s.calls[0]!.messages[0]!.content[0]!.text,canary);assertPrivateLog(s.events);
  assert.equal((s.events.find(event=>event.type==='private/result')!.data as {status:string}).status,'complete');
  assert.equal((s.events.find(event=>event.type==='private/request')!.data as {backgroundRevision:number}).backgroundRevision,17);
});

test('未知供应商错误代码只在私人结果保留，普通日志使用稳定通用代码',async()=>{
  const privateCode='SYNTHETIC_CODE_CANARY_20261006';
  const s=setup(async function*(){yield {type:'finish',reason:{kind:'error',failure:{code:privateCode,message:errorEcho}}};});
  const result=await generatePrivate(s.ctx,config,request,new AbortController());
  assert.equal(result.status,'failed');assert.equal(result.error!.code,privateCode);
  assert.ok(!JSON.stringify(s.events).includes(privateCode));assertPrivateLog(s.events);
});

test('私人生成取消保留部分输出，供应商错误回显不进入普通日志',async()=>{
  for(const mode of ['cancel','failure'] as const){
    const controller=new AbortController();
    const s=setup(async function*(){
      yield {type:'text-delta',index:0,text:output};
      if(mode==='cancel')controller.abort(new Error(errorEcho));
      else yield {type:'finish',reason:{kind:'error',failure:{code:'AUTH',message:errorEcho}}};
    });
    const result=await generatePrivate(s.ctx,config,request,controller);
    assert.equal(result.status,mode==='cancel'?'cancelled':'failed');assert.equal(result.text,output);
    assert.equal(result.error!.code,mode==='cancel'?'CANCELLED':'AUTH');assertPrivateLog(s.events);
  }
});

test('加密私人请求保存失败时不调用模型，也不回退保存完整普通日志',async()=>{
  const s=setup(async function*(){yield {type:'finish',reason:{kind:'stop'}};});
  const memory={assertUnlocked:()=>{},writeAudit:async()=>{throw new Error(canary);}} as unknown as MemoryService;
  const result=await generatePrivate(s.ctx,config,request,new AbortController(),memory);
  assert.equal(result.status,'failed');assert.equal(result.error!.code,'LOG_WRITE');assert.equal(s.calls.length,0);
  assert.ok(!JSON.stringify(s.events).includes(canary));
});

test('正常取消轮的加密记录保留原问题与上下文，避免终态覆盖掉私人请求',async()=>{
  const records:Record<string,unknown>[]=[];
  const memory={assertUnlocked:()=>{},writeAudit:async(_id:string,value:Record<string,unknown>)=>{records.push(value);}} as unknown as MemoryService;
  const controller=new AbortController();
  const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};controller.abort(new Error('合成取消'));});
  const result=await generatePrivate(s.ctx,config,request,controller,memory);
  assert.equal(result.status,'cancelled');assert.equal(records.length,2);
  assert.deepEqual(records.at(-1)!.messages,request.messages);assert.equal(records.at(-1)!.system,request.system);
  assert.equal(records.at(-1)!.text,output);assertPrivateLog(s.events);
});

test('共享背景作为用户资料附加，停用和空文档不追加上下文',()=>{
  const snapshot={enabled:true,forOthers:false,revision:7,epoch:3,markdown:canary};
  const text=withBackground('冻结占卜记录',snapshot);
  assert.ok(text.startsWith('冻结占卜记录'));assert.ok(text.includes(canary));assert.ok(text.includes('"revision":7'));
  assert.equal(withBackground('冻结占卜记录',{...snapshot,enabled:false}),'冻结占卜记录');
  assert.equal(withBackground('冻结占卜记录',{...snapshot,markdown:'  '}),'冻结占卜记录');
});
