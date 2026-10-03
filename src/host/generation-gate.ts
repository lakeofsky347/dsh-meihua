/** One active interpretation across all modules, including requests from another window. */
export class GenerationGate {
  private owner:string | null = null;
  assertIdle():void {
    if (this.owner) throw Object.assign(new Error('另一份解读正在进行，请等待结束或先取消'),{code:'GENERATION_BUSY'});
  }
  acquire(owner:string):()=>void {
    this.assertIdle();this.owner=owner;
    return ()=>{if(this.owner===owner)this.owner=null;};
  }
}
