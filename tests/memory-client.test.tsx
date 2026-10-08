import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { MemoryPanel, BackgroundControls, type MemoryActions } from '../src/client/MemoryPanel.tsx';
import { MemoryController, type MemoryPageState } from '../src/client/memory-controller.ts';
import { MeihuaController } from '../src/client/controller.ts';
import { TarotController } from '../src/client/tarot-controller.ts';
import { MethodController } from '../src/client/method-controller.ts';
import type { MethodReading } from '../src/shared/methods.ts';
import type { ModuleId } from '../src/shared/modules.ts';
import { zh } from '../src/client/locales.ts';
import { RuleRegistry } from '../src/core/index.ts';
import { TAROT_CARDS, TAROT_DECK, TAROT_SPREADS, tarotSpread } from '../src/tarot/index.ts';
import type { MemoryDocument, MemoryStatus, MemoryVersion } from '../src/shared/memory.ts';
import type { Catalog, ClientRpc, Reading, RpcResult, TarotCatalog, TarotReading } from '../src/shared/protocol.ts';

const jsdomPackage:string='jsdom';
const {JSDOM}=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const dom=new JSDOM('<!doctype html><html><body><button id="opener">共享背景</button><div id="memory-root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
const {createRoot}=await import('react-dom/client');
const {TarotPage}=await import('../src/client/TarotPage.tsx');
const {Page}=await import('../src/client/Page.tsx');
const container=()=>document.getElementById('memory-root')!;
const button=(text:string)=>Array.from(container().querySelectorAll<HTMLButtonElement>('button')).find(value=>value.textContent?.includes(text))!;
const now='2026-10-06T04:00:00Z';
const status:MemoryStatus={initialized:true,unlocked:true,revision:2,epoch:7,updating:false,pending:false};
const memoryDocument:MemoryDocument={content:'生日：1999-07-08，出生时间不详。',revision:2,epoch:7,source:'manual',updatedAt:now,fixedParagraphs:['生日：1999-07-08，出生时间不详。']};
const version:MemoryVersion={...memoryDocument,id:'version-2',changes:{before:'关注换工作的选择。',after:memoryDocument.content}};
const memoryState:MemoryPageState={status,document:memoryDocument,versions:[version],loading:false,acting:false,open:true,error:'',notice:'',privacyEpoch:0};
const config={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:1500,maxOutputTokens:3000,pollIntervalMs:5};
const route={provider:'p',model:'m'},providers=[{id:'p',name:'模型供应商',models:[{id:'m',name:'模型'}]}];
const input={ruleId:'three-numbers',question:'合成私人问题',values:{a:2,b:3,c:2},environment:{capturedAt:now,timeZone:'Asia/Shanghai',details:{}}};
const catalog:Catalog={rules:new RuleRegistry().list(),providers,config};
const reading:Reading={id:'mh-private',result:new RuleRegistry().calculate(input),status:'ready',text:''};
const tarotCatalog:TarotCatalog={spreads:TAROT_SPREADS,deck:TAROT_DECK,providers,config};
const tarotReading:TarotReading={id:'tr-private',moduleId:'tarot',algorithmVersion:'tarot-v1',spread:tarotSpread('single'),question:input.question,includeReversed:true,createdAt:now,selectionCount:1,selectedSlots:[0],cards:[{positionIndex:0,positionLabel:'当下指引',revealed:true,card:TAROT_CARDS[0]!,orientation:'upright'}],status:'ready',text:''};
const noop=async()=>true;
const actions:MemoryActions={onClose:()=>{},onRefresh:async()=>{},onInitialize:noop,onUnlock:noop,onLock:noop,onSave:noop,onRollback:noop,onClear:noop,onChangePassphrase:noop};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

test('共享背景面板显示容量、固定段落和版本差异；清空需先展开具体删除范围',async()=>{
  const root=createRoot(container());let clears=0,closed=0;
  document.getElementById('opener')!.focus();
  await act(async()=>root.render(<MemoryPanel state={memoryState} {...actions} onClear={async()=>{clears++;return true;}} onClose={()=>{closed++;}}/>));
  assert.equal(document.activeElement?.getAttribute('aria-label'),'关闭共享背景');
  assert.equal(container().querySelector<HTMLTextAreaElement>('#wm-document')!.value,memoryDocument.content);
  assert.ok(container().textContent!.includes(`${4000-memoryDocument.content.length} 字符可用`));
  assert.ok(container().textContent!.includes('固定内容 · 1 段'));
  await act(async()=>button('v2 · 手动编辑').click());
  assert.ok(container().querySelector('.wm-diff')!.textContent!.includes(version.changes.before));
  assert.ok(container().querySelector('.wm-diff')!.textContent!.includes(version.changes.after));
  assert.equal(button('恢复这个版本').disabled,true);
  assert.equal(Array.from(container().querySelectorAll('button')).some(value=>value.textContent==='确认清空全部私人资料'),false);
  await act(async()=>button('清空全部私人资料').click());
  assert.equal(clears,0);assert.ok(container().textContent!.includes('旧版普通日志不在本次清理范围'));
  await act(async()=>button('确认清空全部私人资料').click());assert.equal(clears,1);
  await act(async()=>container().querySelector('[role=dialog]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(closed,1);
  await act(async()=>root.unmount());assert.equal(document.activeElement?.id,'opener');
});

test('锁定界面隐藏背景与历史；替他人问关闭背景选择，冻结选择只展示版本',async()=>{
  const root=createRoot(container());
  await act(async()=>root.render(<MemoryPanel state={{...memoryState,status:{...status,unlocked:false},document:null,versions:[]}} {...actions}/>));
  assert.equal(container().querySelector('textarea'),null);assert.ok(container().textContent!.includes('解锁背景'));assert.equal(container().textContent!.includes('1999-07-08'),false);
  let changes:unknown;
  await act(async()=>root.render(<BackgroundControls state={memoryState} options={{useBackground:true,forOthers:true}} onChange={patch=>{changes=patch;}} onOpen={()=>{}}/>));
  const inputs=container().querySelectorAll<HTMLInputElement>('input');assert.equal(inputs[0]!.checked,false);assert.equal(inputs[0]!.disabled,true);assert.equal(inputs[1]!.checked,true);
  await act(async()=>inputs[1]!.click());assert.deepEqual(changes,{forOthers:false});
  await act(async()=>root.render(<BackgroundControls state={memoryState} options={{useBackground:true,forOthers:false}} onChange={()=>{}} onOpen={()=>{}} usage={{enabled:true,forOthers:false,revision:2,epoch:7}}/>));
  assert.equal(container().querySelector('input'),null);assert.ok(container().textContent!.includes('本次追问沿用此版本'));assert.equal(container().textContent!.includes('1999-07-08'),false);
  await act(async()=>root.unmount());
});

test('两模块首次解读冻结后，输入表单也只显示已冻结选择；新一轮重新提供背景开关',async()=>{
  const root=createRoot(container()),usage={enabled:false,forOthers:true,revision:2,epoch:7};
  const noopVoid=async()=>{};
  for(const moduleId of ['meihua','tarot'] as const){
    for(const frozen of [true,false]){
      const current=frozen?{status:'complete' as const,text:'已冻结的首次解读',memory:usage}:{status:'ready' as const,text:''};
      const common={onInterpret:noopVoid,onCancel:noopVoid,onRefresh:noopVoid,onSkip:()=>{},memoryState,onOpenMemory:()=>{}};
      await act(async()=>root.render(moduleId==='meihua'?<Page {...common} t={key=>zh[key]} useMeihua={selector=>selector({catalog,reading:{...reading,...current},loading:false,casting:false,animationStartedAt:null,error:''})} onCast={noopVoid}/>:<TarotPage {...common} useTarot={selector=>selector({catalog:tarotCatalog,reading:{...tarotReading,...current},loading:false,acting:false,shuffling:false,error:'',draft:{question:'合成问题',spreadId:'single',includeReversed:true,route}})} onStart={noopVoid} onSelect={noopVoid} onReveal={noopVoid} onDraftChange={()=>{}} onActivityChange={()=>{}} active/>));
      assert.equal(container().querySelectorAll('.wm-reading-controls input').length,frozen?0:2);
      if(frozen)assert.ok(container().textContent!.includes('本人背景与自动记忆已停用'));
    }
  }
  await act(async()=>root.unmount());
});

test('客户端编辑与恢复携带版本和epoch；锁定清理解密状态且不会在重读时重复清理',async()=>{
  const calls:{endpoint:string;payload:unknown}[]=[];let currentStatus={...status},documentValue={...memoryDocument},resets=0;
  const rpc:ClientRpc={call:async(_channel,endpoint,payload)=>{
    calls.push({endpoint,payload});
    if(endpoint==='memory/status')return {ok:true,value:currentStatus};
    if(endpoint==='memory/document')return {ok:true,value:documentValue};
    if(endpoint==='memory/versions')return {ok:true,value:{versions:[version]}};
    if(endpoint==='memory/save'){documentValue={...documentValue,revision:3,content:'固定的新背景'};currentStatus={...currentStatus,revision:3};return {ok:true,value:documentValue};}
    if(endpoint==='memory/rollback')return {ok:true,value:documentValue};
    if(endpoint==='memory/lock'){currentStatus={...currentStatus,unlocked:false,epoch:8};return {ok:true,value:currentStatus};}
    throw new Error('unexpected endpoint');
  }};
  const controller=new MemoryController(rpc,()=>{resets++;});await controller.load();
  assert.equal(controller.getSnapshot().document?.content,memoryDocument.content);
  await controller.load();assert.equal(calls.filter(call=>call.endpoint==='memory/document').length,1,'unchanged status polling must not repeatedly retrieve personal content');
  assert.equal(await controller.save('固定的新背景',2),true);
  assert.deepEqual(calls.find(call=>call.endpoint==='memory/save')!.payload,{content:'固定的新背景',expectedRevision:2,epoch:7});
  await controller.rollback(version.id,3);assert.deepEqual(calls.find(call=>call.endpoint==='memory/rollback')!.payload,{versionId:version.id,expectedRevision:3,epoch:7});
  await controller.lock();assert.equal(resets,1);assert.equal(controller.getSnapshot().document,null);assert.deepEqual(controller.getSnapshot().versions,[]);assert.equal(controller.getSnapshot().privacyEpoch,1);
  await controller.load();assert.equal(resets,1);controller.dispose();
});

test('模块提交等待背景epoch加载，起卦和结束检查点携带当前epoch及替他人选项',async()=>{
  let epoch:number|undefined;const calls:{endpoint:string;payload:unknown}[]=[];
  const rpc:ClientRpc={call:async(_channel,endpoint,payload)=>{
    calls.push({endpoint,payload});
    if(endpoint==='meihua/catalog')return {ok:true,value:catalog};
    if(endpoint==='meihua/current')return {ok:true,value:null};
    if(endpoint==='meihua/cast')return {ok:true,value:reading};
    if(endpoint==='meihua/checkpoint')return {ok:true,value:status};
    throw new Error('unexpected endpoint');
  }};
  const controller=new MeihuaController(rpc,()=>epoch);await controller.load();
  await controller.cast(input);assert.equal(calls.some(call=>call.endpoint==='meihua/cast'),false);assert.ok(controller.getSnapshot().error.includes('共享背景状态'));
  epoch=7;controller.updateDraft({route,useBackground:false,forOthers:true});await controller.cast(input);
  assert.deepEqual(calls.find(call=>call.endpoint==='meihua/cast')!.payload,{...input,options:{useBackground:false,forOthers:true},route,epoch:7});
  await controller.checkpoint(true);assert.deepEqual(calls.find(call=>call.endpoint==='meihua/checkpoint')!.payload,{id:reading.id,options:{useBackground:false,forOthers:true},route,retry:true,epoch:7});controller.dispose();
});

test('恢复尚未AI解读的结果时保留替他人选项；同一结果的普通刷新不覆盖新的选择',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){
    let current:Reading|TarotReading={...(moduleId==='meihua'?reading:tarotReading),backgroundOptions:{useBackground:false,forOthers:true}};
    const controller=moduleId==='meihua'?new MeihuaController({call:async(_channel,endpoint)=>({ok:true,value:endpoint.endsWith('/catalog')?catalog:current})}):new TarotController({call:async(_channel,endpoint)=>({ok:true,value:endpoint.endsWith('/catalog')?tarotCatalog:current})});
    await controller.load();assert.equal(controller.getSnapshot().draft!.forOthers,true);assert.equal(controller.getSnapshot().draft!.useBackground,false);
    controller.updateDraft({forOthers:false,useBackground:true});await controller.load();assert.equal(controller.getSnapshot().draft!.forOthers,false);assert.equal(controller.getSnapshot().draft!.useBackground,true);
    current={...current,id:'new-reading-id',backgroundOptions:{useBackground:false,forOthers:true}};await controller.load();assert.equal(controller.getSnapshot().draft!.forOthers,true);assert.equal(controller.getSnapshot().draft!.useBackground,false);controller.dispose();
  }
});

test('未AI的背景开关立即保存元数据供硬刷新恢复；乱序回包与过期错误不覆盖最新草稿',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){
    let current:Reading|TarotReading={...(moduleId==='meihua'?reading:tarotReading),backgroundOptions:{useBackground:true,forOthers:false}};
    const preferenceCalls:{payload:unknown;response:ReturnType<typeof deferred<RpcResult>>}[]=[];
    const rpc:ClientRpc={call:async(_channel,endpoint,payload)=>{
      if(endpoint.endsWith('/catalog'))return {ok:true,value:moduleId==='meihua'?catalog:tarotCatalog};
      if(endpoint.endsWith('/current'))return {ok:true,value:current};
      if(endpoint.endsWith('/preferences')){
        const data=payload as {options:{useBackground:boolean;forOthers:boolean}};
        current={...current,backgroundOptions:{...data.options}};
        const response=deferred<RpcResult>();preferenceCalls.push({payload,response});return response.promise;
      }
      throw new Error('preferences must not generate a model response or trigger a summary');
    }};
    const make=()=>moduleId==='meihua'?new MeihuaController(rpc,()=>7):new TarotController(rpc,()=>7);
    const controller=make();await controller.load();controller.updateDraft({useBackground:false,forOthers:true});
    assert.deepEqual(preferenceCalls[0]!.payload,{id:current.id,options:{useBackground:false,forOthers:true},epoch:7});
    const reopened=make();await reopened.load();assert.equal(reopened.getSnapshot().draft!.forOthers,true);assert.equal(reopened.getSnapshot().draft!.useBackground,false);reopened.dispose();
    controller.updateDraft({useBackground:true,forOthers:false});controller.updateDraft({question:'最新问题草稿'});
    preferenceCalls[1]!.response.resolve({ok:true,value:{...current,backgroundOptions:{useBackground:false,forOthers:true}}});
    preferenceCalls[0]!.response.resolve({ok:false,error:{code:'OLD',message:'过期请求的错误',details:{}}});
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(controller.getSnapshot().draft!.forOthers,false);assert.equal(controller.getSnapshot().draft!.useBackground,true);assert.equal(controller.getSnapshot().draft!.question,'最新问题草稿');assert.equal(controller.getSnapshot().error,'');
    controller.updateDraft({question:'普通编辑不会保存背景偏好'});assert.equal(preferenceCalls.length,2);controller.dispose();
  }
});

