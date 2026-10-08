import test from 'node:test';
import assert from 'node:assert/strict';
import { act, useSyncExternalStore } from 'react';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import type {HubProps} from '../src/client/Hub.tsx';
import { Starfield } from '../src/client/Portal.tsx';
import { HubController, type HubState } from '../src/client/hub-controller.ts';
import { MeihuaController, type PageState } from '../src/client/controller.ts';
import { TarotController, type TarotPageState } from '../src/client/tarot-controller.ts';
import type { MemoryController, MemoryPageState } from '../src/client/memory-controller.ts';
import { RuleRegistry } from '../src/core/index.ts';
import { TAROT_CARDS, TAROT_DECK } from '../src/tarot/cards.ts';
import { TAROT_SPREADS } from '../src/tarot/spreads.ts';
import { zh } from '../src/client/locales.ts';
import type { Catalog, ClientRpc, Reading, RpcResult, TarotCatalog, TarotReading } from '../src/shared/protocol.ts';

const jsdomPackage:string='jsdom';
const { JSDOM }=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})) {
  Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
}
// Initialize react-dom after the DOM so its controlled-input event detection is real.
const { createRoot }=await import('react-dom/client');
const {Hub}=await import('../src/client/Hub.tsx');
const media=(reduced:boolean)=>Object.defineProperty(globalThis,'matchMedia',{value:()=>({matches:reduced}),configurable:true,writable:true});
const noop=async()=>{};
const config={timeZone:'Asia/Shanghai',animationMs:4800,interpretationTimeoutMs:1500,maxOutputTokens:3000,pollIntervalMs:100};
const catalog:Catalog={rules:new RuleRegistry().list(),providers:[],config};
const tarotCatalog:TarotCatalog={spreads:TAROT_SPREADS,providers:[],config,deck:TAROT_DECK};
const input={ruleId:'three-numbers',question:'冻结问题',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-02T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};
const reading:Reading={id:'hub-m1',result:new RuleRegistry().calculate(input),status:'ready',text:''};
const tarotReading:TarotReading={id:'hub-t1',moduleId:'tarot',algorithmVersion:'tarot-v1',spread:TAROT_SPREADS[0]!,question:'当下指引',includeReversed:true,createdAt:'2026-10-03T10:00:00Z',selectionCount:0,selectedSlots:[],cards:[],status:'selecting',text:''};

function actions():Omit<HubProps,'useHub'|'useMeihua'|'useTarot'|'onNavigate'|'onSkipJourney'> {
  return {
    t:key=>zh[key],onMeihuaCast:noop,onMeihuaInterpret:noop,onMeihuaCancel:noop,
    onMeihuaRefresh:noop,onMeihuaSkip:()=>{},onMeihuaDraft:()=>{},
    onTarotStart:noop,onTarotSelect:noop,onTarotReveal:noop,onTarotInterpret:noop,
    onTarotCancel:noop,onTarotRefresh:noop,onTarotSkip:()=>{},onTarotDraft:()=>{},onTarotActive:()=>{},
  };
}

test('门户控制器在生成期间拒绝导航，接受取消终态后解锁，并锁定重复转场',t=>{
  media(false);t.mock.timers.enable({apis:['setTimeout']});
  let busy=true,changes=0;
  const hub=new HubController(()=>busy);
  const unsubscribe=hub.subscribe(()=>changes++);
  hub.navigate('tarot');
  assert.equal(hub.getSnapshot().view,'portal');
  assert.equal(hub.getSnapshot().journey,null);
  assert.match(hub.getSnapshot().error,/先取消/);
  busy=false;hub.navigate('meihua',{x:.25,y:.65});
  assert.equal(hub.getSnapshot().error,'');
  assert.deepEqual(hub.getSnapshot().journey?.origin,{x:.25,y:.65});
  assert.equal(hub.getSnapshot().journey?.duration,1600);
  const journey=hub.getSnapshot().journey;
  hub.navigate('tarot');
  assert.equal(hub.getSnapshot().journey,journey);
  hub.skip();assert.equal(hub.getSnapshot().view,'meihua');assert.equal(hub.getSnapshot().journey,null);
  const afterSkip=changes;
  t.mock.timers.tick(2000);assert.equal(changes,afterSkip);
  hub.navigate('portal');assert.equal(hub.getSnapshot().journey?.duration,800);
  t.mock.timers.tick(425);assert.equal(hub.getSnapshot().view,'portal');assert.ok(hub.getSnapshot().journey);
  t.mock.timers.tick(375);assert.equal(hub.getSnapshot().journey,null);
  hub.setScheme('dark');assert.equal(hub.getSnapshot().scheme,'dark');
  unsubscribe();hub.dispose();
});

