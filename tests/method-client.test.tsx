import test from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MemoryService} from '../src/host/memory-service.ts';
import {MethodService} from '../src/host/method-service.ts';
import {GenerationGate} from '../src/host/generation-gate.ts';
import {registerModuleTransport} from '../src/host/transport.ts';
import {MethodController,type MethodPageState} from '../src/client/method-controller.ts';
import {MethodPage,type MethodActions} from '../src/client/MethodPage.tsx';
import type {MemoryPageState} from '../src/client/memory-controller.ts';
import {zh,type Translate} from '../src/client/locales.ts';
import type {NewMethodId} from '../src/shared/modules.ts';
import type {MethodReading} from '../src/shared/methods.ts';
import type {ClientRpc,PluginConfig,RpcResult} from '../src/shared/protocol.ts';
import type {GenerateOptions,HostContext,LlmChunk,LogSession} from '../src/host/platform.ts';
import type {XiaoliuResult} from '../src/xiaoliu/types.ts';
import type {LenormandResult} from '../src/lenormand/types.ts';
import type {LiuyaoResult} from '../src/liuyao/types.ts';

const jsdomPackage:string='jsdom',sessionPackage:string='@deepseek-ai/dsh-session';
const {JSDOM}=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const {JsonStorageBackend}=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js')).href) as {JsonStorageBackend:new(root:string)=>{kv:unknown;close():Promise<void>}};
const dom=new JSDOM('<!doctype html><html><body><div id="method-test-root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
const container=()=>document.getElementById('method-test-root')!;
const findButton=(label:string)=>Array.from(container().querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.includes(label))!;
const t:Translate=key=>zh[key];
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:3000,maxOutputTokens:3000,pollIntervalMs:5};
const route={provider:'fixture-method',model:'fixture-method'};
const secondRoute={provider:'fixture-method-second',model:'fixture-method-second-model'};
const modules:readonly NewMethodId[]=['xiaoliu','lenormand','liuyao'];
const values=[6,7,8,9,7,8];
function unwrap<T>(result:RpcResult):T {assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:unknown}).value as T;}
async function until(check:()=>boolean,label:string):Promise<void>{for(let i=0;i<300;i++){if(check())return;await new Promise<void>(resolve=>setTimeout(resolve,5));}assert.fail(`Timed out: ${label}`);}

/** Real controllers -> exact Connection Fetch envelope -> real services and encrypted JSON backend.
 * Only the supplier stream is synthetic; no network request or personal user data is involved.
 */
