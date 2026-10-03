import type { CastResult, RuleInfo } from '../core/types.ts';
import type { TarotDeckInfo, TarotDrawnCard, TarotSpread } from '../tarot/types.ts';

export interface PluginConfig {
  timeZone: string;
  animationMs: number;
  interpretationTimeoutMs: number;
  maxOutputTokens: number;
  pollIntervalMs: number;
}
export interface ModelRoute { provider: string; model: string }
export interface ProviderGroup {
  id: string;
  name: string;
  models: { id: string; name: string }[];
  error?: string;
}
export interface Catalog { rules: RuleInfo[]; providers: ProviderGroup[]; config: PluginConfig }
export interface Reading {
  id: string;
  result: CastResult;
  status: 'ready' | 'streaming' | 'complete' | 'failed' | 'cancelled';
  text: string;
  route?: ModelRoute;
  error?: { code: string; message: string };
  logSessionId?: string;
}
export interface TarotCatalog { spreads:readonly TarotSpread[]; providers:ProviderGroup[]; config:PluginConfig; deck:TarotDeckInfo }
export interface TarotReading {
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
}
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: object } };
export interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>;
}
