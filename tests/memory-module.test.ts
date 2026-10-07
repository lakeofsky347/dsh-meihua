import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MemoryService} from '../src/host/memory-service.ts';
import {MeihuaService} from '../src/host/service.ts';
import {TarotService} from '../src/host/tarot-service.ts';
import {GenerationGate} from '../src/host/generation-gate.ts';
import {readingIsBusy} from '../src/shared/protocol.ts';
import type {HostContext,GenerateOptions,LlmChunk,LogSession} from '../src/host/platform.ts';
import type {PluginConfig,Reading,TarotReading,RpcResult} from '../src/shared/protocol.ts';
import type {MemoryDocument} from '../src/shared/memory.ts';

const {JsonStorageBackend}=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js')).href) as {JsonStorageBackend:new(root:string)=>{kv:unknown;close():Promise<void>}};
const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:3000,maxOutputTokens:3000,pollIntervalMs:100};
const route={provider:'fixture',model:'fixture'};
const castInput={ruleId:'three-numbers',question:'下一步如何安排？',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-06T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};
function value<T>(result:RpcResult):T{assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:unknown}).value as T;}
function failure(result:RpcResult,code:string):void{assert.equal(result.ok,false);assert.equal((result as {ok:false;error:{code:string}}).error.code,code);}
function isSummary(options:GenerateOptions):boolean{return options.system.includes('背景信息提炼器');}
async function* completed(options:GenerateOptions):AsyncGenerator<LlmChunk>{
  if(isSummary(options)){
    const input=JSON.parse(options.messages[0]!.content[0]!.text) as {messages:{id:string;text:string}[]};
    yield {type:'text-delta',index:0,text:JSON.stringify({items:input.messages.map(message=>({kind:/[?？]/.test(message.text)?'concern':'fact',category:'近期处境与目标',sourceMessageId:message.id,quote:message.text}))})};
  }else yield {type:'text-delta',index:0,text:'合成供应商的完整解释，仅用于模块验收。'};
  yield {type:'finish',reason:{kind:'stop'}};
}
async function setup(stream:(options:GenerateOptions)=>AsyncIterable<LlmChunk>=completed){
  const directory=await mkdtemp(join(tmpdir(),'wenxiang-memory-modules-')),backend=new JsonStorageBackend(directory),calls:GenerateOptions[]=[],gate=new GenerationGate();
  const ctx={storage:{backend:{get:()=>backend}},llm:{listProviders:()=>[{id:route.provider,name:'Fixture'}],listModels:async()=>[{id:route.model,name:'Fixture'}],stream:(options:GenerateOptions)=>{assert.equal(options.sessionId,undefined);calls.push(options);return stream(options);}},sessions:{prepare:(id:string)=>new Session(id,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},sessionPersistence:{create:async()=>({append:async()=>{},flush:async()=>{},close:async()=>{}})},connection:{fetch:{register:()=>async()=>{}}},reflect:{provide:()=>async()=>{}},effect:(factory:()=>unknown)=>factory()} as unknown as HostContext;
  const memory=new MemoryService(ctx,config,gate),meihua=new MeihuaService(ctx,config,gate,memory),tarot=new TarotService(ctx,config,gate,memory);await memory.ready;
  return {ctx,memory,meihua,tarot,calls,gate,cleanup:async()=>{await memory.dispose();await meihua.dispose();await tarot.dispose();await backend.close();await rm(directory,{recursive:true,force:true});}};
}
async function payload(memory:MemoryService,data:object):Promise<object>{return {...data,epoch:(await memory.status()).epoch};}
async function localCast(s:Awaited<ReturnType<typeof setup>>,options?:object,question=castInput.question):Promise<Reading>{return value(await s.meihua.rpc('cast',await payload(s.memory,{...castInput,question,route,...(options?{options}:{})})));}
async function localTarot(s:Awaited<ReturnType<typeof setup>>,options?:object):Promise<TarotReading>{
  const reading=value<TarotReading>(await s.tarot.rpc('start',await payload(s.memory,{question:'如何安排学习？',spreadId:'single',includeReversed:true,route,...(options?{options}:{})})));
  value(await s.tarot.rpc('select',await payload(s.memory,{id:reading.id,slot:0})));return value(await s.tarot.rpc('reveal',await payload(s.memory,{id:reading.id,all:true})));
}
async function settled<T extends Reading|TarotReading>(service:{snapshot():T|null}):Promise<T>{
  for(let i=0;i<300;i++){const reading=service.snapshot();if(reading&&!readingIsBusy(reading))return reading;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('module did not settle');
}
async function save(memory:MemoryService,content:string):Promise<MemoryDocument>{const d=value<MemoryDocument>(await memory.rpc('document',{}));return memory.save(content,d.revision,d.epoch);}

test('锁定时两模块仍可本地起卦、选牌和揭牌，首解拒绝且不调用模型',async()=>{
  const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');await s.memory.lock();
    const meihua=await localCast(s),tarot=await localTarot(s);assert.equal(meihua.status,'ready');assert.equal(tarot.status,'ready');assert.equal(tarot.cards[0]!.revealed,true);
    failure(await s.meihua.rpc('interpret',await payload(s.memory,{id:meihua.id,...route})),'MEMORY_LOCKED');failure(await s.tarot.rpc('interpret',await payload(s.memory,{id:tarot.id,...route})),'MEMORY_LOCKED');assert.equal(s.calls.length,0);
  }finally{await s.cleanup();}
});
test('摘要占用生成位时本地起卦与抽牌可用，下一次首解等待摘要并使用成功新背景',async()=>{
  let started:()=>void=()=>{},unblock:()=>void=()=>{};const reached=new Promise<void>(resolve=>{started=resolve;}),barrier=new Promise<void>(resolve=>{unblock=resolve;});
  const s=await setup(async function*(options){if(isSummary(options)){started();await barrier;}yield* completed(options);});try{
    await s.memory.initialize('synthetic-module-only');const previous=await localCast(s,undefined,'我目前在上海工作。');value(await s.meihua.rpc('checkpoint',await payload(s.memory,{id:previous.id,route})));await reached;
    const next=await localCast(s),tarot=await localTarot(s);assert.equal(next.status,'ready');assert.equal(tarot.status,'ready');assert.equal(s.calls.length,1);
    let interpreted=false;const interpretation=s.meihua.rpc('interpret',await payload(s.memory,{id:next.id,...route})).then(response=>{interpreted=true;return response;});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(interpreted,false);assert.equal(s.calls.length,1);
    unblock();value(await interpretation);const final=await settled(s.meihua);assert.equal(final.status,'complete');assert.equal(final.memory?.revision,1);assert.ok(s.calls.find(call=>!isSummary(call))!.messages[0]!.content[0]!.text.includes('我目前在上海工作。'));
  }finally{unblock();await s.cleanup();}
});
test('两模块首解冻结背景版本，手动修改后追问仍使用各自原快照',async()=>{
  const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');await save(s.memory,'手写私人背景_A_ONLY');const meihua=await localCast(s);value(await s.meihua.rpc('interpret',await payload(s.memory,{id:meihua.id,...route})));let first=await settled(s.meihua);assert.equal(first.memory?.revision,1);
    await save(s.memory,'手写私人背景_B_ONLY');value(await s.meihua.rpc('followup',await payload(s.memory,{id:meihua.id,question:'进一步如何安排？',expectedTurnCount:0})));first=await settled(s.meihua);const meihuaFollowup=s.calls.at(-1)!;assert.ok(meihuaFollowup.messages[0]!.content[0]!.text.includes('背景_A_ONLY'));assert.ok(!meihuaFollowup.messages[0]!.content[0]!.text.includes('背景_B_ONLY'));assert.equal(first.memory?.revision,1);
    const tarot=await localTarot(s);value(await s.tarot.rpc('interpret',await payload(s.memory,{id:tarot.id,...route})));let second=await settled(s.tarot);assert.equal(second.memory?.revision,2);
    await save(s.memory,'手写私人背景_C_ONLY');value(await s.tarot.rpc('followup',await payload(s.memory,{id:tarot.id,question:'具体有什么行动？',expectedTurnCount:0})));second=await settled(s.tarot);const tarotFollowup=s.calls.at(-1)!;assert.ok(tarotFollowup.messages[0]!.content[0]!.text.includes('背景_B_ONLY'));assert.ok(!tarotFollowup.messages[0]!.content[0]!.text.includes('背景_C_ONLY'));assert.equal(second.memory?.revision,2);
    assert.ok(!JSON.stringify(s.meihua.snapshot()).includes('背景_A_ONLY'));assert.ok(!JSON.stringify(s.tarot.snapshot()).includes('背景_B_ONLY'));
  }finally{await s.cleanup();}
});
test('未首解的替他人设置在 Host 缺省 options 时恢复，既不使用本人背景也不写入记忆',async()=>{
  const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');await save(s.memory,'本人的私人背景_FOR_OTHERS_SENTINEL');
    const meihua=await localCast(s,{useBackground:true,forOthers:true},'朋友的学习如何安排？'),tarot=await localTarot(s,{useBackground:true,forOthers:true});assert.equal(meihua.backgroundOptions?.forOthers,true);assert.equal(tarot.backgroundOptions?.forOthers,true);
    // A newly loaded client can interpret the current reading without supplying replacement options.
    value(await s.meihua.rpc('interpret',await payload(s.memory,{id:meihua.id,...route})));const first=await settled(s.meihua);assert.equal(first.memory?.forOthers,true);assert.equal(first.memory?.enabled,false);
    value(await s.tarot.rpc('interpret',await payload(s.memory,{id:tarot.id,...route})));const second=await settled(s.tarot);assert.equal(second.memory?.forOthers,true);assert.equal(second.memory?.enabled,false);
    assert.ok(s.calls.every(call=>!call.messages[0]!.content[0]!.text.includes('FOR_OTHERS_SENTINEL')));
    value(await s.meihua.rpc('checkpoint',await payload(s.memory,{id:meihua.id,route})));value(await s.tarot.rpc('checkpoint',await payload(s.memory,{id:tarot.id,route})));assert.equal(s.calls.filter(isSummary).length,0);
  }finally{await s.cleanup();}
});
test('清空使两模块旧读取失效；旧 epoch 与缺失 epoch 的本地 mutation 在恢复 current 前拒绝',async()=>{
  const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');const epoch=(await s.memory.status()).epoch,meihua=await localCast(s),tarot=await localTarot(s);await s.memory.clear(epoch);assert.equal(s.meihua.snapshot(),null);assert.equal(s.tarot.snapshot(),null);
    failure(await s.meihua.rpc('cast',{...castInput,epoch}),'MEMORY_STALE');failure(await s.tarot.rpc('start',{question:'旧问句',spreadId:'single',includeReversed:true,epoch}),'MEMORY_STALE');
    failure(await s.meihua.rpc('cast',castInput),'MEMORY_STALE');failure(await s.tarot.rpc('start',{question:'无epoch旧问句',spreadId:'single',includeReversed:true}),'MEMORY_STALE');failure(await s.meihua.rpc('interpret',{id:meihua.id,...route,epoch}),'MEMORY_STALE');failure(await s.tarot.rpc('select',{id:tarot.id,slot:1,epoch}),'MEMORY_STALE');assert.equal(s.meihua.snapshot(),null);assert.equal(s.tarot.snapshot(),null);assert.equal(s.calls.length,0);
    assert.equal((await localCast(s)).status,'ready');assert.equal((await localTarot(s)).status,'ready');
  }finally{await s.cleanup();}
});
test('模块 mutation 等待准备期间清空，实时 epoch fence 拒绝旧 cast/start',async()=>{
  for(const module of ['meihua','tarot'] as const){const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');const epoch=(await s.memory.status()).epoch,original=s.memory.ready;let release:()=>void=()=>{};
    Object.defineProperty(s.memory,'ready',{value:new Promise<void>(resolve=>{release=resolve;}),configurable:true});
    const clearing=s.memory.clear(epoch),pending=module==='meihua'?s.meihua.rpc('cast',{...castInput,epoch}):s.tarot.rpc('start',{question:'旧快照竞态',spreadId:'single',includeReversed:true,epoch});release();
    failure(await pending,'MEMORY_STALE');await clearing;Object.defineProperty(s.memory,'ready',{value:original,configurable:true});assert.equal(s.meihua.snapshot(),null);assert.equal(s.tarot.snapshot(),null);
  }finally{await s.cleanup();}}
});
test('未首解 checkbox 选择写入 Host preferences，刷新可读取且缺省首解遵循替他人设置',async()=>{
  const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');await save(s.memory,'自己的背景_PREFERENCES_SENTINEL');const meihua=await localCast(s),tarot=await localTarot(s);
    for(const [service,reading]of [[s.meihua,meihua],[s.tarot,tarot]] as const){
      const updated=value<Reading|TarotReading>(await service.rpc('preferences',await payload(s.memory,{id:reading.id,options:{useBackground:false,forOthers:true}})));assert.deepEqual(updated.backgroundOptions,{useBackground:false,forOthers:true});
      const reloaded=value<Reading|TarotReading>(await service.rpc('current',{}));assert.deepEqual(reloaded.backgroundOptions,{useBackground:false,forOthers:true});
      value(await service.rpc('interpret',await payload(s.memory,{id:reading.id,...route})));const final=await settled(service as {snapshot():Reading|TarotReading|null});assert.equal(final.memory?.forOthers,true);assert.equal(final.memory?.enabled,false);
      const frozen=await service.rpc('preferences',await payload(s.memory,{id:reading.id,options:{useBackground:true,forOthers:false}}));assert.equal(frozen.ok,false);
    }
    assert.equal(s.calls.length,2);assert.ok(s.calls.every(call=>!call.messages[0]!.content[0]!.text.includes('PREFERENCES_SENTINEL')));
  }finally{await s.cleanup();}
});
test('未首解检查点开始后清空，creation epoch 保证旧问题不会进入新文档',async()=>{
  for(const module of ['meihua','tarot'] as const){const s=await setup();try{
    await s.memory.initialize('synthetic-module-only');const reading=module==='meihua'?await localCast(s,undefined,'我目前在上海工作。'):await localTarot(s),service=module==='meihua'?s.meihua:s.tarot,original=s.memory.checkpoint.bind(s.memory);
    s.memory.checkpoint=async input=>{await s.memory.clear(s.memory.currentEpoch);await original(input);};
    failure(await service.rpc('checkpoint',await payload(s.memory,{id:reading.id,route})),'MEMORY_STALE');assert.equal(s.calls.length,0);assert.equal(value<MemoryDocument>(await s.memory.rpc('document',{})).content,'');assert.equal(s.meihua.snapshot(),null);assert.equal(s.tarot.snapshot(),null);
  }finally{await s.cleanup();}}
});
