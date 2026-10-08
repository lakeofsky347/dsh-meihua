import type { ClientRpc } from '../shared/protocol.ts';
import { readingIsBusy } from '../shared/protocol.ts';
import { MeihuaController } from './controller.ts';
import { Hub } from './Hub.tsx';
import { CosmosMark } from './Portal.tsx';
import { TarotController } from './tarot-controller.ts';
import { HubController } from './hub-controller.ts';
import { MemoryController } from './memory-controller.ts';
import { en,zh, type Translate } from './locales.ts';
import css from './styles.css?inline';
import {MethodController} from './method-controller.ts';
import type {NewMethodId} from '../shared/modules.ts';
import type {MethodActions} from './MethodPage.tsx';

interface ClientContext {
  connection:{ rpc:ClientRpc };
  slots:{ inject(name:string,setup:()=>unknown):unknown; register(options:object,component:unknown):unknown };
  locale:{ register(namespace:string,dictionaries:object):()=>void; bind(namespace:string):Translate };
  effect(setup:()=>void | (()=>void), label?:string):unknown;
  theme?:{getTheme():{active:{colorScheme:'light'|'dark'}}};
  on(event:string,listener:()=>void):()=>void;
}
export const inject = ['slots','locale','connection','theme'];

/** Register one sidebar row and one main panel; no replacement of the host shell. */
export function apply(ctx:ClientContext):void {
  const controller = new MeihuaController(ctx.connection.rpc,()=>memory.getSnapshot().status?.epoch);
  const tarot = new TarotController(ctx.connection.rpc,()=>memory.getSnapshot().status?.epoch);
  const methods:Record<NewMethodId,MethodController>={xiaoliu:new MethodController('xiaoliu',ctx.connection.rpc,()=>memory.getSnapshot().status?.epoch),lenormand:new MethodController('lenormand',ctx.connection.rpc,()=>memory.getSnapshot().status?.epoch),liuyao:new MethodController('liuyao',ctx.connection.rpc,()=>memory.getSnapshot().status?.epoch)};
  const memory = new MemoryController(ctx.connection.rpc,()=>{controller.resetPrivate();tarot.resetPrivate();for(const method of Object.values(methods)){method.resetPrivate();void method.load();}void controller.load();void tarot.load();});
  const hub = new HubController(()=>{const m=controller.getSnapshot(),r=tarot.getSnapshot();return m.casting||!!m.interpreting||r.acting||readingIsBusy(m.reading)||readingIsBusy(r.reading)||Object.values(methods).some(method=>method.getSnapshot().acting||readingIsBusy(method.getSnapshot().reading));});
  const restoreActiveReading=()=>{if(readingIsBusy(controller.getSnapshot().reading))hub.restoreReading('meihua');else if(readingIsBusy(tarot.getSnapshot().reading))hub.restoreReading('tarot');else for(const [id,method] of Object.entries(methods))if(readingIsBusy(method.getSnapshot().reading)){hub.restoreReading(id as NewMethodId);break;}};
  ctx.effect(()=>{const disposers=[controller.subscribe(restoreActiveReading),tarot.subscribe(restoreActiveReading),...Object.values(methods).map(method=>method.subscribe(restoreActiveReading))];return ()=>{for(const dispose of disposers)dispose();};},'divination: restore active reading');
  ctx.effect(()=>()=>controller.dispose(),'meihua: page lifetime');
  ctx.effect(()=>()=>tarot.dispose(),'tarot: page lifetime');
  ctx.effect(()=>()=>hub.dispose(),'divination: navigation lifetime');
  ctx.effect(()=>()=>memory.dispose(),'divination: shared background lifetime');
  for(const method of Object.values(methods))ctx.effect(()=>()=>method.dispose(),`${method.moduleId}: page lifetime`);
  const syncTheme=()=>hub.setScheme(ctx.theme?.getTheme().active.colorScheme??(document.body.hasAttribute('data-ds-dark-theme')?'dark':'light'));
  syncTheme();ctx.effect(()=>ctx.on('theme/change',syncTheme),'divination: theme subscription');
  ctx.effect(()=>ctx.locale.register('meihua',{zh,en}),'meihua: copy');
  ctx.effect(()=>{
    const style=document.createElement('style');style.dataset.plugin='dsh-meihua';style.textContent=css;document.head.append(style);
    return ()=>style.remove();
  },'meihua: style');
  const t=ctx.locale.bind('meihua');
  const checkpointMeihua=async(retry=false)=>{const pending=controller.checkpoint(retry);void memory.load();await pending;await memory.load();};
  const checkpointTarot=async(retry=false)=>{const pending=tarot.checkpoint(retry);void memory.load();await pending;await memory.load();};
  const navigate=(...args:Parameters<typeof hub.navigate>)=>{
    const before=hub.getSnapshot();hub.navigate(...args);
    if(hub.getSnapshot().journey!==before.journey){
      if(before.view==='meihua')void checkpointMeihua();
      else if(before.view==='tarot')void checkpointTarot();
      else if(before.view!=='portal'){const pending=methods[before.view].checkpoint();void memory.load();void pending.finally(()=>memory.load());}
    }
  };
  const methodActions=Object.fromEntries(Object.entries(methods).map(([id,method])=>[id,{onStart:method.start,onLocal:method.local,onInterpret:method.interpret,onFollowup:method.followup,onResume:method.resume,onCancel:method.cancel,onRefresh:method.load.bind(method),onDraft:method.updateDraft,onCheckpoint:async()=>{const pending=method.checkpoint(true);void memory.load();await pending;await memory.load();}}])) as Record<NewMethodId,MethodActions>;
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'meihua',locale:'meihua',inject:()=>({
    hooks:{hub,meihua:controller,tarot,memory,...methods},methodActions,onNavigate:navigate,onSkipJourney:hub.skip,
    onOpenMemory:memory.open,memoryActions:{onClose:memory.close,onRefresh:memory.load.bind(memory),onInitialize:memory.initialize,onUnlock:memory.unlock,onLock:memory.lock,onSave:memory.save,onRollback:memory.rollback,onClear:memory.clear,onChangePassphrase:memory.changePassphrase},
    onMeihuaCheckpoint:()=>checkpointMeihua(true),onTarotCheckpoint:()=>checkpointTarot(true),
    onMeihuaCast:controller.cast.bind(controller),onMeihuaInterpret:controller.interpret.bind(controller),
    onMeihuaFollowup:controller.followup.bind(controller),onMeihuaResume:controller.resume.bind(controller),
    onMeihuaCancel:controller.cancel.bind(controller),onMeihuaRefresh:controller.load.bind(controller),onMeihuaSkip:controller.skipAnimation,onMeihuaDraft:controller.updateDraft,
    onTarotStart:tarot.start.bind(tarot),onTarotSelect:tarot.select.bind(tarot),onTarotReveal:tarot.reveal.bind(tarot),
    onTarotInterpret:tarot.interpret.bind(tarot),onTarotCancel:tarot.cancel.bind(tarot),onTarotRefresh:tarot.load.bind(tarot),
    onTarotFollowup:tarot.followup.bind(tarot),onTarotResume:tarot.resume.bind(tarot),
    onTarotSkip:tarot.skipShuffle,onTarotDraft:tarot.updateDraft,onTarotActive:tarot.setActive
  })},Hub));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'meihua',order:30,label:()=>t('hubPanel'),locale:'meihua'},CosmosMark));
  ctx.effect(()=>ctx.on('connection/reset',()=>{void controller.load();void tarot.load();for(const method of Object.values(methods))void method.load();void memory.load();}),'divination: connection subscription');
  void controller.load();void tarot.load();for(const method of Object.values(methods))void method.load();void memory.load();
}
