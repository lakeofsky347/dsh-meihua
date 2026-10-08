import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivate, withBackground } from '../src/host/private-generation.ts';
import type { PrivateGeneration } from '../src/host/private-generation.ts';
import type { MemoryService } from '../src/host/memory-service.ts';
import type { GenerateOptions, HostContext, LlmChunk, LogEvent, LogSession, ModelInfo, PreparedCall } from '../src/host/platform.ts';
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


test('最高思考与真实模型上限同时发送，prepareCall配置与日志保持一致',async()=>{
  const s=setup(async function*(){yield {type:'reasoning-delta',index:0,text:'PRIVATE_REASONING'};yield {type:'text-delta',index:1,text:output};yield {type:'usage',usage:{reasoningTokens:123}};yield {type:'finish',reason:{kind:'stop'}};});
  s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',context:{contextWindow:262144},defaultMaxTokens:3000,maxOutputTokens:65536,outputTokenAccounting:'includes-reasoning',reasoning:{efforts:[{id:'maximum-fixture',name:'最大'},{id:'off',name:'关闭'}],maxEffort:'maximum-fixture'}});
  const phases:string[]=[];
  let preparedCalls=0;
  s.ctx.llm.prepareCall=async config=>{preparedCalls++;return {config,context:{contextWindow:262144},maxOutputTokens:65536,outputTokenAccounting:'includes-reasoning',reasoning:{efforts:[{id:'maximum-fixture',name:'最大'},{id:'off',name:'关闭'}],maxEffort:'maximum-fixture'},stream:options=>s.ctx.llm.stream(options)};};
  const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},{...request,onGeneration:info=>phases.push(info.phase)},new AbortController());
  assert.equal(result.status,'complete');assert.equal(preparedCalls,1);assert.equal(s.calls[0]!.maxTokens,65536);assert.equal(s.calls[0]!.reasoningEffort,'maximum-fixture');
  assert.equal(result.generation.budgetSource,'model-maximum');assert.equal(result.generation.reasoningStatus,'maximum');assert.ok(phases.includes('thinking'));assert.ok(phases.includes('responding'));assert.equal(phases.at(-1),'finished');
  assert.ok(JSON.stringify(s.events).includes('reasoningTokens'));assert.ok(!JSON.stringify(s.events).includes('PRIVATE_REASONING'));assertPrivateLog(s.events);
});

test('默认预算不冒充模型最大；未知档位不猜测，禁用思考的路由仍可用',async()=>{
  for(const reasoning of [undefined,{efforts:[{id:'off',name:'关闭'}],maxEffort:'off'},{efforts:[{id:'mystery',name:'未知档位'}]}]){
    const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
    s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',defaultMaxTokens:8192,reasoning});
    const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
    assert.equal(result.status,'complete');assert.equal(s.calls[0]!.maxTokens,8192);assert.equal(s.calls[0]!.reasoningEffort,undefined);assert.equal(result.generation.budgetSource,'host-default');assert.notEqual(result.generation.reasoningStatus,'maximum');
  }
});

test('旧宿主未知预算保持省略，上下文已知时保留超过60000字符的全部原文',async()=>{
  const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
  const first=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
  assert.equal(first.status,'complete');assert.equal(s.calls[0]!.maxTokens,undefined);
  s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',context:{contextWindow:262144},maxOutputTokens:65536});
  const messages=[{...request.messages[0]!,content:[{type:'text' as const,text:'x'.repeat(70000)}]}];
  const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},{...request,id:'large-context',messages},new AbortController());
  assert.equal(result.status,'complete');assert.equal(s.calls[1]!.messages[0]!.content[0]!.text.length,70000);assert.ok(result.generation.contextLimitCharacters!>60000);
});

test('上下文无空间时拒绝模型调用；已知空间会限制请求预算但不删前文',async()=>{
  const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
  s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',context:{contextWindow:8192},maxOutputTokens:65536});
  const tooLarge={...request,messages:[{...request.messages[0]!,content:[{type:'text' as const,text:'字'.repeat(3000)}]}]};
  const failure=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},tooLarge,new AbortController());
  assert.equal(failure.error?.code,'CONTEXT_LIMIT');assert.equal(s.calls.length,0);
  const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
  assert.equal(result.status,'complete');assert.ok(s.calls[0]!.maxTokens!<8192);assert.equal(s.calls[0]!.messages[0]!.content[0]!.text,canary);
});

