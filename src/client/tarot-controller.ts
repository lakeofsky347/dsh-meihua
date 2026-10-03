import type { ClientRpc, ModelRoute, TarotCatalog, TarotReading } from '../shared/protocol.ts';
import type { TarotStartInput, TarotSpreadId } from '../tarot/types.ts';

export interface TarotDraft {
  question:string;
  spreadId:TarotSpreadId;
  includeReversed:boolean;
  route:ModelRoute;
}
export interface TarotPageState {
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
    draft:{question:'',spreadId:'single',includeReversed:true,route:{provider:'',model:''}},
  };
  private listeners = new Set<()=>void>();
  private abort = new AbortController();
  private disposed = false;
  private active = false;
  private shuffleRemaining = 0;
  private shuffleResumedAt = 0;
  private shuffleTimer:ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  constructor(private readonly rpc:ClientRpc) {}
  getSnapshot = ():TarotPageState => this.state;
  subscribe = (listener:()=>void):(()=>void) => { this.listeners.add(listener);return ()=>{this.listeners.delete(listener);}; };
  private update(patch:Partial<TarotPageState>):void {
    if(this.disposed)return;
    this.state={...this.state,...patch};
    for(const listener of this.listeners)listener();
  }
  private async call<T>(endpoint:string,payload:unknown={}):Promise<T> {
    const response=await this.rpc.call('/api',`tarot/${endpoint}`,payload,this.abort.signal);
    if(!response.ok)throw new Error(response.error.message);
    return response.value as T;
  }
  updateDraft = (patch:Partial<TarotDraft>):void => { this.update({draft:{...this.state.draft,...patch}}); };
  async load():Promise<void> {
    try {
      const [catalog,reading]=await Promise.all([this.call<TarotCatalog>('catalog'),this.call<TarotReading|null>('current')]);
      const route=this.state.draft.route;
      const valid=catalog.providers.some(p=>p.id===route.provider && p.models.some(m=>m.id===route.model));
      const first=catalog.providers.find(p=>p.models.length>0);
      const restored=this.state.catalog===null && reading?{question:reading.question,spreadId:reading.spread.id,includeReversed:reading.includeReversed}:{};
      const changed=reading?.id!==this.state.reading?.id;
      if(changed){clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;this.shuffleRemaining=0;}
      this.update({catalog,reading,loading:false,error:'',...(changed?{shuffling:false}:{}),draft:{...this.state.draft,...restored,route:valid?route:{provider:first?.id??'',model:first?.models[0]?.id??''}}});
      if(reading?.status==='streaming')void this.poll();
    } catch(error) { this.update({loading:false,error:message(error)}); }
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
    if(this.state.acting || this.state.reading?.status==='streaming')return;
    this.update({acting:true,error:''});
    try {
      const reading=await this.call<TarotReading>('start',input);
      clearTimeout(this.shuffleTimer);this.shuffleTimer=undefined;
      const reduced=typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.shuffleRemaining=reduced?0:2400;
      this.update({reading,acting:false,shuffling:!reduced});this.resumeShuffle();
    } catch(error) { this.update({acting:false,error:message(error)}); }
  }
  async select(slot:number):Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='selecting' || this.state.acting || this.state.shuffling)return;
    this.update({acting:true,error:''});
    try { this.update({reading:await this.call<TarotReading>('select',{id:reading.id,slot}),acting:false}); }
    catch(error) { this.update({acting:false,error:message(error)}); }
  }
  async reveal(position?:number,all=false):Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='revealing' || this.state.acting)return;
    this.update({acting:true,error:''});
    try { this.update({reading:await this.call<TarotReading>('reveal',{id:reading.id,...(position===undefined?{}:{position}),all}),acting:false}); }
    catch(error) { this.update({acting:false,error:message(error)}); }
  }
  async interpret(route:ModelRoute):Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='ready' || this.state.acting)return;
    this.update({acting:true,error:''});
    try {
      this.update({reading:await this.call<TarotReading>('interpret',{id:reading.id,...route}),acting:false});
      await this.poll();
    } catch(error) { this.update({acting:false,error:message(error)}); }
  }
  private async poll():Promise<void> {
    if(this.polling)return;
    this.polling=true;
    try {
      while(!this.disposed && this.state.reading?.status==='streaming'){
        await new Promise<void>(resolve=>{
          const timer=setTimeout(finish,this.state.catalog?.config.pollIntervalMs??250);
          const signal=this.abort.signal;
          function finish(){clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();}
          signal.addEventListener('abort',finish,{once:true});
        });
        if(this.disposed)break;
        this.update({reading:await this.call<TarotReading|null>('current')});
      }
    } catch(error) { this.update({error:message(error)}); }
    finally { this.polling=false; }
  }
  async cancel():Promise<void> {
    const reading=this.state.reading;
    if(!reading || reading.status!=='streaming')return;
    try { this.update({reading:await this.call<TarotReading>('cancel',{id:reading.id})}); }
    catch(error) { this.update({error:message(error)}); }
  }
  dispose():void {
    this.disposed=true;this.abort.abort();clearTimeout(this.shuffleTimer);this.listeners.clear();
  }
}
function message(error:unknown):string {return error instanceof Error?error.message:'操作未完成';}
