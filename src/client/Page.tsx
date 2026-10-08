import {ReadingText} from './ReadingText.tsx';
import {GenerationStatus,ResumeReading} from './GenerationStatus.tsx';
import {ReadingJump,useReadingNavigation} from './reading-navigation.tsx';
import { useEffect, useState } from 'react';
import type { CastInput, Hexagram, RuleInfo } from '../core/types.ts';
import { localTimestamp, wallTimeToInstant } from '../core/calendar.ts';
import type { ModelRoute, Reading } from '../shared/protocol.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import { initialMeihuaDraft, type MeihuaDraft, type PageState } from './controller.ts';
import type { LocaleKey, Translate } from './locales.ts';
import { Conversation, formatConversationCopy } from './Conversation.tsx';
import { BackgroundControls, type BackgroundOptions } from './MemoryPanel.tsx';
import type { MemoryPageState } from './memory-controller.ts';

export interface PageProps {
  t:Translate;
  useMeihua:<T>(selector:(state:PageState)=>T)=>T;
  onCast:(input:CastInput)=>Promise<void>;
  onInterpret:(route:ModelRoute,options?:BackgroundOptions)=>Promise<void>;
  active?:boolean;
  onResume?:(turnId?:string)=>Promise<boolean|void>;
  onFollowup?:(question:string)=>Promise<boolean|void>;
  onCancel:()=>Promise<void>;
  onRefresh:()=>Promise<void>;
  onSkip:()=>void;
  onDraftChange?:(patch:Partial<MeihuaDraft>)=>void;
  memoryState?:MemoryPageState;
  onOpenMemory?:()=>void;
  onCheckpoint?:()=>Promise<void>;
}

/** Six lines are always drawn bottom-to-top; the displayed stack reverses their positions. */
function HexagramDrawing({hex,moving=0,progress=1,large=false}:{hex:Hexagram;moving?:number;progress?:number;large?:boolean}) {
  return <svg className={`mh-hex ${large?'mh-hex-large':''}`} viewBox="0 0 160 160" aria-hidden="true">
    {hex.lines.map((line,i)=>{
      const y = 132-i*23, visible = progress >= (i+1)/7;
      return <g key={i} className={moving === i+1?'mh-moving':''} style={{opacity:visible?1:0,transform:visible?'none':'translateY(4px)',transition:'opacity .45s, transform .45s'}}>
        {line===1 ? <rect x="17" y={y} width="126" height="9" rx="1.5"/> : <><rect x="17" y={y} width="53" height="9" rx="1.5"/><rect x="90" y={y} width="53" height="9" rx="1.5"/></>}
        {moving===i+1 && <circle cx="153" cy={y+4.5} r="3"/>}
      </g>;
    })}
  </svg>;
}

/** Ink circle and trigrams are vector artwork, with no network assets. */
export function Bagua({size=28,spinning=false}:{size?:number;spinning?:boolean}) {
  const codes = [[1,1,1],[1,1,0],[1,0,1],[1,0,0],[0,1,1],[0,1,0],[0,0,1],[0,0,0]];
  return <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true" className={spinning?'mh-bagua mh-bagua-spin':'mh-bagua'}>
    <circle cx="80" cy="80" r="72" fill="none" stroke="currentColor" strokeWidth="1" opacity=".28"/>
    {codes.map((lines,i)=><g key={i} transform={`rotate(${i*45},80,80)`}>{lines.map((line,j)=>line ? <rect key={j} x="65" y={11+j*7} width="30" height="3"/> : <g key={j}><rect x="65" y={11+j*7} width="12" height="3"/><rect x="83" y={11+j*7} width="12" height="3"/></g>)}</g>)}
    <circle cx="80" cy="80" r="27" fill="none" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M80 53 A27 27 0 0 1 80 107 A13.5 13.5 0 0 1 80 80 A13.5 13.5 0 0 0 80 53"/>
    <circle cx="80" cy="66.5" r="3.5" className="mh-taiji-light"/><circle cx="80" cy="93.5" r="3.5"/>
  </svg>;
}

