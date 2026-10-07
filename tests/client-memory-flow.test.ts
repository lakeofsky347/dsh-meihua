import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { MemoryService } from '../src/host/memory-service.ts';
import { MeihuaService } from '../src/host/service.ts';
import { TarotService } from '../src/host/tarot-service.ts';
import { GenerationGate } from '../src/host/generation-gate.ts';
import { registerTransport, registerModuleTransport } from '../src/host/transport.ts';
import { MEMORY_ENDPOINTS, type MemoryDocument } from '../src/shared/memory.ts';
import type { HostContext, GenerateOptions, LlmChunk, LogSession } from '../src/host/platform.ts';
import type { ClientRpc, ModelRoute, PluginConfig, RpcResult } from '../src/shared/protocol.ts';
import type { HubProps } from '../src/client/Hub.tsx';
import type { HubController, ModuleId } from '../src/client/hub-controller.ts';
import type { MeihuaController } from '../src/client/controller.ts';
import type { TarotController } from '../src/client/tarot-controller.ts';
import type { MemoryController } from '../src/client/memory-controller.ts';

const { JsonStorageBackend } = await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js')).href) as {JsonStorageBackend:new(root:string)=>{kv:unknown;close():Promise<void>}};
const sessionPackage:string='@deepseek-ai/dsh-session', jsdomPackage:string='jsdom';
const { Session } = await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const { JSDOM } = await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const route:ModelRoute={provider:'fixture',model:'fixture'};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:3000,maxOutputTokens:3000,pollIntervalMs:10};
const castInput={ruleId:'three-numbers',question:'我目前在学习写作。',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-06T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};
type InjectedClient=Omit<HubProps,'t'|'useHub'|'useMeihua'|'useTarot'|'useMemory'> & {hooks:{hub:HubController;meihua:MeihuaController;tarot:TarotController;memory:MemoryController}};
const isSummary=(options:GenerateOptions)=>options.system.includes('背景信息提炼器');

async function until(check:()=>boolean,label:string):Promise<void>{
  for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail(`Timed out waiting for ${label}`);
}
function value<T>(result:RpcResult):T{assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:unknown}).value as T;}

/** Released client -> exact Connection Fetch envelope -> real module service -> real encrypted JSON backend.
 * Host authentication admission is covered independently by the isolated HTTP probe, not this in-process carrier.
 */
