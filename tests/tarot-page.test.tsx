import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TarotPage,formatTarotCopy,type TarotPageProps } from '../src/client/TarotPage.tsx';
import { TarotController,type TarotPageState } from '../src/client/tarot-controller.ts';
import { TAROT_CARDS,TAROT_DECK,TAROT_SPREADS,tarotSpread } from '../src/tarot/index.ts';
import type { ClientRpc,ModelRoute,TarotCatalog,TarotReading } from '../src/shared/protocol.ts';
import type { TarotStartInput } from '../src/tarot/types.ts';

const jsdomPackage:string='jsdom';
const {JSDOM}=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const dom=new JSDOM('<!doctype html><html><body><div id="tarot-root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
const catalog:TarotCatalog={spreads:TAROT_SPREADS,deck:TAROT_DECK,providers:[{id:'p1',name:'供应商甲',models:[{id:'m1',name:'模型甲'}]},{id:'p2',name:'供应商乙',models:[{id:'m2',name:'模型乙'}]}],config:{timeZone:'Asia/Shanghai',animationMs:4800,interpretationTimeoutMs:1500,maxOutputTokens:3000,pollIntervalMs:10}};
const input:TarotStartInput={question:'冻结的最初塔罗问题',spreadId:'timeline',includeReversed:true};
function reading(spreadId:TarotStartInput['spreadId']='timeline',revealedCount=0):TarotReading {
  const spread=tarotSpread(spreadId);
  return {id:'tarot-1',moduleId:'tarot',algorithmVersion:'tarot-v1',spread,question:input.question,includeReversed:true,createdAt:'2026-10-03T04:00:00Z',selectionCount:spread.cardCount,selectedSlots:Array.from({length:spread.cardCount},(_,i)=>i*3),cards:spread.positions.map((label,i)=>({positionIndex:i,positionLabel:label,revealed:i<revealedCount,...(i<revealedCount?{card:TAROT_CARDS[i]!,orientation:i%2?'reversed' as const:'upright' as const}:{})})),status:revealedCount===spread.cardCount?'ready':'revealing',text:''};
}
function state(current:TarotReading|null=null):TarotPageState {return {catalog,reading:current,loading:false,acting:false,shuffling:false,error:'',draft:{...input,route:{provider:'p1',model:'m1'}}};}
function noops():Omit<TarotPageProps,'useTarot'> {return {onStart:async()=>{},onSelect:async()=>{},onReveal:async()=>{},onInterpret:async()=>{},onCancel:async()=>{},onRefresh:async()=>{},onSkip:()=>{},onDraftChange:()=>{},onActivityChange:()=>{},active:true,scheme:'dark'};}
const container=()=>document.getElementById('tarot-root')!;
const button=(text:string)=>Array.from(container().querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.includes(text))!;

test('四牌阵来自目录；启动输入保持原稿，洗牌可跳过；78张背牌不提前显示牌面',async()=>{
  const root=createRoot(container());let current=state(),submitted:TarotStartInput|undefined,slot:number|undefined,skips=0;
  const render=async()=>act(async()=>root.render(<TarotPage {...noops()} useTarot={selector=>selector(current)} onDraftChange={patch=>{current={...current,draft:{...current.draft,...patch}};}} onStart={async value=>{submitted=value;}} onSelect={async value=>{slot=value;}} onSkip={()=>{skips++;}}/>));
  await render();assert.equal(container().querySelectorAll('.tr-spread-option').length,4);assert.equal(container().querySelectorAll('img').length,0);
  await act(async()=>button('凯尔特十字').click());await render();assert.equal(current.draft.spreadId,'celtic-cross');
  await act(async()=>container().querySelector<HTMLButtonElement>('.tr-start')!.click());assert.deepEqual(submitted,{question:input.question,spreadId:'celtic-cross',includeReversed:true});
  current={...current,reading:{...reading('celtic-cross'),selectionCount:0,selectedSlots:[],cards:[],status:'selecting'},shuffling:true};await render();
  assert.ok(container().textContent!.includes('让牌面暂时归于未知'));await act(async()=>button('跳过洗牌动画').click());assert.equal(skips,1);
  current={...current,shuffling:false};await render();assert.equal(container().querySelectorAll('.tr-river-card').length,78);assert.equal(container().querySelectorAll('img').length,0);
  assert.equal(container().querySelector<HTMLTextAreaElement>('#tr-question')!.disabled,true);assert.equal(container().querySelector<HTMLFieldSetElement>('fieldset')!.disabled,true);
  const scrolls:ScrollToOptions[]=[],river=container().querySelector<HTMLElement>('.tr-card-river')!;
  Object.defineProperty(river,'scrollBy',{value:(options:ScrollToOptions)=>scrolls.push(options),configurable:true});
  const previousMedia=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');
  try {
    Object.defineProperty(globalThis,'matchMedia',{value:()=>({matches:true}),configurable:true});await act(async()=>container().querySelector<HTMLButtonElement>('[aria-label="向后查看背牌"]')!.click());
    Object.defineProperty(globalThis,'matchMedia',{value:()=>({matches:false}),configurable:true});await act(async()=>container().querySelector<HTMLButtonElement>('[aria-label="向前查看背牌"]')!.click());
    assert.deepEqual(scrolls,[{left:400,behavior:'auto'},{left:-400,behavior:'smooth'}]);
  } finally {if(previousMedia)Object.defineProperty(globalThis,'matchMedia',previousMedia);else Reflect.deleteProperty(globalThis,'matchMedia');}
  await act(async()=>container().querySelector<HTMLButtonElement>('.tr-river-card:nth-child(62)')!.click());assert.equal(slot,61);
  current={...current,reading:{...current.reading!,selectionCount:1,selectedSlots:[61],cards:[{positionIndex:0,positionLabel:'现状',revealed:false}]}};await render();
  assert.equal(container().querySelector<HTMLButtonElement>('.tr-river-card:nth-child(62)')!.disabled,true);assert.ok(container().textContent!.includes('已选 1 / 10'));assert.equal(container().querySelectorAll('img').length,0);
  assert.equal(container().querySelectorAll('.tr-selected-thumb .tr-card-back').length,1);assert.ok(container().querySelector('.tr-selected-list')!.textContent!.includes('01 · 现状'));assert.equal(container().querySelector('.tr-selected-thumb .tr-back-ordinal')!.textContent,'01');
  await act(async()=>root.unmount());
});

test('十字十个位置按顺序揭示，下一张以外禁用；全部揭示与放大详情不重抽',async()=>{
  const root=createRoot(container());let current=state(reading('celtic-cross')),requested:{position?:number;all?:boolean}|undefined;
  const render=async(active=true)=>act(async()=>root.render(<TarotPage {...noops()} active={active} useTarot={selector=>selector(current)} onReveal={async(position,all)=>{requested={position,all};}}/>));
  await render();assert.equal(container().querySelectorAll('.tr-position').length,10);assert.equal(container().querySelectorAll('.tr-position img').length,0);
  assert.equal(container().querySelectorAll('.tr-cross-mini-map .tr-mini-position').length,10);assert.ok(container().querySelector('.tr-cross-mini-map')!.getAttribute('aria-label')!.includes('10 发展趋势'));assert.equal(container().querySelector('.tr-position-next')!.getAttribute('data-position'),'1');
  const positions=Array.from(container().querySelectorAll<HTMLButtonElement>('.tr-position-card'));
  assert.equal(positions[0]!.disabled,false);assert.ok(positions.slice(1).every(p=>p.disabled));
  await act(async()=>positions[0]!.click());assert.deepEqual(requested,{position:0,all:undefined});
  current=state(reading('celtic-cross',1));await render();assert.equal(container().querySelectorAll('.tr-position img').length,1);assert.equal(container().querySelectorAll('.tr-meaning-list article').length,1);assert.equal(container().querySelector('.tr-interpret-button'),null);
  assert.equal(container().querySelector<HTMLButtonElement>('.tr-position[data-position="2"] .tr-position-card')!.disabled,false);
  assert.equal(container().querySelector('.tr-position-next')!.getAttribute('data-position'),'2');
  await act(async()=>button('全部揭示').click());assert.deepEqual(requested,{position:undefined,all:true});
  current=state(reading('celtic-cross',10));await render();assert.equal(container().querySelectorAll('.tr-position img').length,10);assert.equal(container().querySelectorAll('.tr-meaning-list article').length,10);assert.ok(container().querySelector('.tr-interpret-button'));
  assert.equal(container().querySelectorAll('.tr-position-description').length,10);assert.ok(container().querySelector('.tr-position-description')!.textContent!.includes(tarotSpread('celtic-cross').positionDescriptions[0]!));
  assert.equal(container().querySelector('.tr-position[data-position="2"] .tr-cross-direction')!.textContent,'逆位');
  current={...current,reading:{...current.reading!,cards:current.reading!.cards.map(d=>d.positionIndex===1?{...d,orientation:'upright' as const}:d)}};await render();assert.equal(container().querySelector('.tr-position[data-position="2"] .tr-cross-direction')!.textContent,'正位');
  const first=container().querySelector<HTMLButtonElement>('.tr-position-card')!;first.focus();await act(async()=>first.click());
  const dialog=container().querySelector<HTMLElement>('[role="dialog"]')!;assert.ok(dialog);assert.ok(dialog.textContent!.includes(TAROT_CARDS[0]!.nameEn));assert.ok(dialog.textContent!.includes('牌位说明'));assert.ok(dialog.textContent!.includes(tarotSpread('celtic-cross').positionDescriptions[0]!));assert.ok(dialog.textContent!.includes('正位牌义'));assert.ok(dialog.textContent!.includes('逆位牌义'));assert.equal(document.activeElement?.getAttribute('aria-label'),'关闭牌面详情');
  await act(async()=>dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(container().querySelector('[role="dialog"]'),null);assert.equal(document.activeElement,first);
  await act(async()=>first.click());await render(false);assert.equal(container().querySelector('[role="dialog"]'),null);assert.equal(container().querySelector('.tr-page')!.getAttribute('data-active'),'false');
  await act(async()=>root.unmount());
});

test('模型显式选择、一次流式解读、取消前缀保留；复制包含十张位置/牌义/模型/全文',async()=>{
  const root=createRoot(container());let current=state(reading('celtic-cross',10)),selected:ModelRoute|undefined,copied='',cancels=0;
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{copied=value;}},configurable:true});
  const render=async()=>act(async()=>root.render(<TarotPage {...noops()} useTarot={selector=>selector(current)} onDraftChange={patch=>{current={...current,draft:{...current.draft,...patch}};}} onInterpret={async route=>{selected=route;}} onCancel={async()=>{cancels++;}}/>));
  await render();const provider=container().querySelector<HTMLSelectElement>('.tr-model-row select')!;
  await act(async()=>{provider.value='p2';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await render();await act(async()=>button('开始解读').click());assert.deepEqual(selected,{provider:'p2',model:'m2'});
  current={...current,reading:{...current.reading!,status:'streaming',route:selected,text:'## 已收到\n\n第一份流式文字'}};await render();assert.equal(container().querySelector('.tr-interpret-button'),null);assert.equal(container().querySelector<HTMLTextAreaElement>('#tr-question')!.disabled,true);
  await act(async()=>button('取消解读').click());assert.equal(cancels,1);
  current={...current,reading:{...current.reading!,status:'cancelled',error:{code:'CANCELLED',message:'已取消，保留收到的内容'}}};await render();assert.ok(container().textContent!.includes('第一份流式文字'));assert.equal(container().querySelector('.tr-interpret-button'),null);assert.ok(container().textContent!.includes('本次牌阵已保留第一次解读'));assert.equal(container().querySelector<HTMLButtonElement>('.tr-start')!.disabled,false);
  current={...current,reading:{...current.reading!,status:'complete',error:undefined,text:'## 完整解读\n\n第一次完整塔罗输出'}};await render();await act(async()=>button('复制结果').click());
  assert.ok(copied.includes(input.question));assert.ok(copied.includes('凯尔特十字'));assert.ok(copied.includes('10. 发展趋势'));assert.ok(copied.includes('魔术师（逆位）'));assert.ok(copied.includes('p2 / m2'));assert.ok(copied.includes('第一次完整塔罗输出'));assert.ok(copied.includes(TAROT_CARDS[1]!.reversed));
  await act(async()=>root.unmount());
});

test('复制未揭牌快照不伪造牌面，模型文字按纯文本安全渲染',async()=>{
  const hidden=reading('timeline');const copy=formatTarotCopy(hidden);assert.ok(copy.includes('1. 过去：未揭示'));assert.ok(!copy.includes('愚者'));
  const root=createRoot(container()),current=state({...reading('timeline',3),status:'complete',text:'<img src="bad" onerror="attack()">\n\n**安全文字**'});
  await act(async()=>root.render(<TarotPage {...noops()} useTarot={selector=>selector(current)}/>));
  assert.equal(container().querySelector('.tr-reading-text img'),null);assert.ok(container().textContent!.includes('<img src="bad"'));assert.ok(container().textContent!.includes('安全文字'));
  await act(async()=>root.unmount());
});

function rpcFixture(finish=true){
  let current:TarotReading|null=null,calls=0;const endpoints:{endpoint:string;payload:unknown}[]=[];
  const rpc:ClientRpc={call:async(channel,method,payload)=>{
    assert.equal(channel,'/api');const endpoint=method.replace('tarot/','');endpoints.push({endpoint,payload});
    if(endpoint==='catalog')return {ok:true,value:catalog};if(endpoint==='current')return {ok:true,value:current};
    const body=payload as Record<string,unknown>;
    if(endpoint==='start'){const input=body as unknown as TarotStartInput;const spread=tarotSpread(input.spreadId);current={...reading(input.spreadId),question:input.question,includeReversed:input.includeReversed,selectionCount:0,selectedSlots:[],cards:[],status:'selecting'};return {ok:true,value:current};}
    if(endpoint==='select'){const i=current!.selectionCount,slot=body.slot as number;current={...current!,selectionCount:i+1,selectedSlots:[...current!.selectedSlots,slot],cards:[...current!.cards,{positionIndex:i,positionLabel:current!.spread.positions[i]!,revealed:false}],status:i+1===current!.spread.cardCount?'revealing':'selecting'};return {ok:true,value:current};}
    if(endpoint==='reveal'){const cards=current!.cards.map(d=>d.revealed || body.all || d.positionIndex===body.position?{...d,revealed:true,card:TAROT_CARDS[d.positionIndex]!,orientation:'upright' as const}:d);current={...current!,cards,status:cards.every(d=>d.revealed)?'ready':'revealing'};return {ok:true,value:current};}
    if(endpoint==='interpret'){calls++;current={...current!,status:'streaming',text:'收到的塔罗前缀',route:{provider:body.provider as string,model:body.model as string}};if(finish)setTimeout(()=>{current={...current!,status:'complete',text:'完成后的首次塔罗解读'};},20);return {ok:true,value:current};}
    if(endpoint==='cancel'){current={...current!,status:'cancelled',error:{code:'CANCELLED',message:'取消'}};return {ok:true,value:current};}
    throw new Error(`Unexpected endpoint ${endpoint}`);
  }};
  return {rpc,endpoints,getCurrent:()=>current,getCalls:()=>calls};
}

test('控制器暂停隐藏页洗牌时钟；重新显示继续剩余时长；跳过和减少动态效果不重新洗牌',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000_000});
  const fixture=rpcFixture(),controller=new TarotController(fixture.rpc);await controller.load();controller.setActive(true);await controller.start(input);assert.equal(controller.getSnapshot().shuffling,true);
  t.mock.timers.tick(1200);controller.setActive(false);t.mock.timers.tick(9000);assert.equal(controller.getSnapshot().shuffling,true);
  controller.setActive(true);t.mock.timers.tick(1199);assert.equal(controller.getSnapshot().shuffling,true);t.mock.timers.tick(1);assert.equal(controller.getSnapshot().shuffling,false);
  await controller.start(input);controller.skipShuffle();assert.equal(controller.getSnapshot().shuffling,false);assert.equal(fixture.endpoints.filter(e=>e.endpoint==='start').length,2);
  Object.defineProperty(globalThis,'matchMedia',{value:()=>({matches:true}),configurable:true});await controller.start(input);assert.equal(controller.getSnapshot().shuffling,false);Reflect.deleteProperty(globalThis,'matchMedia');controller.dispose();
});