test('减少动态效果采用120ms转场，结束与销毁会清理计时器',t=>{
  media(true);t.mock.timers.enable({apis:['setTimeout']});
  const hub=new HubController(()=>false);
  hub.navigate('tarot');assert.equal(hub.getSnapshot().journey?.duration,120);
  t.mock.timers.tick(0);assert.equal(hub.getSnapshot().view,'tarot');
  t.mock.timers.tick(120);assert.equal(hub.getSnapshot().journey,null);
  hub.navigate('portal');const pending=hub.getSnapshot();
  hub.dispose();t.mock.timers.tick(1000);assert.equal(hub.getSnapshot(),pending);
  media(false);
});

test('门户的两种入口和导航按钮按模块生成与请求状态禁用，转场可从按钮跳过',async()=>{
  media(false);
  const container=document.getElementById('root')!,root=createRoot(container);
  let hubState:HubState={view:'portal',journey:null,scheme:'dark',error:''};
  let meihuaState:PageState={catalog,reading:null,loading:false,casting:false,animationStartedAt:null,error:''};
  let tarotState:TarotPageState={catalog:tarotCatalog,reading:null,loading:false,acting:false,shuffling:false,error:'',draft:{question:'',spreadId:'single',includeReversed:true,route:{provider:'',model:''}}};
  const navigation:string[]=[],base=actions();let skipped=0;
  const render=async()=>act(async()=>root.render(<Hub {...base} useHub={selector=>selector(hubState)} useMeihua={selector=>selector(meihuaState)} useTarot={selector=>selector(tarotState)} onNavigate={to=>{navigation.push(to);}} onSkipJourney={()=>{skipped++;}}/>));
  await render();
  const entrances=container.querySelectorAll<HTMLButtonElement>('.wx-portal button');
  assert.equal(entrances.length,5);
  assert.ok(entrances[0]!.textContent?.includes('梅花易数'));
  assert.ok(entrances[1]!.textContent?.includes('塔罗牌'));
  await act(async()=>entrances[1]!.click());assert.deepEqual(navigation,['tarot']);
  hubState={...hubState,view:'meihua'};
  const streamingTurn={id:'pending-followup',question:'请解释',text:'流式前缀',status:'streaming' as const,route:{provider:'local',model:'offline'},createdAt:new Date().toISOString()};
  for(const lock of ['meihua-streaming','tarot-streaming','meihua-followup','tarot-followup','casting','interpreting','acting'] as const) {
    meihuaState={...meihuaState,reading:lock==='meihua-streaming'?{...reading,status:'streaming'}:lock==='meihua-followup'?{...reading,status:'complete',text:'首份解读',conversation:[streamingTurn]}:reading,casting:lock==='casting',interpreting:lock==='interpreting'};
    tarotState={...tarotState,reading:lock==='tarot-streaming'?{...tarotReading,status:'streaming'}:lock==='tarot-followup'?{...tarotReading,status:'complete',text:'首份解读',conversation:[streamingTurn]}:null,acting:lock==='acting'};
    await render();
    const buttons=container.querySelectorAll<HTMLButtonElement>('.wx-topbar button');
    assert.equal(buttons.length,6);
    assert.ok(Array.from(buttons).every(button=>button.disabled),lock);
    await act(async()=>buttons[0]!.click());assert.deepEqual(navigation,['tarot'],lock);
  }
  meihuaState={...meihuaState,reading:{...reading,status:'cancelled',text:'取消前文字'},casting:false,interpreting:false};
  tarotState={...tarotState,acting:false};await render();
  assert.equal(container.querySelector<HTMLButtonElement>('.wx-home')!.disabled,false);
  await act(async()=>container.querySelector<HTMLButtonElement>('.wx-home')!.click());
  assert.deepEqual(navigation,['tarot','portal']);
  hubState={...hubState,journey:{from:'meihua',to:'portal',startedAt:Date.now(),duration:800,origin:{x:.5,y:.5}}};await render();
  assert.ok(Array.from(container.querySelectorAll<HTMLButtonElement>('.wx-topbar button')).every(button=>button.disabled));
  const skip=container.querySelector<HTMLButtonElement>('.wx-journey button')!;
  assert.match(skip.textContent??'',/跳过/);await act(async()=>skip.click());assert.equal(skipped,1);
  await act(async()=>root.unmount());
});

