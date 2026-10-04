import { useEffect, useRef, useState } from 'react';
import type { ModelRoute, TarotReading } from '../shared/protocol.ts';
import type { TarotDrawnCard, TarotStartInput, TarotSpreadId } from '../tarot/types.ts';
import type { TarotDraft, TarotPageState } from './tarot-controller.ts';
import { tarotAssets } from './tarot-assets.ts';

export interface TarotPageProps {
  useTarot:<T>(selector:(state:TarotPageState)=>T)=>T;
  onStart:(input:TarotStartInput)=>Promise<void>;
  onSelect:(slot:number)=>Promise<void>;
  onReveal:(position?:number,all?:boolean)=>Promise<void>;
  onInterpret:(route:ModelRoute)=>Promise<void>;
  onCancel:()=>Promise<void>;
  onRefresh:()=>Promise<void>;
  onSkip:()=>void;
  onDraftChange:(patch:Partial<TarotDraft>)=>void;
  onActivityChange:(active:boolean)=>void;
  active:boolean;
  scheme?:'light'|'dark';
}

export function TarotGlyph({size=48}:{size?:number}) {
  return <svg className="tr-glyph" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth=".8"/>
    <circle cx="60" cy="60" r="43" fill="none" stroke="currentColor" strokeWidth=".6" strokeDasharray="2 6"/>
    <path d="M77 31a31 31 0 1 0 0 58 27 27 0 0 1 0-58Z" fill="currentColor" opacity=".7"/>
    <path d="m79 47 2.5 8 8 2.5-8 2.5-2.5 8-2.5-8-8-2.5 8-2.5Z" fill="currentColor"/>
    <circle cx="90" cy="35" r="1.8" fill="currentColor"/><circle cx="85" cy="82" r="1.3" fill="currentColor"/>
  </svg>;
}

function CardBack({ordinal}:{ordinal?:number}) {
  return <span className="tr-card-back" aria-hidden="true"><span className="tr-card-back-border"/><TarotGlyph size={45}/>{ordinal!==undefined && <span className="tr-back-ordinal">{String(ordinal).padStart(2,'0')}</span>}</span>;
}

function CrossPositionMap({reading,nextPosition}:{reading:TarotReading;nextPosition?:number}) {
  return <div className="tr-cross-overview"><p className="tr-eyebrow">牌阵位置图</p><div className="tr-cross-mini-map" role="img" aria-label={`凯尔特十字位置图：${reading.spread.positions.map((label,i)=>`${i+1} ${label}`).join('，')}`}>
    {reading.cards.map(d=><span key={d.positionIndex} data-position={d.positionIndex+1} className={`tr-mini-position ${d.revealed?'tr-mini-revealed':''} ${d.positionIndex===nextPosition?'tr-mini-next':''}`} aria-hidden="true">{String(d.positionIndex+1).padStart(2,'0')}</span>)}
  </div><p className="tr-hint">位置图与下方牌位编号一一对应</p></div>;
}

function CardImage({drawn,large=false}:{drawn:TarotDrawnCard;large?:boolean}) {
  const card=drawn.card;
  if(!card)return <CardBack/>;
  const src=tarotAssets[card.id];
  return <span className={`tr-card-face ${drawn.orientation==='reversed'?'tr-reversed':''}`}>
    {src?<img src={src} alt={`${card.name} · ${drawn.orientation==='reversed'?'逆位':'正位'}`} loading={large?'eager':'lazy'} draggable={false}/>:<span className="tr-missing-art"><TarotGlyph size={56}/><span>{card.name}</span></span>}
  </span>;
}

