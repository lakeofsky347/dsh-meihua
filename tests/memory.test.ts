import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryService } from '../src/host/memory-service.ts';
import { MEMORY_STORAGE_NAME } from '../src/host/memory-store.ts';
import type { HostContext, GenerateOptions, LlmChunk } from '../src/host/platform.ts';
import type { PluginConfig, RpcResult } from '../src/shared/protocol.ts';
import type { MemoryDocument, MemoryVersion } from '../src/shared/memory.ts';
import { decryptJson,unlockEnvelope,validateEnvelope } from '../src/host/memory-vault.ts';

const jsonBackendPath=resolve('.local/runtime/node_modules/@deepseek-ai/dsh-storage-json/lib/index.js');
const {JsonStorageBackend}=await import(pathToFileURL(jsonBackendPath).href) as {JsonStorageBackend:new(root:string)=>{kv:unknown;close():Promise<void>}};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:2000,maxOutputTokens:3000,pollIntervalMs:100};
const route={provider:'synthetic',model:'fixture'},password='synthetic-only-passphrase';
function value<T>(result:RpcResult):T{assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:unknown}).value as T;}
function failure(result:RpcResult,code:string):void{assert.equal(result.ok,false);assert.equal((result as {ok:false;error:{code:string}}).error.code,code);}
async function* extraction(options:GenerateOptions):AsyncGenerator<LlmChunk>{
  const data=JSON.parse(options.messages[0]!.content[0]!.text) as {messages:{id:string;text:string}[]};
  yield {type:'text-delta',index:0,text:JSON.stringify({items:data.messages.map(message=>({kind:/[?？]/.test(message.text)?'concern':'fact',category:'个人信息',sourceMessageId:message.id,quote:message.text}))})};
  yield {type:'finish',reason:{kind:'stop'}};
}
async function setup(stream:(options:GenerateOptions)=>AsyncIterable<LlmChunk>=extraction){
  const directory=await mkdtemp(join(tmpdir(),'wenxiang-memory-')),backend=new JsonStorageBackend(directory),calls:GenerateOptions[]=[];
  const storage={backend:{get:(name:string)=>{assert.equal(name,'json');return backend;}}};
  const ctx={storage,llm:{listProviders:()=>[{id:route.provider,name:'Fixture'}],listModels:async()=>[{id:route.model,name:'Fixture'}],stream:(options:GenerateOptions)=>{calls.push(options);return stream(options);}}} as unknown as HostContext;
  const service=new MemoryService(ctx,config);await service.ready;
  return {directory,backend,ctx,calls,service,cleanup:async()=>{await service.dispose();await backend.close();await rm(directory,{recursive:true,force:true});}};
}
async function doc(service:MemoryService):Promise<MemoryDocument>{return value<MemoryDocument>(await service.rpc('document',{}));}
async function history(service:MemoryService):Promise<MemoryVersion[]>{return value<{versions:MemoryVersion[]}>(await service.rpc('versions',{})).versions;}

