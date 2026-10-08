import type { CastResult, RuleInfo } from '../core/types.ts';
import type { TarotDeckInfo, TarotDrawnCard, TarotSpread } from '../tarot/types.ts';
import type { MemoryUsage } from './memory.ts';

export interface PluginConfig {
  timeZone: string;
  animationMs: number;
  interpretationTimeoutMs: number;
  maxOutputTokens: number | 'model-maximum';
  pollIntervalMs: number;
  maxContextCharacters?:number;
  contextSafetyTokens?:number;
  summaryMaxOutputTokens?:number;
  summaryTimeoutMs?:number;
}
export interface ModelRoute { provider: string; model: string }
export interface GenerationInfo {
  phase:'preparing'|'thinking'|'responding'|'finished';
  startedAt:number;
  elapsedMs?:number;
  attempt:number;
  reasoningLabel?:string;
  reasoningStatus:'maximum'|'unavailable'|'unknown';
  maxTokens?:number;
  budgetSource:'model-maximum'|'host-default'|'fallback';
  outputTokenAccounting?:'includes-reasoning'|'excludes-reasoning';
  contextLimitCharacters?:number;
  contextCharacters?:number;
}
export interface ConversationTurn {
  id:string;
  question:string;
  text:string;
  status:'streaming' | 'complete' | 'failed' | 'cancelled';
  route:ModelRoute;
  createdAt:string;
  error?:{code:string;message:string};
  logSessionId?:string;
  generation?:GenerationInfo;
}
/** Older in-memory snapshots remain readable; first interpretation stays independent. */
export function readingIsBusy(reading:{status:string;preflight?:{id:string};conversation?:readonly ConversationTurn[]}|null|undefined):boolean {
  return !!reading?.preflight||reading?.status==='streaming'||!!reading?.conversation?.some(turn=>turn.status==='streaming');
}
export interface ProviderGroup {
  id: string;
  name: string;
  models: { id: string; name: string }[];
  error?: string;
}
export interface Catalog { rules: RuleInfo[]; providers: ProviderGroup[]; config: PluginConfig }
export interface Reading {
  preflight?:{id:string};
  id: string;
  result: CastResult;
  status: 'ready' | 'streaming' | 'complete' | 'failed' | 'cancelled';
  text: string;
  route?: ModelRoute;
  error?: { code: string; message: string };
  logSessionId?: string;
  generation?:GenerationInfo;
  conversation?:ConversationTurn[];
  memory?:MemoryUsage;
  backgroundOptions?:{useBackground?:boolean;forOthers?:boolean};
}
export interface TarotCatalog { spreads:readonly TarotSpread[]; providers:ProviderGroup[]; config:PluginConfig; deck:TarotDeckInfo }
export interface TarotReading {
  preflight?:{id:string};
  id:string;
  moduleId:'tarot';
  algorithmVersion:'tarot-v1';
  spread:TarotSpread;
  question:string;
  includeReversed:boolean;
  createdAt:string;
  selectionCount:number;
  selectedSlots:number[];
  cards:TarotDrawnCard[];
  status:'selecting' | 'revealing' | 'ready' | 'streaming' | 'complete' | 'failed' | 'cancelled';
  text:string;
  route?:ModelRoute;
  error?:{code:string;message:string};
  logSessionId?:string;
  generation?:GenerationInfo;
  conversation?:ConversationTurn[];
  memory?:MemoryUsage;
  backgroundOptions?:{useBackground?:boolean;forOthers?:boolean};
}
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: object } };
export interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>;
}
