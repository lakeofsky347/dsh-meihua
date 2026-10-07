import {useState,useEffect} from 'react';
import type {MethodPageState} from './method-controller.ts';
import type {NewMethodId} from '../shared/modules.ts';
import {moduleInfo} from '../shared/modules.ts';
import type {XiaoliuResult} from '../xiaoliu/types.ts';
import type {LiuyaoResult} from '../liuyao/types.ts';
import type {LenormandResult} from '../lenormand/types.ts';
import {lenormandAssets} from '../lenormand/assets.ts';
import type {MemoryPageState} from './memory-controller.ts';
import {BackgroundControls} from './MemoryPanel.tsx';
import {readingIsBusy} from '../shared/protocol.ts';
import {Conversation,formatConversationCopy} from './Conversation.tsx';
import type {Translate} from './locales.ts';
export interface MethodActions {
  onStart:()=>Promise<boolean>;onLocal:(endpoint:string,payload?:object)=>Promise<boolean>;onInterpret:()=>Promise<boolean>;onFollowup:(question:string)=>Promise<boolean>;onCancel:()=>Promise<boolean>;onRefresh:()=>Promise<void>;onCheckpoint:()=>Promise<void>;onDraft:(patch:Partial<MethodPageState['draft']>)=>void;
}
export interface MethodPageProps extends MethodActions {moduleId:NewMethodId;state:MethodPageState;memory?:MemoryPageState;onOpenMemory?:()=>void;t:Translate}
function MethodResult({id,result}:{id:NewMethodId;result:unknown}){
  if(id==='xiaoliu'){
    const r=result as XiaoliuResult;
    return <><p className="wx-method-kicker">农历 {r.lunar.leapMonth?'闰':''}{r.lunar.month}月{r.lunar.day}日 · {r.lunar.hourBranch}时</p><div className="wx-six-palaces">{[r.monthPalace,r.dayPalace,r.hourPalace].map((palace,i)=><article key={i}><small>{['月宫','日宫','时宫 · 落宫'][i]}</small><h3>{palace.name}</h3><p>{palace.element} · {palace.spirit}</p></article>)}</div><h2>{r.name} · {r.element}</h2><p>{r.meaning}</p><details><summary>六位顺数过程与约定</summary><ol>{r.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>{r.conventions.map((line,i)=><p key={i}>{line}</p>)}</details></>;
  }
  if(id==='lenormand'){
    const r=result as LenormandResult;
    return <><p className="wx-method-kicker">{r.spread.name} · 中牌主题：{r.center.card.name}</p><div className="wx-small-cards">{r.cards.map(({card,positionIndex,positionLabel})=><article key={card.id}><small>{positionIndex+1} · {positionLabel}</small><img src={lenormandAssets[card.id]} alt={`${card.id} ${card.name} 原创牌面`}/><h3>{card.id} · {card.name}</h3><p>{card.keywords.join(' · ')}</p><p>{card.symbolism}</p><p>{card.advice}</p></article>)}</div><h3>相邻组合</h3>{r.adjacentPairs.map((pair,i)=><p key={i}><strong>{pair.phrase}</strong> — {pair.explanation}</p>)}{!!r.mirrors.length&&<><h3>镜像对照</h3>{r.mirrors.map((pair,i)=><p key={i}><strong>{pair.phrase}</strong> — {pair.explanation}</p>)}</>}<details><summary>本地连读规则</summary>{r.readingGuide.map((line,i)=><p key={i}>{line}</p>)}</details></>;
  }
  const r=result as LiuyaoResult;
  return <><p className="wx-method-kicker">{r.calendar.localDate} · 月建 {r.calendar.monthBranch}{r.calendar.monthElement} · 日辰 {r.calendar.dayGanzhi} · {r.calendar.xun} · 旬空 {r.calendar.voidBranches.join('、')}</p><h2>{r.primary.title} → {r.changed.title}</h2><p>{r.palace.name}宫{r.palace.element} · {r.palace.stage} · 世{r.palace.shi}应{r.palace.ying} · {r.movingLines.length?`动爻：${r.movingLines.join('、')}`:'静卦'}</p><div className="wx-liuyao-table" role="region" aria-label="完整六爻装卦" tabIndex={0}><table><thead><tr><th>爻位</th><th>六神</th><th>六亲</th><th>本卦纳甲</th><th>爻象</th><th>世应/空</th><th>变卦</th></tr></thead><tbody>{[...r.lines].reverse().map(line=><tr key={line.position}><td>{line.position}</td><td>{line.spirit}</td><td>{line.relative}</td><td>{line.najia}{line.element}</td><td>{line.yinYang?'━━━':'━ ━'} {line.label}{line.moving?' ○动':''}</td><td>{line.role}{line.void?' 空':''}</td><td>{line.changed.relative} {line.changed.najia}{line.changed.element}{line.changed.void?' 空':''}</td></tr>)}</tbody></table></div><details><summary>装卦过程、交节与规则约定</summary><ol>{r.steps.map((step,i)=><li key={i}>{step}</li>)}</ol><p>上一节：{r.calendar.previousJie.name} {r.calendar.previousJie.localTime}；下一节：{r.calendar.nextJie.name} {r.calendar.nextJie.localTime}</p>{r.conventions.map((line,i)=><p key={i}>{line}</p>)}</details></>;
}
export function formatMethodCopy(reading:MethodPageState['reading'],t:Translate){
  if(!reading)return '';
  const {moduleId,id,question,createdAt,environment,route,selectedRoute,wallTime,memory,status,coins,selectedSlots,result,text,conversation}=reading;
  return `${moduleInfo(moduleId).title}\n${JSON.stringify({id,question,createdAt,timeZone:environment.timeZone,wallTime,route:route??selectedRoute,backgroundUsage:memory,status,coins,selectedSlots,result},null,2)}\n${text}${formatConversationCopy(conversation,t)}`;
}
export function MethodPage(props:MethodPageProps){
  const {moduleId,state,memory,t}=props,{reading,draft,catalog}=state,info=moduleInfo(moduleId),busy=readingIsBusy(reading),[copied,setCopied]=useState(false);
  useEffect(()=>setCopied(false),[reading?.id]);
  const copy=async()=>{if(!reading)return;try{await navigator.clipboard.writeText(formatMethodCopy(reading,t));setCopied(true);}catch{setCopied(false);}};
  return <section className="wx-method-page" aria-label={info.title}><header><p className="wx-method-kicker">{info.tradition}</p><h1>{info.title}</h1><p>{info.subtitle}</p></header>
    <form onSubmit={event=>{event.preventDefault();const wall=event.currentTarget.querySelector<HTMLInputElement>('input[type=datetime-local]');if(wall)props.onDraft({wallTime:wall.value});void props.onStart();}}><label htmlFor={`${moduleId}-question`}>所问之事</label><textarea id={`${moduleId}-question`} maxLength={500} rows={3} value={draft.question} disabled={busy||state.acting} onChange={event=>props.onDraft({question:event.target.value})} placeholder="写下本次的问题或背景"/>
      {moduleId!=='lenormand'&&<><label htmlFor={`${moduleId}-time`}>指定时间（可留空，使用起课当下）</label><input id={`${moduleId}-time`} type="datetime-local" value={draft.wallTime} disabled={busy||state.acting} onChange={event=>props.onDraft({wallTime:event.target.value})}/><p>按 {catalog?.config.timeZone??'配置时区'} 的当地时间计算</p></>}
      {moduleId==='lenormand'&&<><label htmlFor="lenormand-spread">排列</label><select id="lenormand-spread" value={draft.spreadId} disabled={busy||state.acting} onChange={event=>props.onDraft({spreadId:event.target.value})}><option value="line-3">三张连读</option><option value="line-5">五张连读</option></select><p>无逆位；牌序、相邻组合与中牌共同组成含义。</p></>}
      {memory&&props.onOpenMemory&&<BackgroundControls state={memory} options={{useBackground:draft.useBackground,forOthers:draft.forOthers}} onChange={props.onDraft} onOpen={props.onOpenMemory} disabled={busy||state.acting} usage={reading?.memory}/>}
      <button type="submit" disabled={state.loading||state.acting||busy}>{reading?'另起一轮':moduleId==='lenormand'?'洗牌，开始抽取':moduleId==='liuyao'?'开始六次投币':'本地起课'}</button>
    </form>
    {state.error&&<p className="wx-method-error" role="alert">{state.error}</p>}
    {reading&&<article className="wx-method-result"><p>{reading.question}</p><p>{reading.createdAt} · {reading.environment.timeZone}</p>
      {moduleId==='liuyao'&&reading.status==='collecting'&&<><h2>自下而上 · 第 {reading.coins.length+1} 次</h2><p>字面记2，背面记3；6老阴、7少阳、8少阴、9老阳。可模拟投币，或记录实物三币的和值。</p><ol>{reading.coins.map((coin,i)=><li key={i}>第{i+1}爻：{coin.value} {coin.faces.length?`（${coin.faces.join('+')}）`:'（手动记录）'}</li>)}</ol><button disabled={state.acting} onClick={()=>void props.onLocal('toss')}>投掷三枚硬币</button><div className="wx-coin-values">{[6,7,8,9].map(value=><button key={value} disabled={state.acting} onClick={()=>void props.onLocal('record',{value})}>记录 {value}</button>)}</div></>}
      {moduleId==='lenormand'&&reading.status==='selecting'&&<><h2>选择 {reading.selectionCount} 张背牌</h2><p>已选 {reading.selectedSlots.length}/{reading.selectionCount}，顺序就是牌序。</p><div className="wx-small-deck" aria-label="36张雷诺曼背牌">{Array.from({length:36},(_,i)=><button key={i} disabled={state.acting||reading.selectedSlots.includes(i+1)} aria-label={`选择第 ${i+1} 张背牌`} onClick={()=>void props.onLocal('select',{slot:i+1})}>{reading.selectedSlots.includes(i+1)?`已选 ${reading.selectedSlots.indexOf(i+1)+1}`:'✦'}</button>)}</div></>}
      {reading.status==='revealing'&&<button disabled={state.acting} onClick={()=>void props.onLocal('reveal')}>揭示这组牌</button>}
      {reading.result!==null&&<MethodResult id={moduleId} result={reading.result}/>}
      {reading.status==='ready'&&<div className="wx-method-ai"><h2>解读本次结果</h2><label htmlFor={`${moduleId}-provider`}>供应商</label><select id={`${moduleId}-provider`} value={draft.route.provider} disabled={state.acting} onChange={event=>{const provider=catalog?.providers.find(p=>p.id===event.target.value);props.onDraft({route:{provider:event.target.value,model:provider?.models[0]?.id??''}});}}>{catalog?.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><label htmlFor={`${moduleId}-model`}>模型</label><select id={`${moduleId}-model`} value={draft.route.model} disabled={state.acting} onChange={event=>props.onDraft({route:{...draft.route,model:event.target.value}})}>{catalog?.providers.find(p=>p.id===draft.route.provider)?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><button disabled={state.acting||!draft.route.model||!memory?.status?.unlocked} onClick={()=>void props.onInterpret()}>开始解读</button><button disabled={state.acting} onClick={()=>void props.onRefresh()}>刷新模型目录</button></div>}
      {reading.status==='streaming'&&<button disabled={state.acting} onClick={()=>void props.onCancel()}>取消解读</button>}
      {(reading.text||reading.status==='streaming')&&<><p role="status">{reading.status==='complete'?'完整解读':reading.status==='cancelled'?'已取消，保留部分输出':reading.status==='failed'?'解读未完成':'正在解读'} · 背景 {reading.memory?.enabled?`v${reading.memory.revision}`:'停用'}</p><div className="wx-method-text">{reading.text.split('\n').map((line,i)=><p key={i}>{line||'\u00a0'}</p>)}</div>{reading.error&&<p role="alert">{reading.error.message}</p>}</>}
      {reading.text&&reading.status!=='streaming'&&<Conversation key={reading.id} readingId={reading.id} turns={reading.conversation??[]} busy={busy} pending={state.acting} draft={draft.followupQuestion} theme={moduleId} t={t} onDraftChange={followupQuestion=>props.onDraft({followupQuestion})} onSend={props.onFollowup} onCancel={async()=>{await props.onCancel();}}/>}
      <div className="wx-method-actions"><button onClick={()=>void copy()}>复制结果{copied?' · 已复制':''}</button><button disabled={busy||state.acting||!memory?.status?.unlocked} onClick={()=>void props.onCheckpoint()}>结束本轮并更新背景</button></div>
    </article>}
    <footer>本地规则计算与牌义不调用模型 · 供娱乐与自省</footer>
  </section>;
}
