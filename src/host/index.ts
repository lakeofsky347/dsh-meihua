import type { HostContext } from './platform.ts';
import { MeihuaService } from './service.ts';
import { parseConfig } from './validation.ts';
import { registerTransport } from './transport.ts';

export const name = 'meihua';
export const inject = ['connection','llm','sessions','sessionPersistence'];

/** Install the feature through authenticated Connection RPC and disposable Cordis effects. */
export function apply(ctx:HostContext, config:unknown):void {
  const service = new MeihuaService(ctx,parseConfig(config));
  ctx.effect(()=>()=>service.dispose(),'meihua: generation lifetime');
  ctx.effect(()=>ctx.reflect.provide('meihua',service),'meihua: extensions');
  registerTransport(ctx,service);
}
