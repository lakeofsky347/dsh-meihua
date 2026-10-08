import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { Conversation } from '../src/client/Conversation.tsx';
import { MeihuaController,initialMeihuaDraft,type PageState } from '../src/client/controller.ts';
import { TarotController,type TarotPageState } from '../src/client/tarot-controller.ts';
import { zh,type Translate } from '../src/client/locales.ts';
import { RuleRegistry } from '../src/core/index.ts';
import { TAROT_CARDS,TAROT_DECK,TAROT_SPREADS,tarotSpread } from '../src/tarot/index.ts';
import type { Catalog,ClientRpc,ConversationTurn,Reading,RpcResult,TarotCatalog,TarotReading } from '../src/shared/protocol.ts';

const jsdomPackage:string='jsdom';
const {JSDOM}=await import(jsdomPackage) as {JSDOM:new(html:string,options:object)=>{window:Window & typeof globalThis}};
const dom=new JSDOM('<!doctype html><html><body><div id="conversation-root"></div></body></html>',{url:'http://localhost'});
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
// Load the DOM event system after its browser globals are ready, so real textarea input is exercised.
const {createRoot}=await import('react-dom/client');
const {TarotPage}=await import('../src/client/TarotPage.tsx');
const {Page}=await import('../src/client/Page.tsx');
const t:Translate=key=>zh[key],route={provider:'configured',model:'selected'};
const config={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:1500,maxOutputTokens:3000,pollIntervalMs:5};
const providers=[{id:route.provider,name:'已配置模型',models:[{id:route.model,name:'指定模型'}]}];
const input={ruleId:'three-numbers',question:'这次原始问题',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-05T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};
const meihuaCatalog:Catalog={rules:new RuleRegistry().list(),providers,config};
const tarotCatalog:TarotCatalog={spreads:TAROT_SPREADS,deck:TAROT_DECK,providers,config};
const meihuaReading:Reading={id:'mh-conversation',result:new RuleRegistry().calculate(input),status:'complete',text:'第一次完整解读保持原文',route};
const tarotReading:TarotReading={id:'tr-conversation',moduleId:'tarot',algorithmVersion:'tarot-v1',spread:tarotSpread('single'),question:input.question,includeReversed:true,createdAt:input.environment.capturedAt,selectionCount:1,selectedSlots:[0],cards:[{positionIndex:0,positionLabel:'当下指引',revealed:true,card:TAROT_CARDS[0]!,orientation:'upright'}],status:'complete',text:meihuaReading.text,route};
const turn=(status:ConversationTurn['status']='complete'):ConversationTurn=>({id:'turn-1',question:'请把这个术语讲通俗些',text:'这是与最初结果相连的回答',status,route,createdAt:input.environment.capturedAt});
const mhState=(reading:Reading):PageState=>({catalog:meihuaCatalog,reading,loading:false,casting:false,interpreting:false,animationStartedAt:null,error:'',draft:{...initialMeihuaDraft}});
const trState=(reading:TarotReading):TarotPageState=>({catalog:tarotCatalog,reading,loading:false,acting:false,shuffling:false,error:'',draft:{question:input.question,spreadId:'single',includeReversed:true,route}});
const container=()=>document.getElementById('conversation-root')!;
const clickButton=(text:string)=>Array.from(container().querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.includes(text))!;
const noop=async()=>{};
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function typeDraft(value:string) {
  const textarea=container().querySelector<HTMLTextAreaElement>('.wx-conversation-form textarea')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,value);
    textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
}

