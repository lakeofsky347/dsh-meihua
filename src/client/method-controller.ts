import type {ReadingNavigation} from './reading-navigation.tsx';
import type {ClientRpc,ModelRoute} from '../shared/protocol.ts';
import {readingIsBusy} from '../shared/protocol.ts';
import type {NewMethodId} from '../shared/modules.ts';
import type {MethodCatalog,MethodReading} from '../shared/methods.ts';
export interface MethodDraft {question:string;wallTime:string;spreadId:string;route:ModelRoute;useBackground:boolean;forOthers:boolean;followupQuestion:string}
export interface MethodPageState {navigation?:ReadingNavigation;catalog:MethodCatalog|null;reading:MethodReading|null;loading:boolean;acting:boolean;error:string;draft:MethodDraft}
export class MethodController {
  private state:MethodPageState={catalog:null,reading:null,loading:true,acting:false,error:'',draft:{question:'',wallTime:'',spreadId:'line-3',route:{provider:'',model:''},useBackground:true,forOthers:false,followupQuestion:''}};
  private readonly listeners=new Set<()=>void>();
  private abort=new AbortController();private disposed=false;private revision=0;private snapshotRequest=0;private preferenceRequest=0;
  private pendingGenerationRevision:number|undefined;
  private pollFlight:{signal:AbortSignal;revision:number;promise:Promise<void>}|undefined;
  constructor(readonly moduleId:NewMethodId,private readonly rpc:ClientRpc,private readonly epoch:()=>number|undefined){}
  getSnapshot=():MethodPageState=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<MethodPageState>):void{if(this.disposed)return;this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  private async call<T>(endpoint:string,payload:object={},signal=this.abort.signal):Promise<T>{
    if(!['catalog','current'].includes(endpoint)){const epoch=this.epoch();if(epoch===undefined)throw new Error('正在读取背景状态，请稍后重试');payload={...payload,epoch};}
    const response=await this.rpc.call('/api',`${this.moduleId}/${endpoint}`,payload,signal);if(!response.ok)throw new Error(response.error.message);return response.value as T;
  }
  updateDraft=(patch:Partial<MethodDraft>):void=>{
    const before=this.state.draft,draft={...before,...patch};this.update({draft});
    const reading=this.state.reading;
    if(reading&&!reading.memory&&(draft.useBackground!==before.useBackground||draft.forOthers!==before.forOthers||draft.route.provider!==before.route.provider||draft.route.model!==before.route.model)){
      const request=++this.preferenceRequest;
      void this.call('preferences',{id:reading.id,route:draft.route,options:{useBackground:draft.useBackground,forOthers:draft.forOthers}}).catch(error=>{if(request===this.preferenceRequest&&this.state.reading?.id===reading.id)this.update({error:message(error)});});
    }
  };
  async load():Promise<void>{
    const revision=this.revision,request=++this.snapshotRequest;
    try{
      const [catalog,reading]=await Promise.all([this.call<MethodCatalog>('catalog'),this.call<MethodReading|null>('current')]);
      if(revision!==this.revision||request!==this.snapshotRequest)return;
      const changed=reading?.id!==this.state.reading?.id;
      const route=reading&&(changed||!this.state.catalog)?reading.route??reading.selectedRoute??this.state.draft.route:this.state.draft.route,valid=catalog.providers.some(p=>p.id===route.provider&&p.models.some(m=>m.id===route.model)),first=catalog.providers.find(p=>p.models.length);
      const restored=reading&&(changed||!this.state.catalog)?{question:reading.question,wallTime:reading.wallTime??'',spreadId:reading.spreadId??this.state.draft.spreadId,useBackground:reading.backgroundOptions.useBackground!==false,forOthers:!!reading.backgroundOptions.forOthers,followupQuestion:''}:{};
      this.update({catalog,reading,loading:false,error:'',draft:{...this.state.draft,...restored,route:valid?route:{provider:first?.id??'',model:first?.models[0]?.id??''}}});if(readingIsBusy(reading))void this.poll();
    }catch(error){if(revision===this.revision&&request===this.snapshotRequest)this.update({loading:false,error:message(error)});}
  }
  private async act(endpoint:string,payload:object):Promise<boolean>{
    if(this.disposed||this.state.acting||readingIsBusy(this.state.reading))return false;const revision=++this.revision;++this.snapshotRequest;
    const generation=['interpret','followup','resume'].includes(endpoint);if(generation)this.pendingGenerationRevision=revision;
    this.update({acting:true,error:''});if(generation)void this.poll();
    try{const reading=await this.call<MethodReading>(endpoint,payload);if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;if(revision!==this.revision)return false;++this.snapshotRequest;this.update({reading,acting:false,...(['start','interpret','followup','resume','reveal'].includes(endpoint)||(endpoint==='toss'||endpoint==='record')&&reading.status==='ready'?{navigation:{sequence:(this.state.navigation?.sequence??0)+1,target:endpoint==='followup'||endpoint==='resume'&&'turnId' in payload?'latest':endpoint==='interpret'||endpoint==='resume'?'interpretation':'result'}}:{}),...(endpoint==='start'?{draft:{...this.state.draft,followupQuestion:''}}:{})});if(readingIsBusy(reading))void this.poll();return true;}
    catch(error){if(revision===this.revision)this.update({acting:false,error:message(error)});return false;}
    finally{if(this.pendingGenerationRevision===revision)this.pendingGenerationRevision=undefined;}
  }
  start=():Promise<boolean>=>this.act('start',{question:this.state.draft.question,wallTime:this.state.draft.wallTime,spreadId:this.state.draft.spreadId,route:this.state.draft.route,options:{useBackground:this.state.draft.useBackground,forOthers:this.state.draft.forOthers}});
  local=(endpoint:string,payload:object={}):Promise<boolean>=>this.act(endpoint,{id:this.state.reading?.id,expectedCount:this.moduleId==='liuyao'?this.state.reading?.coins.length:this.state.reading?.selectedSlots.length,...payload});
  interpret=():Promise<boolean>=>this.act('interpret',{id:this.state.reading?.id,...this.state.draft.route,options:{useBackground:this.state.draft.useBackground,forOthers:this.state.draft.forOthers}});
  followup=(question:string):Promise<boolean>=>this.act('followup',{id:this.state.reading?.id,question,expectedTurnCount:this.state.reading?.conversation?.length??0});
  resume=(turnId?:string):Promise<boolean>=>{const reading=this.state.reading;if(!reading||readingIsBusy(reading)||this.state.acting)return Promise.resolve(false);const turn=turnId?reading.conversation?.at(-1):undefined;if(turnId?!turn||turn.id!==turnId||!['failed','cancelled'].includes(turn.status):!!reading.conversation?.length||!['failed','cancelled'].includes(reading.status))return Promise.resolve(false);return this.act('resume',{id:reading.id,expectedTurnCount:reading.conversation?.length??0,expectedAttempt:(turnId?reading.conversation?.find(turn=>turn.id===turnId)?.generation:reading.generation)?.attempt??0,...(turnId?{turnId}:{})});};
  cancel=async():Promise<boolean>=>{
    const reading=this.state.reading;if(!reading||!readingIsBusy(reading))return false;
    const turn=reading.status==='streaming'?undefined:reading.conversation?.find(value=>value.status==='streaming');
    const payload=reading.preflight?{id:reading.id,preflightId:reading.preflight.id}:{id:reading.id,expectedAttempt:(turn?turn.generation:reading.generation)?.attempt??0,...(turn?{turnId:turn.id}:{})};
    const revision=++this.revision;++this.snapshotRequest;
    try{const next=await this.call<MethodReading>('cancel',payload);if(revision!==this.revision)return false;++this.snapshotRequest;this.update({reading:next,acting:false,error:''});if(readingIsBusy(next))void this.poll();return true;}
    catch(error){if(revision===this.revision)this.update({error:message(error)});return false;}
  };
  async checkpoint(retry=false):Promise<void>{
    const reading=this.state.reading;if(!reading||readingIsBusy(reading))return;
    try{await this.call('checkpoint',{id:reading.id,route:reading.route??this.state.draft.route,options:{useBackground:this.state.draft.useBackground,forOthers:this.state.draft.forOthers},...(retry?{retry:true}:{})});}catch(error){this.update({error:message(error)});}
  }
  private needsPoll():boolean{return this.pendingGenerationRevision===this.revision||readingIsBusy(this.state.reading);}
  private poll():Promise<void>{
    const signal=this.abort.signal;if(this.pollFlight?.signal===signal&&this.pollFlight.revision===this.revision)return this.pollFlight.promise;
    const flight={signal,revision:this.revision,promise:Promise.resolve()};this.pollFlight=flight;
    flight.promise=(async()=>{try{while(!this.disposed&&!signal.aborted&&flight.revision===this.revision&&this.needsPoll()){
      const revision=this.revision;
      await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,this.state.catalog?.config.pollIntervalMs??250);signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();});
      if(this.disposed||signal.aborted||!this.needsPoll())break;if(revision!==this.revision)break;
      const id=this.state.reading?.id;if(!id)break;const request=++this.snapshotRequest;
      try{const reading=await this.call<MethodReading|null>('current',{},signal);if(!signal.aborted&&revision===this.revision&&request===this.snapshotRequest&&id===this.state.reading?.id)this.update({reading});}
      catch(error){if(!signal.aborted&&revision===this.revision&&request===this.snapshotRequest)this.update({error:message(error)});break;}
    }}finally{if(this.pollFlight===flight)this.pollFlight=undefined;}})();
    return flight.promise;
  }
  resetPrivate=():void=>{++this.revision;++this.snapshotRequest;++this.preferenceRequest;this.pendingGenerationRevision=undefined;this.abort.abort();this.abort=new AbortController();this.update({reading:null,acting:false,error:'',draft:{...this.state.draft,question:'',wallTime:'',followupQuestion:'',useBackground:true,forOthers:false}});};
  dispose():void{this.disposed=true;this.abort.abort();this.listeners.clear();}
}
function message(value:unknown):string{return value instanceof Error?value.message:'操作未完成';}
