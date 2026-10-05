import type { HostContext } from './platform.ts';
import { MeihuaService } from './service.ts';
import { parseConfig } from './validation.ts';
import { registerTransport, registerModuleTransport } from './transport.ts';
import { TarotService } from './tarot-service.ts';
import { GenerationGate } from './generation-gate.ts';

export const name = 'meihua';
export const inject = ['connection','llm','sessions','sessionPersistence'];

/** Install the feature through authenticated Connection RPC and disposable Cordis effects. */
export function apply(ctx:HostContext, config:unknown):void {
  const settings=parseConfig(config),gate=new GenerationGate();
  const service = new MeihuaService(ctx,settings,gate);
  const tarot = new TarotService(ctx,settings,gate);
  ctx.effect(()=>()=>service.dispose(),'meihua: generation lifetime');
  ctx.effect(()=>ctx.reflect.provide('meihua',service),'meihua: extensions');
  ctx.effect(()=>()=>tarot.dispose(),'tarot: generation lifetime');
  registerTransport(ctx,service);
  registerModuleTransport(ctx,'tarot',tarot,['catalog','current','start','select','reveal','interpret','followup','cancel']);
}
