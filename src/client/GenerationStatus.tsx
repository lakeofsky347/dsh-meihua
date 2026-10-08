import {useEffect,useState} from 'react';

import type {GenerationInfo} from '../shared/protocol.ts';

/** Capability checks can be cancelled before any text or follow-up is created. */
export function PreflightStatus({active,onCancel}:{active:boolean;onCancel:()=>Promise<void>}) {
  const [pending,setPending]=useState(false);
  if(!active)return null;
  return <div className="wx-preflight"><p role="status">正在检查模型能力 · 尚未开始生成</p><button type="button" disabled={pending} onClick={async()=>{setPending(true);try{await onCancel();}finally{setPending(false);}}}>{pending?'正在取消':'取消能力检查'}</button></div>;
}

/** Show model capability and progress without exposing private reasoning content. */
export function GenerationStatus({generation,busy}:{generation?:GenerationInfo;busy:boolean}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!busy||!generation)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[busy,generation?.startedAt]);
  if(!generation)return null;
  const phase={preparing:'正在准备解读',thinking:'正在深入思考',responding:'正在输出解读',finished:'本次生成已结束'}[generation.phase];
  const elapsed=Math.max(0,Math.floor((busy?now-generation.startedAt:generation.elapsedMs??0)/1000));
  const reasoning=generation.reasoningStatus==='maximum'?`已启用最高思考档位${generation.reasoningLabel?` · ${generation.reasoningLabel}`:''}`:generation.reasoningStatus==='unavailable'?'当前模型未提供可设置的思考档位':'最高思考档位未知 · 沿用宿主默认';
  const budget={ 'model-maximum':'按模型最大能力分配输出预算','host-default':'沿用宿主默认输出预算',fallback:'使用配置的输出预算'}[generation.budgetSource];
  return <div className="wx-generation"><p role="status">{phase}{elapsed?` · ${elapsed} 秒`:''}</p><p>{reasoning}</p><p>{budget}{generation.maxTokens?` · ${generation.maxTokens.toLocaleString()} tokens`:''}{generation.outputTokenAccounting==='includes-reasoning'?'（包含思考消耗）':generation.outputTokenAccounting==='excludes-reasoning'?'（不含思考消耗）':' · 思考计量方式未知'}</p>{generation.contextCharacters!==undefined&&generation.contextLimitCharacters!==undefined&&<p>上下文字符数 {generation.contextCharacters.toLocaleString()} / 保护参考上限 {generation.contextLimitCharacters.toLocaleString()}（已知容量按保守估算）</p>}</div>;
}

/** A retry always requires an explicit click and retains the existing result. */
export function ResumeReading({status,text,busy,onResume}:{status:string;text:string;busy:boolean;onResume?:()=>Promise<boolean|void>}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  if(!onResume||!['failed','cancelled'].includes(status))return null;
  return <div className="wx-resume"><button type="button" disabled={busy||pending} onClick={async()=>{setPending(true);setError('');try{await onResume();}catch(failure){setError(failure instanceof Error?failure.message:'恢复请求未完成，请稍后重试。');}finally{setPending(false);}}}>{pending?'正在提交':text.trim()?'继续完成':'重试本轮'}</button><span>{text.trim()?'沿用本次结果，保留已收到的内容。':'沿用本次结果与模型重新请求。'}</span>{error&&<p role="alert">{error}</p>}</div>;
}