test('跨窗口锁定后，较早发出的文档读取不能重新显示私人内容',async()=>{
  const oldDocument=deferred<RpcResult>();let locked=false,resets=0;
  const controller=new MemoryController({call:async(_channel,endpoint)=>{
    if(endpoint==='memory/status')return {ok:true,value:locked?{...status,unlocked:false,epoch:8}:status};
    if(endpoint==='memory/document')return oldDocument.promise;
    if(endpoint==='memory/versions')return {ok:true,value:{versions:[version]}};
    throw new Error('unexpected endpoint');
  }},()=>{resets++;});
  const beforeLock=controller.load();await new Promise<void>(resolve=>setImmediate(resolve));
  locked=true;await controller.load();oldDocument.resolve({ok:true,value:memoryDocument});await beforeLock;
  assert.equal(controller.getSnapshot().status?.unlocked,false);assert.equal(controller.getSnapshot().document,null);assert.deepEqual(controller.getSnapshot().versions,[]);assert.equal(resets,1);controller.dispose();
});

test('两控制器提交背景选项；清理私人缓存后，迟到的解读和揭牌RPC不能恢复旧内容',async()=>{
  for(const moduleId of ['meihua','tarot'] as const){
    const accepted=deferred<RpcResult>();let payload:unknown;
    const rpc:ClientRpc={call:async(_channel,endpoint,value)=>{
      if(endpoint.endsWith('/catalog'))return {ok:true,value:moduleId==='meihua'?catalog:tarotCatalog};
      if(endpoint.endsWith('/current'))return {ok:true,value:moduleId==='meihua'?reading:tarotReading};
      if(endpoint.endsWith('/interpret')){payload=value;return accepted.promise;}
      throw new Error('unexpected endpoint');
    }};
    const controller=moduleId==='meihua'?new MeihuaController(rpc):new TarotController(rpc);await controller.load();
    controller.updateDraft({question:'生日和私人问题',followupQuestion:'未发送的私人追问',useBackground:false,forOthers:true});
    const submission=controller.interpret(route);assert.deepEqual((payload as {options:unknown}).options,{useBackground:false,forOthers:true});
    controller.resetPrivate();accepted.resolve({ok:true,value:{...(moduleId==='meihua'?reading:tarotReading),status:'complete',text:'迟到的私人输出'}});await submission;
    assert.equal(controller.getSnapshot().reading,null);assert.equal(controller.getSnapshot().draft!.question,'');assert.equal(controller.getSnapshot().draft!.followupQuestion??'','');controller.dispose();
  }
  const delayed=deferred<RpcResult>(),controller=new TarotController({call:async(_channel,endpoint)=>endpoint.endsWith('/catalog')?{ok:true,value:tarotCatalog}:endpoint.endsWith('/current')?{ok:true,value:{...tarotReading,status:'revealing'}}:delayed.promise});
  await controller.load();const reveal=controller.reveal(0);controller.resetPrivate();delayed.resolve({ok:true,value:tarotReading});await reveal;assert.equal(controller.getSnapshot().reading,null);controller.dispose();
});

