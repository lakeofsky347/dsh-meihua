import type { CastResult, RuleInfo } from '../core/types.ts';

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
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: object } };
export interface ClientRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>;
}
