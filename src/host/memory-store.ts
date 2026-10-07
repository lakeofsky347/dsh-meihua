import { memoryError, validateEnvelope } from './memory-vault.ts';
import type { CipherRecord, VaultEnvelope } from './memory-vault.ts';

/** The installed DSH storage hub KV contract; no filesystem or plaintext fallback. */
export interface MemoryKvUnit {
  loadAll():Promise<{tables:Record<string,Record<string,unknown>>;global:unknown}>;
  setGlobal(value:unknown):Promise<void>;
  putRecord(table:string,key:string,value:unknown):Promise<void>;
  deleteRecord(table:string,key:string):Promise<void>;
  close():Promise<void>;
}
interface StorageHub {backend:{get(name:string):{kv?:{open(descriptor:{name:string;version:number;tables:readonly string[];hasGlobal:boolean;layout:'single'}):Promise<MemoryKvUnit>}}}}
export const MEMORY_STORAGE_NAME='wenxiang_private_memory';
export class MemoryStore {
  private unit?:MemoryKvUnit;
  private auditIds=new Set<string>();
  async open(storage:unknown):Promise<VaultEnvelope|null> {
    try {
      const hub=storage as StorageHub;
      if(!hub?.backend||typeof hub.backend.get!=='function')throw new Error('missing');
      const kv=hub.backend.get('json').kv;
      if(!kv)throw new Error('missing');
      this.unit=await kv.open({name:MEMORY_STORAGE_NAME,version:1,tables:['audit'],hasGlobal:true,layout:'single'});
      const data=await this.unit.loadAll();this.auditIds=new Set(Object.keys(data.tables.audit??{}));
      return data.global===null?null:validateEnvelope(data.global);
    }catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='MEMORY_FORMAT')throw error;throw memoryError('MEMORY_STORAGE','加密资料存储不可用');}
  }
  async save(envelope:VaultEnvelope):Promise<void> {
    try{await this.requireUnit().setGlobal(envelope);}catch{throw memoryError('MEMORY_STORAGE','加密资料未能保存，请保留当前页面后重试');}
  }
  async audit(id:string,value:CipherRecord):Promise<void> {
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw memoryError('MEMORY_FORMAT','私人记录标识无效');
    try{await this.requireUnit().putRecord('audit',id,value);this.auditIds.add(id);}catch{throw memoryError('MEMORY_STORAGE','加密记录未能保存');}
  }
  async clearAudits():Promise<void> {
    try{for(const id of this.auditIds){await this.requireUnit().deleteRecord('audit',id);this.auditIds.delete(id);}}
    catch{throw memoryError('MEMORY_STORAGE','资料已清空，旧密文清理尚未完成');}
  }
  private requireUnit():MemoryKvUnit {if(!this.unit)throw memoryError('MEMORY_STORAGE','加密资料存储不可用');return this.unit;}
  async close():Promise<void>{await this.unit?.close();this.unit=undefined;}
}
