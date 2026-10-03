import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TarotService } from '../src/host/tarot-service.ts';
import { MeihuaService } from '../src/host/service.ts';
import { GenerationGate } from '../src/host/generation-gate.ts';
import type { GenerateOptions, HostContext, LlmChunk, LogEvent, LogSession, PersistenceHandle } from '../src/host/platform.ts';
import type { PluginConfig, TarotReading } from '../src/shared/protocol.ts';
import type { TarotSpreadId } from '../src/tarot/types.ts';

const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:200,maxOutputTokens:3000,pollIntervalMs:100};
const route={provider:'configured',model:'chosen'};
const startInput={question:'这次学习如何安排？',spreadId:'timeline' as TarotSpreadId,includeReversed:true};
async function* complete():AsyncGenerator<LlmChunk>{yield {type:'text-delta',index:0,text:'完整塔罗解读'};yield {type:'finish',reason:{kind:'stop'}};}
async function* untilCancelled(options:GenerateOptions):AsyncGenerator<LlmChunk>{
  yield {type:'text-delta',index:0,text:'已经收到的塔罗文字'};
  await new Promise<void>(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',()=>resolve(),{once:true});});
  options.signal.throwIfAborted();
}
function setup(generate:(options:GenerateOptions)=>AsyncIterable<LlmChunk>=complete,persistence?:HostContext['sessionPersistence']){
  const calls:GenerateOptions[]=[],events:LogEvent[]=[];
  let flushed=false,closed=0;
  const ctx:HostContext={
    llm:{listProviders:()=>[{id:route.provider,name:'Configured'}],listModels:async()=>[{id:route.model,name:'Chosen'}],stream:options=>{assert.ok(flushed,'provider must run after a durable request');calls.push(options);return generate(options);}},
    sessions:{prepare:id=>new Session(id!,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},
    sessionPersistence:persistence??{create:async()=>({append:async rows=>{events.push(...rows);},flush:async()=>{flushed=true;},close:async()=>{closed++;}})},
    connection:{fetch:{register:()=>async()=>{}}},reflect:{provide:()=>async()=>{}},effect:factory=>factory(),
  };
  const gate=new GenerationGate();
  return {ctx,gate,service:new TarotService(ctx,config,gate),calls,events,getClosed:()=>closed,setFlushed:()=>{flushed=true;}};
}
function ready(service:TarotService,spreadId:TarotSpreadId='timeline'):TarotReading{
  const reading=service.start({...startInput,spreadId});
  for(let slot=0;slot<reading.spread.cardCount;slot++)service.select(reading.id,slot);
  return service.reveal(reading.id,undefined,true);
}
async function settled(service:TarotService):Promise<TarotReading>{
  for(let index=0;index<200;index++){
    const reading=service.snapshot()!;if(reading.status!=='streaming')return reading;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw new Error('Tarot generation did not settle');
}
async function textArrived(service:TarotService):Promise<void>{
  for(let index=0;index<200&&!service.snapshot()!.text;index++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(service.snapshot()!.text);
}

test('真实手选冻结位置与点击顺序；未揭位置和方向在所有快照中隐藏，逐牌进度可恢复',async()=>{
  const s=setup(),reading=s.service.start(startInput);
  assert.equal(reading.status,'selecting');assert.deepEqual(reading.cards,[]);assert.equal(s.calls.length,0);
  const first=s.service.select(reading.id,61);
  assert.deepEqual(first.selectedSlots,[61]);assert.deepEqual(first.cards,[{positionIndex:0,positionLabel:'过去',revealed:false}]);
  assert.throws(()=>s.service.select(reading.id,61),/已被选取/);assert.equal(s.service.snapshot()!.selectionCount,1);
  assert.throws(()=>s.service.reveal(reading.id,0),/选齐/);
  await assert.rejects(s.service.interpret(reading.id,route),/翻开/);
  s.service.select(reading.id,5);const selected=s.service.select(reading.id,24);
  assert.equal(selected.status,'revealing');assert.deepEqual(selected.selectedSlots,[61,5,24]);
  for(const card of selected.cards){assert.equal(card.card,undefined);assert.equal(card.orientation,undefined);}
  assert.throws(()=>s.service.reveal(reading.id,1),/顺序/);
  const revealed=s.service.reveal(reading.id,0);
  assert.equal(revealed.status,'revealing');assert.equal(revealed.cards[0]!.revealed,true);assert.ok(revealed.cards[0]!.card);
  assert.equal(revealed.cards[1]!.card,undefined);assert.equal(revealed.cards[2]!.orientation,undefined);
  const stored=s.service.snapshot()!;assert.deepEqual(stored,revealed);assert.ok(Object.isFrozen(stored.cards));
  assert.deepEqual(s.service.reveal(reading.id,0),revealed,'repeated reveal cannot redraw a card');
  assert.throws(()=>s.service.reveal(reading.id,2),/顺序/);
  await assert.rejects(s.service.interpret(reading.id,route),/翻开/);
  const all=s.service.reveal(reading.id,undefined,true);
  assert.equal(all.status,'ready');assert.equal(new Set(all.cards.map(card=>card.card!.id)).size,3);
  assert.ok(all.cards.every(card=>card.revealed&&card.card&&card.orientation));
  assert.deepEqual(s.service.reveal(reading.id,undefined,true),all);
  await s.service.dispose();
});
test('过期ID、伪造槽位和输入被拒绝，新牌阵不受旧操作影响',async()=>{
  const s=setup(),old=s.service.start(startInput),current=s.service.start({...startInput,includeReversed:false});
  assert.throws(()=>s.service.select(old.id,0),/不存在/);assert.throws(()=>s.service.cancel(old.id),/不存在/);
  for(const slot of [-1,78,0.1,NaN,'3',null])assert.throws(()=>s.service.select(current.id,slot as number),/位置/);
  for(const payload of [{...startInput,spreadId:'decision'},{...startInput,includeReversed:'true'},{...startInput,question:'a'.repeat(501)},[]])assert.throws(()=>s.service.start(payload));
  assert.equal(s.service.snapshot()!.id,current.id);assert.equal(s.service.snapshot()!.selectionCount,0);
  for(let slot=0;slot<3;slot++)s.service.select(current.id,slot);
  for(const position of [-1,3,0.5,undefined])assert.throws(()=>s.service.reveal(current.id,position),/牌位/);
  const all=s.service.reveal(current.id,undefined,true);assert.ok(all.cards.every(card=>card.orientation==='upright'));
  assert.equal(s.service.start({...startInput,question:''}).question,'当下指引');
  await s.service.dispose();assert.throws(()=>s.service.start(startInput),/停止/);
  assert.equal((await s.service.rpc('current',{})).ok,false);
});
test('并发interpret只提交一次，固定牌阵进入日志，完整输出禁止重解',async()=>{
  const s=setup(),reading=ready(s.service);
  const results=await Promise.allSettled([s.service.interpret(reading.id,route),s.service.interpret(reading.id,route)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const final=await settled(s.service);assert.equal(final.status,'complete');assert.equal(final.text,'完整塔罗解读');
  assert.equal(s.calls.length,1);assert.equal(s.calls[0]!.maxTokens,3000);assert.equal(s.getClosed(),1);
  const prompt=s.calls[0]!.messages[0]!.content[0]!.text;
  for(const card of reading.cards){assert.ok(prompt.includes(card.card!.id));assert.ok(prompt.includes(card.orientation!));assert.ok(prompt.includes(card.positionLabel));}
  assert.ok(prompt.includes(startInput.question));assert.ok(!prompt.includes('hiddenDeck'));assert.ok(!prompt.includes('selectedSlots'));
  assert.deepEqual(s.events.map(event=>event.type),['turn/start','step/start','request/header','system/message','user/message','assistant/message','step/end','turn/end']);
  await assert.rejects(s.service.interpret(reading.id,route),/第一次/);assert.equal(s.calls.length,1);s.gate.assertIdle();await s.service.dispose();
});
test('十牌阵有独立5000token预算，模型目录校验失败不消耗首次机会',async()=>{
  const s=setup(),reading=ready(s.service,'celtic-cross');
  await assert.rejects(s.service.interpret(reading.id,{...route,model:'missing'}),/模型/);
  assert.equal(s.service.snapshot()!.status,'ready');assert.equal(s.calls.length,0);
  await s.service.interpret(reading.id,route);assert.equal((await settled(s.service)).status,'complete');
  assert.equal(s.calls[0]!.maxTokens,5000);assert.equal(reading.cards.length,10);await s.service.dispose();
});
test('模型目录异步等待期间换轮或卸载，不会提交过期牌阵和占用共享锁',async()=>{
  for(const mode of ['replace','dispose']){
    const s=setup(),reading=ready(s.service);
    let resolveModels!:(models:{id:string;name:string}[])=>void;
    s.ctx.llm.listModels=()=>new Promise(resolve=>{resolveModels=resolve;});
    const interpreting=s.service.interpret(reading.id,route);
    const replacement=mode==='replace'?s.service.start({...startInput,question:'新的牌阵'}):undefined;
    if(mode==='dispose')await s.service.dispose();
    resolveModels([{id:route.model,name:'Chosen'}]);
    await assert.rejects(interpreting,/状态已变化/);assert.equal(s.calls.length,0);s.gate.assertIdle();
    if(replacement){assert.equal(s.service.snapshot()!.id,replacement.id);assert.equal(s.service.snapshot()!.status,'selecting');}
    await s.service.dispose();
  }
});
test('取消与超时保留文字和冻结牌，卸载也结束任务；无后台重试',async()=>{
  for(const mode of ['cancel','timeout','dispose']){
    const s=setup(untilCancelled),reading=ready(s.service);
    await s.service.interpret(reading.id,route);await textArrived(s.service);
    assert.throws(()=>s.service.start(startInput),/解读/);
    if(mode==='cancel')s.service.cancel(reading.id);if(mode==='dispose')await s.service.dispose();
    const final=await settled(s.service);assert.equal(final.status,'cancelled');assert.equal(final.text,'已经收到的塔罗文字');
    assert.deepEqual(final.cards,reading.cards);assert.equal(final.error!.code,mode==='timeout'?'TIMEOUT':'CANCELLED');
    assert.equal(s.calls.length,1);assert.ok(s.events.some(event=>event.type==='assistant/attempt'));s.gate.assertIdle();
    if(mode!=='dispose')await assert.rejects(s.service.interpret(reading.id,route),/第一次/);
    await s.service.dispose();
  }
});
test('供应商错误、截断、空输出和日志错误收尾，不改变已抽牌',async()=>{
  for(const [finish,code] of [[{kind:'error',failure:{code:'AUTH',message:'credential unavailable'}},'AUTH'],[{kind:'max-tokens'},'INCOMPLETE'],[{kind:'stop'},'EMPTY_RESPONSE']] as const){
    const s=setup(async function*(){if(code!=='EMPTY_RESPONSE')yield {type:'text-delta',index:0,text:'部分塔罗文字'};yield {type:'finish',reason:finish};}),reading=ready(s.service);
    await s.service.interpret(reading.id,route);const final=await settled(s.service);
    assert.equal(final.status,'failed');assert.equal(final.error!.code,code);assert.deepEqual(final.cards,reading.cards);assert.equal(s.calls.length,1);
    await s.service.dispose();
  }
  const s=setup(complete),reading=ready(s.service);s.ctx.sessions.prepare=()=>{throw new Error('session unavailable');};
  await s.service.interpret(reading.id,route);assert.equal((await settled(s.service)).status,'failed');assert.equal(s.calls.length,0);s.gate.assertIdle();await s.service.dispose();
});
test('请求日志写入失败不调用供应商，输出日志关闭失败保留完成文本且释放锁',async()=>{
  let closed=0;
  const failed=setup(complete,{create:async()=>({append:async()=>{throw new Error('disk unavailable');},flush:async()=>{},close:async()=>{closed++;}})});
  const reading=ready(failed.service);await failed.service.interpret(reading.id,route);const final=await settled(failed.service);
  assert.equal(final.status,'failed');assert.equal(final.error!.code,'LOG_WRITE');assert.equal(failed.calls.length,0);assert.equal(closed,1);failed.gate.assertIdle();await failed.service.dispose();
  const closeFailed=setup(complete,{create:async()=>({append:async()=>{},flush:async()=>{},close:async()=>{throw new Error('close unavailable');}})});closeFailed.setFlushed();
  const readyReading=ready(closeFailed.service);await closeFailed.service.interpret(readyReading.id,route);const completeReading=await settled(closeFailed.service);
  assert.equal(completeReading.status,'complete');assert.equal(completeReading.text,'完整塔罗解读');assert.equal(completeReading.error!.code,'LOG_WRITE');assert.equal(closeFailed.calls.length,1);closeFailed.gate.assertIdle();await closeFailed.service.dispose();
});
test('同一个GenerationGate跨梅花与塔罗阻止并发，取消后才允许新解读',async()=>{
  const s=setup(untilCancelled),meihua=new MeihuaService(s.ctx,config,s.gate),tarot=ready(s.service);
  const meihuaReading=await meihua.cast({ruleId:'three-numbers',question:'并发测试',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-03T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}});
  const concurrent=await Promise.allSettled([s.service.interpret(tarot.id,route),meihua.interpret(meihuaReading.id,route)]);
  assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);assert.equal(concurrent.filter(result=>result.status==='rejected').length,1);
  assert.throws(()=>s.service.start(startInput),/解读/);
  await assert.rejects(meihua.cast({ruleId:'time',question:'测试',values:{},environment:{capturedAt:'2026-10-03T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}}),/解读/);
  if(s.service.snapshot()!.status==='streaming'){s.service.cancel(tarot.id);await settled(s.service);}
  else{meihua.cancel(meihuaReading.id);for(let index=0;index<200&&meihua.snapshot()!.status==='streaming';index++)await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(s.calls.length,1);s.gate.assertIdle();await meihua.dispose();await s.service.dispose();
});
test('塔罗RPC不泄漏暗牌，对错误payload和未知操作有明确结果',async()=>{
  const s=setup(),started=await s.service.rpc('start',startInput);assert.equal(started.ok,true);
  const reading=started.ok?started.value as TarotReading:null;assert.ok(reading);
  const selected=await s.service.rpc('select',{id:reading.id,slot:5});assert.equal(selected.ok,true);
  const serialized=JSON.stringify(selected);assert.ok(!serialized.includes('orientation'));assert.ok(!serialized.includes('arcana'));
  for(const payload of [{id:reading.id,slot:'5'},{id:'old',slot:1}])assert.equal((await s.service.rpc('select',payload)).ok,false);
  assert.equal((await s.service.rpc('reveal',{id:reading.id,all:'true'})).ok,false);assert.equal((await s.service.rpc('missing',{})).ok,false);
  const catalog=await s.service.catalog();assert.equal(catalog.spreads.length,4);assert.equal(catalog.deck.cardCount,78);assert.equal(s.calls.length,0);
  await s.service.dispose();
});
test('正式DSH JSONL后端可读回固定牌阵和首次完整塔罗日志',async()=>{
  const cordisPackage:string='@deepseek-ai/cordis';
  type Fiber={await():Promise<void>;dispose():Promise<void>};
  const {Context}=await import(cordisPackage) as {Context:new()=>{plugin(plugin:unknown,config:object):Fiber;get(name:string):unknown}};
  const module=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href) as {default:unknown};
  const root=await mkdtemp(join(tmpdir(),'tarot-log-')),ctx=new Context(),fiber=ctx.plugin(module.default,{root,compression:'none'});await fiber.await();
  const persistence=ctx.get('sessionPersistence') as HostContext['sessionPersistence']&{open(id:string,mode:'read'):Promise<PersistenceHandle&{read():Promise<{events:LogEvent[]}>}>;locate(meta:LogSession['header']):{path:string}};
  const s=setup(complete,persistence);s.setFlushed();
  try{
    const reading=ready(s.service);await s.service.interpret(reading.id,route);const final=await settled(s.service);assert.equal(final.status,'complete');
    const handle=await persistence.open(final.logSessionId!,'read'),{events}=await handle.read();await handle.close();
    assert.ok(events.some(event=>event.type==='assistant/message'));assert.equal(events.at(-1)!.type,'turn/end');
    const body=await readFile(persistence.locate({id:final.logSessionId!,version:4,createdAt:0}).path,'utf8');
    assert.ok(body.includes(reading.cards[0]!.card!.id));assert.ok(body.includes('完整塔罗解读'));
  }finally{await s.service.dispose();await fiber.dispose();await rm(root,{recursive:true,force:true});}
});
