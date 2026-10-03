import { useEffect, useRef } from 'react';
import { Page, type PageProps } from './Page.tsx';
import { TarotPage } from './TarotPage.tsx';
import type { TarotPageState, TarotDraft } from './tarot-controller.ts';
import type { TarotStartInput } from '../tarot/types.ts';
import type { ModelRoute } from '../shared/protocol.ts';
import type { HubState, ModuleId, ViewId } from './hub-controller.ts';
import { Portal, Starfield, CosmosMark } from './Portal.tsx';

export interface HubProps {
  t:PageProps['t'];useHub:<T>(selector:(state:HubState)=>T)=>T;useMeihua:PageProps['useMeihua'];
  useTarot:<T>(selector:(state:TarotPageState)=>T)=>T;
  onNavigate:(view:ViewId,origin?:{x:number;y:number})=>void;onSkipJourney:()=>void;
  onMeihuaCast:PageProps['onCast'];onMeihuaInterpret:PageProps['onInterpret'];onMeihuaCancel:PageProps['onCancel'];
  onMeihuaRefresh:PageProps['onRefresh'];onMeihuaSkip:PageProps['onSkip'];onMeihuaDraft:NonNullable<PageProps['onDraftChange']>;
  onTarotStart:(input:TarotStartInput)=>Promise<void>;onTarotSelect:(slot:number)=>Promise<void>;
  onTarotReveal:(position?:number,all?:boolean)=>Promise<void>;onTarotInterpret:(route:ModelRoute)=>Promise<void>;
  onTarotCancel:()=>Promise<void>;onTarotRefresh:()=>Promise<void>;onTarotSkip:()=>void;
  onTarotDraft:(patch:Partial<TarotDraft>)=>void;onTarotActive:(active:boolean)=>void;
}

export function Hub(props:HubProps) {
  const hub=props.useHub(s=>s),meihua=props.useMeihua(s=>s),tarot=props.useTarot(s=>s),ref=useRef<HTMLElement>(null);
  const busy=meihua.reading?.status==='streaming'||tarot.reading?.status==='streaming';
  const pending=meihua.casting||meihua.interpreting||tarot.acting;
  useEffect(()=>{
    if(hub.journey){ref.current?.querySelector<HTMLButtonElement>('.wx-journey button')?.focus({preventScroll:true});return;}
    const heading=ref.current?.querySelector<HTMLElement>('.wx-view:not([hidden]) h1');
    if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
  },[hub.view,hub.journey]);
  const navigate=(view:ViewId,origin?:{x:number;y:number})=>{if(!busy&&!pending)props.onNavigate(view,origin);};
  const stateClass=hub.journey?`wx-travelling wx-journey-${hub.journey.to}`:'';
  const viewInteraction=hub.journey?{inert:''}:{};
  const view=hub.view;
  return <main ref={ref} className={`wx-hub ${stateClass}`} data-view={view} data-scheme={hub.scheme}>
    <nav className="wx-topbar" aria-label="占卜导航" hidden={view==='portal'}>
      <button className="wx-home" onClick={()=>navigate('portal')} disabled={busy||pending||!!hub.journey}><CosmosMark/><span>返回星空</span></button>
      <div className="wx-module-tabs">{(['meihua','tarot'] as ModuleId[]).map(id=><button key={id} aria-current={view===id?'page':undefined} disabled={busy||pending||!!hub.journey} onClick={()=>navigate(id)}>{id==='meihua'?'梅花易数':'塔罗牌'}</button>)}</div>
      <span className="wx-nav-note">{busy?'解读进行中 · 取消后可切换':'问象 · 占卜'}</span>
    </nav>
    <div className="wx-view wx-view-portal" {...viewInteraction} hidden={view!=='portal'}><Portal active={view==='portal'&&!hub.journey} onEnter={navigate}/></div>
    <div className="wx-view wx-view-module" {...viewInteraction} hidden={view!=='meihua'}><Page t={props.t} useMeihua={props.useMeihua} onCast={props.onMeihuaCast} onInterpret={props.onMeihuaInterpret} onCancel={props.onMeihuaCancel} onRefresh={props.onMeihuaRefresh} onSkip={props.onMeihuaSkip} onDraftChange={props.onMeihuaDraft}/></div>
    <div className="wx-view wx-view-module" {...viewInteraction} hidden={view!=='tarot'}><TarotPage useTarot={props.useTarot} onStart={props.onTarotStart} onSelect={props.onTarotSelect} onReveal={props.onTarotReveal} onInterpret={props.onTarotInterpret} onCancel={props.onTarotCancel} onRefresh={props.onTarotRefresh} onSkip={props.onTarotSkip} onDraftChange={props.onTarotDraft} onActivityChange={props.onTarotActive} active={view==='tarot'&&!hub.journey} scheme={hub.scheme}/></div>
    {hub.error&&<p className="wx-hub-error" role="alert">{hub.error}</p>}
    {hub.journey&&<div className={`wx-journey ${hub.journey.to==='portal'?'wx-journey-return':'wx-journey-enter'}`} style={{'--wx-journey-ms':`${hub.journey.duration}ms`,'--wx-origin-x':`${hub.journey.origin.x*100}%`,'--wx-origin-y':`${hub.journey.origin.y*100}%`} as React.CSSProperties} aria-label="星空转场" role="status" onKeyDown={event=>{if(event.key==='Tab'){event.preventDefault();event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus();}}}>
      <Starfield active journey={hub.journey}/><div className="wx-journey-wash"/><p>{hub.journey.to==='portal'?'归于星河':hub.journey.to==='meihua'?'墨生万象':'星启秘仪'}</p><button onClick={props.onSkipJourney}>跳过转场 ↗</button>
    </div>}
  </main>;
}
