import test from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {ReadingText} from '../src/client/ReadingText.tsx';
import {ReadingJump,scrollWithin,useReadingNavigation,type ReadingNavigation} from '../src/client/reading-navigation.tsx';
import {Conversation} from '../src/client/Conversation.tsx';
import {GenerationStatus} from '../src/client/GenerationStatus.tsx';
import {MeihuaController} from '../src/client/controller.ts';
import {TarotController} from '../src/client/tarot-controller.ts';
import {MethodController} from '../src/client/method-controller.ts';
import {RuleRegistry} from '../src/core/index.ts';
import {TAROT_SPREADS,TAROT_DECK,tarotSpread} from '../src/tarot/index.ts';
import {zh,type Translate} from '../src/client/locales.ts';
import type {ClientRpc,ConversationTurn,GenerationInfo,Reading,TarotReading} from '../src/shared/protocol.ts';
import type {MethodReading} from '../src/shared/methods.ts';

const jsdomPackage:string='jsdom';
const {JSDOM}=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const dom=new JSDOM('<!doctype html><html><body><div id="experience-root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
const {createRoot}=await import('react-dom/client');
const container=()=>document.getElementById('experience-root')!;
const t:Translate=key=>zh[key];
const generation:GenerationInfo={phase:'finished',startedAt:0,elapsedMs:2000,reasoningStatus:'maximum',reasoningLabel:'最高',maxTokens:64000,budgetSource:'model-maximum',attempt:2};
const turn=(id:string,status:ConversationTurn['status'],text='已收到的内容'):ConversationTurn=>({id,status,text,question:'请继续解释',route:{provider:'local',model:'test'},createdAt:'2026-10-08T00:00:00Z',generation});

test('五模块共用的正文呈现标题、强调和列表，HTML与不安全链接始终保持文字',async()=>{
  const root=createRoot(container());
  try {
    await act(async()=>root.render(<ReadingText text={'## 先看结论\n\n**可以先沟通**，再安排下一步。\n\n- 第一步\n- 第二步\n\n1. 观察反馈\n2. 调整计划\n\n<img src=x onerror=attack()>\n[危险链接](javascript:attack())\n`原始术语`'}/>));
    assert.equal(container().querySelector('h4')?.textContent,'先看结论');
    assert.equal(container().querySelector('strong')?.textContent,'可以先沟通');
    assert.equal(container().querySelectorAll('ul li').length,2);assert.equal(container().querySelectorAll('ol li').length,2);
    assert.equal(container().querySelector('img,a,script'),null);assert.match(container().textContent??'',/<img src=x onerror=attack\(\)>/);
    assert.equal(container().querySelector('code')?.textContent,'原始术语');
  }finally{await act(async()=>root.unmount());}
});

function ScrollHarness({navigation,contentKey,active=true,busy=true}:{navigation?:ReadingNavigation;contentKey:string;active?:boolean;busy?:boolean}){
  const reading=useReadingNavigation({navigation,contentKey,active,busy});
  return <main ref={reading.ref}><ReadingJump onJump={reading.jump} hasNewContent={reading.hasNewContent}/><section data-reading-result>本次结果</section><section data-reading-interpretation>解读正文<span data-reading-end/></section></main>;
}
const bounds=(top:number,height:number)=>({x:0,y:top,top,bottom:top+height,left:0,right:400,width:400,height,toJSON:()=>({})});

test('200% 页面缩放后定位使用布局像素，不重复放大滚动距离',()=>{
  const panel=document.createElement('main'),toolbar=document.createElement('nav'),target=document.createElement('section');
  toolbar.className='wx-reading-jump';panel.append(toolbar,target);panel.scrollTop=100;
  document.body.append(panel);
  try{
  Object.defineProperty(panel,'offsetHeight',{value:500});panel.getBoundingClientRect=()=>bounds(100,1000);toolbar.getBoundingClientRect=()=>bounds(100,80);target.getBoundingClientRect=()=>bounds(700,500);
  scrollWithin(panel,target);assert.equal(panel.scrollTop,342);
  panel.scrollTop=100;scrollWithin(panel,target,true);assert.equal(panel.scrollTop,174);
  panel.style.height='500.5px';panel.style.boxSizing='border-box';panel.getBoundingClientRect=()=>bounds(100,1001);panel.scrollTop=100;
  scrollWithin(panel,target);assert.equal(panel.scrollTop,342);
  panel.scrollTop=100;scrollWithin(panel,target,true);assert.equal(panel.scrollTop,173.5);
  }finally{panel.remove();}
});

test('成功动作在模块内定位；回看时保留位置，回到最新后继续跟随，模块往返不重复定位',async()=>{
  const root=createRoot(container());
  try {
    await act(async()=>root.render(<ScrollHarness contentKey="a"/>));
    const panel=container().querySelector('main')!,result=panel.querySelector<HTMLElement>('[data-reading-result]')!,end=panel.querySelector<HTMLElement>('[data-reading-end]')!;
    let endPosition=1500;
    panel.getBoundingClientRect=()=>bounds(100,500);result.getBoundingClientRect=()=>bounds(100+700-panel.scrollTop,50);end.getBoundingClientRect=()=>bounds(100+endPosition-panel.scrollTop,1);
    panel.querySelector<HTMLElement>('nav')!.getBoundingClientRect=()=>bounds(100,40);
    const render=async(navigation:ReadingNavigation,contentKey:string,active=true)=>{await act(async()=>root.render(<ScrollHarness navigation={navigation} contentKey={contentKey} active={active}/>));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2));});};
    await render({sequence:1,target:'result'},'a');assert.equal(panel.scrollTop,642);assert.equal(document.activeElement,result);assert.equal(document.documentElement.scrollTop,0);
    await act(async()=>{panel.scrollTop=200;panel.dispatchEvent(new dom.window.Event('scroll'));});
    await render({sequence:1,target:'result'},'b');assert.equal(panel.scrollTop,200);assert.match(panel.textContent??'',/有新内容/);
    await act(async()=>Array.from(panel.querySelectorAll('button')).find(button=>button.textContent?.includes('回到最新'))!.click());
    assert.equal(panel.scrollTop,1025);
    await act(async()=>panel.dispatchEvent(new dom.window.Event('scroll')));
    endPosition=1700;await render({sequence:1,target:'result'},'c');assert.equal(panel.scrollTop,1225);
    await render({sequence:1,target:'result'},'c',false);await render({sequence:1,target:'result'},'c',true);assert.equal(panel.scrollTop,1225);
    await render({sequence:2,target:'result'},'c',false);assert.equal(panel.scrollTop,1225);await render({sequence:2,target:'result'},'c',true);assert.equal(panel.scrollTop,642);
  }finally{await act(async()=>root.unmount());}
});

