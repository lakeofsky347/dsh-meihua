import type { ClientRpc } from '../shared/protocol.ts';
import { MeihuaController } from './controller.ts';
import { Hub } from './Hub.tsx';
import { CosmosMark } from './Portal.tsx';
import { TarotController } from './tarot-controller.ts';
import { HubController } from './hub-controller.ts';
import { en,zh, type Translate } from './locales.ts';
import css from './styles.css?inline';

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
  const controller = new MeihuaController(ctx.connection.rpc);
  const tarot = new TarotController(ctx.connection.rpc);
  const hub = new HubController(()=>{const m=controller.getSnapshot(),r=tarot.getSnapshot();return m.casting||!!m.interpreting||r.acting||m.reading?.status==='streaming'||r.reading?.status==='streaming';});
  const restoreActiveReading=()=>{if(controller.getSnapshot().reading?.status==='streaming')hub.restoreReading('meihua');else if(tarot.getSnapshot().reading?.status==='streaming')hub.restoreReading('tarot');};
  ctx.effect(()=>{const a=controller.subscribe(restoreActiveReading),b=tarot.subscribe(restoreActiveReading);return ()=>{a();b();};},'divination: restore active reading');
  ctx.effect(()=>()=>controller.dispose(),'meihua: page lifetime');
  ctx.effect(()=>()=>tarot.dispose(),'tarot: page lifetime');
  ctx.effect(()=>()=>hub.dispose(),'divination: navigation lifetime');
  const syncTheme=()=>hub.setScheme(ctx.theme?.getTheme().active.colorScheme??(document.body.hasAttribute('data-ds-dark-theme')?'dark':'light'));
  syncTheme();ctx.effect(()=>ctx.on('theme/change',syncTheme),'divination: theme subscription');
  ctx.effect(()=>ctx.locale.register('meihua',{zh,en}),'meihua: copy');
  ctx.effect(()=>{
    const style=document.createElement('style');style.dataset.plugin='dsh-meihua';style.textContent=css;document.head.append(style);
    return ()=>style.remove();
  },'meihua: style');
  const t=ctx.locale.bind('meihua');
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'meihua',locale:'meihua',inject:()=>({
    hooks:{hub,meihua:controller,tarot},onNavigate:hub.navigate,onSkipJourney:hub.skip,
    onMeihuaCast:controller.cast.bind(controller),onMeihuaInterpret:controller.interpret.bind(controller),
    onMeihuaCancel:controller.cancel.bind(controller),onMeihuaRefresh:controller.load.bind(controller),onMeihuaSkip:controller.skipAnimation,onMeihuaDraft:controller.updateDraft,
    onTarotStart:tarot.start.bind(tarot),onTarotSelect:tarot.select.bind(tarot),onTarotReveal:tarot.reveal.bind(tarot),
    onTarotInterpret:tarot.interpret.bind(tarot),onTarotCancel:tarot.cancel.bind(tarot),onTarotRefresh:tarot.load.bind(tarot),
    onTarotSkip:tarot.skipShuffle,onTarotDraft:tarot.updateDraft,onTarotActive:tarot.setActive
  })},Hub));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'meihua',order:30,label:()=>t('hubPanel'),locale:'meihua'},CosmosMark));
  ctx.effect(()=>ctx.on('connection/reset',()=>{void controller.load();void tarot.load();}),'divination: connection subscription');
  void controller.load();void tarot.load();
}