async function setup(){
  const directory=await mkdtemp(join(tmpdir(),'wenxiang-client-memory-')),backend=new JsonStorageBackend(directory),gate=new GenerationGate();
  const calls:GenerateOptions[]=[],rpcCalls:{endpoint:string;payload:unknown}[]=[],routes=new Map<string,{fetch(request:Request):Promise<Response>}>();
  const ctx:HostContext={
    storage:{backend:{get:()=>backend}},
    llm:{listProviders:()=>[{id:route.provider,name:'Offline fixture'}],listModels:async()=>[{id:route.model,name:'Offline fixture'}],stream:async function*(options):AsyncGenerator<LlmChunk>{
      assert.equal(options.sessionId,undefined);calls.push(options);
      if(isSummary(options)){
        const input=JSON.parse(options.messages[0]!.content[0]!.text) as {messages:{id:string;text:string}[]};
        yield {type:'text-delta',index:0,text:JSON.stringify({items:input.messages.map(message=>({kind:/[?？]/.test(message.text)?'concern':'fact',category:'近期处境与目标',sourceMessageId:message.id,quote:message.text}))})};
      }else yield {type:'text-delta',index:0,text:'本地合成解读，仅验证客户端与加密记忆流程。'};
      yield {type:'finish',reason:{kind:'stop'}};
    }},
    sessions:{prepare:id=>new Session(id!,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},
    sessionPersistence:{create:async()=>({append:async()=>{},flush:async()=>{},close:async()=>{}})},
    connection:{fetch:{register:registered=>{assert.ok(!routes.has(registered.path));routes.set(registered.path,registered);return async()=>{routes.delete(registered.path);};}}},
    reflect:{provide:()=>async()=>{}},effect:factory=>factory(),
  };
  const memory=new MemoryService(ctx,config,gate),meihua=new MeihuaService(ctx,config,gate,memory),tarot=new TarotService(ctx,config,gate,memory);
  await memory.initialize('synthetic-client-flow-only');
  registerTransport(ctx,meihua);registerModuleTransport(ctx,'tarot',tarot,['catalog','current','start','select','reveal','interpret','followup','cancel','checkpoint','preferences']);registerModuleTransport(ctx,'memory',memory,MEMORY_ENDPOINTS);
  let rpcSequence=0;
  const rpc:ClientRpc={call:async(channel,endpoint,payload)=>{
    assert.equal(channel,'/api');rpcCalls.push({endpoint,payload});
    const registered=routes.get(`/api/${endpoint}`);assert.ok(registered,`No exact Connection route for ${endpoint}`);
    const rpcId=`client-flow-${++rpcSequence}`,response=await registered.fetch(new Request(`http://localhost/api/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload})}));
    assert.equal(response.status,200);
    const envelope=await response.json() as {type:string;rpcId:string;result:RpcResult};assert.equal(envelope.type,'server-response');assert.equal(envelope.rpcId,rpcId);return envelope.result;
  }};
  const bundle=await readFile('lib/client.js','utf8'),require=createRequire(import.meta.url),clients:{dispose:()=>void}[]=[];
  async function client(){
    const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{url:'http://localhost'});
    let exported:unknown;const disposers:(()=>void)[]=[],events=new Map<string,Set<()=>void>>(),slots:{name:string;inject?:()=>unknown}[]=[];
    runInNewContext(bundle,{AbortController,document:dom.window.document,setTimeout,clearTimeout,window:{__ModuleLoader__:{load:({factory}:{factory:(loader:NodeJS.Require)=>unknown})=>{exported=factory(require);}}}});
    const application=exported as {apply(ctx:object):void};
    application.apply({connection:{rpc},locale:{register:()=>()=>{},bind:()=>((key:string)=>key)},theme:{getTheme:()=>({active:{colorScheme:'light'}})},
      effect:(factory:()=>void|(()=>void))=>{const dispose=factory();if(dispose)disposers.push(dispose);},
      on:(event:string,listener:()=>void)=>{const set=events.get(event)??new Set<()=>void>();set.add(listener);events.set(event,set);return ()=>{set.delete(listener);};},
      slots:{inject:(_name:string,factory:()=>unknown)=>factory(),register:(options:{name:string;inject?:()=>unknown})=>{slots.push(options);}},
    });
    const injected=slots.find(slot=>slot.name==='main')!.inject!() as InjectedClient;
    await until(()=>!!injected.hooks.memory.getSnapshot().status?.unlocked&&!!injected.hooks.meihua.getSnapshot().catalog&&!!injected.hooks.tarot.getSnapshot().catalog,'released client initial snapshots');
    let disposed=false;
    const result={...injected,window:dom.window,emit:(event:string)=>{for(const listener of events.get(event)??[])listener();},dispose:()=>{if(disposed)return;disposed=true;for(const dispose of disposers.reverse())dispose();}};
    clients.push(result);return result;
  }
  return {memory,meihua,tarot,calls,rpcCalls,client,document:async()=>value<MemoryDocument>(await memory.rpc('document',{})),cleanup:async()=>{for(const current of clients)current.dispose();await memory.dispose();await meihua.dispose();await tarot.dispose();await backend.close();await rm(directory,{recursive:true,force:true});}};
}

async function start(client:Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['client']>>,moduleId:ModuleId,question:string,options={useBackground:true,forOthers:false}){
  client.onNavigate(moduleId);client.onSkipJourney();
  if(moduleId==='meihua'){
    client.onMeihuaDraft({question,route,...options});await client.onMeihuaCast({...castInput,question});
    assert.equal(client.hooks.meihua.getSnapshot().error,'');return client.hooks.meihua.getSnapshot().reading!;
  }
  client.onTarotDraft({question,route,...options});await client.onTarotStart({question,spreadId:'single',includeReversed:true});
  assert.equal(client.hooks.tarot.getSnapshot().error,'');return client.hooks.tarot.getSnapshot().reading!;
}

test('发行客户端不先结束就离开两模块，真实RPC检查点提炼当前用户问题并写入共享文档',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){const s=await setup();try{
    const client=await s.client(),question=`我目前在练习${moduleId==='meihua'?'摄影':'绘画'}。`;await start(client,moduleId,question);
    assert.equal(s.calls.length,0);assert.equal((await s.document()).revision,0);
    client.onNavigate(moduleId==='meihua'?'tarot':'meihua');client.onSkipJourney();
    await until(()=>s.calls.some(isSummary),'automatic module-exit summary');await s.memory.freeze();
    const document=await s.document();assert.equal(document.revision,1);assert.ok(document.content.includes(question));assert.equal(document.source,moduleId);
    assert.equal(s.rpcCalls.filter(call=>call.endpoint===`${moduleId}/checkpoint`).length,1);
    assert.equal(s.calls.filter(isSummary).length,1);
  }finally{await s.cleanup();}}
});

test('发行客户端直接另起一轮，两模块Host自动提炼旧轮，保留新轮待处理且不需要显式结束',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){const s=await setup();try{
    const client=await s.client(),oldQuestion='我目前在学习摄影。',newQuestion='我近期希望练习写作。';const previous=await start(client,moduleId,oldQuestion);
    const current=await start(client,moduleId,newQuestion);assert.notEqual(current.id,previous.id);
    await until(()=>s.calls.some(isSummary),'automatic new-round summary');await s.memory.freeze();
    const document=await s.document();assert.ok(document.content.includes(oldQuestion));assert.ok(!document.content.includes(newQuestion));assert.equal(document.source,moduleId);
    assert.equal(s.rpcCalls.filter(call=>call.endpoint.endsWith('/checkpoint')).length,0);
    const submitted=JSON.parse(s.calls.find(isSummary)!.messages[0]!.content[0]!.text) as {messages:{id:string;text:string}[]};assert.deepEqual(submitted.messages.map(message=>message.text),[oldQuestion]);
  }finally{await s.cleanup();}}
});

test('两模块单次停用背景仍能解读，结束时保存本人的新增信息；不等同于替他人停用写入',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){const s=await setup();try{
    const initial=await s.document();await s.memory.save('本人固定资料_PRIVATE_OPT_OUT_SENTINEL',initial.revision,initial.epoch);
    const client=await s.client(),question='我目前在学习摄影。',reading=await start(client,moduleId,question,{useBackground:false,forOthers:false});
    if(moduleId==='meihua')await client.onMeihuaInterpret(route,{useBackground:false,forOthers:false});
    else{client.onTarotSkip();await client.onTarotSelect(0);await client.onTarotReveal(undefined,true);await client.onTarotInterpret(route,{useBackground:false,forOthers:false});}
    const completed=moduleId==='meihua'?client.hooks.meihua.getSnapshot().reading!:client.hooks.tarot.getSnapshot().reading!;
    assert.equal(completed.id,reading.id);assert.equal(completed.status,'complete');assert.equal(completed.memory?.enabled,false);assert.equal(completed.memory?.forOthers,false);
    const interpretation=s.calls.find(options=>!isSummary(options))!;assert.ok(!JSON.stringify(interpretation.messages).includes('PRIVATE_OPT_OUT_SENTINEL'));
    await (moduleId==='meihua'?client.onMeihuaCheckpoint!():client.onTarotCheckpoint!());await until(()=>s.calls.some(isSummary),'opt-out end summary');await s.memory.freeze();
    const document=await s.document();assert.ok(document.content.includes('PRIVATE_OPT_OUT_SENTINEL'));assert.ok(document.content.includes(question));assert.equal(document.revision,2);assert.equal(document.source,moduleId);
  }finally{await s.cleanup();}}
});

test('刷新目录、连接重置、宿主暂切和客户端重开只恢复同一结果，不触发两模块提炼',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){const s=await setup();try{
    const client=await s.client(),reading=await start(client,moduleId,'我目前在学习摄影。');
    await (moduleId==='meihua'?client.onMeihuaRefresh():client.onTarotRefresh());
    client.emit('connection/reset');await new Promise<void>(resolve=>setImmediate(resolve));
    client.window.document.dispatchEvent(new client.window.Event('visibilitychange'));client.window.dispatchEvent(new client.window.Event('pagehide'));client.onTarotActive(false);client.onTarotActive(true);
    client.dispose();const reopened=await s.client();await (moduleId==='meihua'?reopened.onMeihuaRefresh():reopened.onTarotRefresh());
    assert.equal((moduleId==='meihua'?reopened.hooks.meihua:reopened.hooks.tarot).getSnapshot().reading?.id,reading.id);
    assert.equal(s.rpcCalls.filter(call=>call.endpoint.endsWith('/checkpoint')).length,0);assert.equal(s.calls.length,0);assert.equal((await s.document()).revision,0);
  }finally{await s.cleanup();}}
});
