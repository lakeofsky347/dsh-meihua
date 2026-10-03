import type { CastInput } from '../core/types.ts';
import type { Catalog, ClientRpc, ModelRoute, Reading } from '../shared/protocol.ts';

export interface PageState {
  catalog:Catalog | null;
  reading:Reading | null;
  loading:boolean;
  casting:boolean;
  animationStartedAt:number | null;
  error:string;
}
/** Registration-private source; DSH binds its observable to the component's useMeihua hook. */
export class MeihuaController {
  private state:PageState = { catalog:null,reading:null,loading:true,casting:false,animationStartedAt:null,error:'' };
  private listeners = new Set<()=>void>();
  private abort = new AbortController();
  private animationTimer:ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  constructor(private readonly rpc:ClientRpc) {}
  getSnapshot = ():PageState => this.state;
  subscribe = (listener:()=>void):(()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; };
  private update(patch:Partial<PageState>):void {
    if (this.disposed) return;
    this.state = { ...this.state,...patch };
    for (const listener of this.listeners) listener();
  }
  private async call<T>(endpoint:string,payload:unknown = {}):Promise<T> {
    const response = await this.rpc.call('/api',`meihua/${endpoint}`,payload,this.abort.signal);
    if (!response.ok) throw new Error(response.error.message);
    return response.value as T;
  }
  async load():Promise<void> {
    try {
      const [catalog,reading] = await Promise.all([this.call<Catalog>('catalog'),this.call<Reading|null>('current')]);
      this.update({catalog,reading,loading:false,error:''});
      if (reading?.status === 'streaming') void this.poll();
    } catch (error) { this.update({loading:false,error:message(error)}); }
  }
  async cast(input:CastInput):Promise<void> {
    if (this.state.casting || this.state.reading?.status === 'streaming') return;
    this.update({casting:true,error:''});
    try {
      const reading = await this.call<Reading>('cast',input);
      clearTimeout(this.animationTimer);
      const duration = this.state.catalog?.config.animationMs ?? 0;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.update({reading,casting:false,animationStartedAt:reduce || duration === 0 ? null : Date.now()});
      if (!reduce && duration > 0) this.animationTimer = setTimeout(()=>this.skipAnimation(),duration);
    } catch (error) { this.update({casting:false,error:message(error)}); }
  }
  skipAnimation = ():void => { clearTimeout(this.animationTimer); this.update({animationStartedAt:null}); };
  async interpret(route:ModelRoute):Promise<void> {
    const reading = this.state.reading;
    if (!reading || reading.status !== 'ready') return;
    this.update({error:''});
    try { this.update({reading:await this.call<Reading>('interpret',{id:reading.id,...route})}); await this.poll(); }
    catch (error) { this.update({error:message(error)}); }
  }
  private polling = false;
  private async poll():Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      while (!this.disposed && this.state.reading?.status === 'streaming') {
        await new Promise<void>(resolve=>{
          const timer = setTimeout(finish,this.state.catalog?.config.pollIntervalMs ?? 250);
          const signal = this.abort.signal;
          function finish() { clearTimeout(timer);signal.removeEventListener('abort',finish);resolve(); }
          signal.addEventListener('abort',finish,{once:true});
        });
        if (this.disposed) break;
        this.update({reading:await this.call<Reading|null>('current')});
      }
    } catch (error) { this.update({error:message(error)}); }
    finally { this.polling = false; }
  }
  async cancel():Promise<void> {
    const reading = this.state.reading;
    if (!reading) return;
    try { this.update({reading:await this.call<Reading>('cancel',{id:reading.id})}); }
    catch (error) { this.update({error:message(error)}); }
  }
  dispose():void { this.disposed=true;this.abort.abort();clearTimeout(this.animationTimer);this.listeners.clear(); }
}
function message(error:unknown):string { return error instanceof Error ? error.message : '操作未完成'; }