test('独立口令、真实 JSON 后端、重启恢复和改口令；明文标记不会保存到文件',async()=>{
  const s=await setup();
  try{
    assert.equal((await s.service.status()).initialized,false);await s.service.initialize(password);
    const initial=await doc(s.service),marker='我的生日是1991-03-08，出生时间不详。PRIVATE_SENTINEL_726';
    await s.service.save(marker,initial.revision,initial.epoch);
    await s.service.writeAudit('fixture-private',{input:marker,output:'synthetic private response'});
    for(const name of await readdir(s.directory)){const bytes=await readFile(join(s.directory,name),'utf8');assert.ok(!bytes.includes('PRIVATE_SENTINEL'));assert.ok(!bytes.includes('1991-03-08'));assert.ok(!bytes.includes(password));assert.ok(!bytes.includes('synthetic private response'));}
    await s.service.lock();failure(await s.service.rpc('document',{}),'MEMORY_LOCKED');await assert.rejects(s.service.freeze(),{code:'MEMORY_LOCKED'});
    failure(await s.service.rpc('unlock',{passphrase:'incorrect-passphrase'}),'MEMORY_UNLOCK');
    await s.service.unlock(password);assert.equal((await doc(s.service)).content,marker);
    let current=await doc(s.service);await s.service.changePassphrase(password,'changed-synthetic-only',current.epoch);
    await s.service.dispose();
    const restarted=new MemoryService(s.ctx,config);await restarted.ready;assert.equal((await restarted.status()).unlocked,false);
    failure(await restarted.rpc('unlock',{passphrase:password}),'MEMORY_UNLOCK');await restarted.unlock('changed-synthetic-only');assert.equal((await doc(restarted)).content,marker);await restarted.dispose();
  }finally{await s.cleanup();}
});
test('密文篡改拒绝解锁，认证失败不泄露原文',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const d=await doc(s.service);await s.service.save('我的生日是1991-03-08。',d.revision,d.epoch);await s.service.dispose();
    const path=join(s.directory,`${MEMORY_STORAGE_NAME}.json`),raw=JSON.parse(await readFile(path,'utf8'));raw.global.payload.ciphertext=(raw.global.payload.ciphertext[0]==='A'?'B':'A')+raw.global.payload.ciphertext.slice(1);await writeFile(path,JSON.stringify(raw));
    const restored=new MemoryService(s.ctx,config);await restored.ready;const response=await restored.rpc('unlock',{passphrase:password});failure(response,'MEMORY_UNLOCK');assert.ok(!JSON.stringify(response).includes('1991'));await restored.dispose();
  }finally{await s.cleanup();}
});
test('摘要只读取新增 user 消息，精确生日保留，固定段落不会覆盖，重复结束不调用模型',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const d=await doc(s.service);await s.service.save('我手动固定的生日是1991-03-08，出生时间不详。',d.revision,d.epoch);
    const checkpoint={moduleId:'meihua' as const,readingId:'reading-one',route,messages:[{id:'u1',text:'我目前在上海工作。'},{id:'u2',text:'今年适合转职吗？'}]};
    await s.service.checkpoint(checkpoint);const frozen=await s.service.freeze();assert.ok(frozen.markdown.includes('我目前在上海工作。'));assert.ok(frozen.markdown.includes('我手动固定的生日是1991-03-08，出生时间不详。'));assert.ok(frozen.markdown.includes('关注：今年适合转职吗？'));
    assert.equal(s.calls.length,1);assert.equal('sessionId' in s.calls[0]!,false);assert.equal(s.calls[0]!.messages.length,1);assert.equal(s.calls[0]!.messages[0]!.role,'user');
    await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(s.calls.length,1);
    await s.service.checkpoint({...checkpoint,messages:[...checkpoint.messages,{id:'u3',text:'我的生日是1991-03-08，出生时间不详。'}]});await s.service.freeze();assert.equal(s.calls.length,2);
    const lastInput=JSON.parse(s.calls[1]!.messages[0]!.content[0]!.text);assert.deepEqual(lastInput.messages,[{id:'u3',text:'我的生日是1991-03-08，出生时间不详。'}]);
  }finally{await s.cleanup();}
});
test('引用、第三方、假设和问题不能写成本人事实；无证据模型内容使整次摘要失败',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);
    await s.service.checkpoint({moduleId:'tarot',readingId:'reading-safe',route,messages:[{id:'friend',text:'我朋友的生日是1991-03-08。'},{id:'hypothetical',text:'假如我出生在2000年。'},{id:'quote',text:'引用：“我出生在2000年。”'},{id:'myself',text:'我的出生时间不详。'}]});
    const frozen=await s.service.freeze();assert.ok(frozen.markdown.includes('我的出生时间不详。'));assert.ok(!frozen.markdown.includes('1991'));assert.ok(!frozen.markdown.includes('2000'));
    s.ctx.llm.stream=async function*(){yield {type:'text-delta',index:0,text:JSON.stringify({items:[{kind:'fact',category:'个人信息',sourceMessageId:'bad',quote:'我的生日是1900-01-01。'}]})};yield {type:'finish',reason:{kind:'stop'}};};
    const before=await doc(s.service);await s.service.checkpoint({moduleId:'tarot',readingId:'reading-hallucination',route,messages:[{id:'bad',text:'我出生时间不详。'}]});await s.service.freeze();assert.equal((await doc(s.service)).content,before.content);assert.equal((await s.service.status()).error?.code,'MEMORY_SUMMARY');
  }finally{await s.cleanup();}
});
test('freeze 等待摘要并隔离本次快照，其他人和单次停用均不引用文档',async()=>{
  let unblock:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{unblock=resolve;});
  const s=await setup(async function*(options){await barrier;yield* extraction(options);});try{
    await s.service.initialize(password);await s.service.checkpoint({moduleId:'meihua',readingId:'reading-wait',route,messages:[{id:'one',text:'我目前在上海工作。'}]});
    let resolved=false;const waiting=s.service.freeze().then(snapshot=>{resolved=true;return snapshot;});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(resolved,false);unblock();const frozen=await waiting;
    const d=await doc(s.service);await s.service.save('我现在在北京工作。',d.revision,d.epoch);assert.ok(frozen.markdown.includes('上海'));assert.ok(!frozen.markdown.includes('北京'));
    assert.equal((await s.service.freeze({useBackground:false})).markdown,'');const others=await s.service.freeze({forOthers:true});assert.equal(others.enabled,false);assert.equal(others.forOthers,true);assert.equal(others.markdown,'');
  }finally{unblock();await s.cleanup();}
});
test('摘要期间的手动编辑不会被晚到输出覆盖；过期 CAS 被拒绝',async()=>{
  let unblock:()=>void=()=>{},started:()=>void=()=>{};const barrier=new Promise<void>(resolve=>{unblock=resolve;}),request=new Promise<void>(resolve=>{started=resolve;});
  const s=await setup(async function*(options){started();await barrier;yield* extraction(options);});try{
    await s.service.initialize(password);await s.service.checkpoint({moduleId:'meihua',readingId:'reading-concurrent',route,messages:[{id:'one',text:'我目前在上海工作。'}]});await request;
    const d=await doc(s.service);await s.service.save('手写固定段落。',d.revision,d.epoch);unblock();await s.service.freeze();assert.equal((await doc(s.service)).content,'手写固定段落。');assert.equal((await s.service.status()).error?.code,'MEMORY_CONFLICT');
    failure(await s.service.rpc('save',{content:'过期覆盖',expectedRevision:d.revision,epoch:d.epoch}),'MEMORY_CONFLICT');
  }finally{unblock();await s.cleanup();}
});
test('撤回生成新版本；已处理消息不复活；最多保留20版本',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);await s.service.checkpoint({moduleId:'meihua',readingId:'reading-rollback',route,messages:[{id:'one',text:'我目前在上海工作。'}]});await s.service.freeze();
    const initial=(await history(s.service)).find(v=>v.revision===0)!;let d=await doc(s.service);await s.service.rollback(initial.id,d.revision,d.epoch);assert.equal((await doc(s.service)).content,'');
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-rollback',route,messages:[{id:'one',text:'我目前在上海工作。'}]});await s.service.freeze();assert.equal(s.calls.length,1);assert.equal((await doc(s.service)).content,'');
    for(let i=0;i<23;i++){d=await doc(s.service);await s.service.save(`手动固定版本${i}`,d.revision,d.epoch);}assert.equal((await history(s.service)).length,20);
    d=await doc(s.service);failure(await s.service.rpc('save',{content:'字'.repeat(4001),expectedRevision:d.revision,epoch:d.epoch}),'MEMORY_INPUT');
  }finally{await s.cleanup();}
});
test('失败不自动重试，模型目录缺失为待更新；保存失败没有明文降级',async()=>{
  const s=await setup(async function*(){yield {type:'text-delta',index:0,text:'invalid output'};yield {type:'finish',reason:{kind:'stop'}};});try{
    await s.service.initialize(password);const checkpoint={moduleId:'meihua' as const,readingId:'reading-failed',route,messages:[{id:'one',text:'我目前在上海工作。'}]};
    await s.service.checkpoint(checkpoint);await s.service.freeze();await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(s.calls.length,1);assert.equal((await doc(s.service)).content,'');
    await s.service.checkpoint({...checkpoint,readingId:'reading-pending',route:undefined});assert.equal((await s.service.status()).pending,true);assert.equal(s.calls.length,1);
    const store=(s.service as unknown as {store:{save(value:unknown):Promise<void>}}).store,original=store.save;store.save=async()=>{throw Object.assign(new Error('PRIVATE_STORAGE_SENTINEL'),{code:'MEMORY_STORAGE'});};
    const d=await doc(s.service);const result=await s.service.rpc('save',{content:'PRIVATE_FALLBACK_SENTINEL',expectedRevision:d.revision,epoch:d.epoch});failure(result,'MEMORY_STORAGE');assert.ok(!JSON.stringify(result).includes('PRIVATE_STORAGE'));assert.equal((await doc(s.service)).content,'');store.save=original;
    assert.ok(!(await readFile(join(s.directory,`${MEMORY_STORAGE_NAME}.json`),'utf8')).includes('PRIVATE_FALLBACK'));
  }finally{await s.cleanup();}
});
test('清空取消在途提炼、删版本和审计、轮换密钥；旧页面和快照不能恢复资料',async()=>{
  let started:()=>void=()=>{};const request=new Promise<void>(resolve=>{started=resolve;});
  const s=await setup(async function*(options){started();await new Promise<void>(resolve=>options.signal.addEventListener('abort',()=>resolve(),{once:true}));options.signal.throwIfAborted();});try{
    await s.service.initialize(password);let d=await doc(s.service);await s.service.save('我手写的私人标记。',d.revision,d.epoch);await s.service.writeAudit('before-clear',{private:'OLD_PRIVATE_SENTINEL'});
    const oldBytes=JSON.parse(await readFile(join(s.directory,`${MEMORY_STORAGE_NAME}.json`),'utf8')),oldAudit=oldBytes.tables.audit['before-clear'];
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-clear',route,messages:[{id:'one',text:'我目前在上海工作。'}]});await request;d=await doc(s.service);let invalidated=false;s.service.onInvalidate(event=>{invalidated=event==='clear';});
    await s.service.clear(d.epoch);assert.equal(invalidated,true);assert.equal((await doc(s.service)).content,'');assert.deepEqual(await history(s.service),[]);failure(await s.service.rpc('save',{content:'旧页面恢复',expectedRevision:0,epoch:d.epoch}),'MEMORY_STALE');await assert.rejects(s.service.writeAudit('old-result',{private:'resurrect'},d.epoch),{code:'MEMORY_STALE'});
    const after=JSON.parse(await readFile(join(s.directory,`${MEMORY_STORAGE_NAME}.json`),'utf8'));assert.deepEqual(after.tables.audit,{});const unlocked=await unlockEnvelope(validateEnvelope(after.global),password);assert.throws(()=>decryptJson(unlocked.key,oldAudit,'wenxiang-memory-v1:audit:before-clear'),{code:'MEMORY_UNLOCK'});unlocked.key.fill(0);unlocked.wrappingKey.fill(0);
  }finally{await s.cleanup();}
});
test('明确重试只重试失败的新增消息；后台检查点不自动重试',async()=>{
  let malformed=true;const s=await setup(async function*(options){if(malformed){yield {type:'text-delta',index:0,text:'invalid json'};yield {type:'finish',reason:{kind:'stop'}};}else yield* extraction(options);});
  try{
    await s.service.initialize(password);const checkpoint={moduleId:'meihua' as const,readingId:'reading-retry',route,messages:[{id:'one',text:'我目前在上海工作。'}]};
    await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(s.calls.length,1);malformed=false;
    await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(s.calls.length,1);
    await s.service.checkpoint({...checkpoint,retry:true});await s.service.freeze();assert.equal(s.calls.length,2);assert.ok((await doc(s.service)).content.includes('上海'));assert.equal((await s.service.status()).pending,false);
    await s.service.checkpoint({...checkpoint,retry:true});await s.service.freeze();assert.equal(s.calls.length,2);
  }finally{await s.cleanup();}
});
test('生日冲突标记待核实；容量不足不会静默丢弃生日或手写内容',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);await s.service.checkpoint({moduleId:'meihua',readingId:'reading-birthday-one',route,messages:[{id:'one',text:'我的生日是1991-03-08。'}]});await s.service.freeze();
    await s.service.checkpoint({moduleId:'tarot',readingId:'reading-birthday-two',route,messages:[{id:'two',text:'我的生日是1992-04-09。'}]});await s.service.freeze();assert.ok((await doc(s.service)).content.includes('待核实'));assert.ok((await doc(s.service)).content.includes('1991-03-08'));assert.ok((await doc(s.service)).content.includes('1992-04-09'));
    const d=await doc(s.service),fixed=`生日固定：1991-03-08\n\n${'固定背景'.repeat(992)}`;assert.ok(fixed.length<4000);await s.service.save(fixed,d.revision,d.epoch);
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-overflow',route,messages:[{id:'long',text:`我目前处于${'长期状态'.repeat(60)}。`}]});await s.service.freeze();assert.equal((await doc(s.service)).content,fixed);assert.equal((await s.service.status()).error?.code,'MEMORY_LIMIT');
  }finally{await s.cleanup();}
});
test('初始化派生口令期间锁定，迟到初始化不会重新发布解密状态',async()=>{
  const s=await setup();try{
    const initializing=s.service.initialize(password);await new Promise(resolve=>setTimeout(resolve,20));await s.service.lock();await assert.rejects(initializing,{code:'MEMORY_STALE'});assert.equal((await s.service.status()).unlocked,false);
    // If the lock arrives before the initial write, the user can initialize again normally.
    if(!(await s.service.status()).initialized)await s.service.initialize(password);else await s.service.unlock(password);
    assert.equal((await s.service.status()).unlocked,true);
  }finally{await s.cleanup();}
});
test('持久化期间锁定：密文元数据跟随磁盘，重新解锁读取已成功写入的版本',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const d=await doc(s.service),store=(s.service as unknown as {store:{save(value:unknown):Promise<void>}}).store,original=store.save.bind(store);
    let entered:()=>void=()=>{},unblock:()=>void=()=>{};const reached=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{unblock=resolve;});
    store.save=async value=>{await original(value);entered();await barrier;};
    const saving=s.service.save('我目前在上海工作。',d.revision,d.epoch);await reached;await s.service.lock();unblock();await assert.rejects(saving,{code:'MEMORY_STALE'});store.save=original;
    assert.equal((await s.service.status()).unlocked,false);await s.service.unlock(password);assert.equal((await doc(s.service)).content,'我目前在上海工作。');
  }finally{await s.cleanup();}
});
test('手动改写自动段落后固定原文，下一次摘要不会重复；恢复旧版本保留其提炼条目',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);await s.service.checkpoint({moduleId:'meihua',readingId:'reading-original',route,messages:[{id:'one',text:'我目前在上海工作。'}]});await s.service.freeze();
    const oldVersion=(await history(s.service)).find(v=>v.revision===1)!;let d=await doc(s.service);
    const manuallyEdited=d.content.replace('## 个人信息','## 我的固定背景');await s.service.save(manuallyEdited,d.revision,d.epoch);
    await s.service.checkpoint({moduleId:'tarot',readingId:'reading-next',route,messages:[{id:'two',text:'我近期想换工作。'}]});await s.service.freeze();d=await doc(s.service);assert.equal(d.content.split('我目前在上海工作。').length-1,1);assert.ok(d.content.includes(manuallyEdited));
    await s.service.rollback(oldVersion.id,d.revision,d.epoch);
    await s.service.checkpoint({moduleId:'tarot',readingId:'reading-after-rollback',route,messages:[{id:'three',text:'我近期希望提升专业技能。'}]});await s.service.freeze();d=await doc(s.service);assert.ok(d.content.includes('我目前在上海工作。'));assert.ok(d.content.includes('提升专业技能'));assert.ok(!d.content.includes('我近期想换工作。'));
  }finally{await s.cleanup();}
});
test('Memory RPC 检查点必须带当前 epoch；无效 route 和 retry 在模型调用前被拒绝',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const epoch=(await s.service.status()).epoch,payload={moduleId:'meihua',readingId:'reading-rpc',route,messages:[{id:'one',text:'我目前在上海工作。'}]};
    failure(await s.service.rpc('checkpoint',payload),'MEMORY_INPUT');await s.service.clear(epoch);failure(await s.service.rpc('checkpoint',{...payload,epoch}),'MEMORY_STALE');
    const current=(await s.service.status()).epoch;failure(await s.service.rpc('checkpoint',{...payload,epoch:current,route:{provider:'',model:'fixture'}}),'MEMORY_INPUT');failure(await s.service.rpc('checkpoint',{...payload,epoch:current,retry:'true'}),'MEMORY_INPUT');assert.equal(s.calls.length,0);
  }finally{await s.cleanup();}
});
test('长对话全量检查点可超过100条，只给模型新增消息；总输入上限60,000字符',async()=>{
  const s=await setup(async function*(options){const input=JSON.parse(options.messages[0]!.content[0]!.text),latest=input.messages.at(-1);yield {type:'text-delta',index:0,text:JSON.stringify({items:latest?[{kind:'concern',category:'持续关注的问题',sourceMessageId:latest.id,quote:latest.text}]:[]})};yield {type:'finish',reason:{kind:'stop'}};});
  try{
    await s.service.initialize(password);const older=Array.from({length:101},(_,i)=>({id:`old-${i}`,text:`第${i}个关注问题？`}));
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-long',route,messages:older});await s.service.freeze();assert.equal(s.calls.length,1);
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-long',route,messages:[...older,{id:'new',text:'我近期想换工作。'}]});await s.service.freeze();assert.equal(s.calls.length,2);assert.deepEqual(JSON.parse(s.calls[1]!.messages[0]!.content[0]!.text).messages,[{id:'new',text:'我近期想换工作。'}]);
    const epoch=(await s.service.status()).epoch;failure(await s.service.rpc('checkpoint',{moduleId:'meihua',readingId:'reading-oversize',route,epoch,messages:Array.from({length:31},(_,i)=>({id:`huge-${i}`,text:'字'.repeat(2000)}))}),'MEMORY_INPUT');assert.equal(s.calls.length,2);
  }finally{await s.cleanup();}
});