test('转场隔离全部底层view并锁住跳过按钮焦点，中点切页仍锁定，结束恢复新页标题',async()=>{
  media(false);
  const container=document.getElementById('root')!,root=createRoot(container),base=actions();
  let hubState:HubState={view:'portal',journey:null,scheme:'dark',error:''},skips=0;
  const meihuaState:PageState={catalog,reading:null,loading:false,casting:false,animationStartedAt:null,error:''};
  const tarotState:TarotPageState={catalog:tarotCatalog,reading:null,loading:false,acting:false,shuffling:false,error:'',draft:{question:'',spreadId:'single',includeReversed:true,route:{provider:'',model:''}}};
  const render=async()=>act(async()=>root.render(<Hub {...base} useHub={selector=>selector(hubState)} useMeihua={selector=>selector(meihuaState)} useTarot={selector=>selector(tarotState)} onNavigate={()=>{}} onSkipJourney={()=>{skips++;hubState={...hubState,view:'tarot',journey:null};}}/>));
  await render();assert.equal(document.activeElement,container.querySelector('.wx-portal h1'));
  hubState={...hubState,journey:{from:'portal',to:'tarot',startedAt:Date.now(),duration:1600,origin:{x:.5,y:.5}}};await render();
  const views=Array.from(container.querySelectorAll('.wx-view'));assert.equal(views.length,3);assert.ok(views.every(view=>view.hasAttribute('inert')));
  const skip=container.querySelector<HTMLButtonElement>('.wx-journey button')!;assert.equal(document.activeElement,skip);
  for(const shiftKey of [false,true]){
    const tab=new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey,bubbles:true,cancelable:true});
    await act(async()=>skip.dispatchEvent(tab));assert.equal(tab.defaultPrevented,true);assert.equal(document.activeElement,skip);
  }
  hubState={...hubState,view:'tarot'};await render();assert.ok(views.every(view=>view.hasAttribute('inert')));assert.equal(document.activeElement,skip);
  await act(async()=>skip.click());await render();assert.equal(skips,1);assert.ok(views.every(view=>!view.hasAttribute('inert')));assert.equal(container.querySelector('.wx-journey'),null);assert.equal(document.activeElement,container.querySelector('.tr-header h1'));
  await act(async()=>root.unmount());
});

