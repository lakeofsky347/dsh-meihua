import { useEffect, useRef, useState } from 'react';
import { MEMORY_LIMIT, type MemorySource, type MemoryUsage } from '../shared/memory.ts';
import type { MemoryPageState } from './memory-controller.ts';

export interface BackgroundOptions {useBackground:boolean;forOthers:boolean}
export interface MemoryActions {
  onClose:()=>void;
  onRefresh:()=>Promise<void>;
  onInitialize:(passphrase:string)=>Promise<boolean>;
  onUnlock:(passphrase:string)=>Promise<boolean>;
  onLock:()=>Promise<boolean>;
  onSave:(content:string,expectedRevision:number)=>Promise<boolean>;
  onRollback:(versionId:string,expectedRevision:number)=>Promise<boolean>;
  onClear:()=>Promise<boolean>;
  onChangePassphrase:(oldPassphrase:string,newPassphrase:string)=>Promise<boolean>;
}
const sourceLabel:Record<MemorySource,string>={manual:'手动编辑',rollback:'撤回恢复',meihua:'梅花易数',tarot:'塔罗牌',xiaoliu:'小六壬',lenormand:'雷诺曼',liuyao:'六爻纳甲',initial:'初始文档'};
const defaultPlaceholder='## 个人信息\n生日、出生时间与地点（如不详，请直接写不详）\n\n## 近期处境与目标\n\n## 偏好与约束\n\n## 持续关注的问题';
const displayTime=(value:string)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未保存';

/** Context is opt-out per reading, and the frozen choice remains visible through follow-ups. */
export function BackgroundControls({state,options,onChange,onOpen,disabled=false,usage}:{state:MemoryPageState;options:BackgroundOptions;onChange:(patch:Partial<BackgroundOptions>)=>void;onOpen:()=>void;disabled?:boolean;usage?:MemoryUsage}) {
  return <div className="wm-reading-controls">
    {usage?<p className="wm-caption">{usage.forOthers?'替他人占卜 · 本人背景与自动记忆已停用':usage.enabled?`已冻结共享背景 v${usage.revision} · 本次追问沿用此版本`:'本次未引用共享背景 · 追问沿用此选择'}</p>:<>
      <label><input type="checkbox" checked={options.useBackground&&!options.forOthers} disabled={disabled||options.forOthers} onChange={event=>onChange({useBackground:event.target.checked})}/>本次使用共享背景</label>
      <label><input type="checkbox" checked={options.forOthers} disabled={disabled} onChange={event=>onChange({forOthers:event.target.checked})}/>替他人占卜（不引用、不写入本人记忆）</label>
      {state.status?.updating&&<p className="wm-caption" role="status">背景正在更新，解读会等待更新结束。</p>}
      {!state.status?.unlocked&&<p className="wm-caption">本地起卦和抽牌可继续，AI 解读前请<button type="button" className="wm-text-button" onClick={onOpen}>{state.status?.initialized?'解锁共享背景':'设置独立口令'}</button>。</p>}
    </>}
  </div>;
}