test('恢复只提供给最近未完成追问，必须点击；空输出显示重试，部分输出显示继续完成',async()=>{
  const root=createRoot(container());const calls:string[]=[];
  try {
    const props={readingId:'reading',busy:false,pending:false,theme:'mh',t,onSend:async()=>true,onCancel:async()=>{},onResume:async(id:string)=>{calls.push(id);}};
    await act(async()=>root.render(<Conversation {...props} turns={[turn('old','failed'),turn('last','cancelled')]}/>));
    assert.equal(container().querySelectorAll('.wx-resume button').length,1);assert.deepEqual(calls,[]);
    await act(async()=>container().querySelector<HTMLButtonElement>('.wx-resume button')!.click());assert.deepEqual(calls,['last']);
    await act(async()=>root.render(<Conversation {...props} turns={[turn('old','failed'),turn('last','failed','')]}/>));
    assert.equal(container().querySelector('.wx-resume button')?.textContent,'重试本轮');
    await act(async()=>root.render(<Conversation {...props} busy turns={[turn('old','failed'),turn('last','streaming')]}/>));
    assert.equal(container().querySelector('.wx-resume'),null);
  }finally{await act(async()=>root.unmount());}
});

test('生成信息区分可确认最高档位与宿主默认预算，并显示共享思考预算',async()=>{
  const root=createRoot(container());
  try{
    await act(async()=>root.render(<GenerationStatus busy={false} generation={{...generation,outputTokenAccounting:'includes-reasoning'}}/>));
    assert.match(container().textContent??'',/已启用最高思考档位/);assert.match(container().textContent??'',/按模型最大能力分配输出预算/);assert.match(container().textContent??'',/包含思考消耗/);
    await act(async()=>root.render(<GenerationStatus busy={false} generation={{...generation,reasoningStatus:'unknown',budgetSource:'host-default'}}/>));
    assert.match(container().textContent??'',/最高思考档位未知 · 沿用宿主默认/);assert.match(container().textContent??'',/沿用宿主默认输出预算/);assert.doesNotMatch(container().textContent??'',/已启用最高/);
  }finally{await act(async()=>root.unmount());}
});

