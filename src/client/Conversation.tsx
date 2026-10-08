import {ReadingText} from './ReadingText.tsx';
import {GenerationStatus,ResumeReading} from './GenerationStatus.tsx';
import { useEffect, useRef, useState } from 'react';
import type { ConversationTurn } from '../shared/protocol.ts';
import type { LocaleKey, Translate } from './locales.ts';

function statusKey(status:ConversationTurn['status']):LocaleKey {
  return status==='streaming'?'followupStreaming':status==='complete'?'followupComplete':status==='cancelled'?'followupCancelled':'followupFailed';
}

/** A copy is a complete transcript, including partial answers and their terminal state. */
export function formatConversationCopy(turns:readonly ConversationTurn[]|undefined,t:Translate):string {
  if(!turns?.length)return '';
  return `\n\n${t('conversation')}\n${turns.map((turn,index)=>`\n${index+1}. ${t('followupQuestion')}：${turn.question}\n${t('followupAnswer')} · ${t(statusKey(turn.status))}\n${turn.text}${turn.error?`\n${turn.error.message}`:''}`).join('\n')}`;
}

interface ConversationProps {
  readingId:string;
  turns:readonly ConversationTurn[];
  busy:boolean;
  pending:boolean;
  draft?:string;
  theme:string;
  t:Translate;
  onDraftChange?:(question:string)=>void;
  onSend:(question:string)=>Promise<boolean|void>;
  onResume?:(turnId:string)=>Promise<boolean|void>;
  onCancel:()=>Promise<void>;
}

/** Provider text is rendered through React text nodes; HTML is never interpreted. */
export function Conversation({readingId,turns,busy,pending,draft='',theme,t,onDraftChange,onSend,onCancel,onResume}:ConversationProps) {
  const [question,setQuestion]=useState(draft),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
  const current=useRef({readingId,question}),mounted=useRef(true);
  const inFlight=useRef(false);
  current.current={readingId,question};
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const updateDraft=(value:string)=>{setQuestion(value);onDraftChange?.(value);};
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(busy||pending||inFlight.current||!question.trim())return;
    const sent=question,id=readingId;
    inFlight.current=true;setSubmitting(true);setError('');
    try {
      const accepted=await onSend(sent.trim());
      if(!mounted.current||current.current.readingId!==id)return;
      if(accepted!==false){
        if(current.current.question===sent)updateDraft('');
      } else setError(t('followupSubmitFailed'));
    } catch(failure) {
      if(mounted.current&&current.current.readingId===id)setError(failure instanceof Error?failure.message:t('followupSubmitFailed'));
    } finally {inFlight.current=false;if(mounted.current&&current.current.readingId===id)setSubmitting(false);}
  };
  return <section className={`wx-conversation wx-conversation-${theme}`} aria-labelledby={`${theme}-conversation-title`}>
    <div className={`${theme}-section-heading`}><h3 id={`${theme}-conversation-title`}>{t('conversation')}</h3></div>
    <p className={`${theme}-hint`}>{t('conversationHint')}</p>
    <ol className="wx-conversation-turns" aria-label={t('conversation')}>
      {turns.map((turn,index)=><li key={turn.id} className="wx-conversation-turn" data-status={turn.status}>
        <div className="wx-conversation-question"><p className="wx-conversation-label">{String(index+1).padStart(2,'0')} · {t('followupQuestion')}</p><p>{turn.question}</p></div>
        <div className="wx-conversation-answer"><div className="wx-conversation-answer-heading"><p className="wx-conversation-label">{t('followupAnswer')}</p><span className={`${theme}-status ${theme}-status-${turn.status}`} role="status">{t(statusKey(turn.status))}</span></div>
          <GenerationStatus generation={turn.generation} busy={turn.status==='streaming'}/>{turn.text?<ReadingText className="wx-conversation-text" text={turn.text}/>:<p className={`${theme}-hint`}>{t('followupPending')}</p>}
          <span data-reading-end/><ResumeReading status={turn.status} text={turn.text} busy={busy||pending} onResume={index===turns.length-1&&onResume?()=>onResume(turn.id):undefined}/>
          {turn.error&&<p className={`${theme}-notice`} role="alert">{turn.error.message}</p>}
          {turn.status==='streaming'&&<div className={`${theme}-actions`}><button className={`${theme}-link`} type="button" onClick={()=>void onCancel()}>{t('cancelFollowup')}</button></div>}
        </div>
      </li>)}
    </ol>
    <form className="wx-conversation-form" onSubmit={event=>void submit(event)}>
      <label className={`${theme}-label`} htmlFor={`${theme}-followup-question`}>{t('followupQuestion')}</label>
      <textarea id={`${theme}-followup-question`} value={question} onChange={event=>updateDraft(event.target.value)} maxLength={2000} rows={3} placeholder={t('followupPlaceholder')} disabled={submitting||pending} aria-describedby={`${theme}-followup-hint`}/>
      <div className="wx-conversation-send"><p className={`${theme}-hint`} id={`${theme}-followup-hint`}>{busy?t('followupLocked'):`${question.length} / 2000`}</p><button className={`${theme}-button`} type="submit" disabled={busy||pending||submitting||!question.trim()}>{submitting||pending?t('sendingFollowup'):t('sendFollowup')} <span aria-hidden="true">↗</span></button></div>
      {error&&<p className={`${theme}-notice`} role="alert">{error}</p>}
    </form>
  </section>;
}
