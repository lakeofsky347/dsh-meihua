import { useEffect, useRef } from 'react';
import { Page, type PageProps } from './Page.tsx';
import { TarotPage } from './TarotPage.tsx';
import type { TarotPageState, TarotDraft } from './tarot-controller.ts';
import type { TarotStartInput } from '../tarot/types.ts';
import type { ModelRoute } from '../shared/protocol.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import type { TarotPageProps } from './TarotPage.tsx';
import type { HubState, ModuleId, ViewId } from './hub-controller.ts';
import { Portal, Starfield, CosmosMark, modulePresentation } from './Portal.tsx';
import { MemoryPanel, type MemoryActions } from './MemoryPanel.tsx';
import type { MemoryPageState } from './memory-controller.ts';
import {MODULES} from '../shared/modules.ts';
import type {NewMethodId} from '../shared/modules.ts';
import type {MethodPageState} from './method-controller.ts';
import {MethodPage,type MethodActions} from './MethodPage.tsx';

export interface HubProps {
  t:PageProps['t'];useHub:<T>(selector:(state:HubState)=>T)=>T;useMeihua:PageProps['useMeihua'];
  useTarot:<T>(selector:(state:TarotPageState)=>T)=>T;
  onNavigate:(view:ViewId,origin?:{x:number;y:number})=>void;onSkipJourney:()=>void;
  onMeihuaCast:PageProps['onCast'];onMeihuaInterpret:PageProps['onInterpret'];onMeihuaCancel:PageProps['onCancel'];
  onMeihuaResume?:PageProps['onResume'];
  onTarotResume?:TarotPageProps['onResume'];
  onMeihuaFollowup?:PageProps['onFollowup'];
  onMeihuaRefresh:PageProps['onRefresh'];onMeihuaSkip:PageProps['onSkip'];onMeihuaDraft:NonNullable<PageProps['onDraftChange']>;
  onTarotStart:(input:TarotStartInput)=>Promise<void>;onTarotSelect:(slot:number)=>Promise<void>;
  onTarotReveal:(position?:number,all?:boolean)=>Promise<void>;onTarotInterpret:TarotPageProps['onInterpret'];
  onTarotFollowup?:TarotPageProps['onFollowup'];
  onTarotCancel:()=>Promise<void>;onTarotRefresh:()=>Promise<void>;onTarotSkip:()=>void;
  onTarotDraft:(patch:Partial<TarotDraft>)=>void;onTarotActive:(active:boolean)=>void;
  useMemory?:<T>(selector:(state:MemoryPageState)=>T)=>T;
  onOpenMemory?:()=>void;
  memoryActions?:MemoryActions;
  onMeihuaCheckpoint?:()=>Promise<void>;
  onTarotCheckpoint?:()=>Promise<void>;
  useXiaoliu?:<T>(selector:(state:MethodPageState)=>T)=>T;
  useLenormand?:<T>(selector:(state:MethodPageState)=>T)=>T;
  useLiuyao?:<T>(selector:(state:MethodPageState)=>T)=>T;
  methodActions?:Record<NewMethodId,MethodActions>;
}

