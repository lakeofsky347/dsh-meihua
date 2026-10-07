import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';

export interface CipherRecord { nonce:string; tag:string; ciphertext:string }
export interface VaultEnvelope {
  format:1;
  kdf:{name:'scrypt';N:131072;r:8;p:1;salt:string};
  wrappedKey:CipherRecord;
  payload:CipherRecord;
}
const KDF = {name:'scrypt',N:131072,r:8,p:1} as const;
const KEY_AAD='wenxiang-memory-v1:key';
export function memoryError(code:string,message:string):Error & {code:string} { return Object.assign(new Error(message),{code}); }
export function validPassphrase(value:unknown):string {
  if(typeof value!=='string'||value.length<8||value.length>256)throw memoryError('MEMORY_PASSPHRASE','口令须为 8—256 个字符');
  return value;
}
function decode(value:unknown,length?:number):Buffer {
  if(typeof value!=='string'||value.length>32_000_000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw memoryError('MEMORY_FORMAT','加密资料格式无效');
  const bytes=Buffer.from(value,'base64');
  if(length!==undefined&&bytes.length!==length)throw memoryError('MEMORY_FORMAT','加密资料格式无效');
  return bytes;
}
export function validateCipher(value:unknown):CipherRecord {
  if(!value||typeof value!=='object')throw memoryError('MEMORY_FORMAT','加密资料格式无效');
  const record=value as CipherRecord;decode(record.nonce,12);decode(record.tag,16);decode(record.ciphertext);
  return {nonce:record.nonce,tag:record.tag,ciphertext:record.ciphertext};
}
export function validateEnvelope(value:unknown):VaultEnvelope {
  if(!value||typeof value!=='object')throw memoryError('MEMORY_FORMAT','加密资料格式无效');
  const record=value as VaultEnvelope,kdf=record.kdf;
  if(record.format!==1||!kdf||kdf.name!=='scrypt'||kdf.N!==KDF.N||kdf.r!==8||kdf.p!==1)throw memoryError('MEMORY_FORMAT','加密资料版本或口令参数无效');
  decode(kdf.salt,16);
  return {format:1,kdf:{...KDF,salt:kdf.salt},wrappedKey:validateCipher(record.wrappedKey),payload:validateCipher(record.payload)};
}
export async function deriveWrappingKey(passphrase:string,salt:string):Promise<Buffer> {
  return new Promise((resolve,reject)=>scrypt(passphrase,decode(salt,16),32,{N:KDF.N,r:8,p:1,maxmem:256*1024*1024},(error,key)=>error?reject(memoryError('MEMORY_CRYPTO','口令派生未完成')):resolve(key)));
}
export function encryptBytes(key:Buffer,plaintext:Buffer,aad:string):CipherRecord {
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(aad));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return {nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
export function decryptBytes(key:Buffer,record:CipherRecord,aad:string):Buffer {
  const checked=validateCipher(record),decipher=createDecipheriv('aes-256-gcm',key,decode(checked.nonce,12));
  decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(decode(checked.tag,16));
  try{return Buffer.concat([decipher.update(decode(checked.ciphertext)),decipher.final()]);}
  catch{throw memoryError('MEMORY_UNLOCK','口令错误或加密资料已损坏');}
}
export function encryptJson(key:Buffer,value:unknown,aad:string):CipherRecord {
  let bytes:Buffer;
  try{bytes=Buffer.from(JSON.stringify(value));}catch{throw memoryError('MEMORY_FORMAT','私人资料无法序列化');}
  try{return encryptBytes(key,bytes,aad);}finally{bytes.fill(0);}
}
export function decryptJson<T>(key:Buffer,record:CipherRecord,aad:string):T {
  const bytes=decryptBytes(key,record,aad);
  try{return JSON.parse(bytes.toString('utf8')) as T;}catch{throw memoryError('MEMORY_FORMAT','加密资料内容无效');}finally{bytes.fill(0);}
}
export async function createEnvelope(value:unknown,passphrase:string):Promise<{envelope:VaultEnvelope;key:Buffer;wrappingKey:Buffer}> {
  const salt=randomBytes(16).toString('base64'),wrappingKey=await deriveWrappingKey(passphrase,salt),key=randomBytes(32);
  return {envelope:{format:1,kdf:{...KDF,salt},wrappedKey:encryptBytes(wrappingKey,key,KEY_AAD),payload:encryptJson(key,value,'wenxiang-memory-v1:payload')},key,wrappingKey};
}
export async function unlockEnvelope(envelope:VaultEnvelope,passphrase:string):Promise<{key:Buffer;wrappingKey:Buffer}> {
  const wrappingKey=await deriveWrappingKey(passphrase,envelope.kdf.salt);
  try{return {key:decryptBytes(wrappingKey,envelope.wrappedKey,KEY_AAD),wrappingKey};}
  catch(error){wrappingKey.fill(0);throw error;}
}
export function replacePayload(envelope:VaultEnvelope,key:Buffer,value:unknown):VaultEnvelope { return {...envelope,payload:encryptJson(key,value,'wenxiang-memory-v1:payload')}; }
export function rotateDataKey(envelope:VaultEnvelope,wrappingKey:Buffer,key:Buffer,value:unknown):VaultEnvelope {
  return {...envelope,wrappedKey:encryptBytes(wrappingKey,key,KEY_AAD),payload:encryptJson(key,value,'wenxiang-memory-v1:payload')};
}
export async function rewrapEnvelope(envelope:VaultEnvelope,key:Buffer,newPassphrase:string):Promise<{envelope:VaultEnvelope;wrappingKey:Buffer}> {
  const salt=randomBytes(16).toString('base64'),wrappingKey=await deriveWrappingKey(newPassphrase,salt);
  return {envelope:{...envelope,kdf:{...KDF,salt},wrappedKey:encryptBytes(wrappingKey,key,KEY_AAD)},wrappingKey};
}