function completedReading(moduleId:ModuleId,id:string):Reading|TarotReading|MethodReading {
  const common={id,status:'complete' as const,text:'已完成的私人解读',route};
  if(moduleId==='meihua')return {...reading,...common};
  if(moduleId==='tarot')return {...tarotReading,...common};
  return {...common,moduleId,question:input.question,createdAt:now,environment:input.environment,result:null,backgroundOptions:{},selectedSlots:[],selectionCount:0,coins:[]};
}
function privateController(moduleId:ModuleId,rpc:ClientRpc){
  return moduleId==='meihua'?new MeihuaController(rpc,()=>7):moduleId==='tarot'?new TarotController(rpc,()=>7):new MethodController(moduleId,rpc,()=>7);
}
const flushMicrotasks=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('五模块清理发生在轮询计时器等待时，旧循环不能用新signal发起current或回填私人数据',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const moduleId of ['meihua','tarot','xiaoliu','lenormand','liuyao'] as const){
    const original=completedReading(moduleId,`${moduleId}-old`),accepted=deferred<RpcResult>();let currentCalls=0;
    const controller=privateController(moduleId,{call:async(_channel,endpoint)=>{
      if(endpoint.endsWith('/catalog'))return {ok:true,value:{...catalog,...tarotCatalog,moduleId}};
      if(endpoint.endsWith('/current')){currentCalls++;return {ok:true,value:original};}
      if(endpoint.endsWith('/followup'))return accepted.promise;
      throw new Error(`unexpected ${endpoint}`);
    }});
    try{
      await controller.load();const pending=controller.followup('尚未发出的私人追问');controller.resetPrivate();
      accepted.resolve({ok:true,value:original});assert.equal(await pending,false);await flushMicrotasks();
      t.mock.timers.tick(config.pollIntervalMs*2);await flushMicrotasks();
      assert.equal(currentCalls,1,moduleId);assert.equal(controller.getSnapshot().reading,null,moduleId);assert.equal(controller.getSnapshot().error,'',moduleId);
    }finally{controller.dispose();}
  }
});