export function MemoryPanel({state,...actions}:MemoryActions&{state:MemoryPageState}) {
  const panel=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
  const [passphrase,setPassphrase]=useState(''),[confirmation,setConfirmation]=useState('');
  const [content,setContent]=useState(state.document?.content??''),[baseRevision,setBaseRevision]=useState(state.document?.revision??0),[dirty,setDirty]=useState(false);
  const [selectedVersion,setSelectedVersion]=useState<string|null>(null),[confirmClear,setConfirmClear]=useState(false);
  const [oldPassphrase,setOldPassphrase]=useState(''),[newPassphrase,setNewPassphrase]=useState(''),[newConfirmation,setNewConfirmation]=useState('');
  const [localError,setLocalError]=useState('');
  const document=state.document,status=state.status;
  useEffect(()=>{
    const previous=window.document.activeElement as HTMLElement|null;
    close.current?.focus({preventScroll:true});
    return ()=>previous?.focus({preventScroll:true});
  },[]);
  useEffect(()=>{if(document&&!dirty){setContent(document.content);setBaseRevision(document.revision);}},[document?.revision,dirty]);
  const keyDown=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();actions.onClose();}
    if(event.key==='Tab'){
      const elements=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[href],[tabindex="0"]')??[]).filter(element=>!element.closest('[hidden]'));
      const first=elements[0],last=elements.at(-1);
      if(event.shiftKey&&window.document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&window.document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };
  const authorize=async(event:React.FormEvent)=>{
    event.preventDefault();setLocalError('');
    if(!status?.initialized&&passphrase!==confirmation){setLocalError('两次输入的口令不一致。');return;}
    const ok=await (status?.initialized?actions.onUnlock(passphrase):actions.onInitialize(passphrase));
    setPassphrase('');setConfirmation('');if(ok)setDirty(false);
  };
  const save=async()=>{setLocalError('');if(await actions.onSave(content,baseRevision))setDirty(false);};
  const changePassphrase=async(event:React.FormEvent)=>{
    event.preventDefault();setLocalError('');
    if(newPassphrase!==newConfirmation){setLocalError('两次输入的新口令不一致。');return;}
    await actions.onChangePassphrase(oldPassphrase,newPassphrase);
    setOldPassphrase('');setNewPassphrase('');setNewConfirmation('');
  };
  const selected=state.versions.find(version=>version.id===selectedVersion);
  const changedOutside=dirty&&document?.revision!==baseRevision;
  return <div className="wm-backdrop wx-panel-backdrop" onClick={event=>{if(event.target===event.currentTarget)actions.onClose();}}>
    <div ref={panel} className="wm-panel" role="dialog" aria-modal="true" aria-labelledby="wm-title" onKeyDown={keyDown}>
      <header className="wm-header"><div><p className="wm-eyebrow">问象 · 私人资料</p><h2 id="wm-title">共享背景</h2></div><button ref={close} className="wm-close" aria-label="关闭共享背景" onClick={actions.onClose}>×</button></header>
      <p className="wm-description">同一份背景供各占卜模块参考。结束问询时，新增的用户信息会自动提炼；解读与追问使用开始时的背景版本。</p>
      {state.loading&&!status?<p role="status">正在读取加密存储状态…</p>:!status?.unlocked?<form className="wm-auth" onSubmit={event=>void authorize(event)}>
        <h3>{status?.initialized?'解锁背景':'设置独立口令'}</h3><p className="wm-caption">{status?.initialized?'本地文件使用口令加密，解锁后可在当前启动期间共同使用。':'口令用于本地加密保存背景与新版问询记录。忘记口令无法恢复这些资料。'}</p>
        <label>{status?.initialized?'口令':'新口令'}<input type="password" autoComplete={status?.initialized?'current-password':'new-password'} value={passphrase} onChange={event=>setPassphrase(event.target.value)} minLength={8} maxLength={256} required disabled={state.acting}/></label>
        {!status?.initialized&&<label>再次输入口令<input type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} minLength={8} maxLength={256} required disabled={state.acting}/></label>}
        <button className="wm-button" type="submit" disabled={state.acting||!status}>{state.acting?'正在处理…':status?.initialized?'解锁':'启用共享背景'}</button>
      </form>:<>
        <div className="wm-status"><span>已解锁 · 当前 v{document?.revision??status.revision}</span><button className="wm-text-button" disabled={state.acting} onClick={()=>void actions.onLock()}>立即锁定</button></div>
        <label className="wm-document-label" htmlFor="wm-document">背景记忆文档</label><textarea id="wm-document" className="wm-document" value={content} onChange={event=>{setContent(event.target.value);setDirty(true);}} maxLength={MEMORY_LIMIT} rows={12} placeholder={defaultPlaceholder} disabled={state.acting}/>
        <div className="wm-document-meta"><span>{MEMORY_LIMIT-content.length} 字符可用</span><span>{dirty?'有未保存修改':document?`${sourceLabel[document.source]} · ${displayTime(document.updatedAt)}`:'正在读取文档…'}</span></div>
        <p className="wm-caption">手动新增或修改的段落会固定保留。自动提炼只处理新增用户消息，生日和出生信息按你输入的原文保存；不从解读结果推算个人事实。</p>
        {!!document?.fixedParagraphs.length&&<details className="wm-fixed"><summary>固定内容 · {document.fixedParagraphs.length} 段</summary>{document.fixedParagraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</details>}
        {changedOutside&&<p className="wm-error" role="alert">背景已有新版本，你的草稿仍保留。请先查看新内容再合并，当前保存会受到版本检查保护。<button className="wm-text-button" onClick={()=>{setContent(document!.content);setBaseRevision(document!.revision);setDirty(false);}}>载入最新内容并放弃此草稿</button></p>}
        <div className="wm-actions"><button className="wm-button" onClick={()=>void save()} disabled={state.acting||!document||!dirty||changedOutside}>保存背景</button><button className="wm-text-button" onClick={()=>void actions.onRefresh()} disabled={state.acting}>刷新状态</button></div>
        <p className="wm-update" role="status">{status.updating?'正在提炼新增问询…':status.pending?'有尚未更新的问询，请在所属模块结束本轮并更新背景。':'新问询会在结束本轮、离开模块或另起一轮时自动提炼。'}</p>
        <details className="wm-history"><summary>版本与变化 · 最近 {state.versions.length} / 20 个版本</summary><div className="wm-version-list">{state.versions.length===0?<p className="wm-caption">暂时没有历史版本。</p>:state.versions.map(version=><button key={version.id} className="wm-version" aria-pressed={selectedVersion===version.id} onClick={()=>setSelectedVersion(version.id)}><b>v{version.revision} · {sourceLabel[version.source]}</b><span>{displayTime(version.updatedAt)}</span></button>)}</div>
          {selected&&<div className="wm-version-detail"><h4>v{selected.revision} 的变化</h4><div className="wm-diff"><div><p>更新前</p><pre>{selected.changes.before||'（空文档）'}</pre></div><div><p>更新后</p><pre>{selected.changes.after||'（空文档）'}</pre></div></div><button className="wm-button wm-secondary" disabled={state.acting||selected.revision===document?.revision||dirty||!document} onClick={()=>void actions.onRollback(selected.id,document!.revision)}>恢复这个版本</button><p className="wm-caption">恢复会生成新版本，已处理的消息不会再次自动写入。</p></div>}
        </details>
        <details className="wm-password"><summary>更改口令</summary><form onSubmit={event=>void changePassphrase(event)}><label>当前口令<input type="password" autoComplete="current-password" required value={oldPassphrase} onChange={event=>setOldPassphrase(event.target.value)} disabled={state.acting}/></label><label>新口令<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={newPassphrase} onChange={event=>setNewPassphrase(event.target.value)} disabled={state.acting}/></label><label>再次输入新口令<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={newConfirmation} onChange={event=>setNewConfirmation(event.target.value)} disabled={state.acting}/></label><button className="wm-button wm-secondary" disabled={state.acting}>更改口令</button></form></details>
        <div className="wm-danger"><button className="wm-text-button" disabled={state.acting} onClick={()=>setConfirmClear(!confirmClear)}>清空全部私人资料</button>{confirmClear&&<div role="alert"><p>将删除共享背景、所有版本、关联的新版加密问询记录，并清理两种占卜的当前会话。此操作不能撤回；旧版普通日志不在本次清理范围。</p><div className="wm-actions"><button className="wm-button wm-danger-button" disabled={state.acting} onClick={async()=>{if(await actions.onClear()){setDirty(false);setConfirmClear(false);setSelectedVersion(null);}}}>确认清空全部私人资料</button><button className="wm-text-button" onClick={()=>setConfirmClear(false)}>保留资料</button></div></div>}</div>
      </>}
      {(localError||state.error||status?.error)&&<p className="wm-error" role="alert">{localError||state.error||status?.error?.message}</p>}
      {state.notice&&<p className="wm-notice" role="status">{state.notice}</p>}
      <footer className="wm-footer">本地保存内容经过加密。解读及自动提炼会将相关明文发送给当前所选模型供应商；已有旧版普通日志不会自动迁移或删除。</footer>
    </div>
  </div>;
}