test('梅花实际表单草稿往返门户与塔罗仍保留，模块切换不调用RPC',async()=>{
  media(false);
  const endpoints:string[]=[];
  const rpc:ClientRpc={call:async(_channel,endpoint)=>{
    endpoints.push(endpoint);
    return {ok:true,value:endpoint==='meihua/catalog'?catalog:endpoint==='tarot/catalog'?tarotCatalog:null};
  }};
  const meihua=new MeihuaController(rpc),tarot=new TarotController(rpc),hub=new HubController(()=>false);
  await Promise.all([meihua.load(),tarot.load()]);
  const callsAfterLoad=endpoints.length;
  const useHub=<T,>(selector:(state:HubState)=>T)=>selector(useSyncExternalStore(hub.subscribe,hub.getSnapshot));
  const useMeihua=<T,>(selector:(state:PageState)=>T)=>selector(useSyncExternalStore(meihua.subscribe,meihua.getSnapshot));
  const useTarot=<T,>(selector:(state:TarotPageState)=>T)=>selector(useSyncExternalStore(tarot.subscribe,tarot.getSnapshot));
  const container=document.getElementById('root')!,root=createRoot(container);
  await act(async()=>root.render(<Hub {...actions()} useHub={useHub} useMeihua={useMeihua} useTarot={useTarot} onNavigate={hub.navigate} onSkipJourney={hub.skip} onMeihuaDraft={meihua.updateDraft} onTarotDraft={tarot.updateDraft} onTarotActive={tarot.setActive}/>));
  await act(async()=>{hub.navigate('meihua');hub.skip();});
  const question=container.querySelector<HTMLTextAreaElement>('#mh-question')!;
  const nativeTextarea=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!;
  await act(async()=>{nativeTextarea.call(question,'想问接下来的创作方向');question.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  const tab=Array.from(container.querySelectorAll<HTMLButtonElement>('.mh-tabs button')).find(button=>button.textContent==='三数起卦')!;
  await act(async()=>tab.click());
  const nativeInput=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
  const numbers=Array.from(container.querySelectorAll<HTMLInputElement>('.mh-number-row input'));
  for(let i=0;i<3;i++)await act(async()=>{nativeInput.call(numbers[i],['2','3','2'][i]);numbers[i]!.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.equal(meihua.getSnapshot().draft?.question,'想问接下来的创作方向');
  assert.equal(meihua.getSnapshot().draft?.ruleId,'three-numbers');
  assert.deepEqual(meihua.getSnapshot().draft?.numbers,{a:'2',b:'3',c:'2'});
  const originalQuestion=question;
  for(const view of ['portal','tarot','portal','meihua'] as const)await act(async()=>{hub.navigate(view);hub.skip();});
  assert.equal(container.querySelector('#mh-question'),originalQuestion);
  assert.equal(container.querySelector<HTMLTextAreaElement>('#mh-question')!.value,'想问接下来的创作方向');
  assert.deepEqual(Array.from(container.querySelectorAll<HTMLInputElement>('.mh-number-row input')).map(input=>input.value),['2','3','2']);
  assert.equal(container.querySelector('.wx-view-portal')!.hasAttribute('hidden'),true);
  assert.equal(container.querySelector('.wx-view-module')!.hasAttribute('hidden'),false);
  assert.equal(endpoints.length,callsAfterLoad);
  await act(async()=>root.unmount());meihua.dispose();tarot.dispose();hub.dispose();
});

test('梅花解读请求尚未回应时锁住重起卦、重复解读和导航，取消终态后解锁',async t=>{
  media(false);t.mock.timers.enable({apis:['setTimeout']});
  const endpoints:string[]=[];
  let current:Reading={...reading};
  let respond!:(value:RpcResult)=>void;
  const delayed=new Promise<RpcResult>(resolve=>{respond=resolve;});
  const rpc:ClientRpc={call:async(_channel,endpoint)=>{
    endpoints.push(endpoint);
    if(endpoint==='meihua/catalog')return {ok:true,value:catalog};
    if(endpoint==='meihua/current')return {ok:true,value:current};
    if(endpoint==='meihua/interpret')return delayed;
    throw new Error(`Unexpected RPC while interpret is pending: ${endpoint}`);
  }};
  const controller=new MeihuaController(rpc);
  await controller.load();
  const hub=new HubController(()=>!!controller.getSnapshot().interpreting || controller.getSnapshot().reading?.status==='streaming');
  hub.restoreReading('meihua');
  const pending=controller.interpret({provider:'local',model:'offline'});
  assert.equal(controller.getSnapshot().interpreting,true);
  assert.equal(controller.getSnapshot().reading?.status,'ready');
  await controller.cast(input);await controller.interpret({provider:'other',model:'duplicate'});
  assert.equal(endpoints.filter(endpoint=>endpoint==='meihua/interpret').length,1);
  assert.equal(endpoints.includes('meihua/cast'),false);
  hub.navigate('tarot');assert.equal(hub.getSnapshot().view,'meihua');assert.equal(hub.getSnapshot().journey,null);
  current={...reading,status:'streaming',text:'保留的一段'};
  respond({ok:true,value:current});
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(controller.getSnapshot().interpreting,true);
  assert.equal(controller.getSnapshot().reading?.status,'streaming');
  current={...current,status:'cancelled',error:{code:'CANCELLED',message:'已取消'}};
  t.mock.timers.tick(config.pollIntervalMs);
  await pending;
  assert.equal(controller.getSnapshot().interpreting,false);
  assert.equal(controller.getSnapshot().reading?.status,'cancelled');
  assert.equal(controller.getSnapshot().reading?.text,'保留的一段');
  hub.navigate('portal');assert.equal(hub.getSnapshot().journey?.to,'portal');hub.skip();
  controller.dispose();hub.dispose();
});

test('发行版重新注册客户端时自动显示正在生成的模块，取消按钮不会藏在门户',async()=>{
  media(false);
  const bundle=await readFile('lib/client.js','utf8'),require=createRequire(import.meta.url);
  for(const moduleId of ['meihua','tarot'] as const) for(const mode of ['interpretation','followup'] as const) {
    let exported:unknown;
    runInNewContext(bundle,{AbortController,document,setTimeout,clearTimeout,window:{__ModuleLoader__:{load:({factory}:{factory:(require:NodeJS.Require)=>unknown})=>{exported=factory(require);}}}});
    const client=exported as {apply(ctx:object):void};
    const disposers:(()=>void)[]=[],registered:{name:string;inject?:()=>unknown}[]=[];
    let current:Reading|TarotReading=moduleId==='meihua'?{...reading,status:'streaming',text:'恢复中的梅花输出'}:{...tarotReading,status:'streaming',text:'恢复中的塔罗输出',selectionCount:1,selectedSlots:[0],cards:[{positionIndex:0,positionLabel:'当下需要关注的主题',revealed:true,card:TAROT_CARDS[0]!,orientation:'upright'}]};
    if(mode==='followup')current={...current,status:'complete',route:{provider:'local',model:'offline'},conversation:[{id:'restored-turn',question:'解释依据',text:'恢复中的追问前缀',status:'streaming',route:{provider:'local',model:'offline'},createdAt:new Date().toISOString()}]};
    const rpc:ClientRpc={call:async(_channel,endpoint)=>{
      if(endpoint==='memory/status')return {ok:true,value:{initialized:true,unlocked:true,revision:0,epoch:1,updating:false,pending:false}};
      if(endpoint==='memory/document')return {ok:true,value:{content:'',revision:0,epoch:1,updatedAt:'',source:'initial',fixedParagraphs:[]}};
      if(endpoint==='memory/versions')return {ok:true,value:{versions:[],revision:0,epoch:1}};
      if(endpoint==='meihua/catalog')return {ok:true,value:catalog};
      if(endpoint==='tarot/catalog')return {ok:true,value:tarotCatalog};
      if(endpoint===`${moduleId}/current`)return {ok:true,value:current};
      if(endpoint.endsWith('/current'))return {ok:true,value:null};
      if(endpoint===`${moduleId}/cancel`){current=mode==='followup'?{...current,conversation:current.conversation!.map(turn=>({...turn,status:'cancelled'}))}:{...current,status:'cancelled'};return {ok:true,value:current};}
      throw new Error(`Unexpected restored-reading RPC: ${endpoint}`);
    }};
    client.apply({connection:{rpc},locale:{register:()=>()=>{},bind:()=>((key:keyof typeof zh)=>zh[key])},on:()=>()=>{},theme:{getTheme:()=>({active:{colorScheme:'dark'}})},
      effect:(setup:()=>void|(()=>void))=>{const dispose=setup();if(dispose)disposers.push(dispose);},
      slots:{inject:(_name:string,setup:()=>unknown)=>setup(),register:(options:{name:string;inject?:()=>unknown})=>{registered.push(options);}},
    });
    let root:ReturnType<typeof createRoot>|undefined;
    try {
    const main=registered.find(options=>options.name==='main')!;
    const injected=main.inject!() as Omit<HubProps,'t'|'useHub'|'useMeihua'|'useTarot'> & {hooks:{hub:HubController;meihua:MeihuaController;tarot:TarotController;memory:MemoryController}};
    const { hooks,...callbacks }=injected;
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(hooks.hub.getSnapshot().view,moduleId);
    assert.equal(hooks.hub.getSnapshot().journey,null);
    const container=document.getElementById('root')!;root=createRoot(container);
    const mountedRoot=root;
    const useHub=<T,>(selector:(state:HubState)=>T)=>selector(useSyncExternalStore(hooks.hub.subscribe,hooks.hub.getSnapshot));
    const useMeihua=<T,>(selector:(state:PageState)=>T)=>selector(useSyncExternalStore(hooks.meihua.subscribe,hooks.meihua.getSnapshot));
    const useTarot=<T,>(selector:(state:TarotPageState)=>T)=>selector(useSyncExternalStore(hooks.tarot.subscribe,hooks.tarot.getSnapshot));
    const useMemory=<T,>(selector:(state:MemoryPageState)=>T)=>selector(useSyncExternalStore(hooks.memory.subscribe,hooks.memory.getSnapshot));
    await act(async()=>mountedRoot.render(<Hub {...callbacks} t={key=>zh[key]} useHub={useHub} useMeihua={useMeihua} useTarot={useTarot} useMemory={useMemory}/>));
    const visible=container.querySelector('.wx-view:not([hidden])')!;
    assert.equal(container.querySelector('.wx-view-portal')!.hasAttribute('hidden'),true);
    const cancel=Array.from(visible.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.includes('取消'));
    assert.ok(cancel,`${moduleId} cancellation is visible`);
    assert.ok(Array.from(container.querySelectorAll<HTMLButtonElement>('.wx-topbar button:not(.wm-entry)')).every(button=>button.disabled));
    assert.equal(container.querySelector<HTMLButtonElement>('.wm-entry')!.disabled,false,'shared background remains available to lock while a reading is running');
    await act(async()=>cancel.click());
    assert.equal((moduleId==='meihua'?hooks.meihua:hooks.tarot).getSnapshot().reading?.status,mode==='followup'?'complete':'cancelled');
    if(mode==='followup'){
      const restored=(moduleId==='meihua'?hooks.meihua:hooks.tarot).getSnapshot().reading!;
      assert.equal(restored.conversation![0]!.status,'cancelled');
      assert.equal(restored.conversation![0]!.text,'恢复中的追问前缀');
    }
    assert.equal((moduleId==='meihua'?hooks.meihua:hooks.tarot).getSnapshot().reading?.text,moduleId==='meihua'?'恢复中的梅花输出':'恢复中的塔罗输出');
    assert.equal(container.querySelector<HTMLButtonElement>('.wx-home')!.disabled,false);
    } finally {
      const mountedRoot=root;if(mountedRoot)await act(async()=>mountedRoot.unmount());
      for(const dispose of disposers.reverse())dispose();
    }
  }
});

test('减少动态效果下星空只绘制一帧，窗口与观察器resize可重绘，隐藏或卸载停止RAF',async t=>{
  media(true);
  let hidden=false,width=640,height=400,nextRaf=1,painted=0,disconnected=0;
  const frames=new Map<number,FrameRequestCallback>();
  let observedResize:()=>void=()=>{};
  const globals=new Map<string,PropertyDescriptor|undefined>();
  const install=(key:string,value:unknown)=>{globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});};
  const hiddenDescriptor=Object.getOwnPropertyDescriptor(document,'hidden');
  Object.defineProperty(document,'hidden',{get:()=>hidden,configurable:true});
  install('CanvasRenderingContext2D',function CanvasRenderingContext2D(){});
  install('requestAnimationFrame',(callback:FrameRequestCallback)=>{const id=nextRaf++;frames.set(id,callback);return id;});
  install('cancelAnimationFrame',(id:number)=>{frames.delete(id);});
  install('ResizeObserver',class {constructor(callback:()=>void){observedResize=callback;}observe(){}disconnect(){disconnected++;}});
  const canvasContext={setTransform(){},clearRect(){painted++;},beginPath(){},arc(){},fill(){},moveTo(){},lineTo(){},stroke(){},fillStyle:'',strokeStyle:''};
  t.mock.method(dom.window.HTMLCanvasElement.prototype,'getContext',()=>canvasContext);
  t.mock.method(dom.window.HTMLCanvasElement.prototype,'getBoundingClientRect',()=>({width,height,left:0,top:0,right:width,bottom:height,x:0,y:0,toJSON(){}}));
  const flushFrame=()=>{const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(100);};
  const container=document.getElementById('root')!,root=createRoot(container);
  try {
    await act(async()=>root.render(<Starfield active/>));
    assert.equal(frames.size,1);flushFrame();assert.equal(painted,1);assert.equal(frames.size,0);
    width=800;await act(async()=>window.dispatchEvent(new dom.window.Event('resize')));
    assert.equal(frames.size,1);flushFrame();assert.equal(painted,2);assert.equal(frames.size,0);
    height=500;observedResize();assert.equal(frames.size,1);flushFrame();assert.equal(painted,3);assert.equal(frames.size,0);
    const canvas=container.querySelector('canvas')!;assert.equal(canvas.width,800);assert.equal(canvas.height,500);
    hidden=true;document.dispatchEvent(new dom.window.Event('visibilitychange'));assert.equal(frames.size,0);
    hidden=false;document.dispatchEvent(new dom.window.Event('visibilitychange'));assert.equal(frames.size,1);flushFrame();assert.equal(painted,4);assert.equal(frames.size,0);
    await act(async()=>root.render(<Starfield active={false}/>));assert.equal(disconnected,1);assert.equal(frames.size,0);
    window.dispatchEvent(new dom.window.Event('resize'));assert.equal(frames.size,0);
  } finally {
    await act(async()=>root.unmount());
    for(const [key,descriptor] of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
    if(hiddenDescriptor)Object.defineProperty(document,'hidden',hiddenDescriptor);else Reflect.deleteProperty(document,'hidden');
    media(false);
  }
});
