import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MeihuaService} from '../src/host/service.ts';
import {TarotService} from '../src/host/tarot-service.ts';
import {MethodService} from '../src/host/method-service.ts';
import {MemoryService} from '../src/host/memory-service.ts';
import {GenerationGate} from '../src/host/generation-gate.ts';
import {GenerationPreflight} from '../src/host/generation-preflight.ts';
import {readingIsBusy} from '../src/shared/protocol.ts';
import type {Reading,TarotReading,PluginConfig,RpcResult} from '../src/shared/protocol.ts';
import type {MethodReading} from '../src/shared/methods.ts';
import type {ModuleId} from '../src/shared/modules.ts';
import type {GenerateOptions,HostContext,LogSession,ModelInfo} from '../src/host/platform.ts';

const {JsonStorageBackend}=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js')).href) as {JsonStorageBackend:new(root:string)=>{kv:unknown;close():Promise<void>}};
const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
type Current=Reading|TarotReading|MethodReading;
const route={provider:'fixture',model:'fixture'},options={useBackground:false,forOthers:true};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:120,maxOutputTokens:3000,pollIntervalMs:100};
const unwrap=<T>(result:RpcResult):T=>{assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:unknown}).value as T;};
function failure(result:RpcResult,code:string):void {assert.equal(result.ok,false);assert.equal(!result.ok&&result.error.code,code);}
async function until(check:()=>boolean):Promise<void>{for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('fixture did not reach expected state');}