test('第三方亲属、模型转述、预测和非真实示例均不归入本人事实；直接本人信息与目标仍保留',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);
    const excluded=[
      '我妹妹的生日是1998-02-03。','我丈夫出生于1990-04-05。','我孩子出生在北京。',
      '我祖母的出生时间是上午八点。','我客户的职业是律师。',
      '我嫂子的生日是1998-02-03。','我舅舅的职业是律师。','我家人的所在地是北京。',
      '我同学的出生时间是上午八点。','我的导师的生日是1998-02-03。','我的邻居出生在上海。',
      '我爸妈出生在北京。','我哥的生日是1998-02-03。','我爱人出生在上海。',
      '我的工作伙伴的年龄是30岁。','我现在的导师出生在上海。','我自己的妹妹出生在北京。',
      '我目前在照顾小明，小明出生在上海。',
      '我问模型得到的答案是我出生于2000-01-01。','根据塔罗解读，我的所在地是杭州。',
      'AI告诉我，我的出生时间是上午八点。','我的生日是1990-02-03（举例，非真实）。',
      '我的生日是1990-02-03，这只是一个示例。','我一定会在明年结婚。','我的职业应该是医生。',
    ];
    const included=['我的生日是1991-03-08，出生时间不详。','我从事人工智能研究工作。','我计划明年提升写作技能。'];
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-direct-source',route,messages:[...excluded,...included].map((text,i)=>({id:`source-${i}`,text}))});
    const background=(await s.service.freeze()).markdown;
    for(const quote of excluded)assert.ok(!background.includes(quote),`indirect source saved as a personal fact: ${quote}`);
    for(const quote of included)assert.ok(background.includes(quote),`direct self report lost: ${quote}`);
    assert.equal(s.calls.length,1);
  }finally{await s.cleanup();}
});