test('两模块的对话按轮展示；失败、取消和模型 HTML 作为文字保留，复制完整上下文',async()=>{
  const root=createRoot(container());let copied='';
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{copied=value;}},configurable:true});
  const history:ConversationTurn[]=[turn(),{...turn('cancelled'),id:'turn-2',question:'我可以先做什么',text:'<img src="bad" onerror="attack()">\n收到的部分回答',error:{code:'CANCELLED',message:'本轮取消，部分文字保留'}},{...turn('failed'),id:'turn-3',question:'再解释一遍',text:'仍然保留的部分',error:{code:'TIMEOUT',message:'超时，保留部分'}}];
  for(const module of ['mh','tr'] as const){
    const common={onInterpret:noop,onFollowup:async()=>true,onCancel:noop,onRefresh:noop,onSkip:()=>{}};
    await act(async()=>root.render(module==='mh'?<Page {...common} t={t} useMeihua={selector=>selector(mhState({...meihuaReading,conversation:history}))} onCast={noop}/>:<TarotPage {...common} useTarot={selector=>selector(trState({...tarotReading,conversation:history}))} onStart={noop} onSelect={noop} onReveal={noop} onDraftChange={()=>{}} onActivityChange={()=>{}} active/>));
    assert.equal(container().querySelectorAll('.wx-conversation-turn').length,3);
    assert.equal(container().querySelectorAll('.wx-conversation-text img').length,0);
    assert.ok(container().querySelector('.wx-conversation-text')!.textContent!.includes(history[0]!.text));
    assert.ok(container().textContent!.includes('<img src="bad"'));
    await act(async()=>clickButton('复制结果').click());
    for(const value of [input.question,meihuaReading.text,...history.flatMap(value=>[value.question,value.text]),'回答完成','回答已取消','回答未完成'])assert.ok(copied.includes(value),`${module} copy missing ${value}`);
  }
  await act(async()=>root.unmount());
});

test('提交在 RPC 接收后清除本条草稿；下一条草稿不会被生成结束覆盖，失败可直接重试',async()=>{
  const root=createRoot(container()),accepted=deferred<boolean>();let busy=false,turns:ConversationTurn[]=[],persisted='';
  const sent:string[]=[];
  const render=async(onSend:(question:string)=>Promise<boolean>)=>act(async()=>root.render(<Conversation readingId="draft-reading" turns={turns} busy={busy} pending={false} theme="mh" t={t} onDraftChange={value=>{persisted=value;}} onSend={onSend} onCancel={noop}/>));
  const send=async(question:string)=>{sent.push(question);return accepted.promise;};
  await render(send);await typeDraft('请解释这次结果');
  assert.equal(persisted,'请解释这次结果');
  await act(async()=>clickButton('发送追问').click());
  assert.deepEqual(sent,['请解释这次结果']);
  assert.equal(container().querySelector<HTMLTextAreaElement>('textarea')!.value,'请解释这次结果');
  assert.equal(container().querySelector<HTMLTextAreaElement>('textarea')!.disabled,true);
  busy=true;turns=[turn('streaming')];await render(send);
  await act(async()=>accepted.resolve(true));
  assert.equal(container().querySelector<HTMLTextAreaElement>('textarea')!.value,'');assert.equal(persisted,'');
  assert.equal(clickButton('发送追问').disabled,true);
  await typeDraft('下一条还未发送的问题');assert.equal(persisted,'下一条还未发送的问题');
  busy=false;turns=[turn('complete')];await render(async()=>false);
  assert.equal(container().querySelector<HTMLTextAreaElement>('textarea')!.value,'下一条还未发送的问题');
  await act(async()=>clickButton('发送追问').click());
  assert.equal(container().querySelector<HTMLTextAreaElement>('textarea')!.value,'下一条还未发送的问题');
  assert.ok(container().textContent!.includes('草稿已保留'));
  assert.equal(clickButton('发送追问').disabled,false);
  await render(async question=>{sent.push(question);return true;});await act(async()=>clickButton('发送追问').click());
  assert.equal(sent.at(-1),'下一条还未发送的问题');assert.equal(persisted,'');
  await act(async()=>root.unmount());
});