function CardDialog({drawn,positionDescription,onClose}:{drawn:TarotDrawnCard;positionDescription:string;onClose:()=>void}) {
  const close=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    close.current?.focus();
    return ()=>previous?.focus();
  },[]);
  const card=drawn.card!;
  const keyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();onClose();}
    if(event.key==='Tab'){
      const elements=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex="0"]')??[]);
      const first=elements[0],last=elements.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };
  return <div className="tr-dialog-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div ref={dialog} className="tr-dialog" role="dialog" aria-modal="true" aria-labelledby="tr-dialog-title" onKeyDown={keyDown}>
      <button ref={close} className="tr-dialog-close" onClick={onClose} aria-label="关闭牌面详情">×</button>
      <div className="tr-dialog-art"><CardImage drawn={drawn} large/></div>
      <div className="tr-dialog-copy"><p className="tr-eyebrow">{String(drawn.positionIndex+1).padStart(2,'0')} · {drawn.positionLabel}</p><h2 id="tr-dialog-title">{card.name}</h2><p className="tr-card-name-en">{card.nameEn}</p><p className="tr-orientation">{drawn.orientation==='reversed'?'逆位':'正位'}</p>
        <h3>牌位说明</h3><p>{positionDescription}</p><p className="tr-keywords">{card.keywords.join(' · ')}</p><h3>正位牌义</h3><p>{card.upright}</p><h3>逆位牌义</h3><p>{card.reversed}</p><p className="tr-hint tr-dialog-note">经典 Rider–Waite–Smith 图像，Pamela Colman Smith 绘制。牌义为本地中文参考。</p>
      </div>
    </div>
  </div>;
}

