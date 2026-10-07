import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MethodService} from '../src/host/method-service.ts';
import {MeihuaService} from '../src/host/service.ts';
import {MemoryService} from '../src/host/memory-service.ts';
import {GenerationGate} from '../src/host/generation-gate.ts';
import {readingIsBusy} from '../src/shared/protocol.ts';
import type {MethodReading} from '../src/shared/methods.ts';
import type {MemoryDocument} from '../src/shared/memory.ts';
import type {NewMethodId} from '../src/shared/modules.ts';
import type {GenerateOptions,HostContext,LlmChunk,LogEvent,LogSession} from '../src/host/platform.ts';
import type {PluginConfig,RpcResult} from '../src/shared/protocol.ts';
import type {LiuyaoResult} from '../src/liuyao/types.ts';
import type {LenormandResult} from '../src/lenormand/types.ts';
const {JsonStorageBackend}=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js')).href) as {JsonStorageBackend:new(root:string)=>{kv:unknown;close():Promise<void>}};
const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:4000,maxOutputTokens:3000,pollIntervalMs:100},route={provider:'fixture',model:'fixture'};
const ids:NewMethodId[]=['xiaoliu','lenormand','liuyao'];
const unwrap=<T>(result:RpcResult):T=>{assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:unknown}).value as T;};
const doc=async(memory:MemoryService)=>unwrap<MemoryDocument>(await memory.rpc('document',{}));
const failure=(result:RpcResult,code?:string)=>{assert.equal(result.ok,false);if(code)assert.equal((result as {ok:false;error:{code:string}}).error.code,code);};
const summary=(request:GenerateOptions)=>request.system.includes('背景信息提炼器');
async function* normal(request:GenerateOptions):AsyncGenerator<LlmChunk>{
  if(summary(request)){const input=JSON.parse(request.messages[0]!.content[0]!.text);yield {type:'text-delta',index:0,text:JSON.stringify({items:input.messages.map((message:{id:string;text:string})=>({kind:'fact',category:'近期处境与目标',sourceMessageId:message.id,quote:message.text}))})};}
  else yield {type:'text-delta',index:0,text:'合成的模块解释。'};
  yield {type:'finish',reason:{kind:'stop'}};
}
async function setup(stream:(request:GenerateOptions)=>AsyncIterable<LlmChunk>=normal){
  const directory=await mkdtemp(join(tmpdir(),'wx-methods-')),backend=new JsonStorageBackend(directory),gate=new GenerationGate(),calls:GenerateOptions[]=[],events:LogEvent[]=[];
  const ctx={storage:{backend:{get:()=>backend}},llm:{listProviders:()=>[{id:'fixture',name:'Fixture'}],listModels:async()=>[{id:'fixture',name:'Fixture'}],stream:(request:GenerateOptions)=>{assert.equal(request.sessionId,undefined);calls.push(request);return stream(request);}},sessions:{prepare:(id:string)=>new Session(id,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},sessionPersistence:{create:async()=>({append:async(rows:LogEvent[])=>{events.push(...rows);},flush:async()=>{},close:async()=>{}})},connection:{fetch:{register:()=>async()=>{}}},reflect:{provide:()=>async()=>{}},effect:(factory:()=>unknown)=>factory()} as unknown as HostContext;
  const memory=new MemoryService(ctx,config,gate);await memory.initialize('synthetic-expansion-only');
  const services=Object.fromEntries(ids.map(id=>[id,new MethodService(id,ctx,config,gate,memory)])) as Record<NewMethodId,MethodService>;
  const legacy=new MeihuaService(ctx,config,gate,memory);
  const call=async(id:NewMethodId,endpoint:string,payload:object={})=>services[id].rpc(endpoint,{...payload,epoch:(await memory.status()).epoch});
  async function ready(id:NewMethodId,question='我目前正在学习绘画。',options={useBackground:true,forOthers:false}){
    let reading=unwrap<MethodReading>(await call(id,'start',{question,wallTime:'2024-02-10T12:00',spreadId:'line-5',route,options}));
    if(id==='lenormand'){for(let slot=1;slot<=5;slot++)reading=unwrap(await call(id,'select',{id:reading.id,slot,expectedCount:slot-1}));reading=unwrap(await call(id,'reveal',{id:reading.id}));}
    if(id==='liuyao'){for(const [index,value] of [6,7,8,9,6,9].entries())reading=unwrap(await call(id,'record',{id:reading.id,value,expectedCount:index}));}
    return reading;
  }
  return {directory,ctx,memory,services,legacy,calls,events,call,ready,cleanup:async()=>{await memory.dispose();for(const service of Object.values(services))await service.dispose();await legacy.dispose();await backend.close();await rm(directory,{recursive:true,force:true});}};
}
async function settled(service:MethodService):Promise<MethodReading>{for(let i=0;i<500;i++){const reading=service.snapshot()!;if(!readingIsBusy(reading))return reading;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('generation did not settle');}
test('三个新模块锁定仍可完整本地起课/装卦/抽牌，模型调用为零，AI被拒绝',async()=>{
  const s=await setup();try{await s.memory.lock();for(const id of ids){const reading=await s.ready(id);assert.equal(reading.status,'ready');assert.ok(reading.result);failure(await s.call(id,'interpret',{id:reading.id,...route}),'MEMORY_LOCKED');}assert.equal(s.calls.length,0);assert.equal(s.events.length,0);}finally{await s.cleanup();}
});
test('雷诺曼暗牌不泄露，重复/越界/陈旧选择被拒绝，三五排列完整冻结',async()=>{
  const s=await setup();try{for(const count of [3,5]){
    let r=unwrap<MethodReading>(await s.call('lenormand','start',{spreadId:`line-${count}`,route}));assert.equal(r.result,null);assert.equal(JSON.stringify(r).includes('cardIds'),false);
    failure(await s.call('lenormand','select',{id:r.id,slot:37,expectedCount:0}));failure(await s.call('lenormand','select',{id:r.id,slot:1,expectedCount:1}));
    r=unwrap(await s.call('lenormand','select',{id:r.id,slot:1,expectedCount:0}));failure(await s.call('lenormand','select',{id:r.id,slot:1,expectedCount:1}));
    for(let slot=2;slot<=count;slot++)r=unwrap(await s.call('lenormand','select',{id:r.id,slot,expectedCount:slot-1}));assert.equal(r.status,'revealing');assert.equal(r.result,null);
    r=unwrap(await s.call('lenormand','reveal',{id:r.id}));const result=r.result as LenormandResult;assert.equal(new Set(result.cards.map(card=>card.card.id)).size,count);assert.equal(result.adjacentPairs.length,count-1);assert.equal(result.mirrors.length,count===5?2:0);assert.ok(Object.isFrozen(result));failure(await s.call('lenormand','reveal',{id:r.id}));
  }}finally{await s.cleanup();}
});
test('六次三币投掷逐爻记录，手动多动爻完整装卦，旧页面不能多写一爻',async()=>{
  const s=await setup();try{
    let r=unwrap<MethodReading>(await s.call('liuyao','start',{wallTime:'2024-02-10T12:00',route}));
    for(let i=0;i<6;i++){r=unwrap(await s.call('liuyao','toss',{id:r.id,expectedCount:i}));const coin=r.coins[i]!;assert.equal(coin.faces.length,3);assert.ok(coin.faces.every(face=>face===2||face===3));assert.equal(coin.value,coin.faces.reduce((a,b)=>a+b,0));if(i===0){failure(await s.call('liuyao','record',{id:r.id,expectedCount:0,value:6}));assert.equal(s.services.liuyao.snapshot()!.coins.length,1);}}
    const manual=await s.ready('liuyao');const result=manual.result as LiuyaoResult;assert.deepEqual(result.movingLines,[1,4,5,6]);assert.equal(result.lines.length,6);assert.ok(result.lines.every(line=>line.najia&&line.relative&&line.spirit&&line.changed.najia));assert.equal(result.calendar.dayGanzhi,'甲辰');assert.equal(result.calendar.monthBranch,'寅');assert.deepEqual(result.calendar.voidBranches,['寅','卯']);
  }finally{await s.cleanup();}
});
test('新模块共享文档、初解冻结、追问原快照与role顺序，元日志标识正确而无私人文本',async()=>{
  const s=await setup();try{for(const [index,id] of ids.entries()){
    await s.memory.save(`手动背景_PRIVATE_${id}`,(await doc(s.memory)).revision,(await s.memory.status()).epoch);const reading=await s.ready(id);
    unwrap(await s.call(id,'interpret',{id:reading.id,...route}));const first=await settled(s.services[id]);assert.equal(first.memory!.revision,index*2+1);
    await s.memory.save(`后来编辑背景_NEW_${id}`,(await doc(s.memory)).revision,(await s.memory.status()).epoch);
    unwrap(await s.call(id,'followup',{id:reading.id,question:'解释固定结果',expectedTurnCount:0}));await settled(s.services[id]);const request=s.calls.at(-1)!;
    assert.deepEqual(request.messages.map(message=>message.role),['user','assistant','user']);assert.ok(request.messages[0]!.content[0]!.text.includes(`PRIVATE_${id}`));assert.ok(!request.messages[0]!.content[0]!.text.includes(`NEW_${id}`));
    assert.ok(!JSON.stringify(s.services[id].snapshot()).includes(`PRIVATE_${id}`));
    const rows=s.events.filter(event=>event.type==='private/request').slice(-2);assert.ok(rows.every(row=>(row.data as {moduleId:string}).moduleId===id));
  }assert.ok(!JSON.stringify(s.events).includes('PRIVATE_'));assert.ok(!JSON.stringify(s.events).includes('合成的模块解释'));}finally{await s.cleanup();}
});
test('新模块单次不引用仍提炼本人消息，替他人两者停用；版本来源重建可解锁',async()=>{
  const s=await setup();try{
    await s.memory.save('PRIVATE_OWNER_ONLY',0,(await s.memory.status()).epoch);
    for(const id of ids){const r=await s.ready(id,'我目前正在学习绘画。',{useBackground:false,forOthers:true});unwrap(await s.call(id,'interpret',{id:r.id,...route}));const final=await settled(s.services[id]);assert.equal(final.memory!.enabled,false);unwrap(await s.call(id,'checkpoint',{id:r.id,route}));}
    assert.equal(s.calls.filter(summary).length,0);assert.ok(s.calls.every(request=>!request.messages[0]!.content[0]!.text.includes('PRIVATE_OWNER_ONLY')));
    const r=await s.ready('xiaoliu','我目前正在学习书法。',{useBackground:false,forOthers:false});unwrap(await s.call('xiaoliu','interpret',{id:r.id,...route}));await settled(s.services.xiaoliu);unwrap(await s.call('xiaoliu','checkpoint',{id:r.id,route}));await s.memory.freeze();assert.equal((await doc(s.memory)).source,'xiaoliu');assert.ok((await doc(s.memory)).content.includes('我目前正在学习书法。'));
    await s.memory.dispose();const reopened=new MemoryService(s.ctx,config);await reopened.ready;assert.equal((await reopened.status()).unlocked,false);await reopened.unlock('synthetic-expansion-only');assert.equal((await doc(reopened)).source,'xiaoliu');await reopened.dispose();
  }finally{await s.cleanup();}
});
test('新轮自动提炼且下一首解等待摘要；同轮重复结束不重复发送',async()=>{
  const s=await setup();try{for(const id of ids){const previous=await s.ready(id,'我目前正在学习绘画。');const next=await s.ready(id,'我目前正在练习书法。');unwrap(await s.call(id,'interpret',{id:next.id,...route}));const final=await settled(s.services[id]);assert.ok(final.memory!.revision>=1);const first=s.calls.findLast(request=>!summary(request))!;assert.ok(first.messages[0]!.content[0]!.text.includes('我目前正在学习绘画。'));
    unwrap(await s.call(id,'checkpoint',{id:next.id,route}));await s.memory.freeze();const before=s.calls.filter(summary).length;unwrap(await s.call(id,'checkpoint',{id:next.id,route}));await s.memory.freeze();assert.equal(s.calls.filter(summary).length,before);assert.notEqual(previous.id,next.id);
  }}finally{await s.cleanup();}
});
test('跨旧新模块共用生成锁；取消保留部分文字，再追问延续未完成状态',async()=>{
  let entered=false;
  const s=await setup(async function*(request){if(summary(request)){yield* normal(request);return;}yield {type:'text-delta',index:0,text:'部分_PRIVATE_OUTPUT'};entered=true;await new Promise<void>(resolve=>{if(request.signal.aborted)resolve();else request.signal.addEventListener('abort',()=>resolve(),{once:true});});yield {type:'finish',reason:{kind:'stop'}};});
  try{const x=await s.ready('xiaoliu');const cast={ruleId:'three-numbers',question:'旧模块问题',values:{a:2,b:3,c:2},environment:{capturedAt:'2024-02-10T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};const legacy=unwrap<{id:string}>(await s.legacy.rpc('cast',{...cast,epoch:(await s.memory.status()).epoch}));
    unwrap(await s.call('xiaoliu','interpret',{id:x.id,...route}));for(let i=0;i<100&&!entered;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(entered);
    failure(await s.legacy.rpc('interpret',{id:legacy.id,...route,epoch:(await s.memory.status()).epoch}),'GENERATION_BUSY');
    unwrap(await s.call('xiaoliu','cancel',{id:x.id}));const final=await settled(s.services.xiaoliu);assert.equal(final.status,'cancelled');assert.equal(final.text,'部分_PRIVATE_OUTPUT');
    unwrap(await s.call('xiaoliu','followup',{id:x.id,question:'解释收到的部分',expectedTurnCount:0}));for(let i=0;i<100&&s.calls.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(s.calls.at(-1)!.messages[1]!.content[0]!.text.includes('未完成'));const turn=s.services.xiaoliu.snapshot()!.conversation![0]!;unwrap(await s.call('xiaoliu','cancel',{id:x.id,turnId:turn.id}));await settled(s.services.xiaoliu);
  }finally{await s.cleanup();}
});
test('锁定/清空取消新模块并失效所有旧页面，不允许迟到数据恢复',async()=>{
  const s=await setup();try{const readings=await Promise.all(ids.map(id=>s.ready(id)));const old=(await s.memory.status()).epoch;await s.memory.clear(old);for(const [index,id] of ids.entries()){assert.equal(s.services[id].snapshot(),null);failure(await s.services[id].rpc('start',{question:'旧数据',epoch:old}),'MEMORY_STALE');failure(await s.call(id,'checkpoint',{id:readings[index]!.id,route}));}assert.equal((await doc(s.memory)).content,'');const r=await s.ready('xiaoliu');await s.memory.lock();assert.equal(s.services.xiaoliu.snapshot(),null);failure(await s.call('xiaoliu','interpret',{id:r.id,...route}),'MEMORY_LOCKED');}finally{await s.cleanup();}
});