function Animation({reading,startedAt,duration,t,onSkip}:{reading:Reading;startedAt:number;duration:number;t:Translate;onSkip:()=>void}) {
  const [progress,setProgress] = useState(0);
  useEffect(()=>{
    const timer = setInterval(()=>setProgress(Math.min(1,(Date.now()-startedAt)/Math.max(duration,1))),45);
    return ()=>clearInterval(timer);
  },[startedAt,duration]);
  return <div className="mh-animation" aria-live="polite">
    <div className="mh-ritual-circle"><Bagua size={300} spinning/><div className="mh-ritual-hex"><HexagramDrawing hex={reading.result.primary} moving={reading.result.movingLine} progress={progress} large/></div></div>
    <div className="mh-animation-caption"><p className="mh-eyebrow">{t('animationTitle')}</p><p>{t('animationText')}</p><button className="mh-link" onClick={onSkip}>{t('skip')} <span aria-hidden="true">↗</span></button></div>
  </div>;
}

function HexagramCard({hex,label,moving=0,main=false}:{hex:Hexagram;label:string;moving?:number;main?:boolean}) {
  return <article className={`mh-hex-card ${main?'mh-hex-card-main':''}`}>
    <p className="mh-eyebrow">{label}</p><HexagramDrawing hex={hex} moving={moving} large={main}/>
    <h3>{hex.title}</h3><span className="mh-hex-number">{String(hex.number).padStart(2,'0')}</span>
  </article>;
}

function formatCopy(reading:Reading,t:Translate):string {
  const r=reading.result;
  const status:LocaleKey=reading.status==='complete'?'complete':reading.status==='cancelled'?'cancelled':reading.status==='failed'?'failed':'interpreting';
  return `${t('panel')}\n${t('question')}：${r.input.question}\n${t('localTime')}：${r.lunar.localTime.replace('T',' ')} (${r.input.environment.timeZone})\n${t('primary')}：${r.primary.title}\n${t('mutual')}：${r.mutual.title}\n${t('changed')}：${r.changed.title}\n${t('moving')}：${r.movingLine}\n${t('body')}：${r.body.name}（${r.body.element}） · ${t('application')}：${r.application.name}（${r.application.element}） · ${r.relationship}\n\n${r.steps.join('\n')}\n\n${reading.route?`${t('source')}：${reading.route.provider} / ${reading.route.model}\n\n`:''}${reading.status!=='ready'?`${t('readingStatus')}：${t(status)}\n`:''}${reading.text}${reading.error?`\n${reading.error.message}`:''}${formatConversationCopy(reading.conversation,t)}`;
}