function Interpretation({text}:{text:string}) {
  return <div className="tr-reading-text">{text.split(/\n\s*\n/).filter(Boolean).map((part,i)=><div key={i}>{part.split('\n').map((line,j)=>/^#{1,4}\s/.test(line)?<h4 key={j}>{line.replace(/^#{1,4}\s+/,'')}</h4>:<p key={j}>{line.replace(/\*\*(.*?)\*\*/g,'$1')}</p>)}</div>)}</div>;
}

export function formatTarotCopy(reading:TarotReading):string {
  const cards=reading.cards.map(d=>`${d.positionIndex+1}. ${d.positionLabel}：${d.card?`${d.card.name}（${d.orientation==='reversed'?'逆位':'正位'}）\n关键词：${d.card.keywords.join('、')}\n牌义：${d.orientation==='reversed'?d.card.reversed:d.card.upright}`:'未揭示'}`).join('\n\n');
  return `塔罗牌占卜\n所问之事：${reading.question}\n牌阵：${reading.spread.name}\n抽牌时间：${reading.createdAt}\n使用逆位：${reading.includeReversed?'是':'否'}\n\n${cards}\n\n${reading.route?`使用模型：${reading.route.provider} / ${reading.route.model}\n\n`:''}${reading.text}\n\n供娱乐与自省；未来位置表示趋势与可能性。`;
}

export function TarotPage({useTarot,onStart,onSelect,onReveal,onInterpret,onCancel,onRefresh,onSkip,onDraftChange,onActivityChange,active,scheme='dark'}:TarotPageProps) {
  const state=useTarot(state=>state),{catalog,reading,draft}=state;
  const [copyStatus,setCopyStatus]=useState('复制结果'),[enlarged,setEnlarged]=useState<number|null>(null);
  const river=useRef<HTMLDivElement>(null);
  useEffect(()=>{onActivityChange(active);return ()=>onActivityChange(false);},[active,onActivityChange]);
  useEffect(()=>{setCopyStatus('复制结果');setEnlarged(null);},[reading?.id]);
  useEffect(()=>{if(!active)setEnlarged(null);},[active]);
  const spread=catalog?.spreads.find(s=>s.id===draft.spreadId);
  const busy=reading?.status==='streaming',locked=busy || state.acting || state.shuffling;
  const inputLocked=locked || reading?.status==='selecting' || reading?.status==='revealing';
  const providers=catalog?.providers??[],provider=providers.find(p=>p.id===draft.route.provider);
  const revealed=reading?.cards.filter(d=>d.revealed && d.card)??[];
  const nextPosition=reading?.cards.find(d=>!d.revealed)?.positionIndex;
  const allRevealed=reading && revealed.length===reading.spread.cardCount;
  const start=async(event:React.FormEvent)=>{event.preventDefault();setCopyStatus('复制结果');await onStart({question:draft.question,spreadId:draft.spreadId,includeReversed:draft.includeReversed});};
  const copy=async()=>{
    if(!reading)return;
    try {await navigator.clipboard.writeText(formatTarotCopy(reading));setCopyStatus('已复制');}
    catch {setCopyStatus('复制未完成，请选择文字复制');}
  };
  const scrollRiver=(distance:number)=>{
    const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    river.current?.scrollBy({left:distance,behavior:reduced?'auto':'smooth'});
  };
  const status=reading?.status==='complete'?'完整解读':reading?.status==='cancelled'?'解读已取消':reading?.status==='failed'?'解读未完成':'正在解读';
  const modal=enlarged===null?undefined:reading?.cards.find(d=>d.positionIndex===enlarged && d.revealed && d.card);
  return <main className="tr-page" data-scheme={scheme} data-active={active?'true':'false'}>
    <div className="tr-ambient" aria-hidden="true"/>
    <header className="tr-header"><div><p className="tr-eyebrow">循着象征，照见此刻</p><h1>塔罗牌<span className="tr-title-star" aria-hidden="true">✧</span></h1><p className="tr-subtitle">在图像、直觉与故事之间，寻找一份新的视角。</p></div><TarotGlyph size={88}/></header>
    {state.loading?<div className="tr-loading" role="status"><TarotGlyph size={72}/><p>正在准备牌桌</p></div>:!catalog?<div className="tr-notice" role="alert">牌桌读取未完成<p>{state.error}</p><button className="tr-link" onClick={()=>void onRefresh()}>重新读取</button></div>:<div className="tr-workspace">
      <aside className="tr-input-panel"><form onSubmit={event=>void start(event)}>
        <label className="tr-label" htmlFor="tr-question">所问之事</label><textarea id="tr-question" value={draft.question} onChange={e=>onDraftChange({question:e.target.value})} rows={3} maxLength={500} placeholder="此刻，想探索些什么？留空则作当下指引" disabled={inputLocked}/><p className="tr-hint">一个问题，一次抽牌。未来位置表示趋势与可能性。</p>
        <fieldset disabled={inputLocked}><legend className="tr-label">选择牌阵</legend><div className="tr-spread-options">{catalog.spreads.map(s=><button type="button" key={s.id} className={`tr-spread-option ${draft.spreadId===s.id?'tr-spread-selected':''}`} aria-pressed={draft.spreadId===s.id} onClick={()=>onDraftChange({spreadId:s.id as TarotSpreadId})}><span>{s.name}</span><span className="tr-spread-count">{s.cardCount} 张</span></button>)}</div><p className="tr-hint tr-spread-description">{spread?.description}</p><label className="tr-check"><input type="checkbox" checked={draft.includeReversed} onChange={e=>onDraftChange({includeReversed:e.target.checked})}/>包含逆位</label><p className="tr-hint">逆位是另一种观察角度，不等同于坏结果。</p></fieldset>
        <button className="tr-button tr-start" type="submit" disabled={locked}><span aria-hidden="true">✧</span>{state.acting?'正在准备':reading?'重新洗牌':'洗牌，开始抽取'}<span aria-hidden="true">→</span></button>
        {busy && <p className="tr-hint">解读进行中，请先等待完成或取消。</p>}{state.error && <p className="tr-notice" role="alert">{state.error}</p>}
      </form><footer className="tr-input-footer"><span aria-hidden="true">☾</span><p>供娱乐与自省<br/><span>{catalog.deck.cardCount} 张完整牌组 · 经典 RWS 体系</span></p></footer></aside>
      <section className="tr-stage" aria-label="塔罗牌桌">
        {!reading?<div className="tr-empty"><div className="tr-empty-orbit"><TarotGlyph size={185}/><span className="tr-empty-spark"/></div><h2>静心，然后抽一张牌</h2><p>选择适合的问题与牌阵。<br/>牌义在本地即可查看，模型解读由你决定。</p><div className="tr-empty-rule"><span/>THE SYMBOLS ARE WAITING<span/></div></div>:state.shuffling?<div className="tr-shuffle" role="status"><div className="tr-shuffle-deck" aria-hidden="true">{Array.from({length:7},(_,i)=><div className="tr-shuffle-card" key={i} style={{'--tr-card-i':i} as React.CSSProperties}><CardBack/></div>)}</div><p className="tr-eyebrow">洗牌 · 静心 · 专注</p><h2>让牌面暂时归于未知</h2><p className="tr-hint">随后由你从 78 张背牌中选择。</p><button className="tr-link" onClick={onSkip}>跳过洗牌动画 ↗</button></div>:<>
          <div className="tr-result-heading"><div><p className="tr-eyebrow">{reading.spread.name} · {reading.spread.cardCount} 张</p><h2>{reading.question || '当下指引'}</h2><p className="tr-hint">{new Date(reading.createdAt).toLocaleString('zh-CN',{hour12:false})} · {reading.includeReversed?'包含逆位':'仅正位'}</p></div><TarotGlyph size={48}/></div>
          {reading.status==='selecting'?<section className="tr-selection"><div className="tr-section-heading"><h3>循着直觉，选择背牌</h3><span className="tr-selection-count" aria-live="polite">已选 {reading.selectionCount} / {reading.spread.cardCount}</span></div><p className="tr-hint">第 {reading.selectionCount+1} 张 · {reading.spread.positions[reading.selectionCount]}。左右滑动查看全部牌，牌面在揭示前保持隐藏。</p>
            <div className="tr-river-shell"><div ref={river} className="tr-card-river" aria-label="78 张背牌">{Array.from({length:78},(_,slot)=>{
              const ordinal=reading.selectedSlots.indexOf(slot)+1;
              return <button key={slot} type="button" className={`tr-river-card ${ordinal?'tr-river-selected':''}`} aria-label={ordinal?`第 ${slot+1} 张背牌，已选为第 ${ordinal} 牌位`:`选择第 ${slot+1} 张背牌`} disabled={!!ordinal || state.acting} onClick={()=>void onSelect(slot)}><CardBack ordinal={ordinal || undefined}/><span className="tr-river-number">{String(slot+1).padStart(2,'0')}</span></button>;
            })}</div></div><div className="tr-river-controls"><button className="tr-link" type="button" aria-label="向前查看背牌" onClick={()=>scrollRiver(-400)}>←</button><span>78 张牌，等待你的选择</span><button className="tr-link" type="button" aria-label="向后查看背牌" onClick={()=>scrollRiver(400)}>→</button></div>
            {reading.selectedSlots.length>0 && <ol className="tr-selected-list" aria-label="已选牌位">{reading.selectedSlots.map((slot,i)=><li key={slot}><span className="tr-selected-thumb"><CardBack ordinal={i+1}/></span><div><b>{String(i+1).padStart(2,'0')} · {reading.spread.positions[i]}</b><span>第 {slot+1} 张背牌</span></div></li>)}</ol>}
          </section>:<>
            <div className="tr-section-heading tr-board-heading"><h3>{allRevealed?'牌阵已显现':'逐一揭示你的牌'}</h3>{reading.status==='revealing' && <button className="tr-link" disabled={state.acting} onClick={()=>void onReveal(undefined,true)}>全部揭示 ↗</button>}</div>
            {reading.spread.id==='celtic-cross' && <CrossPositionMap reading={reading} nextPosition={nextPosition}/>}
            <div className={`tr-board tr-board-${reading.spread.id}`} aria-label={`${reading.spread.name}牌阵`}>{reading.cards.map(d=><article key={d.positionIndex} className={`tr-position ${d.revealed?'tr-position-revealed':''} ${d.positionIndex===nextPosition?'tr-position-next':''}`} data-position={d.positionIndex+1}><p className="tr-position-label"><b>{String(d.positionIndex+1).padStart(2,'0')}</b>{d.positionLabel}{reading.spread.id==='celtic-cross'&&d.positionIndex===1&&d.revealed&&<span className="tr-cross-direction">{d.orientation==='reversed'?'逆位':'正位'}</span>}</p><button className="tr-position-card" onClick={()=>d.revealed?setEnlarged(d.positionIndex):void onReveal(d.positionIndex)} disabled={state.acting || (!d.revealed && (reading.status!=='revealing' || d.positionIndex!==nextPosition))} aria-label={d.card?`放大第 ${d.positionIndex+1} 张：${d.card.name}，${d.orientation==='reversed'?'逆位':'正位'}`:`揭示第 ${d.positionIndex+1} 张：${d.positionLabel}`}><CardImage drawn={d}/>{!d.revealed && <span className="tr-reveal-hint">{d.positionIndex===nextPosition?'点击揭示':'依次揭示'}</span>}</button><h4>{d.card?.name??'未知之牌'}</h4><p className="tr-orientation">{d.revealed?(d.orientation==='reversed'?'逆位':'正位'):'尚未揭示'}</p></article>)}</div>
            {revealed.length>0 && <section className="tr-meanings"><div className="tr-section-heading"><h3>牌面与本地牌义</h3><span className="tr-hint">点击牌面可放大</span></div><div className="tr-meaning-list">{revealed.map(d=><article key={d.positionIndex}><div className="tr-meaning-title"><span className="tr-meaning-number">{String(d.positionIndex+1).padStart(2,'0')}</span><div><p className="tr-eyebrow">{d.positionLabel}</p><h4>{d.card!.name}<span>{d.orientation==='reversed'?'逆位':'正位'}</span></h4></div><button className="tr-link" onClick={()=>setEnlarged(d.positionIndex)} aria-label={`查看${d.card!.name}完整牌面`}>查看牌面 ↗</button></div><p className="tr-position-description">牌位说明：{reading.spread.positionDescriptions[d.positionIndex]}</p><p className="tr-keywords">{d.card!.keywords.join(' · ')}</p><p>{d.orientation==='reversed'?d.card!.reversed:d.card!.upright}</p></article>)}</div></section>}
            {allRevealed && <section className="tr-interpretation"><div className="tr-section-heading"><h3>解读这组牌</h3>{reading.status!=='ready' && <span className={`tr-status tr-status-${reading.status}`}>{status}</span>}</div>
              {reading.status==='ready'?<><p className="tr-hint">选择 DSH 已配置模型，生成本次牌阵的一份完整解读。</p>{providers.length===0?<p className="tr-notice">还没有可用的模型，请先在 DSH 设置中配置供应商。</p>:<div className="tr-model-row"><label>供应商<select value={draft.route.provider} onChange={e=>{const p=providers.find(p=>p.id===e.target.value);onDraftChange({route:{provider:e.target.value,model:p?.models[0]?.id??''}});}}>{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>模型<select value={draft.route.model} onChange={e=>onDraftChange({route:{...draft.route,model:e.target.value}})}>{provider?.models.length?provider.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>):<option value="">没有可选模型</option>}</select></label></div>}{provider?.error && <p className="tr-notice">{provider.error}</p>}<div className="tr-actions"><button className="tr-button tr-interpret-button" disabled={!draft.route.provider || !draft.route.model || state.acting} onClick={()=>void onInterpret(draft.route)}>{state.acting?'正在提交':'开始解读'} <span aria-hidden="true">↗</span></button><button className="tr-link" onClick={()=>void onRefresh()}>刷新模型目录</button></div></>:<><p className="tr-route">{reading.route?.provider} / {reading.route?.model}</p>{reading.text?<Interpretation text={reading.text}/>:<p className="tr-output-pending" role="status">解读将在这里徐徐展开</p>}{reading.error && <p className="tr-notice" role="alert">{reading.error.message}</p>}<div className="tr-actions">{busy?<button className="tr-link" onClick={()=>void onCancel()}>取消解读</button>:<p className="tr-hint">本次牌阵已保留第一次解读</p>}</div></>}
            </section>}
          </>}
          <footer className="tr-copy-row"><button className="tr-link" onClick={()=>void copy()}>{copyStatus}</button><span className="tr-hint">{reading.algorithmVersion} · {catalog.deck.name}</span></footer>
        </>}
      </section>
    </div>}
    {modal && active && <CardDialog drawn={modal} positionDescription={reading!.spread.positionDescriptions[modal.positionIndex]??''} onClose={()=>setEnlarged(null)}/>}
  </main>;
}