test('五模块旧current悬而未决时清理并开始新轮，新轮仍能轮询且迟到旧响应不能恢复私人内容',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const moduleId of ['meihua','tarot','xiaoliu','lenormand','liuyao'] as const){
    const original=completedReading(moduleId,`${moduleId}-old`),oldCurrent=deferred<RpcResult>(),oldAccepted=deferred<RpcResult>();
    const oldPollEntered=deferred<void>();let current=original,currentCalls=0,followupCalls=0,holdOldCurrent=false;
    const controller=privateController(moduleId,{call:async(_channel,endpoint)=>{
      if(endpoint.endsWith('/catalog'))return {ok:true,value:{...catalog,...tarotCatalog,moduleId}};
      if(endpoint.endsWith('/current')){
        currentCalls++;if(holdOldCurrent){holdOldCurrent=false;oldPollEntered.resolve();return oldCurrent.promise;}
        return {ok:true,value:current};
      }
      if(endpoint.endsWith('/followup')){
        if(++followupCalls===1){holdOldCurrent=true;return oldAccepted.promise;}
        current={...current,conversation:[{id:'new-turn',question:'新轮追问',text:'新轮输出',status:'streaming',route,createdAt:now}]};return {ok:true,value:current};
      }
      throw new Error(`unexpected ${endpoint}`);
    }});
    try{
      await controller.load();const oldPending=controller.followup('旧轮私人追问');t.mock.timers.tick(config.pollIntervalMs);await oldPollEntered.promise;
      controller.resetPrivate();assert.equal(controller.getSnapshot().reading,null);
      current=completedReading(moduleId,`${moduleId}-new`);await controller.load();assert.equal(await controller.followup('新轮追问'),true);
      current={...current,conversation:current.conversation!.map(turn=>({...turn,status:'complete' as const,text:'新轮完整输出'}))};
      t.mock.timers.tick(config.pollIntervalMs);await flushMicrotasks();
      assert.equal(controller.getSnapshot().reading?.conversation?.[0]?.text,'新轮完整输出',moduleId);
      const completedCalls=currentCalls;
      oldCurrent.resolve({ok:true,value:original});oldAccepted.resolve({ok:true,value:original});assert.equal(await oldPending,false);await flushMicrotasks();
      t.mock.timers.tick(config.pollIntervalMs*2);await flushMicrotasks();
      assert.equal(currentCalls,completedCalls,moduleId);assert.equal(controller.getSnapshot().reading?.id,`${moduleId}-new`,moduleId);
      assert.equal(controller.getSnapshot().reading?.conversation?.[0]?.text,'新轮完整输出',moduleId);assert.equal(controller.getSnapshot().error,'',moduleId);
    }finally{controller.dispose();}
  }
});