test('所有本人事实需完整陈述边界，模型不能裁去转述来源或未知第三方主语',async()=>{
  const cases=[
    {text:'某人告诉我说我喜欢咖啡。',quote:'我喜欢咖啡。'},
    {text:'最近了解到我喜欢咖啡。',quote:'我喜欢咖啡。'},
    {text:'我嫂子说她喜欢咖啡。',quote:'喜欢咖啡。'},
    {text:'模型预测如下：\n我喜欢咖啡。',quote:'我喜欢咖啡。'},
    {text:'我喜欢咖啡，但是这一句是非真实示例。',quote:'我喜欢咖啡'},
    {text:'我目前在上海工作。\n我计划提升写作技能。',quote:'我目前在上海工作。'},
  ];
  const s=await setup(async function*(options){const input=JSON.parse(options.messages[0]!.content[0]!.text);yield {type:'text-delta',index:0,text:JSON.stringify({items:input.messages.map((message:{id:string},i:number)=>({kind:'fact',category:'近期处境与目标',sourceMessageId:message.id,quote:cases[i]!.quote}))})};yield {type:'finish',reason:{kind:'stop'}};});
  try{
    await s.service.initialize(password);await s.service.checkpoint({moduleId:'tarot',readingId:'reading-statement-boundary',route,messages:cases.map((item,i)=>({id:`boundary-${i}`,text:item.text}))});
    const background=(await s.service.freeze()).markdown;assert.ok(background.includes('我目前在上海工作。'));assert.ok(!background.includes('咖啡'));
  }finally{await s.cleanup();}
});

