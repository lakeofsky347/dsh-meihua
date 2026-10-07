import type { HostContext } from './platform.ts';
import { MeihuaService } from './service.ts';
import { parseConfig } from './validation.ts';
import { registerTransport, registerModuleTransport } from './transport.ts';
import { TarotService } from './tarot-service.ts';
import { GenerationGate } from './generation-gate.ts';
import { MemoryService } from './memory-service.ts';
import { MEMORY_ENDPOINTS } from '../shared/memory.ts';
import {MethodService} from './method-service.ts';
import {MODULES,READING_ENDPOINTS} from '../shared/modules.ts';

export const name = 'meihua';
export const inject = ['connection','llm','sessions','sessionPersistence','storage','storage.backend.json'];

/** Install the feature through authenticated Connection RPC and disposable Cordis effects. */
export function apply(ctx:HostContext, config:unknown):void {
  const settings=parseConfig(config),gate=new GenerationGate();
  const memory = new MemoryService(ctx,settings,gate);
  const service = new MeihuaService(ctx,settings,gate,memory);
  const tarot = new TarotService(ctx,settings,gate,memory);
  ctx.effect(()=>()=>memory.dispose(),'memory: private lifetime');
  ctx.effect(()=>()=>service.dispose(),'meihua: generation lifetime');
  ctx.effect(()=>ctx.reflect.provide('meihua',service),'meihua: extensions');
  ctx.effect(()=>()=>tarot.dispose(),'tarot: generation lifetime');
  registerTransport(ctx,service);
  registerModuleTransport(ctx,'tarot',tarot,['catalog','current','start','select','reveal','interpret','followup','cancel','checkpoint','preferences']);
  registerModuleTransport(ctx,'memory',memory,MEMORY_ENDPOINTS);
  for(const module of MODULES){
    if(module.id==='meihua'||module.id==='tarot')continue;
    const method=new MethodService(module.id,ctx,settings,gate,memory);
    ctx.effect(()=>()=>method.dispose(),`${module.id}: generation lifetime`);
    registerModuleTransport(ctx,module.id,method,[...READING_ENDPOINTS,'start',...(module.id==='liuyao'?['toss','record']:module.id==='lenormand'?['select','reveal']:[])]);
  }
}