test('prepared上下文缩小或新声明的窗口已不足时，在请求日志和派发前拒绝',async()=>{
  for(const mode of ['smaller','newly-known'] as const){
    const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
    s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',...(mode==='smaller'?{context:{contextWindow:32768}}:{}),maxOutputTokens:16384});
    s.ctx.llm.prepareCall=async call=>({config:call,context:{contextWindow:mode==='smaller'?8192:4096},maxOutputTokens:16384,stream:options=>s.ctx.llm.stream(options)});
    const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
    assert.equal(result.error?.code,'MODEL_CHANGED',mode);assert.equal(result.status,'failed');assert.equal(result.text,'');
    assert.equal(s.calls.length,0);assert.equal(s.events.length,0);
  }
});

test('prepare后补宿主默认预算仍受冻结上下文约束，安全预算按实际值显示',async()=>{
  for(const budget of [16384,1024]){
    const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
    s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',context:{contextWindow:8192}});
    s.ctx.llm.prepareCall=async call=>{assert.equal(call.maxTokens,undefined);return {config:{...call,maxTokens:budget},context:{contextWindow:8192},stream:options=>s.ctx.llm.stream(options)};};
    const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
    if(budget===16384){assert.equal(result.error?.code,'MODEL_CHANGED');assert.equal(s.calls.length,0);assert.equal(s.events.length,0);}
    else{assert.equal(result.status,'complete');assert.equal(s.calls[0]!.maxTokens,1024);assert.equal(result.generation.maxTokens,1024);assert.equal(result.generation.budgetSource,'host-default');assertPrivateLog(s.events);}
  }
});

test('prepared支持档位、最高档、输出硬上限或计量口径发生变化均不使用过期声明',async()=>{
  const info:ModelInfo={provider:'fixture',id:'local',name:'Fixture',context:{contextWindow:32768},maxOutputTokens:8192,outputTokenAccounting:'includes-reasoning',reasoning:{efforts:[{id:'high',name:'高'},{id:'max',name:'最大'}],maxEffort:'max'}};
  const changes:Partial<PreparedCall>[]=[
    {reasoning:{efforts:[{id:'max',name:'最大'}],maxEffort:'max'}},
    {reasoning:{efforts:info.reasoning!.efforts,maxEffort:'high'}},
    {maxOutputTokens:16384},
    {maxOutputTokens:4096},
    {outputTokenAccounting:'excludes-reasoning'},
  ];
  for(const change of changes){
    const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
    s.ctx.llm.resolveModelInfo=async()=>info;
    s.ctx.llm.prepareCall=async call=>({config:call,context:info.context,maxOutputTokens:info.maxOutputTokens,reasoning:info.reasoning,outputTokenAccounting:info.outputTokenAccounting,stream:options=>s.ctx.llm.stream(options),...change});
    const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
    assert.equal(result.error?.code,'MODEL_CHANGED',JSON.stringify(change));assert.equal(s.calls.length,0);assert.equal(s.events.length,0);
  }
});

test('旧prepared接口省略新能力字段仍兼容，已知档位顺序与名称变化不误判',async()=>{
  for(const legacy of [true,false]){
    const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
    s.ctx.llm.resolveModelInfo=async()=>({provider:'fixture',id:'local',name:'Fixture',context:{contextWindow:32768},maxOutputTokens:8192,outputTokenAccounting:'includes-reasoning',reasoning:{efforts:[{id:'high',name:'高'},{id:'max',name:'最大'}],maxEffort:'max'}});
    s.ctx.llm.prepareCall=async call=>({config:call,context:{contextWindow:32768},...(legacy?{}:{maxOutputTokens:8192,outputTokenAccounting:'includes-reasoning' as const,reasoning:{efforts:[{id:'max',name:'最高'},{id:'high',name:'高'}],maxEffort:'max'}}),stream:options=>s.ctx.llm.stream(options)});
    const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
    assert.equal(result.status,'complete');assert.equal(s.calls[0]!.maxTokens,8192);assert.equal(s.calls[0]!.reasoningEffort,'max');assert.equal(result.generation.reasoningStatus,'maximum');
    assert.equal(result.generation.reasoningLabel,legacy?'最大':'最高');assertPrivateLog(s.events);
  }
});

test('旧prepared接口和未知模型能力不冒充已知思考支持',async()=>{
  const s=setup(async function*(){yield {type:'text-delta',index:0,text:output};yield {type:'finish',reason:{kind:'stop'}};});
  s.ctx.llm.prepareCall=async call=>({config:call,stream:options=>s.ctx.llm.stream(options)});
  const result=await generatePrivate(s.ctx,{...config,maxOutputTokens:'model-maximum'},request,new AbortController());
  assert.equal(result.status,'complete');assert.equal(result.generation.reasoningStatus,'unknown');assert.equal(result.generation.maxTokens,undefined);
});
