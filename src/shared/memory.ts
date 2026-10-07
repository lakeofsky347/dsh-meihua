import type { ModuleId } from "./modules.ts";
import type { ModelRoute } from './protocol.ts';

export const MEMORY_LIMIT = 4000;
export const MEMORY_ENDPOINTS = ['status','initialize','unlock','lock','document','save','versions','rollback','clear','change-passphrase','checkpoint'] as const;
export type MemorySource = 'manual' | 'rollback' | ModuleId | 'initial';
export interface MemoryState {
  initialized:boolean;
  unlocked:boolean;
  revision:number;
  epoch:number;
  updating:boolean;
  pending:boolean;
  error?:{code:string;message:string};
}
export type MemoryStatus = MemoryState;
export interface MemoryDocument {
  content:string;
  revision:number;
  epoch:number;
  updatedAt:string;
  source:MemorySource;
  fixedParagraphs:string[];
}
export interface MemoryVersion extends Omit<MemoryDocument,'epoch'> {
  id:string;
  changes:{before:string;after:string};
}
/** Host-only snapshot: never expose markdown through a reading RPC. */
export interface MemorySnapshot {
  enabled:boolean;
  forOthers:boolean;
  revision:number;
  epoch:number;
  markdown:string;
}
export interface MemoryUsage extends Omit<MemorySnapshot,'markdown'> {}
export interface MemoryCheckpoint {
  moduleId:ModuleId;
  readingId:string;
  messages:{id:string;text:string}[];
  route?:ModelRoute;
  epoch?:number;
  /** Explicit user retry only; automatic navigation must omit this. */
  retry?:boolean;
}
