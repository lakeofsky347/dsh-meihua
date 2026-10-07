/** Narrow audited DSH 0.2.0-rc.2 service faces; no client context is bundled into Host code. */
import type { JsonValue } from '../core/types.ts';

export interface DurableMessage {
  id: string;
  role: 'user' | 'system' | 'assistant';
  source: { kind: string; provider?: string; model?: string };
  content: { type: 'text'; text: string }[];
}
export type FinishReason = { kind: 'stop' | 'max-tokens' | 'tool-calls' } | { kind:'error' | 'aborted'; failure:{ code:string; message:string } };
export type LlmChunk =
  | { type:'block-start'; index:number; blockType:string }
  | { type:'text-delta' | 'reasoning-delta'; index:number; text:string }
  | { type:'block-end'; index:number; block:{ type:string; text?:string } }
  | { type:'tool-call-delta'; index:number; id:string; argumentsDelta:string; name?:string }
  | { type:'usage'; usage:JsonValue }
  | { type:'finish'; reason:FinishReason };
export interface GenerateOptions {
  provider:string; model:string; messages:DurableMessage[]; system:string;
  maxTokens:number; sessionId?:string; signal:AbortSignal;
}
export interface HostLlm {
  listProviders(): { id:string; name:string }[];
  listModels(provider:string): Promise<{ id:string; name:string }[]>;
  stream(options:GenerateOptions): AsyncIterable<LlmChunk>;
}
export interface LogEvent { type:string; seq:number; time:number; data:unknown; surfaceOp?:'append'; ignorable?:true }
export interface LogSession {
  header: { id:string; version:number; createdAt:number };
  append(type:string, data:unknown, options?:{ surfaceOp:'append' }): LogEvent;
}
export interface PersistenceHandle { append(events:readonly LogEvent[]):Promise<void>; flush():Promise<void>; close():Promise<void> }
export interface HostContext {
  /** Only ciphertext is handed to the mounted storage backend. */
  storage?:unknown;
  llm:HostLlm;
  sessions:{ prepare(id?:string):LogSession };
  sessionPersistence:{ create(header:LogSession['header']):Promise<PersistenceHandle> };
  connection:{ fetch:{ register(route:{path:string;methods:readonly ['POST'];requestBody:'buffered';fetch(request:Request):Promise<Response>}):()=>Promise<void> } };
  reflect:{ provide(name:string, value:unknown):()=>Promise<void> };
  effect(factory:()=>void | (()=>void | Promise<void>), label?:string):unknown;
}
