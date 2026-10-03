import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Page } from '../src/client/Page.tsx';
import { MeihuaController,type PageState } from '../src/client/controller.ts';
import { zh,type Translate } from '../src/client/locales.ts';
import { RuleRegistry } from '../src/core/index.ts';
import type { Catalog,Reading,ClientRpc } from '../src/shared/protocol.ts';

const jsdomPackage:string='jsdom';
const {JSDOM}=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const dom=new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
const input={ruleId:'three-numbers',question:'冻结的最初问题',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-02T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};
const catalog:Catalog={rules:new RuleRegistry().list(),providers:[{id:'p1',name:'供应商甲',models:[{id:'m1',name:'模型甲'}]},{id:'p2',name:'供应商乙',models:[{id:'m2',name:'模型乙'}]}],config:{timeZone:'Asia/Shanghai',animationMs:4800,interpretationTimeoutMs:1500,maxOutputTokens:3000,pollIntervalMs:100}};
const reading:Reading={id:'r1',result:new RuleRegistry().calculate(input),status:'ready',text:''};
const t:Translate=(key)=>zh[key];

test('页面使用框架选择器、切换供应商、复制完整结果，结束后没有追问或重解入口',async()=>{
  const container=document.getElementById('root')!,root=createRoot(container);
  let state:PageState={catalog,reading:null,loading:false,casting:false,animationStartedAt:null,error:''};
  let selected:unknown,copied='';
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{copied=value;}},configurable:true});
  const render=async()=>{await act(async()=>root.render(<Page t={t} useMeihua={selector=>{assert.equal(typeof selector,'function');return selector(state);}} onCast={async()=>{}} onInterpret={async route=>{selected=route;}} onCancel={async()=>{}} onRefresh={async()=>{}} onSkip={()=>{}}/>));};
  await render();assert.ok(container.textContent!.includes('静候一念'));assert.equal(container.querySelectorAll('.mh-number-row input').length,0);
  const numberTab=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='三数起卦')!;
  await act(async()=>numberTab.click());assert.equal(container.querySelectorAll('.mh-number-row input').length,3);
  state={...state,reading};await render();assert.ok(container.textContent!.includes('冻结的最初问题'));
  const provider=container.querySelector<HTMLSelectElement>('.mh-model-row select')!;
  await act(async()=>{provider.value='p2';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>container.querySelector<HTMLButtonElement>('.mh-interpret-button')!.click());
  assert.deepEqual(selected,{provider:'p2',model:'m2'});
  state={...state,reading:{...reading,status:'complete',route:{provider:'p2',model:'m2'},text:'## 完整解读\n\n保留的第一份输出'}};await render();
  assert.equal(container.querySelector('.mh-interpret-button'),null);assert.ok(container.textContent!.includes('本卦已保留第一次解读'));assert.equal(container.querySelectorAll('.mh-model-row select').length,0);
  const copy=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='复制结果')!;await act(async()=>copy.click());
  assert.ok(copied.includes('冻结的最初问题'));assert.ok(copied.includes('泽火革'));assert.ok(copied.includes('保留的第一份输出'));assert.ok(copied.includes('p2 / m2'));
  state={...state,reading:{...reading,status:'cancelled',text:'取消前收到的部分',error:{code:'CANCELLED',message:'已取消'}}};await render();assert.ok(container.textContent!.includes('取消前收到的部分'));assert.equal(container.querySelector('.mh-interpret-button'),null);
  await act(async()=>root.unmount());
});
test('控制器通过 DSH Connection 获取流式快照，跳过动画和重新打开页面保留结果',async()=>{
  let current:Reading|null=null,modelCalls=0;
  const rpc:ClientRpc={call:async(channel,method,payload)=>{
    assert.equal(channel,'/api');const endpoint=method.replace('meihua/','');
    if(endpoint==='catalog')return {ok:true,value:catalog};
    if(endpoint==='current')return {ok:true,value:current};
    if(endpoint==='cast'){current={...reading};return {ok:true,value:current};}
    if(endpoint==='interpret'){modelCalls++;current={...current!,status:'streaming',route:payload as Reading['route']};setTimeout(()=>{current={...current!,status:'complete',text:'完成后的第一次解读'};},20);return {ok:true,value:current};}
    throw new Error('unexpected endpoint');
  }};
  const controller=new MeihuaController(rpc);await controller.load();await controller.cast(input);assert.ok(controller.getSnapshot().animationStartedAt);controller.skipAnimation();assert.equal(controller.getSnapshot().animationStartedAt,null);
  await controller.interpret({provider:'p2',model:'m2'});assert.equal(controller.getSnapshot().reading!.text,'完成后的第一次解读');await controller.interpret({provider:'p1',model:'m1'});assert.equal(modelCalls,1);
  controller.dispose();const reopened=new MeihuaController(rpc);await reopened.load();assert.equal(reopened.getSnapshot().reading!.text,'完成后的第一次解读');reopened.dispose();
});
test('发布版浏览器产物使用 DSH ModuleLoader，复用宿主 React，注册独立侧栏与 main 插槽',async()=>{
  let exports:unknown;
  const require=createRequire(import.meta.url);
  runInNewContext(await readFile('lib/client.js','utf8'),{AbortController,document,setTimeout,clearTimeout,window:{__ModuleLoader__:{load:({id,factory}:{id:string;factory:(require:NodeJS.Require)=>unknown})=>{assert.equal(id,'dsh-meihua');exports=factory(require);}}}});
  const client=exports as {inject:string[];apply(ctx:object):void};assert.ok(client.inject.includes('connection'));
  const registered:Record<string,unknown>[]=[],disposers:(()=>void)[]=[];
  client.apply({connection:{rpc:{call:async()=>({ok:true,value:null})}},locale:{register:()=>()=>{},bind:()=>t},on:()=>()=>{},
    effect:(setup:()=>void|(()=>void))=>{const dispose=setup();if(dispose)disposers.push(dispose);},
    slots:{inject:(_name:string,setup:()=>void)=>setup(),register:(options:Record<string,unknown>)=>{registered.push(options);}}
  });
  assert.ok(registered.some(r=>r.name==='main'&&r.key==='meihua'));assert.ok(registered.some(r=>r.name==='sidebar.panellist'&&r.id==='meihua'));
  assert.equal(document.querySelectorAll('style[data-plugin=dsh-meihua]').length,1);for(const dispose of disposers.reverse())dispose();assert.equal(document.querySelectorAll('style[data-plugin=dsh-meihua]').length,0);
});