test('固定段落内每一个字段都参与冲突核对；出生、年龄、职业、婚姻和明确偏好冲突均标待核实',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const d=await doc(s.service);
    const fixed='## 个人信息\n我的生日是1991-03-08。\n我的出生时间是上午八点。\n我的所在地是上海。\n我的年龄是30岁。\n我的职业是程序员。\n我已婚。\n我喜欢咖啡。\n我偏好简洁的回答。\n我不接受长篇建议。';
    await s.service.save(fixed,d.revision,d.epoch);
    const changed=['我的出生时间是上午十点。','我的所在地是北京。','我今年31岁。','我的职业是教师。','我单身。','我不喜欢咖啡。','我偏好详细的回答。','我接受长篇建议。'];
    await s.service.checkpoint({moduleId:'tarot',readingId:'reading-explicit-conflicts',route,messages:changed.map((text,i)=>({id:`changed-${i}`,text}))});
    const background=(await s.service.freeze()).markdown;
    assert.ok(background.includes(fixed),'fixed paragraph must remain verbatim');
    for(const quote of changed)assert.ok(background.includes(`待核实（用户陈述不一致）：${quote}`),`explicit conflict not labelled: ${quote}`);
  }finally{await s.cleanup();}
});

test('同一字段的同值、未知信息补充和不同偏好对象不误标冲突，内容保持用户原文',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const d=await doc(s.service);
    const fixed='## 个人信息\n我的生日是1991-03-08。\n我的出生时间是上午八点。\n我的年龄是30岁。\n我的职业是程序员。\n我的出生地不详。\n我喜欢咖啡。\n我不接受长篇建议。';
    await s.service.save(fixed,d.revision,d.epoch);
    const unchanged=['我的出生日期是1991-03-08。','我的出生时辰是上午八点。','我今年30岁。','我的职业是一名程序员。','我的出生地是上海。','本人喜欢咖啡。','我喜欢茶。','本人不接受长篇建议。','我近期在上海学习。','我近期在北京旅游。'];
    await s.service.checkpoint({moduleId:'meihua',readingId:'reading-equivalent-values',route,messages:unchanged.map((text,i)=>({id:`equivalent-${i}`,text}))});
    const background=(await s.service.freeze()).markdown;
    assert.ok(background.includes(fixed));assert.ok(!background.includes('待核实'));
    for(const quote of unchanged)assert.ok(background.includes(quote),`original user wording lost: ${quote}`);
  }finally{await s.cleanup();}
});