test('首解生成时没有追问；追问生成锁住重起与重抽，只有本轮取消入口，换新结果清草稿',async()=>{
  const root=createRoot(container());let cancels=0;
  for(const module of ['mh','tr'] as const){
    let current:Reading|TarotReading=module==='mh'?{...meihuaReading,status:'streaming'}:{...tarotReading,status:'streaming'};
    const common={onInterpret:noop,onFollowup:async()=>true,onCancel:async()=>{cancels++;},onRefresh:noop,onSkip:()=>{}};
    const render=async()=>act(async()=>root.render(module==='mh'?<Page {...common} t={t} useMeihua={selector=>selector(mhState(current as Reading))} onCast={noop}/>:<TarotPage {...common} useTarot={selector=>selector(trState(current as TarotReading))} onStart={noop} onSelect={noop} onReveal={noop} onDraftChange={()=>{}} onActivityChange={()=>{}} active/>));
    await render();assert.equal(container().querySelector('.wx-conversation'),null);
    current={...current,status:'complete',conversation:[{...turn('streaming'),text:'回答中已经收到的前缀'}]};await render();
    assert.equal(container().querySelector<HTMLButtonElement>(module==='mh'?'.mh-cast':'.tr-start')!.disabled,true);
    assert.equal(clickButton('发送追问').disabled,true);
    assert.equal(Array.from(container().querySelectorAll('button')).filter(button=>button.textContent?.includes('取消')).length,1);
    await act(async()=>clickButton('取消本轮回答').click());
    current={...current,conversation:[{...turn('cancelled'),text:'回答中已经收到的前缀'}]};await render();
    assert.ok(container().textContent!.includes('回答中已经收到的前缀'));assert.equal(container().querySelector<HTMLButtonElement>(module==='mh'?'.mh-cast':'.tr-start')!.disabled,false);
    await typeDraft('尚未发送的新问题');assert.equal(clickButton('发送追问').disabled,false);
    current={...current,id:`new-${module}`,conversation:[]};await render();
    assert.equal(container().querySelector<HTMLTextAreaElement>('.wx-conversation-form textarea')!.value,'');
  }
  assert.equal(cancels,2);await act(async()=>root.unmount());
});

test('两控制器等待接收时防止重复调用，生成期间仍锁定；取消后保留首解与问答并可继续',async()=>{
  for(const module of ['meihua','tarot'] as const){
    const accepted=deferred<void>();let current:Reading|TarotReading=module==='meihua'?{...meihuaReading}:{...tarotReading};
    const calls:{endpoint:string;payload:unknown}[]=[];
    const rpc:ClientRpc={call:async(_channel,method,payload)=>{
      const endpoint=method.split('/')[1]!;calls.push({endpoint,payload});
      if(endpoint==='catalog')return {ok:true,value:module==='meihua'?meihuaCatalog:tarotCatalog};
      if(endpoint==='current')return {ok:true,value:current};
      if(endpoint==='followup'){
        await accepted.promise;
        const body=payload as {question:string};current={...current,conversation:[...(current.conversation??[]),{...turn('streaming'),id:`turn-${(current.conversation?.length??0)+1}`,question:body.question}]};return {ok:true,value:current};
      }
      if(endpoint==='cancel'){current={...current,conversation:current.conversation!.map(value=>value.status==='streaming'?{...value,status:'cancelled' as const,error:{code:'CANCELLED',message:'取消'}}:value)};return {ok:true,value:current};}
      if(endpoint==='cast'||endpoint==='start'){current={...current,id:`fresh-${module}`,conversation:[]};return {ok:true,value:current};}
      throw new Error(`unexpected ${endpoint}`);
    }};
    const controller=module==='meihua'?new MeihuaController(rpc):new TarotController(rpc);await controller.load();
    controller.updateDraft({followupQuestion:'切页后仍在的草稿'});await controller.load();assert.equal(controller.getSnapshot().draft!.followupQuestion,'切页后仍在的草稿');
    const sending=controller.followup('第一条追问');assert.equal(await controller.followup('重复请求'),false);
    if(controller instanceof MeihuaController){await controller.cast(input);assert.equal(controller.getSnapshot().interpreting,true);}else{await controller.start({question:'新问题',spreadId:'single',includeReversed:true});assert.equal(controller.getSnapshot().acting,true);}
    accepted.resolve();assert.equal(await sending,true);
    assert.deepEqual(calls.filter(call=>call.endpoint==='followup').map(call=>call.payload),[{id:module==='meihua'?meihuaReading.id:tarotReading.id,question:'第一条追问',expectedTurnCount:0}]);
    assert.equal(calls.filter(call=>call.endpoint==='cast'||call.endpoint==='start').length,0);
    assert.equal(await controller.followup('生成中又一条'),false);
    await controller.cancel();assert.deepEqual(calls.filter(call=>call.endpoint==='cancel').at(-1)!.payload,{id:current.id,expectedAttempt:0,turnId:'turn-1'});assert.equal(controller.getSnapshot().reading!.status,'complete');assert.equal(controller.getSnapshot().reading!.text,meihuaReading.text);assert.equal(controller.getSnapshot().reading!.conversation![0]!.status,'cancelled');
    assert.equal(await controller.followup('取消后继续'),true);assert.deepEqual(calls.filter(call=>call.endpoint==='followup').at(-1)!.payload,{id:current.id,question:'取消后继续',expectedTurnCount:1});await controller.cancel();assert.deepEqual(calls.filter(call=>call.endpoint==='cancel').at(-1)!.payload,{id:current.id,expectedAttempt:0,turnId:'turn-2'});
    if(controller instanceof MeihuaController)await controller.cast(input);else await controller.start({question:'新问题',spreadId:'single',includeReversed:true});
    assert.equal(controller.getSnapshot().draft!.followupQuestion,'');controller.dispose();
  }
});