export function Hub(props:HubProps) {
  const hub=props.useHub(s=>s),meihua=props.useMeihua(s=>s),tarot=props.useTarot(s=>s),ref=useRef<HTMLElement>(null);
  const memory=props.useMemory?.(state=>state);
  const xiaoliu=props.useXiaoliu?.(state=>state),lenormand=props.useLenormand?.(state=>state),liuyao=props.useLiuyao?.(state=>state);
  const methods={xiaoliu,lenormand,liuyao};
  const busy=readingIsBusy(meihua.reading)||readingIsBusy(tarot.reading)||Object.values(methods).some(state=>readingIsBusy(state?.reading));
  const pending=meihua.casting||meihua.interpreting||tarot.acting||Object.values(methods).some(state=>state?.acting);
  useEffect(()=>{
    if(hub.journey){ref.current?.querySelector<HTMLButtonElement>('.wx-journey button')?.focus({preventScroll:true});return;}
    const heading=ref.current?.querySelector<HTMLElement>('.wx-view:not([hidden]) h1');
    if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
  },[hub.view,hub.journey]);
  useEffect(()=>{
    const nav=ref.current?.querySelector<HTMLElement>('.wx-topbar');
    if(!nav)return;
    // The offset is consumed as CSS pixels; a zoomed bounding rect would apply
    // the page scale a second time and leave a gap under the navigation.
    const measure=()=>{const height=nav.offsetHeight;if(height>0)ref.current?.style.setProperty('--wx-nav-height',`${height}px`);};
    measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(nav);return()=>observer.disconnect();
  },[hub.view]);
  const navigate=(view:ViewId,origin?:{x:number;y:number})=>{if(!busy&&!pending)props.onNavigate(view,origin);};
  const stateClass=hub.journey?`wx-travelling wx-journey-${hub.journey.to}`:'';
  const viewInteraction=hub.journey||memory?.open?{inert:''}:{};
  const view=hub.view;
  return <main ref={ref} className={`wx-hub ${stateClass}`} data-view={view} data-scheme={hub.scheme}>
    <nav className="wx-topbar" aria-label="占卜导航" hidden={view==='portal'} {...viewInteraction}>
      <button className="wx-home" onClick={()=>navigate('portal')} disabled={busy||pending||!!hub.journey}><CosmosMark/><span>返回星空</span></button>
      <div className="wx-module-tabs">{MODULES.map(({id,title})=><button key={id} data-module={id} aria-current={view===id?'page':undefined} disabled={busy||pending||!!hub.journey} onClick={()=>navigate(id)}><span className="wx-tab-dot" aria-hidden="true"/>{title}</button>)}</div>
      <span className="wx-nav-note">{busy?'解读进行中 · 取消后可切换':'问象 · 占卜'}</span>
      {memory&&props.onOpenMemory&&<button className="wm-entry" onClick={props.onOpenMemory} disabled={!!hub.journey}>共享背景<small>{memory.status?.updating?'更新中':memory.status?.unlocked?'已解锁':'已锁定'}</small></button>}
    </nav>
    {view==='portal'&&memory&&props.onOpenMemory&&<button className="wm-entry wm-entry-portal" onClick={props.onOpenMemory} disabled={!!hub.journey} {...viewInteraction}>共享背景<small>{memory.status?.updating?'更新中':memory.status?.unlocked?'已解锁':'已锁定'}</small></button>}
    <div className="wx-view wx-view-portal" {...viewInteraction} hidden={view!=='portal'}><Portal active={view==='portal'&&!hub.journey} onEnter={navigate}/></div>
    <div className="wx-view wx-view-module" {...viewInteraction} hidden={view!=='meihua'}><Page key={memory?.privacyEpoch??0} t={props.t} useMeihua={props.useMeihua} onCast={props.onMeihuaCast} onInterpret={props.onMeihuaInterpret} active={view==='meihua'&&!hub.journey} onResume={props.onMeihuaResume} onFollowup={props.onMeihuaFollowup} onCancel={props.onMeihuaCancel} onRefresh={props.onMeihuaRefresh} onSkip={props.onMeihuaSkip} onDraftChange={props.onMeihuaDraft} memoryState={memory} onOpenMemory={props.onOpenMemory} onCheckpoint={props.onMeihuaCheckpoint}/></div>
    <div className="wx-view wx-view-module" {...viewInteraction} hidden={view!=='tarot'}><TarotPage key={memory?.privacyEpoch??0} useTarot={props.useTarot} onStart={props.onTarotStart} onSelect={props.onTarotSelect} onReveal={props.onTarotReveal} onInterpret={props.onTarotInterpret} onResume={props.onTarotResume} onFollowup={props.onTarotFollowup} onCancel={props.onTarotCancel} onRefresh={props.onTarotRefresh} onSkip={props.onTarotSkip} onDraftChange={props.onTarotDraft} onActivityChange={props.onTarotActive} active={view==='tarot'&&!hub.journey} scheme={hub.scheme} memoryState={memory} onOpenMemory={props.onOpenMemory} onCheckpoint={props.onTarotCheckpoint}/></div>
    {(['xiaoliu','lenormand','liuyao'] as NewMethodId[]).map(id=>methods[id]&&props.methodActions&&<div key={id} className="wx-view wx-view-module" {...viewInteraction} hidden={view!==id}><MethodPage active={view===id&&!hub.journey} key={memory?.privacyEpoch??0} moduleId={id} state={methods[id]!} {...props.methodActions[id]} memory={memory} onOpenMemory={props.onOpenMemory} t={props.t}/></div>)}
    {hub.error&&<p className="wx-hub-error" role="alert">{hub.error}</p>}
    {hub.journey&&<div className={`wx-journey ${hub.journey.to==='portal'?'wx-journey-return':'wx-journey-enter'}`} style={{'--wx-journey-ms':`${hub.journey.duration}ms`,'--wx-origin-x':`${hub.journey.origin.x*100}%`,'--wx-origin-y':`${hub.journey.origin.y*100}%`} as React.CSSProperties} aria-label="星空转场" role="status" onKeyDown={event=>{if(event.key==='Tab'){event.preventDefault();event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus();}}}>
      <Starfield active journey={hub.journey}/><div className="wx-journey-wash"/><p>{hub.journey.to==='portal'?'归于星河':modulePresentation[hub.journey.to].caption}</p><button onClick={props.onSkipJourney}>跳过转场 ↗</button>
    </div>}
    {memory?.open&&props.memoryActions&&<MemoryPanel key={memory.privacyEpoch} state={memory} {...props.memoryActions}/>}
  </main>;
}