export function Page({t,useMeihua,onCast,onInterpret,onFollowup,onResume,active=true,onCancel,onRefresh,onSkip,onDraftChange,memoryState,onOpenMemory,onCheckpoint}:PageProps) {
  const state=useMeihua(state=>state),{catalog,reading}=state;
  const draft=state.draft??initialMeihuaDraft;
  const [question,setQuestion]=useState(draft.question),[ruleId,setRule]=useState(draft.ruleId);
  const [numbers,setNumbers]=useState<Record<string,string>>(draft.numbers);
  const [customTime,setCustomTime]=useState(draft.customTime),[date,setDate]=useState(draft.date),[context,setContext]=useState(draft.context);
  const [route,setRoute]=useState<ModelRoute>(draft.route);
  useEffect(()=>{onDraftChange?.({question,ruleId,numbers,customTime,date,context,route});},[question,ruleId,numbers,customTime,date,context,route,onDraftChange]);
  const [localError,setError]=useState(''),[copyStatus,setCopyStatus]=useState<LocaleKey>('copy'),[submitting,setSubmitting]=useState(false);
  const rule:RuleInfo | undefined = catalog?.rules.find(r=>r.id===ruleId);
  const providers=catalog?.providers ?? [],group=providers.find(p=>p.id===route.provider);
  const busy=readingIsBusy(reading)||!!state.interpreting,animating=state.animationStartedAt!==null;
  useEffect(()=>{
    if (!catalog) return;
    if (providers.some(p=>p.id===route.provider && p.models.some(m=>m.id===route.model))) return;
    const p=providers.find(p=>p.models.length>0);
    setRoute(p?{provider:p.id,model:p.models[0]!.id}:{provider:'',model:''});
  },[catalog]);
  const chooseTime=()=>{
    if (!customTime && !date) setDate(localTimestamp(new Date().toISOString(),catalog?.config.timeZone ?? 'Asia/Shanghai').slice(0,16));
    setCustomTime(!customTime);
  };
  const cast=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');setCopyStatus('copy');
    try {
      const timeZone=catalog!.config.timeZone;
      const capturedAt=customTime?wallTimeToInstant(date,timeZone):new Date().toISOString();
      const values=Object.fromEntries((rule?.fields??[]).map(f=>[f.key,Number(numbers[f.key])]));
      await onCast({ruleId,question,values,environment:{capturedAt,timeZone,details:context.trim()?{observation:context.trim()}:{}}});
    } catch(error) {setError(error instanceof Error?error.message:t('genericFailure'));}
  };
  const interpret=async()=>{setSubmitting(true);try{if(memoryState)await onInterpret(route,{useBackground:draft.useBackground!==false,forOthers:!!draft.forOthers});else await onInterpret(route);}finally{setSubmitting(false);}};
  const copy=async()=>{if(!reading)return;try{await navigator.clipboard.writeText(formatCopy(reading,t));setCopyStatus('copied');}catch{setCopyStatus('copyFailed');}};
  const navigation=useReadingNavigation({navigation:state.navigation,active,contentKey:`${reading?.id}:${reading?.text.length}:${reading?.conversation?.map(turn=>`${turn.id}:${turn.text.length}`).join(',')}`,busy});
  const error=localError || state.error;
  const statusKey:LocaleKey=reading?.status==='complete'?'complete':reading?.status==='cancelled'?'cancelled':reading?.status==='failed'?'failed':'interpreting';
  const failureKey=(code:string):LocaleKey=>code==='CANCELLED'?'cancelled':code==='TIMEOUT'?'timeout':['AUTH','MISSING_CREDENTIAL','INVALID_CREDENTIAL'].includes(code)?'authFailure':['QUOTA','ACCOUNT_QUOTA','RATE_LIMIT'].includes(code)?'quotaFailure':'genericFailure';
  return <main ref={navigation.ref} className="mh-page">
    {reading&&<ReadingJump onJump={navigation.jump} hasNewContent={navigation.hasNewContent} preflight={!!reading.preflight} onCancel={onCancel}/>}
    <div className="mh-landscape" aria-hidden="true"><svg viewBox="0 0 1400 360" preserveAspectRatio="none"><path d="M0 310 130 253 235 284 402 166 518 230 680 86 807 199 946 139 1054 240 1220 180 1400 302V360H0Z"/><path d="M0 328 164 303 351 244 468 291 665 203 855 282 990 219 1167 291 1400 247V360H0Z"/></svg></div>
    <header className="mh-header"><div><p className="mh-eyebrow">{t('eyebrow')}</p><h1>{t('title')}<span className="mh-seal" aria-hidden="true">梅<br/>花</span></h1><p className="mh-subtitle">{t('subtitle')}</p></div><div className="mh-header-mark"><Bagua size={83}/></div></header>
    {state.loading ? <div className="mh-loading" role="status"><Bagua size={56} spinning/><span>{t('loading')}</span></div> : !catalog ? <div className="mh-notice" role="alert">{t('loadFailed')}<p>{error}</p><button className="mh-link" onClick={()=>void onRefresh()}>{t('refresh')}</button></div> : <div className="mh-workspace">
      <section className="mh-input-panel"><form onSubmit={event=>void cast(event)}>
        <label className="mh-label" htmlFor="mh-question">{t('question')}</label><textarea id="mh-question" className="mh-question" value={question} maxLength={500} onChange={e=>setQuestion(e.target.value)} placeholder={t('questionPlaceholder')} rows={3} disabled={busy}/><p className="mh-hint">{t('questionHint')}</p>
        <fieldset disabled={busy || state.casting}><legend className="mh-label">{t('rule')}</legend><div className="mh-tabs">{catalog.rules.map(r=><button key={r.id} type="button" aria-pressed={ruleId===r.id} className={ruleId===r.id?'mh-tab mh-tab-active':'mh-tab'} onClick={()=>setRule(r.id)}>{r.id==='time'?t('timeRule'):r.id==='three-numbers'?t('numberRule'):r.name}</button>)}</div>
          {rule?.fields.length ? <><div className="mh-number-row">{rule.fields.map((field,i)=><label key={field.key}><span>{ruleId==='three-numbers'?t((['firstNumber','secondNumber','thirdNumber'] as const)[i]!):field.label}</span><input type="number" inputMode="numeric" required min={field.min} max={field.max} step={1} value={numbers[field.key]??''} placeholder={t('numberPlaceholder')} onChange={e=>setNumbers({...numbers,[field.key]:e.target.value})}/></label>)}</div><p className="mh-hint">{ruleId==='three-numbers'?t('numbersHint'):rule.name}</p></> : <><label className="mh-check"><input type="checkbox" checked={customTime} onChange={chooseTime}/>{t('timeCustom')}</label>{customTime && <input className="mh-date" type="datetime-local" aria-label={t('timeCustom')} required value={date} onChange={e=>setDate(e.target.value)}/>}<p className="mh-hint">{t('timeHint')} · {catalog.config.timeZone}</p></>}
        </fieldset>
        <details className="mh-context"><summary>{t('context')} <span>＋</span></summary><p className="mh-hint">{t('contextHint')}</p><textarea value={context} maxLength={800} onChange={e=>setContext(e.target.value)} rows={2} aria-label={t('context')} placeholder={t('contextPlaceholder')} disabled={busy}/></details>
        {memoryState&&onOpenMemory&&<BackgroundControls state={memoryState} options={{useBackground:draft.useBackground!==false,forOthers:!!draft.forOthers}} onChange={patch=>onDraftChange?.(patch)} onOpen={onOpenMemory} disabled={busy||state.casting||!memoryState.status} usage={reading?.memory}/>}
        <button className="mh-button mh-cast" type="submit" disabled={busy || state.casting || animating||!!memoryState&&!memoryState.status}><Bagua size={20}/>{state.casting?t('casting'):reading?t('newCast'):t('cast')}<span aria-hidden="true">→</span></button>
        {busy && <p className="mh-hint">{t('inputLocked')}</p>}
        {error && <div className="mh-notice" role="alert"><p>{error}</p>{state.error&&<button className="mh-link" type="button" disabled={!!state.interpreting||state.casting} onClick={()=>void onRefresh()}>{t('refreshReading')}</button>}</div>}
      </form><footer className="mh-input-footer"><span className="mh-footer-line"/>{t('entertainment')}</footer></section>
      <section data-reading-result className="mh-result-panel" aria-label={t('primary')}>
        {!reading ? <div className="mh-empty"><Bagua size={195}/><h2>{t('waiting')}</h2><p>{t('waitingText')}</p></div> : animating ? <Animation reading={reading} startedAt={state.animationStartedAt!} duration={catalog.config.animationMs} t={t} onSkip={onSkip}/> : <>
          <p className="mh-result-question">{reading.result.input.question}</p>
          <div className="mh-result-meta"><span>{reading.result.lunar.localTime.replace('T',' ').slice(0,16)} · {reading.result.input.environment.timeZone}</span><span>{reading.result.lunar.yearBranch}{t('year')}{reading.result.lunar.leapMonth?t('leap'):''}{reading.result.lunar.month}{t('month')}{reading.result.lunar.day}{t('day')} · {reading.result.lunar.hourBranch}{t('hour')}</span></div>
          <div className="mh-hexagrams"><HexagramCard hex={reading.result.primary} label={t('primary')} moving={reading.result.movingLine} main/><HexagramCard hex={reading.result.mutual} label={t('mutual')}/><HexagramCard hex={reading.result.changed} label={t('changed')}/></div>
          <div className="mh-facts"><span>{t('body')} <b>{reading.result.body.name} · {reading.result.body.element}</b></span><span>{t('application')} <b>{reading.result.application.name} · {reading.result.application.element}</b></span><span className="mh-relation">{reading.result.relationship}</span><span>{t('moving')} <b>{reading.result.movingLine}{t('lineSuffix')}</b></span></div>
          <details className="mh-calculation"><summary>{t('calculation')} <span>＋</span></summary><ol>{reading.result.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>{reading.result.input.environment.details.observation && <p>{String(reading.result.input.environment.details.observation)}</p>}</details>
          <section data-reading-interpretation className="mh-interpretation"><div className="mh-section-heading"><h2>{t('interpretation')}</h2>{reading.status!=='ready' && <span className={`mh-status mh-status-${reading.status}`}>{t(statusKey)}</span>}</div>
            {memoryState&&onOpenMemory&&reading.memory&&<BackgroundControls state={memoryState} options={{useBackground:draft.useBackground!==false,forOthers:!!draft.forOthers}} onChange={patch=>onDraftChange?.(patch)} onOpen={onOpenMemory} disabled usage={reading.memory}/>}
            {reading.status==='ready' ? <><p className="mh-hint">{t('interpretationHint')}</p>{providers.length===0 ? <p className="mh-notice">{t('noProviders')}</p> : <div className="mh-model-row"><label>{t('provider')}<select value={route.provider} onChange={e=>{const p=providers.find(p=>p.id===e.target.value);setRoute({provider:e.target.value,model:p?.models[0]?.id??''});}}>{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>{t('model')}<select value={route.model} onChange={e=>setRoute({...route,model:e.target.value})}>{group?.models.length?group.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>):<option value="">{t('noModels')}</option>}</select></label></div>}
              {group?.error && <p className="mh-notice">{group.error}</p>}<div className="mh-actions"><button className="mh-button mh-interpret-button" onClick={()=>void interpret()} disabled={busy||!route.provider || !route.model || submitting||!!memoryState&&!memoryState.status?.unlocked}>{submitting?t('interpreting'):t('interpret')} <span aria-hidden="true">↗</span></button><button className="mh-link" onClick={()=>void onRefresh()}>{t('refresh')}</button></div>
            </> : <><GenerationStatus generation={reading.generation} busy={reading.status==='streaming'}/><p className="mh-route">{reading.route?.provider} / {reading.route?.model}</p>{reading.text?<ReadingText className="mh-reading-text" text={reading.text}/>:<p className="mh-pending" role="status">{t('outputPending')}</p>}
              {reading.error && <p className="mh-notice" role="alert">{reading.error.code==='LOG_WRITE'?reading.error.message:t(failureKey(reading.error.code))}</p>}
              <div className="mh-actions">{reading.status==='streaming'?<button className="mh-link" onClick={()=>void onCancel()}>{t('cancel')}</button>:<span className="mh-hint">{t('firstOnly')}</span>}</div>
            </>}
          <span data-reading-end/><ResumeReading status={reading.status} text={reading.text} busy={busy||!!state.interpreting} onResume={!reading.conversation?.length&&onResume?()=>onResume():undefined}/></section>{onFollowup&&['complete','failed','cancelled'].includes(reading.status)&&!!reading.text.trim()&&<Conversation key={reading.id} readingId={reading.id} turns={reading.conversation??[]} busy={readingIsBusy(reading)} pending={!!state.interpreting} draft={draft.followupQuestion} theme="mh" t={t} onDraftChange={value=>onDraftChange?.({followupQuestion:value})} onSend={onFollowup} onCancel={onCancel} onResume={onResume}/>}<div className="mh-copy-row"><button className="mh-link" onClick={()=>void copy()}>{t(copyStatus)}</button><span className="mh-hint">{reading.result.algorithmVersion}</span></div>
          {onCheckpoint&&!busy&&<div className="wm-end-row"><button onClick={()=>void onCheckpoint()} disabled={state.casting||!!memoryState&&!memoryState.status?.unlocked||!!memoryState?.status?.updating}>结束本轮并更新背景</button>{reading.memory?.forOthers&&<p className="wm-caption">替他人占卜，不写入本人记忆。</p>}</div>}
        </>}
      </section>
    </div>}
  </main>;
}
