import type { CastInput } from '../core/types.ts';
import type { Catalog, ClientRpc, ModelRoute, Reading } from '../shared/protocol.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import type { BackgroundOptions } from './MemoryPanel.tsx';

export interface PageState {
  catalog:Catalog | null;
  reading:Reading | null;
  loading:boolean;
  casting:boolean;
  interpreting?:boolean;
  animationStartedAt:number | null;
  error:string;
  draft?:MeihuaDraft;
}
export interface MeihuaDraft { question:string;ruleId:string;numbers:Record<string,string>;customTime:boolean;date:string;context:string;route:ModelRoute;followupQuestion?:string;useBackground?:boolean;forOthers?:boolean }
export const initialMeihuaDraft:MeihuaDraft={question:'',ruleId:'time',numbers:{a:'',b:'',c:''},customTime:false,date:'',context:'',route:{provider:'',model:''},useBackground:true,forOthers:false};
/** Registration-private source; DSH binds its observable to the component's useMeihua hook. */
export class MeihuaController {
  private state:PageState = { catalog:null,reading:null,loading:true,casting:false,interpreting:false,animationStartedAt:null,error:'',draft:{...initialMeihuaDraft} };
  private listeners = new Set<()=>void>();
  private abort = new AbortController();
  private animationTimer:ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private revision = 0;
  private snapshotRequest = 0;
  private preferencesRequest = 0;
  constructor(private readonly rpc:ClientRpc,private readonly getMemoryEpoch?:()=>number|undefined) {}
  getSnapshot = ():PageState => this.state;
  subscribe = (listener:()=>void):(()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; };
  private update(patch:Partial<PageState>):void {
    if (this.disposed) return;
    this.state = { ...this.state,...patch };
    for (const listener of this.listeners) listener();
  }
  updateDraft=(patch:Partial<MeihuaDraft>):void=>{
    const previous=this.state.draft??initialMeihuaDraft,draft={...previous,...patch};
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
  private async call<T>(endpoint:string,payload:unknown = {}):Promise<T> {
    if(this.getMemoryEpoch&&endpoint!=='catalog'&&endpoint!=='current'){
      const epoch=this.getMemoryEpoch();if(epoch===undefined)throw new Error('正在读取共享背景状态，请稍后重试。');
      payload={...(payload as object),epoch};
    }
    const response = await this.rpc.call('/api',`meihua/${endpoint}`,payload,this.abort.signal);
    if (!response.ok) throw new Error(response.error.message);
    return response.value as T;
  }
  async load():Promise<void> {
    const revision=this.revision;
    const snapshotRequest=++this.snapshotRequest;
    try {
      const [catalog,reading] = await Promise.all([this.call<Catalog>('catalog'),this.call<Reading|null>('current')]);
      if(revision!==this.revision||snapshotRequest!==this.snapshotRequest)return;
      const changed=reading?.id!==this.state.reading?.id;
      const restoreBackground=!!reading&&(this.state.catalog===null||changed);
      const background=restoreBackground?{useBackground:reading.backgroundOptions?.useBackground!==false,forOthers:!!reading.backgroundOptions?.forOthers}:{};
      this.update({catalog,reading,loading:false,error:'',...(changed||restoreBackground?{draft:{...(this.state.draft??initialMeihuaDraft),...background,...(changed?{followupQuestion:''}:{})}}:{})});
      if (readingIsBusy(reading)) void this.poll();
    } catch (error) { if(revision===this.revision&&snapshotRequest===this.snapshotRequest)this.update({loading:false,error:message(error)}); }
  }
  async cast(input:CastInput):Promise<void> {
    if (this.state.casting || this.state.interpreting || readingIsBusy(this.state.reading)) return;
    const revision=++this.revision;
    this.update({casting:true,error:''});
    try {
      const reading = await this.call<Reading>('cast',{...input,options:{useBackground:this.state.draft?.useBackground!==false,forOthers:!!this.state.draft?.forOthers},route:this.state.draft?.route});
      if(revision!==this.revision)return;
      ++this.snapshotRequest;
      clearTimeout(this.animationTimer);
      const duration = this.state.catalog?.config.animationMs ?? 0;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.update({reading,casting:false,draft:{...(this.state.draft??initialMeihuaDraft),followupQuestion:''},animationStartedAt:reduce || duration === 0 ? null : Date.now()});
      if (!reduce && duration > 0) this.animationTimer = setTimeout(()=>this.skipAnimation(),duration);
    } catch (error) { if(revision===this.revision)this.update({casting:false,error:message(error)}); }
  }
  skipAnimation = ():void => { clearTimeout(this.animationTimer); this.update({animationStartedAt:null}); };
  async interpret(route:ModelRoute,options?:BackgroundOptions):Promise<void> {
    const reading = this.state.reading;
    if (!reading || reading.status !== 'ready' || this.state.interpreting || this.state.casting) return;
    const revision=++this.revision;
    this.update({error:'',interpreting:true});
    try {
      const next=await this.call<Reading>('interpret',{id:reading.id,...route,options:options??{useBackground:this.state.draft?.useBackground!==false,forOthers:!!this.state.draft?.forOthers}});
      if(revision!==this.revision||this.state.reading?.id!==reading.id)return;
      ++this.snapshotRequest;
      this.update({reading:next});await this.poll();
    }
    catch (error) { if(revision===this.revision)this.update({error:message(error)}); }
    finally {if(revision===this.revision)this.update({interpreting:false});}
  }
  /** Resolves at accepted submission so clearing a sent draft never removes a later draft. */
  async followup(question:string):Promise<boolean> {
    const reading=this.state.reading,trimmed=question.trim();
    if(!reading||!['complete','failed','cancelled'].includes(reading.status)||!reading.text.trim()||!trimmed||trimmed.length>2000||this.state.interpreting||this.state.casting||readingIsBusy(reading))return false;
    const revision=++this.revision,expectedTurnCount=reading.conversation?.length??0;
    this.update({interpreting:true,error:''});
    try {
      const next=await this.call<Reading>('followup',{id:reading.id,question:trimmed,expectedTurnCount});
      if(revision!==this.revision||this.state.reading?.id!==reading.id)return false;
      ++this.snapshotRequest;
      this.update({reading:next,interpreting:false});
      if(readingIsBusy(next))void this.poll();
      return (next.conversation?.length??0)>expectedTurnCount;
    } catch(error) {if(revision===this.revision)this.update({error:message(error)});return false;}
    finally {if(revision===this.revision)this.update({interpreting:false});}
  }
  private polling = false;
  private async poll():Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      while (!this.disposed && readingIsBusy(this.state.reading)) {
        await new Promise<void>(resolve=>{
          const timer = setTimeout(finish,this.state.catalog?.config.pollIntervalMs ?? 250);
          const signal = this.abort.signal;
          function finish() { clearTimeout(timer);signal.removeEventListener('abort',finish);resolve(); }
          signal.addEventListener('abort',finish,{once:true});
        });
        if (this.disposed) break;
        const revision=this.revision,id=this.state.reading?.id;
        const snapshotRequest=++this.snapshotRequest;
        try {
          const reading=await this.call<Reading|null>('current');
          if(revision===this.revision&&snapshotRequest===this.snapshotRequest&&id===this.state.reading?.id)this.update({reading});
        } catch(error) {
          if(revision===this.revision&&snapshotRequest===this.snapshotRequest&&id===this.state.reading?.id){this.update({error:message(error)});break;}
        }
      }
    } catch (error) { this.update({error:message(error)}); }
    finally { this.polling = false; }
  }
  async cancel():Promise<void> {
    const reading = this.state.reading;
    if (!reading||!readingIsBusy(reading)) return;
    const turn=reading.status==='streaming'?undefined:reading.conversation?.find(value=>value.status==='streaming');
    const payload={id:reading.id,...(turn?{turnId:turn.id}:{})};
    const revision=++this.revision;
    try {
      const next=await this.call<Reading>('cancel',payload);
      if(revision===this.revision&&this.state.reading?.id===reading.id){++this.snapshotRequest;this.update({reading:next,error:''});if(readingIsBusy(next))void this.poll();}
    }
    catch (error) { this.update({error:message(error)}); }
  }
  async checkpoint(retry=false):Promise<void> {
    const reading=this.state.reading;
    if(!reading||readingIsBusy(reading))return;
    try{await this.call('checkpoint',{id:reading.id,options:{useBackground:this.state.draft?.useBackground!==false,forOthers:!!this.state.draft?.forOthers},route:reading.route??this.state.draft?.route,...(retry?{retry:true}:{})});}
    catch(error){this.update({error:message(error)});}
  }
  /** Invalidate late RPC replies before erasing drafts when the vault locks or is cleared. */
  resetPrivate=():void=>{
    ++this.revision;++this.snapshotRequest;++this.preferencesRequest;this.abort.abort();this.abort=new AbortController();clearTimeout(this.animationTimer);
    const route=this.state.draft?.route??initialMeihuaDraft.route;
    this.update({reading:null,casting:false,interpreting:false,animationStartedAt:null,error:'',draft:{...initialMeihuaDraft,numbers:{...initialMeihuaDraft.numbers},route}});
  };
  dispose():void { this.disposed=true;this.abort.abort();clearTimeout(this.animationTimer);this.listeners.clear(); }
}
function message(error:unknown):string { return error instanceof Error ? error.message : '操作未完成'; }