async function setup(initialize=false){
  const directory=await mkdtemp(join(tmpdir(),'wenxiang-method-client-')),backend=new JsonStorageBackend(directory),gate=new GenerationGate(),calls:GenerateOptions[]=[];
  const rpcCalls:{endpoint:string;payload:unknown}[]=[],routes=new Map<string,{fetch(request:Request):Promise<Response>}>();
  let hold=false;
  const ctx:HostContext={storage:{backend:{get:()=>backend}},llm:{listProviders:()=>[{id:route.provider,name:'合成供应商'},{id:secondRoute.provider,name:'第二个合成供应商'}],listModels:async provider=>[{id:provider===secondRoute.provider?secondRoute.model:route.model,name:'合成模型'}],stream:async function*(options):AsyncGenerator<LlmChunk>{
    assert.equal(options.sessionId,undefined);calls.push(options);
    if(options.system.includes('背景信息提炼器')){
      const input=JSON.parse(options.messages[0]!.content[0]!.text) as {messages:{id:string;text:string}[]};
      yield {type:'text-delta',index:0,text:JSON.stringify({items:input.messages.map(message=>({kind:'concern',category:'持续关注的问题',sourceMessageId:message.id,quote:message.text}))})};
      yield {type:'finish',reason:{kind:'stop'}};return;
    }
    const followup=options.system.includes('最后一个追问');
    yield {type:'text-delta',index:0,text:followup?'追问已收到的前缀':'首解已收到的前缀'};
    if(hold){await new Promise<void>(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',()=>resolve(),{once:true});});yield {type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message:'合成取消'}}};}
    else {yield {type:'text-delta',index:0,text:followup?'；这是完整追问回答。':'；这是完整首次回答。'};yield {type:'finish',reason:{kind:'stop'}};}
  }},sessions:{prepare:id=>new Session(id!,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},sessionPersistence:{create:async()=>({append:async()=>{},flush:async()=>{},close:async()=>{}})},connection:{fetch:{register:registered=>{routes.set(registered.path,registered);return async()=>{routes.delete(registered.path);};}}},reflect:{provide:()=>async()=>{}},effect:factory=>factory()};
  const memory=new MemoryService(ctx,config,gate),services=Object.fromEntries(modules.map(id=>[id,new MethodService(id,ctx,config,gate,memory)])) as Record<NewMethodId,MethodService>;
  await memory.ready;if(initialize)await memory.initialize('synthetic-method-client-only');
  for(const id of modules)registerModuleTransport(ctx,id,services[id],['catalog','current','start','select','reveal','toss','record','interpret','followup','cancel','checkpoint','preferences']);
  const controllers:MethodController[]=[];
  let sequence=0;
  const rpc:ClientRpc={call:async(channel,endpoint,payload)=>{
    assert.equal(channel,'/api');rpcCalls.push({endpoint,payload});const registered=routes.get(`/api/${endpoint}`);assert.ok(registered,endpoint);
    const rpcId=`method-client-${++sequence}`,response=await registered.fetch(new Request(`http://localhost/api/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload})}));
    assert.equal(response.status,200);const envelope=await response.json() as {type:string;rpcId:string;result:RpcResult};assert.equal(envelope.type,'server-response');assert.equal(envelope.rpcId,rpcId);return envelope.result;
  }};
  return {memory,services,rpc,calls,rpcCalls,setHold:(value:boolean)=>{hold=value;},controller:(id:NewMethodId,carrier:ClientRpc=rpc)=>{const controller=new MethodController(id,carrier,()=>memory.currentEpoch);controllers.push(controller);return controller;},memoryState:async():Promise<MemoryPageState>=>({status:await memory.status(),document:null,versions:[],open:false,loading:false,acting:false,error:'',notice:'',privacyEpoch:0}),cleanup:async()=>{for(const controller of controllers)controller.dispose();await memory.dispose();for(const service of Object.values(services))await service.dispose();await backend.close();await rm(directory,{recursive:true,force:true});}};
}
function actions(controller:MethodController):MethodActions{return {onStart:controller.start,onLocal:controller.local,onInterpret:controller.interpret,onFollowup:controller.followup,onCancel:controller.cancel,onRefresh:()=>controller.load(),onCheckpoint:()=>controller.checkpoint(),onDraft:controller.updateDraft};}
async function ready(controller:MethodController):Promise<MethodReading>{
  await controller.load();controller.updateDraft({question:'我如何安排学习？',wallTime:'2024-04-13T08:00',spreadId:'line-5',route,forOthers:true});assert.equal(await controller.start(),true);
  if(controller.moduleId==='lenormand'){for(const slot of [1,3,8,15,31])assert.equal(await controller.local('select',{slot}),true);assert.equal(controller.getSnapshot().reading?.result,null);assert.equal(await controller.local('reveal'),true);}
  if(controller.moduleId==='liuyao')for(const value of values)assert.equal(await controller.local('record',{value}),true);
  assert.equal(controller.getSnapshot().reading?.status,'ready');return controller.getSnapshot().reading!;
}

test('三模块实际本地结果可查看；未解锁禁用解读，展开过程不会调用供应商',async()=>{
  const s=await setup(),root=createRoot(container());try{
    for(const moduleId of modules){const controller=s.controller(moduleId),reading=await ready(controller);await act(async()=>root.render(<MethodPage moduleId={moduleId} state={controller.getSnapshot()} memory={await s.memoryState()} onOpenMemory={()=>{}} t={t} {...actions(controller)}/>));
      assert.equal(findButton('开始解读').disabled,true);assert.equal(container().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,false);
      assert.equal(s.calls.length,0);for(const details of container().querySelectorAll<HTMLDetailsElement>('details')){details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));}assert.equal(s.calls.length,0);
      if(moduleId==='xiaoliu'){
        const result=reading.result as XiaoliuResult;assert.deepEqual(Array.from(container().querySelectorAll('.wx-six-palaces h3')).map(node=>node.textContent),['速喜','大安','小吉']);
        assert.ok(container().textContent?.includes('农历 3月5日 · 辰时'));for(const line of result.steps)assert.ok(container().textContent?.includes(line));assert.ok(container().textContent?.includes(result.meaning));
      }else if(moduleId==='lenormand'){
        const result=reading.result as LenormandResult;assert.equal(container().querySelectorAll('.wx-small-cards article').length,5);assert.equal(container().querySelectorAll('.wx-small-cards img').length,5);
        assert.equal(result.adjacentPairs.length,4);assert.equal(result.mirrors.length,2);assert.ok(container().textContent?.includes(`中牌主题：${result.center.card.name}`));
        for(const pair of [...result.adjacentPairs,...result.mirrors]){assert.ok(container().textContent?.includes(pair.phrase));assert.ok(container().textContent?.includes(pair.explanation));}
        for(const image of container().querySelectorAll<HTMLImageElement>('img')){assert.ok(image.src.startsWith('data:image/svg+xml;utf8,'));assert.ok(image.alt.endsWith('原创牌面'));}
      }else{
        const result=reading.result as LiuyaoResult,rows=Array.from(container().querySelectorAll('tbody tr'));assert.equal(rows.length,6);assert.deepEqual(rows.map(row=>row.querySelector('td')!.textContent),['6','5','4','3','2','1']);
        assert.ok(container().textContent?.includes(result.calendar.dayGanzhi));assert.ok(container().textContent?.includes(result.calendar.voidBranches.join('、')));assert.ok(container().textContent?.includes(`世${result.palace.shi}应${result.palace.ying}`));
        for(const line of result.lines){const row=rows.find(row=>row.querySelector('td')!.textContent===String(line.position))!;for(const fragment of [line.spirit,line.relative,line.najia,line.label,line.changed.najia])assert.ok(row.textContent?.includes(fragment),`${line.position}: ${fragment}`);if(line.moving)assert.ok(row.textContent?.includes('○动'));}
        for(const line of result.steps)assert.ok(container().textContent?.includes(line));assert.ok(container().textContent?.includes(result.calendar.previousJie.localTime));assert.ok(container().textContent?.includes(result.calendar.nextJie.localTime));
      }
    }
  }finally{await act(async()=>root.unmount());await s.cleanup();}
});

test('雷诺曼选择阶段36张背牌不泄露牌号；点击动作携带实际槽位与序号',async()=>{
  const s=await setup(),root=createRoot(container()),controller=s.controller('lenormand');try{
    await controller.load();controller.updateDraft({question:'我如何安排学习？',spreadId:'line-5'});await controller.start();
    const render=async()=>act(async()=>root.render(<MethodPage moduleId="lenormand" state={controller.getSnapshot()} memory={await s.memoryState()} t={t} {...actions(controller)}/>));
    await render();assert.equal(container().querySelectorAll('.wx-small-deck button').length,36);assert.equal(container().querySelectorAll('img').length,0);assert.equal(container().querySelector('.wx-small-cards'),null);
    await act(async()=>container().querySelector<HTMLButtonElement>('[aria-label="选择第 31 张背牌"]')!.click());await until(()=>controller.getSnapshot().reading?.selectedSlots.length===1,'first selected slot');await render();
    assert.deepEqual(controller.getSnapshot().reading?.selectedSlots,[31]);assert.equal(controller.getSnapshot().reading?.result,null);assert.equal(container().querySelector<HTMLButtonElement>('[aria-label="选择第 31 张背牌"]')!.disabled,true);
    assert.deepEqual((s.rpcCalls.find(call=>call.endpoint==='lenormand/select')!.payload as Record<string,unknown>).expectedCount,0);assert.equal(s.calls.length,0);
  }finally{await act(async()=>root.unmount());await s.cleanup();}
});

test('六爻自下而上投币与手录保持动作编号；部分记录也完整进入复制',async()=>{
  const s=await setup(),root=createRoot(container()),controller=s.controller('liuyao');let copied='';
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{copied=value;}},configurable:true});
  try{
    await controller.load();controller.updateDraft({question:'我如何安排学习？',wallTime:'2024-04-13T08:00'});await controller.start();
    const render=async()=>act(async()=>root.render(<MethodPage moduleId="liuyao" state={controller.getSnapshot()} memory={await s.memoryState()} t={t} {...actions(controller)}/>));
    await render();assert.ok(container().textContent?.includes('自下而上 · 第 1 次'));
    await act(async()=>findButton('记录 9').click());await until(()=>controller.getSnapshot().reading?.coins.length===1,'manual first line');await render();
    assert.ok(container().textContent?.includes('第1爻：9'));assert.ok(container().textContent?.includes('自下而上 · 第 2 次'));
    await act(async()=>findButton('投掷三枚硬币').click());await until(()=>controller.getSnapshot().reading?.coins.length===2,'toss second line');await render();
    const coins=controller.getSnapshot().reading!.coins;assert.equal(coins[0]?.value,9);assert.deepEqual(coins[0]?.faces,[]);assert.equal(coins[1]?.faces.length,3);assert.ok(coins[1]?.faces.every(face=>face===2||face===3));assert.equal(coins[1]?.value,coins[1]?.faces.reduce((sum,face)=>sum+face,0));
    assert.deepEqual(s.rpcCalls.filter(call=>['liuyao/record','liuyao/toss'].includes(call.endpoint)).map(call=>(call.payload as Record<string,unknown>).expectedCount),[0,1]);
    assert.equal(controller.getSnapshot().reading?.result,null);await act(async()=>findButton('复制结果').click());
    // A null assembled result must not discard already recorded physical/simulated coins.
    for(const coin of coins){assert.ok(copied.includes(String(coin.value)));for(const face of coin.faces)assert.ok(copied.includes(String(face)));}
    assert.ok(copied.includes('coins')||copied.includes('投币'));assert.equal(s.calls.length,0);
  }finally{await act(async()=>root.unmount());await s.cleanup();}
});

test('控制器恢复Host当前结果与背景选择；清私有缓存后晚到快照和动作不能复活旧问题',async()=>{
  const s=await setup();try{
    for(const moduleId of modules){const original=s.controller(moduleId),reading=await ready(original);original.updateDraft({useBackground:false,forOthers:true});await until(()=>s.services[moduleId].snapshot()?.backgroundOptions.useBackground===false,'preferences saved');
      original.dispose();const reopened=s.controller(moduleId);await reopened.load();assert.equal(reopened.getSnapshot().reading?.id,reading.id);assert.equal(reopened.getSnapshot().draft.question,reading.question);assert.equal(reopened.getSnapshot().draft.useBackground,false);assert.equal(reopened.getSnapshot().draft.forOthers,true);
      let release:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{release=resolve;});let capture=false;
      const delayed:ClientRpc={call:async(...args)=>{const reply=await s.rpc.call(...args);if(capture&&(args[1].endsWith('/current')||args[1].endsWith('/start')))await barrier;return reply;}};
      const protectedController=s.controller(moduleId,delayed);await protectedController.load();capture=true;const loading=protectedController.load();await new Promise<void>(resolve=>setImmediate(resolve));protectedController.resetPrivate();release();await loading;
      assert.equal(protectedController.getSnapshot().reading,null);assert.equal(protectedController.getSnapshot().draft.question,'');assert.equal(protectedController.getSnapshot().draft.followupQuestion,'');
      let releaseAction:()=>void=()=>{};const actionBarrier=new Promise<void>(resolve=>{releaseAction=resolve;});
      const actionDelayed:ClientRpc={call:async(...args)=>{const reply=await s.rpc.call(...args);if(args[1].endsWith('/start'))await actionBarrier;return reply;}};
      const actionController=s.controller(moduleId,actionDelayed);await actionController.load();actionController.updateDraft({question:'清空前的旧问题',forOthers:true});const starting=actionController.start();await new Promise<void>(resolve=>setImmediate(resolve));actionController.resetPrivate();releaseAction();assert.equal(await starting,false);assert.equal(actionController.getSnapshot().reading,null);assert.equal(actionController.getSnapshot().acting,false);assert.equal(actionController.getSnapshot().draft.question,'');
    }
  }finally{await s.cleanup();}
});

test('三个控制器均轮询首解与追问，取消保留前缀与原结果，后续回答仍使用冻结背景',async()=>{
  const s=await setup(true);try{
    await s.memory.save('原背景_METHOD_V1',0,s.memory.currentEpoch);
    for(const moduleId of modules){const controller=s.controller(moduleId);await ready(controller);controller.updateDraft({forOthers:false});await until(()=>!s.services[moduleId].snapshot()?.backgroundOptions.forOthers,'own preferences saved');
      const frozenResult=structuredClone(controller.getSnapshot().reading?.result);s.setHold(true);assert.equal(await controller.interpret(),true);await until(()=>controller.getSnapshot().reading?.text.includes('首解已收到的前缀')===true,'initial prefix');
      assert.equal(await controller.cancel(),true);await until(()=>controller.getSnapshot().reading?.status==='cancelled','initial cancellation');assert.deepEqual(controller.getSnapshot().reading?.result,frozenResult);assert.ok(controller.getSnapshot().reading?.text.includes('首解已收到的前缀'));
      assert.equal(await controller.followup('如何把建议落到今天的安排？'),true);await until(()=>controller.getSnapshot().reading?.conversation?.[0]?.text.includes('追问已收到的前缀')===true,'followup prefix');assert.equal(await controller.cancel(),true);
      await until(()=>controller.getSnapshot().reading?.conversation?.[0]?.status==='cancelled','followup cancellation');const cancelledTurn=controller.getSnapshot().reading!.conversation![0]!;
      const cancelCall=s.rpcCalls.filter(call=>call.endpoint===`${moduleId}/cancel`).at(-1)!;assert.equal((cancelCall.payload as Record<string,unknown>).turnId,cancelledTurn.id);
      assert.ok(cancelledTurn.text.includes('追问已收到的前缀'));assert.deepEqual(controller.getSnapshot().reading?.result,frozenResult);
      const frozenRevision=controller.getSnapshot().reading!.memory!.revision,doc=unwrap<{revision:number;epoch:number}>(await s.memory.rpc('document',{}));await s.memory.save('后改背景_METHOD_V2',doc.revision,doc.epoch);
      s.setHold(false);assert.equal(await controller.followup('还有哪个条件需要核实？'),true);await until(()=>controller.getSnapshot().reading?.conversation?.[1]?.status==='complete','complete followup');
      assert.ok(controller.getSnapshot().reading?.conversation?.[1]?.text.includes('完整追问回答'));assert.equal(controller.getSnapshot().reading?.memory?.revision,frozenRevision);
      const initial=s.calls.filter(call=>call.system.includes(`正在解释${moduleId==='xiaoliu'?'小六壬':moduleId==='lenormand'?'雷诺曼':'六爻纳甲'}`)).at(-3)!,followup=s.calls.at(-1)!;
      const background=(options:GenerateOptions)=>options.messages[0]!.content[0]!.text;
      assert.equal(background(followup),background(initial),'followup must carry the identical frozen local record and background block');
      assert.equal(s.rpcCalls.filter(call=>call.endpoint===`${moduleId}/interpret`).length,1);assert.equal(s.rpcCalls.filter(call=>call.endpoint===`${moduleId}/followup`).length,2);
      controller.dispose();
    }
  }finally{s.setHold(false);await s.cleanup();}
});

test('完整复制保留三种本地结果和追问终态；模型文字按文本节点显示',async()=>{
  const s=await setup(),root=createRoot(container());let copied='';Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{copied=value;}},configurable:true});try{
    for(const moduleId of modules){const controller=s.controller(moduleId),current=await ready(controller),reading:MethodReading={...current,status:'complete',route,text:'<img src="bad" onerror="attack()">首解原文',memory:{enabled:true,forOthers:false,revision:7,epoch:s.memory.currentEpoch},conversation:[{id:'followup-copy',question:'追问合成问题',text:'已保留的部分追问',status:'cancelled',route,createdAt:'2024-04-13T08:00:00Z',error:{code:'CANCELLED',message:'已取消合成回答'}}]};
      const state:MethodPageState={...controller.getSnapshot(),reading};await act(async()=>root.render(<MethodPage moduleId={moduleId} state={state} memory={await s.memoryState()} t={t} {...actions(controller)}/>));await act(async()=>findButton('复制结果').click());
      assert.ok(copied.includes(reading.question));assert.ok(copied.includes('首解原文'));assert.ok(copied.includes('追问合成问题'));assert.ok(copied.includes('已保留的部分追问'));assert.ok(copied.includes('回答已取消'));assert.ok(copied.includes('已取消合成回答'));assert.ok(copied.includes(route.model));
      assert.equal(container().querySelector('.wx-method-text img'),null);assert.ok(container().querySelector('.wx-method-text')?.textContent?.includes('<img src="bad"'));
      if(moduleId==='xiaoliu')for(const palace of ['速喜','大安','小吉'])assert.ok(copied.includes(palace));
      else if(moduleId==='lenormand'){const result=reading.result as LenormandResult;for(const pair of [...result.adjacentPairs,...result.mirrors])assert.ok(copied.includes(pair.phrase));for(const placed of result.cards)assert.ok(copied.includes(placed.card.name));}
      else {const result=reading.result as LiuyaoResult;for(const line of result.lines)for(const fragment of [line.najia,line.spirit,line.relative,line.changed.najia])assert.ok(copied.includes(fragment));assert.ok(copied.includes(result.calendar.dayGanzhi));assert.ok(copied.includes(result.calendar.voidBranches[0]));}
    }
  }finally{await act(async()=>root.unmount());await s.cleanup();}
});

test('三个模块首解前所选非首项模型与指定时间可恢复，结束检查点使用同一供应商',async()=>{
  const s=await setup(true);try{
    for(const moduleId of modules){const original=s.controller(moduleId),reading=await ready(original);
      // The model selector is shown only after the local result. This is the actual UI order.
      original.updateDraft({route:secondRoute,forOthers:false});await until(()=>s.services[moduleId].snapshot()?.selectedRoute?.provider===secondRoute.provider&&!s.services[moduleId].snapshot()?.backgroundOptions.forOthers,'selected model persisted before first interpretation');
      assert.equal(s.calls.length===0||s.calls.every(call=>call.system.includes('背景信息提炼器')),true);
      original.dispose();const reopened=s.controller(moduleId);await reopened.load();const restored=reopened.getSnapshot();
      assert.equal(restored.reading?.id,reading.id);assert.equal(restored.reading?.status,'ready');assert.deepEqual(restored.draft.route,secondRoute);assert.equal(restored.draft.wallTime,'2024-04-13T08:00');
      const count=s.calls.length;await reopened.checkpoint();await s.memory.freeze();assert.equal(s.calls.length,count+1);
      const checkpoint=s.calls.at(-1)!;assert.ok(checkpoint.system.includes('背景信息提炼器'));assert.equal(checkpoint.provider,secondRoute.provider);assert.equal(checkpoint.model,secondRoute.model);
      const body=JSON.parse(checkpoint.messages[0]!.content[0]!.text) as {messages:{text:string}[]};assert.equal(body.messages[0]?.text,reading.question);assert.equal((await s.memory.status()).error,undefined);
      reopened.dispose();
    }
  }finally{await s.cleanup();}
});

test('六爻在开始前拒绝超出历法范围的指定日期，不留下可继续记录的五爻半成品',async()=>{
  const s=await setup(),controller=s.controller('liuyao');try{
    await controller.load();for(const wallTime of ['2101-01-01T12:00','1899-12-31T12:00']){
      controller.updateDraft({question:'合成日期边界检查',wallTime});assert.equal(await controller.start(),false);assert.ok(controller.getSnapshot().error.includes('1900 至 2100'));
      assert.equal(controller.getSnapshot().reading,null);assert.equal(s.services.liuyao.snapshot(),null);assert.equal(s.calls.length,0);
      const recording=await s.services.liuyao.rpc('record',{id:'不存在的旧轮',expectedCount:0,value:7,epoch:s.memory.currentEpoch});assert.equal(recording.ok,false);assert.equal(s.services.liuyao.snapshot(),null);
    }
  }finally{await s.cleanup();}
});

test('同一挂载页面恢复另一窗口的新完整轮次时，旧轮追问草稿不会附着到新结果',async()=>{
  const s=await setup(true),root=createRoot(container()),original=s.controller('xiaoliu');try{
    await ready(original);assert.equal(await original.interpret(),true);await until(()=>original.getSnapshot().reading?.status==='complete','old complete reading');
    const oldId=original.getSnapshot().reading!.id;original.updateDraft({followupQuestion:'只属于旧结果的合成追问草稿'});
    const render=async()=>act(async()=>root.render(<MethodPage moduleId="xiaoliu" state={original.getSnapshot()} memory={await s.memoryState()} t={t} {...actions(original)}/>));
    await render();assert.equal(container().querySelector<HTMLTextAreaElement>('#xiaoliu-followup-question')!.value,'只属于旧结果的合成追问草稿');
    const otherWindow=s.controller('xiaoliu');await otherWindow.load();otherWindow.updateDraft({question:'新窗口的合成学习问题',wallTime:'2024-04-13T08:00',forOthers:true});assert.equal(await otherWindow.start(),true);assert.equal(await otherWindow.interpret(),true);await until(()=>otherWindow.getSnapshot().reading?.status==='complete','new complete reading');
    assert.notEqual(otherWindow.getSnapshot().reading?.id,oldId);await original.load();assert.equal(original.getSnapshot().reading?.id,otherWindow.getSnapshot().reading?.id);assert.equal(original.getSnapshot().draft.followupQuestion,'');
    await render();assert.equal(container().querySelector<HTMLTextAreaElement>('#xiaoliu-followup-question')!.value,'');assert.ok(container().textContent?.includes('新窗口的合成学习问题'));
    assert.equal(s.calls.filter(call=>call.system.includes('背景信息提炼器')).length,0);assert.equal(s.calls.length,2);
  }finally{await act(async()=>root.unmount());await s.cleanup();}
});
