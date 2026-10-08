import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MeihuaService } from '../src/host/service.ts';
import { registerTransport } from '../src/host/transport.ts';
import type { HostContext,LogSession,LogEvent,GenerateOptions,LlmChunk,PersistenceHandle } from '../src/host/platform.ts';
import type { PluginConfig,Reading } from '../src/shared/protocol.ts';

// Use the installed DSH Session validator rather than a permissive log fake.
const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:4800,interpretationTimeoutMs:1500,maxOutputTokens:3000,pollIntervalMs:100};
const input={ruleId:'three-numbers',question:'测试问题',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-02T04:00:00Z',timeZone:'Asia/Shanghai',details:{observation:'微风'}}};
const route={provider:'second-provider',model:'second-model'};
function setup(generate:(options:GenerateOptions)=>AsyncIterable<LlmChunk>,persistence?:HostContext['sessionPersistence']) {
  const calls:GenerateOptions[]=[],events:LogEvent[]=[],disposers:(()=>void|Promise<void>)[]=[];
  const routes=new Map<string,{fetch(request:Request):Promise<Response>}>();
  let flushed=false;
  const ctx:HostContext={
    llm:{listProviders:()=>[{id:'first-provider',name:'First'},{id:route.provider,name:'Second'}],listModels:async p=>[{id:p===route.provider?route.model:'first-model',name:'Model'}],stream:options=>{assert.ok(flushed,'request metadata must be durable before the provider is called');assert.equal(options.sessionId,undefined,'private provider requests omit the ordinary Session ID');calls.push(options);return generate(options);}},
    sessions:{prepare:id=>new Session(id!,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},
    sessionPersistence:persistence??{create:async()=>({append:async rows=>{events.push(...rows);},flush:async()=>{flushed=true;},close:async()=>{}})},
    connection:{fetch:{register:route=>{assert.ok(!routes.has(route.path));routes.set(route.path,route);return async()=>{routes.delete(route.path);};}}},
    reflect:{provide:()=>async()=>{}},
    effect:factory=>{const dispose=factory();if(dispose)disposers.push(dispose);}
  };
  return {ctx,service:new MeihuaService(ctx,config),events,calls,routes,disposers,setFlushed:()=>{flushed=true;}};
}
async function* complete():AsyncGenerator<LlmChunk>{
  yield {type:'text-delta',index:0,text:'首份'};yield {type:'text-delta',index:0,text:'完整解读'};yield {type:'finish',reason:{kind:'stop'}};
}
async function settled(service:MeihuaService):Promise<Reading>{
  for(let i=0;i<200;i++){const reading=service.snapshot()!;if(reading.status!=='streaming')return reading;await new Promise(r=>setTimeout(r,10));}
  throw new Error('generation did not settle');
}

test('任意已配置供应商只调用一次，先持久化元信息，普通日志不保存首次解读全文',async()=>{
  const s=setup(complete),reading=await s.service.cast(input);
  const results=await Promise.allSettled([s.service.interpret(reading.id,route),s.service.interpret(reading.id,route)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const final=await settled(s.service);
  assert.equal(final.status,'complete');assert.equal(final.text,'首份完整解读');assert.equal(final.error,undefined);
  assert.deepEqual(final.route,route);assert.equal(s.calls.length,1);assert.ok(final.logSessionId);
  assert.ok(s.calls[0]!.messages[0]!.content[0]!.text.includes('测试问题'));
  assert.deepEqual(s.events.map(e=>e.type),['turn/start','step/start','request/header','private/request','private/result','step/end','turn/end']);
  const log=JSON.stringify(s.events);for(const fragment of [input.question,'微风','首份完整解读'])assert.ok(!log.includes(fragment));
  assert.equal((s.events.find(event=>event.type==='private/result')!.data as {status:string}).status,'complete');
  await assert.rejects(s.service.interpret(reading.id,route),/第一次/);assert.equal(s.calls.length,1);
  await s.service.dispose();
});
test('取消保留已输出内容并禁止重解，同一卦不发生后台重试',async()=>{
  const s=setup(async function*(options){yield {type:'text-delta',index:0,text:'已经收到的文字'};await new Promise<void>(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',()=>resolve(),{once:true});});options.signal.throwIfAborted();});
  const reading=await s.service.cast(input);await s.service.interpret(reading.id,route);
  while(!s.service.snapshot()!.text)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(s.service.cast(input),/等待/);s.service.cancel(reading.id);
  const final=await settled(s.service);
  assert.equal(final.status,'cancelled');assert.equal(final.text,'已经收到的文字');assert.equal(final.error!.code,'CANCELLED');
  assert.ok(s.events.some(e=>e.type==='private/result'&&(e.data as {status:string}).status==='cancelled'));
  await assert.rejects(s.service.interpret(reading.id,route),/第一次/);await s.service.cast(input);await s.service.dispose();
});
test('供应商错误、输出截断和空响应分别结束，已收到文字仍可查看',async()=>{
  for(const [finish,code] of [[{kind:'error',failure:{code:'AUTH',message:'credential unavailable'}},'AUTH'],[{kind:'max-tokens'},'INCOMPLETE'],[{kind:'stop'},'EMPTY_RESPONSE']] as const){
    const s=setup(async function*(){if(code!=='EMPTY_RESPONSE')yield {type:'text-delta',index:0,text:'部分文字'};yield {type:'finish',reason:finish};});
    const reading=await s.service.cast(input);await s.service.interpret(reading.id,route);const final=await settled(s.service);
    assert.equal(final.status,'failed');assert.equal(final.error!.code,code);assert.equal(s.calls.length,1);
    if(code!=='EMPTY_RESPONSE')assert.equal(final.text,'部分文字');await s.service.dispose();
  }
});
test('超时会终止生成；Session 创建失败也能正常收尾',async()=>{
  const s=setup(async function*(options){await new Promise<void>(resolve=>options.signal.addEventListener('abort',()=>resolve(),{once:true}));options.signal.throwIfAborted();});
  const reading=await s.service.cast(input);await s.service.interpret(reading.id,route);const final=await settled(s.service);
  assert.equal(final.error!.code,'TIMEOUT');assert.equal(s.calls.length,1);await s.service.dispose();
  const broken=setup(complete);broken.ctx.sessions.prepare=()=>{throw new Error('cannot prepare session');};
  const r=await broken.service.cast(input);await broken.service.interpret(r.id,route);assert.equal((await settled(broken.service)).status,'failed');assert.equal(broken.calls.length,0);await broken.service.dispose();
});
test('环境补充和额外数字方式可注册、冻结、撤销；缺失模型不消耗首次机会',async()=>{
  const s=setup(complete),remove=s.service.registerEnvironment('weather',()=>({description:'模拟晴天'}));
  const reading=await s.service.cast(input);assert.deepEqual(reading.result.input.environment.details.weather,{description:'模拟晴天'});
  assert.ok(Object.isFrozen(reading.result.input.environment.details));
  await assert.rejects(s.service.interpret(reading.id,{...route,model:'missing'}),/模型/);assert.equal(s.service.snapshot()!.status,'ready');assert.equal(s.calls.length,0);
  remove();assert.equal((await s.service.cast(input)).result.input.environment.details.weather,undefined);await s.service.dispose();
});
test('官方 Connection 精确路由支持完整 RPC 信封，错误信封被拒绝，贡献能撤销',async()=>{
  const s=setup(complete);registerTransport(s.ctx,s.service);assert.equal(s.routes.size,9);
  const endpoint=s.routes.get('/api/meihua/cast')!;
  const response=await endpoint.fetch(new Request('http://localhost/api/meihua/cast',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'cast-1',method:'meihua/cast',payload:input})}));
  const envelope=await response.json() as {type:string;rpcId:string;result:{ok:boolean;value:Reading}};
  assert.equal(envelope.type,'server-response');assert.equal(envelope.rpcId,'cast-1');assert.equal(envelope.result.value.result.primary.number,49);
  const followup=s.routes.get('/api/meihua/followup')!;
  const noReading=await followup.fetch(new Request('http://localhost/api/meihua/followup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'followup-1',method:'meihua/followup',payload:{id:envelope.result.value.id,question:'解释依据',expectedTurnCount:0}})}));
  const denied=await noReading.json() as {type:string;rpcId:string;result:{ok:boolean}};
  assert.equal(denied.type,'server-response');assert.equal(denied.rpcId,'followup-1');assert.equal(denied.result.ok,false);
  assert.equal((await endpoint.fetch(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,400);
  for(const dispose of s.disposers)await dispose();assert.equal(s.routes.size,0);await s.service.dispose();
});
test('使用发布版 DSH JSONL 后端读回终态元信息，排除私人问题、环境与输出',async()=>{
  const cordisPackage:string='@deepseek-ai/cordis';
  type Fiber={await():Promise<void>;dispose():Promise<void>};
  const {Context}=await import(cordisPackage) as {Context:new()=>{plugin(plugin:unknown,config:object):Fiber;get(name:string):unknown}};
  const module=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href) as {default:unknown};
  const root=await mkdtemp(join(tmpdir(),'meihua-log-')),ctx=new Context(),fiber=ctx.plugin(module.default,{root,compression:'none'});
  await fiber.await();
  const persistence=ctx.get('sessionPersistence') as HostContext['sessionPersistence'] & {open(id:string,mode:'read'):Promise<PersistenceHandle & {read():Promise<{events:LogEvent[]}>}>;locate(meta:LogSession['header']):{path:string}};
  const s=setup(complete,persistence);s.setFlushed();
  try{
    const reading=await s.service.cast(input);await s.service.interpret(reading.id,route);const final=await settled(s.service);
    assert.equal(final.status,'complete');assert.equal(final.error,undefined);
    const handle=await persistence.open(final.logSessionId!,'read'),{events:rows}=await handle.read();await handle.close();
    assert.ok(rows.some(e=>e.type==='private/result'));assert.equal(rows.at(-1)!.type,'turn/end');
    const path=persistence.locate({id:final.logSessionId!,version:4,createdAt:0}).path;
    const body=await readFile(path,'utf8');
    for(const fragment of [input.question,'微风','首份完整解读'])assert.ok(!body.includes(fragment));
    assert.deepEqual(rows.map(row=>row.type),['turn/start','step/start','request/header','private/request','private/result','step/end','turn/end']);
    assert.equal((rows.find(row=>row.type==='private/result')!.data as {status:string}).status,'complete');
    assert.ok(rows.filter(row=>row.type.startsWith('private/')).every(row=>(row as LogEvent&{ignorable?:boolean}).ignorable===true));
  }finally{await s.service.dispose();await fiber.dispose();await rm(root,{recursive:true,force:true});}
});
