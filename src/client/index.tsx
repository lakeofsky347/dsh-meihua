import type { ClientRpc } from '../shared/protocol.ts';
import { MeihuaController } from './controller.ts';
import { Bagua, Page } from './Page.tsx';
import { en,zh, type Translate } from './locales.ts';
import css from './styles.css?inline';

interface ClientContext {
  connection:{ rpc:ClientRpc };
  slots:{ inject(name:string,setup:()=>unknown):unknown; register(options:object,component:unknown):unknown };
  locale:{ register(namespace:string,dictionaries:object):()=>void; bind(namespace:string):Translate };
  effect(setup:()=>void | (()=>void), label?:string):unknown;
  on(event:'connection/reset',listener:()=>void):()=>void;
}
export const inject = ['slots','locale','connection'];

/** Register one sidebar row and one main panel; no replacement of the host shell. */
export function apply(ctx:ClientContext):void {
  const controller = new MeihuaController(ctx.connection.rpc);
  ctx.effect(()=>()=>controller.dispose(),'meihua: page lifetime');
  ctx.effect(()=>ctx.locale.register('meihua',{zh,en}),'meihua: copy');
  ctx.effect(()=>{
    const style=document.createElement('style');style.dataset.plugin='dsh-meihua';style.textContent=css;document.head.append(style);
    return ()=>style.remove();
  },'meihua: style');
  const t=ctx.locale.bind('meihua');
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'meihua',locale:'meihua',inject:()=>({
    hooks:{meihua:controller},onCast:controller.cast.bind(controller),onInterpret:controller.interpret.bind(controller),
    onCancel:controller.cancel.bind(controller),onRefresh:controller.load.bind(controller),onSkip:controller.skipAnimation
  })},Page));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'meihua',order:30,label:()=>t('panel'),locale:'meihua'},Bagua));
  ctx.on('connection/reset',()=>void controller.load());
  void controller.load();
}
