import {randomUUID} from 'node:crypto';
import type {GenerationGate} from './generation-gate.ts';

interface PendingPreflight {
  id:string;
  readingId:string;
  controller:AbortController;
  finished:Promise<void>;
}
const changed=()=>Object.assign(new Error('预检请求已变化，请刷新后再取消'),{code:'CONVERSATION_CHANGED'});
const cancelled=(message:string)=>Object.assign(new Error(message),{code:'CANCELLED'});

/** A cancellable admission check; no conversation or attempt is created before acceptance. */
export class GenerationPreflight {
  private current?:PendingPreflight;
  constructor(private readonly timeoutMs:number,private readonly gate?:GenerationGate){}
  snapshot(readingId:string):{id:string}|undefined {
    return this.current?.readingId===readingId?{id:this.current.id}:undefined;
  }
  assertIdle():void {
    if(this.current)throw Object.assign(new Error('模型能力预检正在进行，请等待或先取消'),{code:'GENERATION_BUSY'});
  }
  /** Exact ids prevent an old window from cancelling a newer admission check. */
  cancel(readingId:string,id:unknown):boolean {
    if(this.current?.readingId===readingId){
      if(id!==this.current.id)throw changed();
      this.current.controller.abort(cancelled('已取消模型能力预检'));return true;
    }
    if(id!==undefined)throw changed();
    return false;
  }
  abort(message:string):void {this.current?.controller.abort(cancelled(message));}
  async dispose():Promise<void> {
    const pending=this.current;this.abort('插件已停止');await pending?.finished;
  }
  /** Race providers that ignore AbortSignal; transfer the same generation slot only after validation. */
  async run<T>(readingId:string,check:(signal:AbortSignal)=>Promise<void>,commit:(controller:AbortController,release:()=>void)=>T):Promise<T> {
    this.assertIdle();
    const id=`preflight-${randomUUID()}`,release=this.gate?.acquire(id)??(()=>{}),controller=new AbortController();
    let finish!:()=>void;
    const pending:PendingPreflight={id,readingId,controller,finished:new Promise<void>(resolve=>{finish=resolve;})};
    this.current=pending;
    let onAbort!:()=>void,transferred=false;
    const aborted=new Promise<never>((_resolve,reject)=>{
      onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('模型能力预检超时，本次尚未发送；请保留草稿后重试'),{code:'TIMEOUT'})),this.timeoutMs);
    try {
      await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return check(controller.signal);}),aborted]);
      controller.signal.throwIfAborted();
      this.current=undefined;
      const result=commit(controller,release);transferred=true;return result;
    }finally{
      clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);
      if(this.current===pending)this.current=undefined;
      if(!transferred)release();finish();
    }
  }
}