test('五模块恢复请求携带轮次与尝试序号，不自动恢复或允许旧追问改写依据',async()=>{
  const route={provider:'local',model:'test'},environment={capturedAt:'2026-10-08T00:00:00Z',timeZone:'Asia/Shanghai',details:{}};
  const config={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:2000,maxOutputTokens:32000,pollIntervalMs:5};
  const providers=[{id:'local',name:'本地',models:[{id:'test',name:'测试'}]}];
  const base={id:'reading',status:'failed' as const,text:'已有文字',route,generation};
  const mh:Reading={...base,result:new RuleRegistry().calculate({ruleId:'three-numbers',question:'问题',values:{a:2,b:3,c:2},environment})};
  const tr:TarotReading={...base,moduleId:'tarot',algorithmVersion:'tarot-v1',spread:tarotSpread('single'),question:'问题',includeReversed:true,createdAt:environment.capturedAt,selectionCount:1,selectedSlots:[0],cards:[]};
  for(const moduleId of ['meihua','tarot','xiaoliu','lenormand','liuyao'] as const){
    let current:Reading|TarotReading|MethodReading=moduleId==='meihua'?mh:moduleId==='tarot'?tr:{...base,moduleId,question:'问题',createdAt:environment.capturedAt,environment,result:null,backgroundOptions:{},selectedSlots:[],selectionCount:0,coins:[]};
    const calls:{endpoint:string;payload:Record<string,unknown>}[]=[];
    let holdPreflight=false,rejectPreflight:(error:Error)=>void=()=>{};
    const rpc:ClientRpc={call:async(_channel,endpoint,payload)=>{
      calls.push({endpoint,payload:payload as Record<string,unknown>});
      if(endpoint.endsWith('/catalog'))return {ok:true,value:{moduleId,config,providers,rules:new RuleRegistry().list(),spreads:TAROT_SPREADS,deck:TAROT_DECK}};
      if(endpoint.endsWith('/followup')&&holdPreflight){current={...current,preflight:{id:'pending-capability'}};return new Promise((_resolve,reject)=>{rejectPreflight=reject;});}
      if(endpoint.endsWith('/cancel')&&current.preflight){current={...current,preflight:undefined};queueMicrotask(()=>rejectPreflight(new Error('已取消能力检查')));}
      return {ok:true,value:current};
    }};
    const controller=moduleId==='meihua'?new MeihuaController(rpc,()=>4):moduleId==='tarot'?new TarotController(rpc,()=>4):new MethodController(moduleId,rpc,()=>4);
    try{
      await controller.load();assert.equal(calls.filter(call=>call.endpoint.endsWith('/resume')).length,0);
      assert.equal(await controller.resume(),true);
      assert.deepEqual(calls.at(-1)?.payload,{id:'reading',expectedTurnCount:0,expectedAttempt:2,epoch:4});
      current={...current,conversation:[turn('old','failed'),turn('latest','cancelled')]};await controller.load();
      assert.equal(await controller.resume(),false);assert.equal(await controller.resume('old'),false);assert.equal(await controller.resume('latest'),true);
      assert.deepEqual(calls.at(-1)?.payload,{id:'reading',expectedTurnCount:2,expectedAttempt:2,turnId:'latest',epoch:4});
      current={...current,conversation:[turn('old','failed'),{...turn('latest','streaming'),generation:{...generation,attempt:3}}]};await controller.load();await controller.cancel();
      assert.deepEqual(calls.filter(call=>call.endpoint.endsWith('/cancel')).at(-1)?.payload,{id:'reading',expectedAttempt:3,turnId:'latest',epoch:4});
      current={...current,status:'complete',conversation:[]};await controller.load();controller.updateDraft({followupQuestion:'保留这条草稿'});holdPreflight=true;
      const pending=controller.followup('保留这条草稿');
      for(let count=0;count<100&&!controller.getSnapshot().reading?.preflight;count++)await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(controller.getSnapshot().reading?.preflight?.id,'pending-capability');await controller.cancel();assert.equal(await pending,false);
      assert.deepEqual(calls.filter(call=>call.endpoint.endsWith('/cancel')).at(-1)?.payload,{id:'reading',preflightId:'pending-capability',epoch:4});
      assert.equal(controller.getSnapshot().draft?.followupQuestion,'保留这条草稿');assert.equal(controller.getSnapshot().reading?.conversation?.length,0);
      const snapshot=controller.getSnapshot();assert.equal('interpreting' in snapshot?snapshot.interpreting:'acting' in snapshot?snapshot.acting:false,false);
    }finally{controller.dispose();}
  }
});