test('控制器通过RPC选择与顺序揭示，进度及草稿属于插件；恢复后仅一次模型调用',async()=>{
  const fixture=rpcFixture(),controller=new TarotController(fixture.rpc);await controller.load();controller.updateDraft({question:'跨页面草稿',spreadId:'celtic-cross',includeReversed:false,route:{provider:'p2',model:'m2'}});
  await controller.start(input);controller.skipShuffle();for(const slot of [61,5,24])await controller.select(slot);
  assert.deepEqual(controller.getSnapshot().reading!.selectedSlots,[61,5,24]);assert.ok(controller.getSnapshot().reading!.cards.every(d=>d.card===undefined));
  await controller.reveal(0);assert.equal(controller.getSnapshot().reading!.cards[0]!.revealed,true);assert.equal(controller.getSnapshot().reading!.cards[1]!.card,undefined);
  await controller.load();assert.equal(controller.getSnapshot().reading!.cards[0]!.revealed,true);assert.equal(controller.getSnapshot().draft.question,'跨页面草稿');assert.equal(controller.getSnapshot().draft.spreadId,'celtic-cross');
  await controller.reveal(undefined,true);await controller.interpret({provider:'p2',model:'m2'});assert.equal(controller.getSnapshot().reading!.text,'完成后的首次塔罗解读');await controller.interpret({provider:'p1',model:'m1'});assert.equal(fixture.getCalls(),1);
  assert.deepEqual(fixture.endpoints.filter(e=>e.endpoint==='reveal').map(e=>e.payload),[{id:'tarot-1',position:0,all:false},{id:'tarot-1',all:true}]);
  controller.dispose();const reopened=new TarotController(fixture.rpc);await reopened.load();assert.equal(reopened.getSnapshot().reading!.text,'完成后的首次塔罗解读');assert.equal(reopened.getSnapshot().draft.question,input.question);assert.equal(reopened.getSnapshot().draft.spreadId,'timeline');reopened.dispose();
});

test('控制器取消流式后保留牌阵与前缀，结束后不允许重新解释',async()=>{
  const fixture=rpcFixture(false),controller=new TarotController(fixture.rpc);await controller.load();await controller.start({...input,spreadId:'single'});controller.skipShuffle();await controller.select(17);await controller.reveal(0);
  const interpreting=controller.interpret({provider:'p1',model:'m1'});await new Promise(resolve=>setTimeout(resolve,1));await controller.cancel();await interpreting;
  const final=controller.getSnapshot().reading!;assert.equal(final.status,'cancelled');assert.equal(final.text,'收到的塔罗前缀');assert.equal(final.cards.length,1);await controller.interpret({provider:'p2',model:'m2'});assert.equal(fixture.getCalls(),1);controller.dispose();
});