test('连接失败保留草稿；刷新恢复问答；取消后迟到的流式快照不能复活上一轮',async()=>{
  for(const module of ['meihua','tarot'] as const){
    let current:Reading|TarotReading=module==='meihua'?{...meihuaReading}:{...tarotReading};
    let rejectSubmission=true,failPoll=false,holdPoll=false;
    const polled=deferred<void>(),stale=deferred<RpcResult>();
    const rpc:ClientRpc={call:async(_channel,method,payload)=>{
      const endpoint=method.split('/')[1]!;
      if(endpoint==='catalog')return {ok:true,value:module==='meihua'?meihuaCatalog:tarotCatalog};
      if(endpoint==='current'){
        if(failPoll){failPoll=false;return {ok:false,error:{code:'CONNECTION',message:'连接中断，可刷新恢复',details:{}}};}
        if(holdPoll){holdPoll=false;polled.resolve();return stale.promise;}
        return {ok:true,value:current};
      }
      if(endpoint==='followup'){
        if(rejectSubmission){rejectSubmission=false;return {ok:false,error:{code:'CONNECTION',message:'提交失败',details:{}}};}
        current={...current,conversation:[...(current.conversation??[]),{...turn('streaming'),id:`turn-${(current.conversation?.length??0)+1}`,question:(payload as {question:string}).question,text:'已收到的回答前缀'}]};return {ok:true,value:current};
      }
      if(endpoint==='cancel'){current={...current,conversation:current.conversation!.map(value=>value.status==='streaming'?{...value,status:'cancelled' as const}:value)};return {ok:true,value:current};}
      throw new Error(`unexpected ${endpoint}`);
    }};
    const controller=module==='meihua'?new MeihuaController(rpc):new TarotController(rpc);await controller.load();controller.updateDraft({followupQuestion:'失败后仍要保留的问题'});
    assert.equal(await controller.followup('失败后仍要保留的问题'),false);assert.equal(controller.getSnapshot().draft!.followupQuestion,'失败后仍要保留的问题');assert.equal(controller.getSnapshot().reading!.conversation?.length??0,0);
    failPoll=true;assert.equal(await controller.followup('重新提交的问题'),true);
    for(let i=0;i<30&&!controller.getSnapshot().error;i++)await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(controller.getSnapshot().error,'连接中断，可刷新恢复');
    current={...current,conversation:current.conversation!.map(value=>({...value,status:'complete' as const,text:'断线期间完成的回答'}))};await controller.load();
    assert.equal(controller.getSnapshot().error,'');assert.equal(controller.getSnapshot().reading!.conversation![0]!.text,'断线期间完成的回答');
    holdPoll=true;assert.equal(await controller.followup('第二轮问题'),true);const oldStreaming=current;
    await polled.promise;await controller.cancel();stale.resolve({ok:true,value:oldStreaming});await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(controller.getSnapshot().reading!.conversation!.at(-1)!.status,'cancelled');assert.equal(controller.getSnapshot().reading!.conversation!.at(-1)!.text,'已收到的回答前缀');assert.equal(controller.getSnapshot().reading!.text,meihuaReading.text);
    controller.dispose();
  }
});
