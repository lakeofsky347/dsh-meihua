import type {ReadingNavigation} from './reading-navigation.tsx';
import type { ClientRpc, ModelRoute, TarotCatalog, TarotReading } from '../shared/protocol.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import type { TarotStartInput, TarotSpreadId } from '../tarot/types.ts';
import type { BackgroundOptions } from './MemoryPanel.tsx';

export interface TarotDraft {
  question:string;
  spreadId:TarotSpreadId;
  includeReversed:boolean;
  route:ModelRoute;
  followupQuestion?:string;
  useBackground?:boolean;
  forOthers?:boolean;
}
export interface TarotPageState {
  navigation?:ReadingNavigation;
  catalog:TarotCatalog | null;
  reading:TarotReading | null;
  loading:boolean;
  acting:boolean;
  shuffling:boolean;
  error:string;
  draft:TarotDraft;
}

/** One observable per plugin registration; changing the visible page never resets a reading. */
export class TarotController {
  private state:TarotPageState = {
    catalog:null,reading:null,loading:true,acting:false,shuffling:false,error:'',
    draft:{question:'',spreadId:'single',includeReversed:true,route:{provider:'',model:''},useBackground:true,forOthers:false},
  };
  private listeners = new Set<()=>void>();
  private abort = new AbortController();
  private disposed = false;
  private active = false;
  private shuffleRemaining = 0;
  private shuffleResumedAt = 0;
  private shuffleTimer:ReturnType<typeof setTimeout> | undefined;
  private pollFlight:{signal:AbortSignal;revision:number;promise:Promise<void>}|undefined;
  private pendingGenerationRevision:number|undefined;
  private revision = 0;
  private snapshotRequest = 0;
  private preferencesRequest = 0;
  constructor(private readonly rpc:ClientRpc,private readonly getMemoryEpoch?:()=>number|undefined) {}
  getSnapshot = ():TarotPageState => this.state;
  subscribe = (listener:()=>void):(()=>void) => { this.listeners.add(listener);return ()=>{this.listeners.delete(listener);}; };
  private update(patch:Partial<TarotPageState>):void {
    if(this.disposed)return;
    this.state={...this.state,...patch};
    for(const listener of this.listeners)listener();
  }
  private async call<T>(endpoint:string,payload:unknown={},signal=this.abort.signal):Promise<T> {
    if(this.getMemoryEpoch&&endpoint!=='catalog'&&endpoint!=='current'){
      const epoch=this.getMemoryEpoch();if(epoch===undefined)throw new Error('正在读取共享背景状态，请稍后重试。');
      payload={...(payload as object),epoch};
    }
    const response=await this.rpc.call('/api',`tarot/${endpoint}`,payload,signal);
    if(!response.ok)throw new Error(response.error.message);
    return response.value as T;
  }
  updateDraft = (patch:Partial<TarotDraft>):void => {
    const previous=this.state.draft,draft={...previous,...patch};
    const changed=(patch.useBackground!==undefined&&patch.useBackground!==previous.useBackground)||(patch.forOthers!==undefined&&patch.forOthers!==previous.forOthers);
    this.update({draft,...(changed?{error:''}:{})});
    const reading=this.state.reading;
    if(changed&&reading&&!reading.memory){
      const request=++this.preferencesRequest;
      void this.call('preferences',{id:reading.id,options:{useBackground:draft.useBackground!==false,forOthers:!!draft.forOthers}}).catch(error=>{
        if(request===this.preferencesRequest&&this.state.reading?.id===reading.id&&!this.state.reading.memory)this.update({error:message(error)});
      });
    }
  };
  async load():Promise<void> {
    const revision=this.revision;
    const snapshotRequest=++this.snapshotRequest;
    try {
      const [catalog,reading]=await Promise.all([this.call<TarotCatalog>('catalog'),this.call<TarotReading|null>('current')]);
      if(revision!==this.revision||snapshotRequest!==this.snapshotRequest)return;
      const route=this.state.draft.route;
      const valid=catalog.providers.some(p=>p.id===route.provider && p.models.some(m=>m.id===route.model));
      const first=catalog.providers.find(p=>p.models.length>0);
      const restored=this.state.catalog===null && reading?{question:reading.question,spreadId:reading.spread.id,includeReversed:reading.includeReversed}:{};
      const changed=reading?.id!==this.state.reading?.id;
      const background=reading&&(this.state.catalog===null||changed)?{useBackground:reading.backgroundOptions?.useBackground!==false,forOthers:!!reading.backgroundOptions?.forOthers}:{};
      if(changed){clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;this.shuffleRemaining=0;}
      this.update({catalog,reading,loading:false,error:'',...(changed?{shuffling:false}:{}),draft:{...this.state.draft,...restored,...background,...(changed?{followupQuestion:''}:{}),route:valid?route:{provider:first?.id??'',model:first?.models[0]?.id??''}}});
      if(readingIsBusy(reading))void this.poll();
    } catch(error) { if(revision===this.revision&&snapshotRequest===this.snapshotRequest)this.update({loading:false,error:message(error)}); }
  }
  /** Pause the ritual clock while its page is hidden; no background animation timers. */
  setActive = (active:boolean):void => {
    if(this.disposed || active===this.active)return;
    this.active=active;
    if(!active){
      if(this.shuffleTimer)this.shuffleRemaining=Math.max(0,this.shuffleRemaining-(Date.now()-this.shuffleResumedAt));
      clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;
    } else this.resumeShuffle();
  };
  private resumeShuffle():void {
    if(!this.active || !this.state.shuffling || this.disposed)return;
    clearTimeout(this.shuffleTimer);
    if(this.shuffleRemaining<=0){this.skipShuffle();return;}
    this.shuffleResumedAt=Date.now();
    this.shuffleTimer=setTimeout(this.skipShuffle,this.shuffleRemaining);
  }
  skipShuffle = ():void => { clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;this.shuffleRemaining=0;this.update({shuffling:false}); };
  async start(input:TarotStartInput):Promise<void> {
    if(this.state.acting || readingIsBusy(this.state.reading))return;
    const revision=++this.revision;
    this.update({acting:true,error:''});
    try {
      const reading=await this.call<TarotReading>('start',{...input,options:{useBackground:this.state.draft.useBackground!==false,forOthers:!!this.state.draft.forOthers},route:this.state.draft.route});
      if(revision!==this.revision)return;
      ++this.snapshotRequest;
      clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;
      const reduced=typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.shuffleRemaining=reduced?0:2400;
      this.update({reading,acting:false,navigation:{sequence:(this.state.navigation?.sequence??0)+1,target:'result'},shuffling:!reduced,draft:{...this.state.draft,followupQuestion:''}});this.resumeShuffle();
    } catch(error) { if(revision===this.revision)this.update({acting:false,error:message(error)}); }
  }
  async select(slot:number):Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='selecting' || this.state.acting || this.state.shuffling)return;
    const revision=++this.revision;
    this.update({acting:true,error:''});
    try { const next=await this.call<TarotReading>('select',{id:reading.id,slot});if(revision===this.revision)this.update({reading:next,acting:false}); }
    catch(error) { if(revision===this.revision)this.update({acting:false,error:message(error)}); }
  }
  async reveal(position?:number,all=false):Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='revealing' || this.state.acting)return;
    const revision=++this.revision;
    this.update({acting:true,error:''});
    try { const next=await this.call<TarotReading>('reveal',{id:reading.id,...(position===undefined?{}:{position}),all});if(revision===this.revision)this.update({reading:next,acting:false,navigation:{sequence:(this.state.navigation?.sequence??0)+1,target:'result'}}); }
    catch(error) { if(revision===this.revision)this.update({acting:false,error:message(error)}); }
  }
  async interpret(route:ModelRoute,options?:BackgroundOptions):Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='ready' || readingIsBusy(reading) || this.state.acting)return;
    const revision=++this.revision;
    this.pendingGenerationRevision=revision;
    this.update({acting:true,error:''});void this.poll();
    try {
      const next=await this.call<TarotReading>('interpret',{id:reading.id,...route,options:options??{useBackground:this.state.draft.useBackground!==false,forOthers:!!this.state.draft.forOthers}});
      if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;
      if(revision!==this.revision||this.state.reading?.id!==reading.id)return;
      ++this.snapshotRequest;
      this.update({reading:next,acting:false,navigation:{sequence:(this.state.navigation?.sequence??0)+1,target:'interpretation'}});
      await this.poll();
    } catch(error) { if(revision===this.revision)this.update({acting:false,error:message(error)}); }
    finally{if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;}
  }
  async followup(question:string):Promise<boolean> {
    const reading=this.state.reading,trimmed=question.trim();
    if(!reading||!['complete','failed','cancelled'].includes(reading.status)||!reading.text.trim()||!trimmed||trimmed.length>2000||this.state.acting||this.state.shuffling||readingIsBusy(reading))return false;
    const revision=++this.revision,expectedTurnCount=reading.conversation?.length??0;
    this.pendingGenerationRevision=revision;
    this.update({acting:true,error:''});void this.poll();
    try {
      const next=await this.call<TarotReading>('followup',{id:reading.id,question:trimmed,expectedTurnCount});
      if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;
      if(revision!==this.revision||this.state.reading?.id!==reading.id)return false;
      ++this.snapshotRequest;
      this.update({reading:next,acting:false,navigation:{sequence:(this.state.navigation?.sequence??0)+1,target:'latest'}});
      if(readingIsBusy(next))void this.poll();
      return (next.conversation?.length??0)>expectedTurnCount;
    } catch(error) {if(revision===this.revision)this.update({error:message(error)});return false;}
    finally {if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;if(revision===this.revision)this.update({acting:false});}
  }
  private needsPoll():boolean {return this.pendingGenerationRevision===this.revision||readingIsBusy(this.state.reading);}
  private poll():Promise<void> {
    const signal=this.abort.signal;
    if(this.pollFlight?.signal===signal&&this.pollFlight.revision===this.revision)return this.pollFlight.promise;
    const flight={signal,revision:this.revision,promise:Promise.resolve()};this.pollFlight=flight;
    flight.promise=(async()=>{try {
      while(!this.disposed&&!signal.aborted&&flight.revision===this.revision&&this.needsPoll()){
        const revision=this.revision;
        await new Promise<void>(resolve=>{
          const timer=setTimeout(finish,this.state.catalog?.config.pollIntervalMs??250);
          function finish(){clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();}
          signal.addEventListener('abort',finish,{once:true});
          if(signal.aborted)finish();
        });
        if(this.disposed||signal.aborted||!this.needsPoll())break;
        if(revision!==this.revision)break;
        const id=this.state.reading?.id;if(!id)break;
        const snapshotRequest=++this.snapshotRequest;
        try {
          const reading=await this.call<TarotReading|null>('current',{},signal);
          if(!signal.aborted&&revision===this.revision&&snapshotRequest===this.snapshotRequest&&id===this.state.reading?.id)this.update({reading});
        } catch(error) {
          if(!signal.aborted&&revision===this.revision&&snapshotRequest===this.snapshotRequest&&id===this.state.reading?.id){this.update({error:message(error)});break;}
        }
      }
    }finally{if(this.pollFlight===flight)this.pollFlight=undefined;}})();
    return flight.promise;
  }
  async resume(turnId?:string):Promise<boolean> {
    const reading=this.state.reading;
    if(!reading||readingIsBusy(reading)||this.state.acting||this.state.shuffling)return false;
    const turn=turnId?reading.conversation?.at(-1):undefined;
    if(turnId? !turn||turn.id!==turnId||!['failed','cancelled'].includes(turn.status):!!reading.conversation?.length||!['failed','cancelled'].includes(reading.status))return false;
    const revision=++this.revision;this.pendingGenerationRevision=revision;this.update({acting:true,error:''});void this.poll();
    try {
      const next=await this.call<TarotReading>('resume',{id:reading.id,expectedTurnCount:reading.conversation?.length??0,expectedAttempt:(turnId?reading.conversation?.find(turn=>turn.id===turnId)?.generation:reading.generation)?.attempt??0,...(turnId?{turnId}:{})});
      if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;
      if(revision!==this.revision||this.state.reading?.id!==reading.id)return false;
      ++this.snapshotRequest;this.update({reading:next,acting:false,navigation:{sequence:(this.state.navigation?.sequence??0)+1,target:turnId?'latest':'interpretation'}});
      if(readingIsBusy(next))void this.poll();return true;
    }catch(error){if(revision===this.revision)this.update({error:message(error)});return false;}
    finally{if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;if(revision===this.revision)this.update({acting:false});}
  }
  async cancel():Promise<void> {
    const reading=this.state.reading;
    if(!reading || !readingIsBusy(reading))return;
    const turn=reading.status==='streaming'?undefined:reading.conversation?.find(value=>value.status==='streaming');
    const payload=reading.preflight?{id:reading.id,preflightId:reading.preflight.id}:{id:reading.id,expectedAttempt:(turn?turn.generation:reading.generation)?.attempt??0,...(turn?{turnId:turn.id}:{})};
    const revision=++this.revision;
    try {
      const next=await this.call<TarotReading>('cancel',payload);
      if(revision===this.revision&&this.state.reading?.id===reading.id){++this.snapshotRequest;this.update({reading:next,acting:false,error:''});if(readingIsBusy(next))void this.poll();}
    }
    catch(error) { if(revision===this.revision)this.update({error:message(error)}); }
  }
  async checkpoint(retry=false):Promise<void> {
    const reading=this.state.reading;
    if(!reading||readingIsBusy(reading))return;
    try{await this.call('checkpoint',{id:reading.id,options:{useBackground:this.state.draft.useBackground!==false,forOthers:!!this.state.draft.forOthers},route:reading.route??this.state.draft.route,...(retry?{retry:true}:{})});}
    catch(error){this.update({error:message(error)});}
  }
  resetPrivate=():void=>{
    ++this.revision;++this.snapshotRequest;++this.preferencesRequest;this.pendingGenerationRevision=undefined;this.abort.abort();this.abort=new AbortController();clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;this.shuffleRemaining=0;
    this.update({reading:null,acting:false,shuffling:false,error:'',draft:{question:'',spreadId:'single',includeReversed:true,route:this.state.draft.route,useBackground:true,forOthers:false,followupQuestion:''}});
  };
  dispose():void {
    this.disposed=true;this.abort.abort();clearTimeout(this.shuffleTimer);this.listeners.clear();
  }
}
function message(error:unknown):string {return error instanceof Error?error.message:'操作未完成';}