async function setup(module:ModuleId,incomplete=false){
  const directory=await mkdtemp(join(tmpdir(),'wx-preflight-')),backend=new JsonStorageBackend(directory),gate=new GenerationGate(),calls:GenerateOptions[]=[];
  const ctx={storage:{backend:{get:()=>backend}},llm:{listProviders:()=>[{id:route.provider,name:'Fixture'}],listModels:async()=>[{id:route.model,name:'Fixture'}],stream:async function*(request:GenerateOptions){calls.push(request);yield {type:'text-delta',index:0,text:'固定的已收到正文'};yield {type:'finish',reason:{kind:incomplete?'max-tokens':'stop'}};}},sessions:{prepare:(id:string)=>new Session(id,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},sessionPersistence:{create:async()=>({append:async()=>{},flush:async()=>{},close:async()=>{}})},connection:{fetch:{register:()=>async()=>{}}},reflect:{provide:()=>async()=>{}},effect:(factory:()=>unknown)=>factory()} as unknown as HostContext;
  const memory=new MemoryService(ctx,config,gate);await memory.initialize('synthetic-preflight-only');
  const service=module==='meihua'?new MeihuaService(ctx,config,gate,memory):module==='tarot'?new TarotService(ctx,config,gate,memory):new MethodService(module,ctx,config,gate,memory);
  const call=(endpoint:string,payload:object={})=>service.rpc(endpoint,{...payload,epoch:memory.currentEpoch});
  let ready:Current;
  if(module==='meihua')ready=unwrap(await call('cast',{ruleId:'three-numbers',question:'如何安排学习',values:{a:2,b:3,c:2},environment:{capturedAt:'2024-02-10T04:00:00Z',timeZone:'Asia/Shanghai',details:{}},options}));
  else if(module==='tarot'){
    ready=unwrap(await call('start',{question:'如何安排学习',spreadId:'single',includeReversed:true,options}));
    ready=unwrap(await call('select',{id:ready.id,slot:0}));ready=unwrap(await call('reveal',{id:ready.id,all:true}));
  }else{
    ready=unwrap(await call('start',{question:'如何安排学习',wallTime:'2024-02-10T12:00',spreadId:'line-3',options}));
    if(module==='lenormand'){for(let slot=1;slot<=3;slot++)ready=unwrap(await call('select',{id:ready.id,slot,expectedCount:slot-1}));ready=unwrap(await call('reveal',{id:ready.id}));}
    if(module==='liuyao')for(const [index,value] of [6,7,8,9,6,9].entries())ready=unwrap(await call('record',{id:ready.id,value,expectedCount:index}));
  }
  unwrap(await call('interpret',{id:ready.id,...route}));await until(()=>!readingIsBusy(service.snapshot()));
  const original=service.snapshot()!;
  function hangCapabilities(){
    let signal:AbortSignal|undefined,resolveCapability!:(info:ModelInfo)=>void;
    ctx.llm.resolveModelInfo=(_provider,_model,currentSignal)=>{signal=currentSignal;return new Promise(resolve=>{resolveCapability=resolve;});};
    return {signal:()=>signal,resolve:()=>resolveCapability({...route,id:route.model,name:'Fixture',context:{contextWindow:100000}})};
  }
  return {ctx,gate,memory,service,call,calls,original,hangCapabilities,cleanup:async()=>{await service.dispose();await memory.dispose();await backend.close();await rm(directory,{recursive:true,force:true});}};
}

for(const module of ['meihua','tarot','xiaoliu','lenormand','liuyao'] as const){
  test(`${module} 能力预检超时不消耗追问或恢复次数，忽略signal的迟到响应不能发送`,async()=>{
    for(const kind of ['followup','resume'] as const){
      const s=await setup(module,kind==='resume');try{
        const hung=s.hangCapabilities(),request=kind==='followup'?{question:'仍在编辑的草稿',expectedTurnCount:0}:{expectedTurnCount:0,expectedAttempt:0};
        const pending=s.call(kind,{id:s.original.id,...request});await until(()=>!!hung.signal());
        const checking=s.service.snapshot()!;assert.ok(checking.preflight?.id);assert.ok(readingIsBusy(checking));
        const {preflight,...unchanged}=checking;assert.deepEqual(unchanged,s.original);
        failure(await pending,'TIMEOUT');assert.equal(hung.signal()!.aborted,true);assert.deepEqual(s.service.snapshot(),s.original);s.gate.assertIdle();
        hung.resolve();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(s.calls.length,1);assert.deepEqual(s.service.snapshot(),s.original);
      }finally{await s.cleanup();}
    }
  });
  test(`${module} 预检取消只接受当前id，保留完整结果和追问草稿语义，可再次提交`,async()=>{
    const s=await setup(module);try{
      const hung=s.hangCapabilities(),payload={id:s.original.id,question:'尚未提交的草稿',expectedTurnCount:0};
      const pending=s.call('followup',payload);await until(()=>!!hung.signal());const id=s.service.snapshot()!.preflight!.id;
      for(const preflightId of [undefined,'old-preflight',123])failure(await s.call('cancel',{id:s.original.id,preflightId}),'CONVERSATION_CHANGED');
      assert.equal(hung.signal()!.aborted,false);failure(await s.call('followup',payload),'GENERATION_BUSY');
      unwrap(await s.call('cancel',{id:s.original.id,preflightId:id}));failure(await pending,'CANCELLED');assert.deepEqual(s.service.snapshot(),s.original);s.gate.assertIdle();
      const newer=s.hangCapabilities(),second=s.call('followup',payload);await until(()=>!!newer.signal());
      const secondId=s.service.snapshot()!.preflight!.id;assert.notEqual(secondId,id);
      failure(await s.call('cancel',{id:s.original.id,preflightId:id}),'CONVERSATION_CHANGED');assert.equal(newer.signal()!.aborted,false);
      unwrap(await s.call('cancel',{id:s.original.id,preflightId:secondId}));failure(await second,'CANCELLED');
      hung.resolve();newer.resolve();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(s.calls.length,1);
      delete s.ctx.llm.resolveModelInfo;unwrap(await s.call('followup',payload));await until(()=>!readingIsBusy(s.service.snapshot()));
      const final=s.service.snapshot()!;assert.equal(final.conversation!.length,1);assert.equal(final.conversation![0]!.question,payload.question);assert.equal(s.calls.length,2);s.gate.assertIdle();
      failure(await s.call('cancel',{id:s.original.id,preflightId:id}),'CONVERSATION_CHANGED');
    }finally{await s.cleanup();}
  });
  test(`${module} 私人资料锁定与卸载取消挂起预检，旧响应不能恢复数据`,async()=>{
    for(const action of ['lock','dispose'] as const){
      const s=await setup(module);try{
        const hung=s.hangCapabilities(),pending=s.call('followup',{id:s.original.id,question:'挂起的草稿',expectedTurnCount:0});await until(()=>!!hung.signal());
        if(action==='lock')await s.memory.lock();else await s.service.dispose();
        failure(await pending,'CANCELLED');assert.equal(hung.signal()!.aborted,true);s.gate.assertIdle();
        if(action==='lock')assert.equal(s.service.snapshot(),null);else assert.equal(s.service.snapshot()?.preflight,undefined);
        const cancelled=s.service.snapshot();hung.resolve();await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(s.service.snapshot(),cancelled);assert.equal(s.calls.length,1);
      }finally{await s.cleanup();}
    }
  });
}

test('目录查询本身永不返回也有界超时，拒绝完整上下文仍不新增追问',async()=>{
  const s=await setup('meihua');try{
    s.ctx.llm.listModels=()=>new Promise(()=>{});
    failure(await s.call('followup',{id:s.original.id,question:'草稿',expectedTurnCount:0}),'TIMEOUT');assert.deepEqual(s.service.snapshot(),s.original);s.gate.assertIdle();
    s.ctx.llm.listModels=async()=>[{id:route.model,name:'Fixture'}];
    s.ctx.llm.resolveModelInfo=async()=>({...route,id:route.model,name:'Fixture',context:{contextWindow:128}});
    failure(await s.call('followup',{id:s.original.id,question:'仍保留的草稿',expectedTurnCount:0}),'CONTEXT_LIMIT');assert.deepEqual(s.service.snapshot(),s.original);assert.equal(s.calls.length,1);s.gate.assertIdle();
  }finally{await s.cleanup();}
});

test('预检转交前失败释放共用名额，成功后由实际任务持有名额',async()=>{
  const gate=new GenerationGate(),preflight=new GenerationPreflight(100,gate);
  await assert.rejects(preflight.run('fixed-result',async()=>{},()=>{throw new Error('state changed');}),/state changed/);
  gate.assertIdle();assert.equal(preflight.snapshot('fixed-result'),undefined);
  let releaseJob!:()=>void;
  await preflight.run('fixed-result',async()=>{},(_controller,release)=>{releaseJob=release;});
  assert.equal(preflight.snapshot('fixed-result'),undefined);assert.throws(()=>gate.assertIdle(),{code:'GENERATION_BUSY'});
  await preflight.dispose();assert.throws(()=>gate.assertIdle(),{code:'GENERATION_BUSY'});releaseJob();gate.assertIdle();
});

test('已取消预检的迟到拒绝被收束且不能干扰新预检或任务名额',async()=>{
  const gate=new GenerationGate(),preflight=new GenerationPreflight(100,gate);let rejectOld!:(error:Error)=>void,resolveNew!:()=>void;
  const old=preflight.run('fixed-result',()=>new Promise((_resolve,reject)=>{rejectOld=reject;}),()=>assert.fail('cancelled check must not commit'));
  const rejected=assert.rejects(old,{code:'CANCELLED'});await Promise.resolve();
  const id=preflight.snapshot('fixed-result')!.id;preflight.cancel('fixed-result',id);await rejected;gate.assertIdle();
  let releaseJob!:()=>void;
  const newer=preflight.run('fixed-result',()=>new Promise(resolve=>{resolveNew=resolve;}),(_controller,release)=>{releaseJob=release;});await Promise.resolve();
  assert.throws(()=>preflight.cancel('fixed-result',id),{code:'CONVERSATION_CHANGED'});
  rejectOld(new Error('ignored abort then failed'));await new Promise(resolve=>setTimeout(resolve,2));assert.throws(()=>gate.assertIdle(),{code:'GENERATION_BUSY'});
  resolveNew();await newer;releaseJob();gate.assertIdle();
});