test('五模块预检期间发出的旧current不能覆盖刚接收的追问，轮询继续更新新回答',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const moduleId of ['meihua','tarot','xiaoliu','lenormand','liuyao'] as const){
    const original=completedReading(moduleId,`${moduleId}-reading`),oldCurrent=deferred<RpcResult>(),accepted=deferred<RpcResult>(),entered=deferred<void>();
    let current=original,holdCurrent=false;
    const controller=privateController(moduleId,{call:async(_channel,endpoint)=>{
      if(endpoint.endsWith('/catalog'))return {ok:true,value:{...catalog,...tarotCatalog,moduleId}};
      if(endpoint.endsWith('/current')){if(holdCurrent){holdCurrent=false;entered.resolve();return oldCurrent.promise;}return {ok:true,value:current};}
      if(endpoint.endsWith('/followup')){holdCurrent=true;return accepted.promise;}
      throw new Error(`unexpected ${endpoint}`);
    }});
    try{
      await controller.load();const pending=controller.followup('本轮追问');t.mock.timers.tick(config.pollIntervalMs);await entered.promise;
      current={...current,conversation:[{id:'accepted-turn',question:'本轮追问',text:'新回答前缀',status:'streaming',route,createdAt:now}]};
      accepted.resolve({ok:true,value:current});assert.equal(await pending,true);
      oldCurrent.resolve({ok:true,value:original});await flushMicrotasks();
      assert.equal(controller.getSnapshot().reading?.conversation?.[0]?.text,'新回答前缀',moduleId);
      current={...current,conversation:current.conversation!.map(turn=>({...turn,status:'complete' as const,text:'新回答完整正文'}))};
      t.mock.timers.tick(config.pollIntervalMs);await flushMicrotasks();
      assert.equal(controller.getSnapshot().reading?.conversation?.[0]?.text,'新回答完整正文',moduleId);
    }finally{controller.dispose();}
  }
});
