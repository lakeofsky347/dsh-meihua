import type { ClientRpc } from '../shared/protocol.ts';
import type { MemoryDocument, MemoryStatus, MemoryVersion } from '../shared/memory.ts';

export interface MemoryPageState {
  status:MemoryStatus|null;
  document:MemoryDocument|null;
  versions:MemoryVersion[];
  open:boolean;
  loading:boolean;
  acting:boolean;
  error:string;
  notice:string;
  privacyEpoch:number;
}

/** One unlocked vault per plugin registration. Personal data never enters browser storage. */
export class MemoryController {
  private state:MemoryPageState={status:null,document:null,versions:[],open:false,loading:true,acting:false,error:'',notice:'',privacyEpoch:0};
  private listeners=new Set<()=>void>();
  private abort=new AbortController();
  private disposed=false;
  private revision=0;
  private pollTimer:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly rpc:ClientRpc,private readonly onPrivateReset:()=>void=()=>{}) {}
  getSnapshot=():MemoryPageState=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<MemoryPageState>):void {if(this.disposed)return;this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
  private async call<T>(endpoint:string,payload:unknown={}):Promise<T> {
    const response=await this.rpc.call('/api',`memory/${endpoint}`,payload,this.abort.signal);
    if(!response.ok)throw new Error(response.error.message);
    return response.value as T;
  }
  private setStatus(status:MemoryStatus):void {
    const previous=this.state.status;
    const reset=!!previous&&((previous.unlocked&&!status.unlocked)||previous.epoch!==status.epoch);
    if(reset){this.onPrivateReset();this.update({document:null,versions:[],privacyEpoch:this.state.privacyEpoch+1});}
    this.update({status,...(!status.unlocked?{document:null,versions:[]}:{} )});
    clearTimeout(this.pollTimer);
    if(status.updating||status.unlocked)this.pollTimer=setTimeout(()=>void this.load(),status.updating?500:1000);
  }
  async load():Promise<void> {
    const revision=++this.revision;
    try {
      const status=await this.call<MemoryStatus>('status');
      if(revision!==this.revision||this.disposed)return;
      this.setStatus(status);
      if(status.unlocked&&(!this.state.document||this.state.document.revision!==status.revision||this.state.document.epoch!==status.epoch)){
        const [document,history]=await Promise.all([this.call<MemoryDocument>('document'),this.call<{versions:MemoryVersion[]}>('versions')]);
        if(revision!==this.revision||this.disposed)return;
        this.update({document,versions:history.versions,loading:false,error:''});
      }else this.update({loading:false,error:''});
    }catch(error){if(revision===this.revision)this.update({loading:false,error:message(error)});}
  }
  open=():void=>{this.update({open:true,error:'',notice:''});void this.load();};
  close=():void=>{this.update({open:false});};
  private async mutate(endpoint:string,payload:unknown,notice:string):Promise<boolean> {
    if(this.state.acting)return false;
    ++this.revision;
    this.update({acting:true,error:'',notice:''});
    try {await this.call(endpoint,payload);await this.load();this.update({notice});return true;}
    catch(error){this.update({error:message(error)});return false;}
    finally {this.update({acting:false});}
  }
  initialize=(passphrase:string):Promise<boolean>=>this.mutate('initialize',{passphrase},'共享背景已启用，口令只用于本地解锁。');
  unlock=(passphrase:string):Promise<boolean>=>this.mutate('unlock',{passphrase},'已解锁，可在各占卜方式中使用。');
  lock=():Promise<boolean>=>this.mutate('lock',{},'已锁定，当前页面的私人内容已清理。');
  save=(content:string,expectedRevision:number):Promise<boolean>=>this.mutate('save',{content,expectedRevision,epoch:this.state.status?.epoch},'已保存；本次手动修改的段落会固定保留。');
  rollback=(versionId:string,expectedRevision:number):Promise<boolean>=>this.mutate('rollback',{versionId,expectedRevision,epoch:this.state.status?.epoch},'已恢复所选内容，并保存为新的当前版本。');
  clear=():Promise<boolean>=>this.mutate('clear',{epoch:this.state.status?.epoch},'已清空背景、版本、关联记录与当前会话。');
  changePassphrase=(oldPassphrase:string,newPassphrase:string):Promise<boolean>=>this.mutate('change-passphrase',{oldPassphrase,newPassphrase,epoch:this.state.status?.epoch},'口令已更改，请妥善保管。');
  notifyCheckpoint=():void=>{void this.load();};
  dispose():void {this.disposed=true;this.abort.abort();clearTimeout(this.pollTimer);this.listeners.clear();}
}
function message(error:unknown):string {return error instanceof Error?error.message:'共享背景操作未完成';}