test('模型目录失败不被普通检查点自动重试；新消息成功不解除旧失败的抑制，显式重试只处理失败消息',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);
    const original=s.ctx.llm.listModels;let unavailable=true,catalogCalls=0;
    s.ctx.llm.listModels=async provider=>{catalogCalls++;if(unavailable)throw new Error('synthetic catalog failure');return original(provider);};
    const first={id:'first',text:'我目前在上海工作。'},second={id:'second',text:'我近期想提升写作技能。'};
    const checkpoint={moduleId:'meihua' as const,readingId:'reading-catalog-failed',route,messages:[first]};
    await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(catalogCalls,1);assert.equal(s.calls.length,0);assert.equal((await s.service.status()).error?.code,'MEMORY_FAILED');
    unavailable=false;await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(catalogCalls,1);assert.equal(s.calls.length,0);
    await s.service.checkpoint({...checkpoint,messages:[first,second]});await s.service.freeze();assert.equal(s.calls.length,1);assert.deepEqual(JSON.parse(s.calls[0]!.messages[0]!.content[0]!.text).messages,[second]);assert.equal((await s.service.status()).pending,true);
    await s.service.checkpoint({...checkpoint,messages:[first,second]});await s.service.freeze();assert.equal(s.calls.length,1);
    await s.service.checkpoint({...checkpoint,messages:[first,second],retry:true});await s.service.freeze();assert.equal(s.calls.length,2);assert.deepEqual(JSON.parse(s.calls[1]!.messages[0]!.content[0]!.text).messages,[first]);assert.equal((await s.service.status()).pending,false);
    const background=(await doc(s.service)).content;assert.ok(background.includes(first.text));assert.ok(background.includes(second.text));
    await s.service.checkpoint({...checkpoint,messages:[first,second],retry:true});await s.service.freeze();assert.equal(s.calls.length,2);
    await s.service.checkpoint({...checkpoint,readingId:'reading-no-model',route:undefined});assert.equal((await s.service.status()).pending,true);
    await s.service.checkpoint({...checkpoint,readingId:'reading-no-model'});await s.service.freeze();assert.equal(s.calls.length,3);
  }finally{await s.cleanup();}
});

test('首次摘要的加密保存失败后仅保留旧文档，普通检查点不会因存储恢复而自动重试',async()=>{
  const s=await setup();try{
    await s.service.initialize(password);const d=await doc(s.service);await s.service.save('我的出生时间不详。',d.revision,d.epoch);
    const store=(s.service as unknown as {store:{save(value:unknown):Promise<void>}}).store,original=store.save;
    store.save=async()=>{throw Object.assign(new Error('synthetic encrypted write failure'),{code:'MEMORY_STORAGE'});};
    const checkpoint={moduleId:'meihua' as const,readingId:'reading-storage-failed',route,messages:[{id:'one',text:'我目前在上海工作。'}]};
    await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(s.calls.length,0);assert.equal((await doc(s.service)).content,'我的出生时间不详。');assert.equal((await s.service.status()).error?.code,'MEMORY_STORAGE');
    store.save=original;await s.service.checkpoint(checkpoint);await s.service.freeze();assert.equal(s.calls.length,0);
    await s.service.checkpoint({...checkpoint,retry:true});await s.service.freeze();assert.equal(s.calls.length,1);assert.ok((await doc(s.service)).content.includes('我目前在上海工作。'));
  }finally{await s.cleanup();}
});
