export type ModuleId = 'meihua' | 'tarot';
export type ViewId = 'portal' | ModuleId;
export interface Journey { from:ViewId; to:ViewId; startedAt:number; duration:number; origin:{x:number;y:number} }
export interface HubState { view:ViewId; journey:Journey|null; scheme:'light'|'dark'; error:string }

/** Navigation and theme belong to the plugin lifetime, just like module results. */
export class HubController {
  private state:HubState={view:'portal',journey:null,scheme:'light',error:''};
  private listeners=new Set<()=>void>();
  private middle:ReturnType<typeof setTimeout>|undefined;
  private end:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly isBusy:()=>boolean) {}
  getSnapshot=():HubState=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<HubState>) {this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  setScheme(scheme:'light'|'dark'):void {if(scheme!==this.state.scheme)this.update({scheme});}
  /** Restoring an in-flight Host reading must expose its cancel button, even after a hard reload. */
  restoreReading(view:ModuleId):void {
    if(this.state.view===view&&!this.state.journey)return;
    clearTimeout(this.middle);clearTimeout(this.end);this.update({view,journey:null,error:''});
  }
  navigate=(to:ViewId,origin={x:.5,y:.5}):void=>{
    if(this.state.journey || to===this.state.view)return;
    if(this.isBusy()){this.update({error:'解读进行中，请先取消解读再切换占卜方式。'});return;}
    const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration=reduce?120:to==='portal'?800:1600;
    const journey:Journey={from:this.state.view,to,origin,startedAt:Date.now(),duration};
    this.update({journey,error:''});
    this.middle=setTimeout(()=>this.update({view:to}),reduce?0:duration*.53);
    this.end=setTimeout(this.skip,duration);
  };
  skip=():void=>{clearTimeout(this.middle);clearTimeout(this.end);if(this.state.journey)this.update({view:this.state.journey.to,journey:null,error:''});};
  dispose():void {clearTimeout(this.middle);clearTimeout(this.end);this.listeners.clear();}
}
