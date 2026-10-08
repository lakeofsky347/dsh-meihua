import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MeihuaService } from '../src/host/service.ts';
import { TarotService } from '../src/host/tarot-service.ts';
import { GenerationGate } from '../src/host/generation-gate.ts';
import { conversationMessages, followupSystem } from '../src/host/conversation.ts';
import { readingIsBusy } from '../src/shared/protocol.ts';
import type { PluginConfig, Reading, TarotReading } from '../src/shared/protocol.ts';
import type { GenerateOptions, HostContext, LlmChunk, LogEvent, LogSession, PersistenceHandle } from '../src/host/platform.ts';

const sessionPackage:string='@deepseek-ai/dsh-session';
const {Session}=await import(sessionPackage) as {Session:new(id:string,seed:undefined,header:object)=>LogSession};
const config:PluginConfig={timeZone:'Asia/Shanghai',animationMs:0,interpretationTimeoutMs:180,maxOutputTokens:3000,pollIntervalMs:100};
const route={provider:'configured',model:'chosen'};
const input={ruleId:'three-numbers',question:'如何安排这次学习？',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-05T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}};
type Service=MeihuaService|TarotService;
type Current=Reading|TarotReading;
type Module='meihua'|'tarot';
async function* complete(_options:GenerateOptions,index:number):AsyncGenerator<LlmChunk>{
  yield {type:'text-delta',index:0,text:index===0?'首份完整解读':`追问回答 ${index}`};yield {type:'finish',reason:{kind:'stop'}};
}
async function* pending(options:GenerateOptions):AsyncGenerator<LlmChunk>{
  yield {type:'text-delta',index:0,text:'保留部分回答'};
  await new Promise<void>(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',()=>resolve(),{once:true});});options.signal.throwIfAborted();
}
function setup(module:Module,generate:(options:GenerateOptions,index:number)=>AsyncIterable<LlmChunk>=complete,persistence?:HostContext['sessionPersistence']){
  const calls:GenerateOptions[]=[],events:LogEvent[]=[],durable=new Set<string>(),gate=new GenerationGate();
  const ctx:HostContext={
    llm:{listProviders:()=>[{id:route.provider,name:'Configured'}],listModels:async()=>[{id:route.model,name:'Chosen'}],stream:options=>{
      assert.equal(durable.size,calls.length+1,'each request metadata must be durable before streaming');assert.equal(options.sessionId,undefined,'private provider requests omit the ordinary Session ID');calls.push(options);return generate(options,calls.length-1);
    }},
    sessions:{prepare:id=>new Session(id!,undefined,{id,version:4,createdAt:Date.now(),isSeeded:false})},
    sessionPersistence:{create:async header=>{
      const handle=persistence?await persistence.create(header):{append:async(rows:readonly LogEvent[])=>{events.push(...rows);},flush:async()=>{},close:async()=>{}};
      return {append:rows=>handle.append(rows),flush:async()=>{await handle.flush();durable.add(header.id);},close:()=>handle.close()};
    }},
    connection:{fetch:{register:()=>async()=>{}}},reflect:{provide:()=>async()=>{}},effect:factory=>factory(),
  };
  const service:Service=module==='meihua'?new MeihuaService(ctx,config,gate):new TarotService(ctx,config,gate);
  return {ctx,service,gate,calls,events};
}
async function ready(service:Service):Promise<Current>{
  if(service instanceof MeihuaService)return service.cast(input);
  const reading=service.start({question:input.question,spreadId:'timeline',includeReversed:true});
  for(let index=0;index<reading.spread.cardCount;index++)service.select(reading.id,index);
  return service.reveal(reading.id,undefined,true);
}
async function settled(service:Service):Promise<Current>{
  for(let index=0;index<200;index++){const reading=service.snapshot()!;if(!readingIsBusy(reading))return reading;await new Promise(resolve=>setTimeout(resolve,3));}
  throw new Error('conversation did not settle');
}
async function first(service:Service):Promise<Current>{const reading=await ready(service);await service.interpret(reading.id,route);return settled(service);}
async function partialArrived(service:Service):Promise<void>{
  for(let index=0;index<200&&!service.snapshot()!.conversation?.at(-1)?.text;index++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(service.snapshot()!.conversation?.at(-1)?.text);
}

for(const module of ['meihua','tarot'] as const){
  test(`${module} 多轮追问保持首解读与固定结果、原模型，完整角色顺序只进入私人模型请求`,async()=>{
    const s=setup(module),original=await first(s.service);
    await s.service.followup(original.id,'第一轮具体怎么做？',0);const one=await settled(s.service);
    assert.equal(one.conversation!.length,1);assert.equal(one.conversation![0]!.status,'complete');assert.equal(one.conversation![0]!.text,'追问回答 1');
    await s.service.followup(original.id,'结合刚才的建议，第二步呢？',1);const two=await settled(s.service);
    const {conversation,...unchanged}=two;assert.deepEqual(unchanged,original);assert.ok(Object.isFrozen(conversation));
    assert.equal(s.calls.length,3);assert.ok(s.calls.every(call=>call.provider===route.provider&&call.model===route.model));
    assert.deepEqual(s.calls[1]!.messages.map(message=>message.role),['user','assistant','user']);
    assert.deepEqual(s.calls[2]!.messages.map(message=>message.role),['user','assistant','user','assistant','user']);
    assert.equal(s.calls[2]!.messages[1]!.content[0]!.text,original.text);
    assert.equal(s.calls[2]!.messages[2]!.content[0]!.text,'第一轮具体怎么做？');assert.equal(s.calls[2]!.messages[3]!.content[0]!.text,'追问回答 1');
    assert.ok(s.calls[2]!.messages[0]!.content[0]!.text.includes(input.question));assert.ok(s.calls[2]!.system.includes('不重复首次解读的固定结构'));
    assert.notEqual(conversation![0]!.logSessionId,original.logSessionId);assert.notEqual(conversation![1]!.logSessionId,conversation![0]!.logSessionId);
    const starts=s.events.filter(event=>event.type==='turn/start');assert.equal(starts.length,3);
    assert.equal(s.events.filter(event=>event.type==='private/request').length,3);
    assert.ok(!s.events.some(event=>event.type==='system/message'||event.type==='user/message'));
    const log=JSON.stringify(s.events);for(const fragment of [input.question,original.text,'第一轮具体怎么做？','结合刚才的建议，第二步呢？','追问回答 1','追问回答 2'])assert.ok(!log.includes(fragment));
    await assert.rejects(s.service.interpret(original.id,route),/第一次/);s.gate.assertIdle();await s.service.dispose();
  });
  test(`${module} 双窗口重复追问只提交一轮；繁忙时禁止重起与重新解读`,async()=>{
    const s=setup(module,(options,index)=>index===0?complete(options,index):pending(options)),original=await first(s.service);
    const results=await Promise.allSettled([s.service.followup(original.id,'同一轮',0),s.service.followup(original.id,'重复提交',0)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(s.service.snapshot()!.conversation!.length,1);
    await partialArrived(s.service);await assert.rejects(ready(s.service),/解读|追问/);await assert.rejects(s.service.interpret(original.id,route),/等待/);
    const snapshot=s.service.snapshot()!;assert.equal(snapshot.status,'complete');assert.equal(snapshot.text,original.text);assert.ok(readingIsBusy(snapshot));
    s.service.cancel(original.id,s.service.snapshot()!.conversation![0]!.id);const final=await settled(s.service);assert.equal(final.conversation![0]!.status,'cancelled');assert.equal(s.calls.length,2);s.gate.assertIdle();await s.service.dispose();
  });
  test(`${module} 旧窗口取消旧轮和缺失轮次不能中断新追问，正确轮次才取消`,async()=>{
    const s=setup(module,(options,index)=>index<2?complete(options,index):pending(options)),original=await first(s.service);
    const oldWindow=await s.service.followup(original.id,'第一轮追问',0),oldTurnId=oldWindow.conversation![0]!.id;
    assert.equal(oldWindow.conversation![0]!.status,'streaming');await settled(s.service);
    assert.equal(s.service.cancel(original.id,oldTurnId).conversation![0]!.status,'complete','cancel of an already settled turn is harmless');
    await s.service.followup(original.id,'另一个窗口的新追问',1);await partialArrived(s.service);
    const newTurnId=s.service.snapshot()!.conversation![1]!.id,signal=s.calls[2]!.signal;
    assert.throws(()=>s.service.cancel(original.id,oldTurnId),error=>error instanceof Error&&'code' in error&&error.code==='CONVERSATION_CHANGED');
    assert.throws(()=>s.service.cancel(original.id),error=>error instanceof Error&&'code' in error&&error.code==='CONVERSATION_CHANGED');
    for(const turnId of [oldTurnId,undefined,'',123,{},'a'.repeat(161)]){
      const result=await s.service.rpc('cancel',{id:original.id,turnId});assert.equal(result.ok,false);
      if(turnId===oldTurnId||turnId===undefined)assert.equal(!result.ok&&result.error.code,'CONVERSATION_CHANGED');
      assert.equal(signal.aborted,false);assert.equal(s.service.snapshot()!.conversation![1]!.status,'streaming');
    }
    const cancelled=await s.service.rpc('cancel',{id:original.id,turnId:newTurnId});assert.equal(cancelled.ok,true);assert.equal(signal.aborted,true);
    const final=await settled(s.service);assert.equal(final.conversation![0]!.status,'complete');assert.equal(final.conversation![1]!.status,'cancelled');assert.equal(final.conversation![1]!.text,'保留部分回答');assert.equal(final.text,original.text);
    assert.equal(s.calls.length,3);s.gate.assertIdle();await s.service.dispose();
  });
  test(`${module} 追问取消、超时与卸载保留部分文字，初解读完全不变`,async()=>{
    for(const mode of ['cancel','timeout','dispose']){
      const s=setup(module,(options,index)=>index===0?complete(options,index):pending(options)),original=await first(s.service);
      await s.service.followup(original.id,'说明一下',0);await partialArrived(s.service);
      if(mode==='cancel')s.service.cancel(original.id,s.service.snapshot()!.conversation![0]!.id);if(mode==='dispose')await s.service.dispose();
      const final=await settled(s.service),turn=final.conversation![0]!;
      assert.equal(turn.status,'cancelled');assert.equal(turn.text,'保留部分回答');assert.equal(turn.error!.code,mode==='timeout'?'TIMEOUT':'CANCELLED');
      const {conversation,...unchanged}=final;assert.deepEqual(unchanged,original);assert.ok(s.events.some(event=>event.type==='private/result'&&(event.data as {status:string}).status==='cancelled'));s.gate.assertIdle();await s.service.dispose();
    }
  });
  test(`${module} 模型错误、截断、空输出只结束当前轮，下一轮保留失败上下文`,async()=>{
    for(const [finish,code] of [[{kind:'error',failure:{code:'AUTH',message:'credential unavailable'}},'AUTH'],[{kind:'max-tokens'},'INCOMPLETE'],[{kind:'stop'},'EMPTY_RESPONSE']] as const){
      const s=setup(module,async function*(options,index){
        if(index!==1){yield* complete(options,index);return;}
        if(code!=='EMPTY_RESPONSE')yield {type:'text-delta',index:0,text:'部分文字'};yield {type:'finish',reason:finish};
      }),original=await first(s.service);
      await s.service.followup(original.id,'可能的阻碍呢？',0);const failed=await settled(s.service);
      assert.equal(failed.conversation![0]!.status,'failed');assert.equal(failed.conversation![0]!.error!.code,code);assert.equal(failed.text,original.text);assert.equal(failed.status,'complete');
      await s.service.followup(original.id,'再解释下一步',1);assert.equal((await settled(s.service)).conversation![1]!.status,'complete');
      const context=s.calls[2]!.messages[3]!.content[0]!.text;assert.ok(context.includes('未完成'));if(code!=='EMPTY_RESPONSE')assert.ok(context.includes('部分文字'));
      assert.equal(s.calls.length,3);await s.service.dispose();
    }
  });
  test(`${module} 输入、首解读条件与原模型可用性检查失败不消耗新一轮`,async()=>{
    const s=setup(module),prepared=await ready(s.service);await assert.rejects(s.service.followup(prepared.id,'先问',0),/首次/);
    await s.service.interpret(prepared.id,route);const original=await settled(s.service);
    for(const [question,count] of [['',0],['  ',0],['a'.repeat(2001),0],[123,0],['问题','0'],['问题',-1],['问题',0.5],['问题',1],['问题',NaN]] as const)await assert.rejects(s.service.followup(original.id,question,count));
    assert.equal((await s.service.rpc('followup',{id:original.id,question:'有效问题',expectedTurnCount:'0'})).ok,false);
    s.ctx.llm.listModels=async()=>[];await assert.rejects(s.service.followup(original.id,'模型检查',0),/模型/);
    s.ctx.llm.listModels=async()=>[{id:route.model,name:'Chosen'}];s.ctx.llm.listProviders=()=>[];await assert.rejects(s.service.followup(original.id,'供应商检查',0),/供应商/);
    assert.equal(s.service.snapshot()!.conversation,undefined);assert.equal(s.calls.length,1);await s.service.dispose();
    const empty=setup(module,async function*(){yield {type:'finish',reason:{kind:'stop'}};}),emptyReading=await first(empty.service);
    await assert.rejects(empty.service.followup(emptyReading.id,'没有首解读',0),/无文字/);await empty.service.dispose();
  });
  test(`${module} 目录预检期间禁止换轮，取消或卸载后迟到追问不提交`,async()=>{
    for(const mode of ['cancel','dispose']){
      const s=setup(module),original=await first(s.service);let releaseModels!:(models:{id:string;name:string}[])=>void;
      s.ctx.llm.listModels=()=>new Promise(resolve=>{releaseModels=resolve;});
      const followup=s.service.followup(original.id,'旧会话问题',0),rejected=assert.rejects(followup,{code:'CANCELLED'});
      await assert.rejects(ready(s.service),{code:'GENERATION_BUSY'});
      if(mode==='dispose')await s.service.dispose();else s.service.cancel(original.id,undefined,undefined,s.service.snapshot()!.preflight!.id);
      await rejected;releaseModels([{id:route.model,name:'Chosen'}]);await new Promise(resolve=>setTimeout(resolve,2));
      assert.equal(s.calls.length,1);assert.deepEqual(s.service.snapshot(),original);
      s.gate.assertIdle();await s.service.dispose();
    }
  });
}

test('不同窗口目录预检互斥，取消旧预检后迟到结果不覆盖新追问',async()=>{
  const s=setup('meihua'),original=await first(s.service);let releaseModels!:(models:{id:string;name:string}[])=>void;
  s.ctx.llm.listModels=()=>new Promise(resolve=>{releaseModels=resolve;});const stale=s.service.followup(original.id,'旧窗口草稿',0);
  const rejected=assert.rejects(stale,{code:'CANCELLED'});await assert.rejects(s.service.followup(original.id,'新窗口追问',0),{code:'GENERATION_BUSY'});
  s.service.cancel(original.id,undefined,undefined,s.service.snapshot()!.preflight!.id);await rejected;
  s.ctx.llm.listModels=async()=>[{id:route.model,name:'Chosen'}];await s.service.followup(original.id,'新窗口追问',0);await settled(s.service);
  releaseModels([{id:route.model,name:'Chosen'}]);await new Promise(resolve=>setTimeout(resolve,2));assert.equal(s.calls.length,2);assert.equal(s.service.snapshot()!.conversation!.length,1);await s.service.dispose();
});
test('跨梅花与塔罗的追问共享 GenerationGate；取消后可继续另一个模块',async()=>{
  const s=setup('meihua',(options,index)=>index<2?complete(options,index):pending(options)),tarot=new TarotService(s.ctx,config,s.gate);
  const meihuaReading=await first(s.service),tarotReading=await first(tarot);
  await s.service.followup(meihuaReading.id,'梅花追问',0);await partialArrived(s.service);
  await assert.rejects(tarot.followup(tarotReading.id,'塔罗追问',0),/另一份解读/);assert.equal(tarot.snapshot()!.conversation,undefined);
  assert.throws(()=>tarot.start({question:'新问题',spreadId:'single',includeReversed:true}),/另一份解读/);
  s.service.cancel(meihuaReading.id,s.service.snapshot()!.conversation![0]!.id);await settled(s.service);s.gate.assertIdle();
  await tarot.followup(tarotReading.id,'现在继续',0);await partialArrived(tarot);tarot.cancel(tarotReading.id,tarot.snapshot()!.conversation![0]!.id);await settled(tarot);assert.equal(s.calls.length,4);
  await s.service.dispose();await tarot.dispose();
});
test('上下文超过容量明确拒绝且不截断历史；初次部分解读保留未完成标记',async()=>{
  const s=setup('meihua',async function*(){yield {type:'text-delta',index:0,text:'a'.repeat(60000)};yield {type:'finish',reason:{kind:'max-tokens'}};}),original=await first(s.service);
  await assert.rejects(s.service.followup(original.id,'保留草稿',0),/60000/);assert.equal(s.calls.length,1);assert.equal(s.service.snapshot()!.conversation,undefined);s.gate.assertIdle();await s.service.dispose();
  const messages=conversationMessages({...original,text:'首解读部分文字'},'固定记录','继续讲讲',followupSystem('meihua'));
  assert.ok(messages[1]!.content[0]!.text.includes('未完成'));assert.ok(messages[1]!.content[0]!.text.includes('首解读部分文字'));
});
test('追问请求日志写入失败阻止模型调用，释放锁并保留首解读',async()=>{
  let creation=0,closed=0;
  const s=setup('tarot',complete,{create:async()=>{creation++;const fail=creation===2;return {append:async()=>{if(fail)throw new Error('disk unavailable');},flush:async()=>{},close:async()=>{closed++;}};}}),original=await first(s.service);
  await s.service.followup(original.id,'日志失败测试',0);const final=await settled(s.service);
  assert.equal(final.conversation![0]!.status,'failed');assert.equal(final.conversation![0]!.error!.code,'LOG_WRITE');assert.equal(final.text,original.text);assert.equal(s.calls.length,1);assert.equal(closed,2);s.gate.assertIdle();await s.service.dispose();
});
test('首次解读失败或取消但已有文字时可追问，完整保留原终态并提醒部分内容',async()=>{
  for(const module of ['meihua','tarot'] as const)for(const mode of ['failed','cancelled'] as const){
    const s=setup(module,async function*(options,index){
      if(index!==0){yield* complete(options,index);return;}
      if(mode==='cancelled'){yield* pending(options);return;}
      yield {type:'text-delta',index:0,text:'首份部分解读'};yield {type:'finish',reason:{kind:'max-tokens'}};
    });
    const prepared=await ready(s.service);await s.service.interpret(prepared.id,route);
    if(mode==='cancelled'){
      for(let index=0;index<200&&!s.service.snapshot()!.text;index++)await new Promise(resolve=>setTimeout(resolve,2));
      s.service.cancel(prepared.id);
    }
    const original=await settled(s.service);assert.equal(original.status,mode);
    await s.service.followup(original.id,'接着解释这部分',0);const final=await settled(s.service);
    const {conversation,...unchanged}=final;assert.deepEqual(unchanged,original);assert.equal(conversation![0]!.status,'complete');
    assert.ok(s.calls[1]!.messages[1]!.content[0]!.text.includes('未完成'));assert.ok(s.calls[1]!.messages[1]!.content[0]!.text.includes(original.text));
    await s.service.dispose();
  }
});
test('官方 DSH JSONL 后端读回两模块当前轮终态元信息，无私人问答或固定结果全文',async()=>{
  const cordisPackage:string='@deepseek-ai/cordis';type Fiber={await():Promise<void>;dispose():Promise<void>};
  const {Context}=await import(cordisPackage) as {Context:new()=>{plugin(plugin:unknown,config:object):Fiber;get(name:string):unknown}};
  const module=await import(pathToFileURL(resolve('.local/runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href) as {default:unknown};
  const root=await mkdtemp(join(tmpdir(),'conversation-log-')),ctx=new Context(),fiber=ctx.plugin(module.default,{root,compression:'none'});await fiber.await();
  const persistence=ctx.get('sessionPersistence') as HostContext['sessionPersistence']&{open(id:string,mode:'read'):Promise<PersistenceHandle&{read():Promise<{events:LogEvent[]}>}>;locate(meta:LogSession['header']):{path:string}};
  try{
    for(const module of ['meihua','tarot'] as const){
      const s=setup(module,complete,persistence);
      try{
        const original=await first(s.service);await s.service.followup(original.id,'第一轮持久化问题',0);await settled(s.service);await s.service.followup(original.id,'第二轮持久化问题',1);
        const final=await settled(s.service),turn=final.conversation![1]!;assert.equal(turn.status,'complete');assert.equal(turn.error,undefined);
        const handle=await persistence.open(turn.logSessionId!,'read'),{events}=await handle.read();await handle.close();
        assert.deepEqual(events.map(event=>event.type),['turn/start','step/start','request/header','private/request','private/result','step/end','turn/end']);
        assert.equal((events.find(event=>event.type==='private/result')!.data as {status:string}).status,'complete');
        assert.ok(events.filter(event=>event.type.startsWith('private/')).every(event=>(event as LogEvent&{ignorable?:boolean}).ignorable===true));
        assert.equal(events.at(-1)!.type,'turn/end');assert.deepEqual((events.at(-1)!.data as {reason:unknown}).reason,{kind:'completed'});
        const body=await readFile(persistence.locate({id:turn.logSessionId!,version:4,createdAt:0}).path,'utf8');
        for(const fragment of [input.question,original.text,'第一轮持久化问题','追问回答 1','第二轮持久化问题','追问回答 2'])assert.ok(!body.includes(fragment));
        if('cards' in original)assert.ok(!body.includes(original.cards[0]!.card!.id));else assert.ok(!body.includes(original.result.primary.name));
        assert.equal(s.calls.length,3);
      }finally{await s.service.dispose();}
    }
  }finally{await fiber.dispose();await rm(root,{recursive:true,force:true});}
});


for(const module of ['meihua','tarot'] as const){
  test(`${module} 手动补全保留固定结果、原文字、独立审计并拒绝过期恢复`,async()=>{
    const s=setup(module,async function*(_options,index){yield {type:'text-delta',index:0,text:index===0?'未完成前缀':'补全正文'};yield {type:'finish',reason:{kind:index<2?'max-tokens':'stop'}};});
    try {
      const initial=await first(s.service),fixed='result'in initial?initial.result:initial.cards;
      assert.equal(initial.status,'failed');assert.equal(s.calls.length,1);
      const response=await s.service.rpc('resume',{id:initial.id,expectedTurnCount:0,expectedAttempt:0});assert.equal(response.ok,true);
      const partial=await settled(s.service);assert.equal(partial.text,'未完成前缀\n\n补全正文');assert.equal(partial.generation?.attempt,1);
      assert.deepEqual('result'in partial?partial.result:partial.cards,fixed);assert.notEqual(partial.logSessionId,initial.logSessionId);
      const stale=await s.service.rpc('resume',{id:initial.id,expectedTurnCount:0,expectedAttempt:0});assert.equal(stale.ok,false);assert.equal(!stale.ok&&stale.error.code,'CONVERSATION_CHANGED');assert.equal(s.calls.length,2);
      await s.service.resume(initial.id,{expectedTurnCount:0,expectedAttempt:1});const final=await settled(s.service);assert.equal(final.status,'complete');assert.equal(final.generation?.attempt,2);assert.ok(s.calls[2]!.messages.some(message=>message.role==='assistant'&&message.content[0]!.text===partial.text));
      assert.ok(!JSON.stringify(s.events).includes('未完成前缀'));assert.ok(!JSON.stringify(s.events).includes('补全正文'));s.gate.assertIdle();
    } finally {await s.service.dispose();}
  });
  test(`${module} 零正文失败在原结果重试，最新追问可补全而旧轮不可改写`,async()=>{
    const s=setup(module,async function*(_options,index){if(index!==0)yield {type:'text-delta',index:0,text:index===2?'追问前缀':'完整正文'};yield {type:'finish',reason:{kind:index===2?'max-tokens':'stop'}};});
    try {
      const original=await first(s.service);assert.equal(original.text,'');assert.equal(original.status,'failed');
      await s.service.resume(original.id,{expectedTurnCount:0,expectedAttempt:0});const firstAnswer=await settled(s.service);assert.equal(firstAnswer.status,'complete');
      assert.equal(s.calls[0]!.messages[0]!.content[0]!.text,s.calls[1]!.messages[0]!.content[0]!.text);
      await s.service.followup(original.id,'具体解释',0);const partial=await settled(s.service),turn=partial.conversation![0]!;assert.equal(turn.status,'failed');
      await assert.rejects(s.service.resume(original.id,{expectedTurnCount:1,expectedAttempt:1}),{code:'CONVERSATION_CHANGED'});
      await s.service.resume(original.id,{expectedTurnCount:1,expectedAttempt:0,turnId:turn.id});const final=await settled(s.service);
      assert.equal(final.text,firstAnswer.text);assert.equal(final.conversation!.length,1);assert.equal(final.conversation![0]!.text,'追问前缀\n\n完整正文');assert.equal(final.conversation![0]!.status,'complete');
    } finally {await s.service.dispose();}
  });
}

for(const module of ['meihua','tarot'] as const)for(const target of ['initial','followup'] as const){
  test(`${module} ${target} 恢复后的同轮新尝试不能被旧窗口取消`,async()=>{
    const s=setup(module,async function*(options,index){
      if(target==='followup'&&index===0){yield* complete(options,index);return;}
      if(index===(target==='initial'?0:1)){yield {type:'text-delta',index:0,text:'未完成'};yield {type:'finish',reason:{kind:'max-tokens'}};return;}
      yield* pending(options);
    });
    try{
      const original=await first(s.service);
      if(target==='followup'){await s.service.followup(original.id,'详细解释',0);await settled(s.service);}
      const before=s.service.snapshot()!,turnId=before.conversation?.at(-1)?.id;
      await s.service.resume(original.id,{expectedTurnCount:target==='initial'?0:1,expectedAttempt:0,...(turnId?{turnId}:{})});
      for(let i=0;i<100&&s.calls.length<(target==='initial'?2:3);i++)await new Promise(resolve=>setTimeout(resolve,2));
      const signal=s.calls.at(-1)!.signal;assert.equal(signal.aborted,false);
      for(const expectedAttempt of [undefined,0]){
        const cancelled=await s.service.rpc('cancel',{id:original.id,...(turnId?{turnId}:{}),...(expectedAttempt===undefined?{}:{expectedAttempt})});
        assert.equal(cancelled.ok,false);assert.equal(!cancelled.ok&&cancelled.error.code,'CONVERSATION_CHANGED');assert.equal(signal.aborted,false);
      }
      const cancelled=await s.service.rpc('cancel',{id:original.id,...(turnId?{turnId}:{}),expectedAttempt:1});
      assert.equal(cancelled.ok,true);assert.equal(signal.aborted,true);await settled(s.service);s.gate.assertIdle();
    }finally{await s.service.dispose();}
  });
}

for(const module of ['meihua','tarot'] as const){
  test(`${module} 追问零正文失败重试原轮次并保留初答`,async()=>{
    const s=setup(module,async function*(options,index){if(index===1){yield {type:'finish',reason:{kind:'stop'}};return;}yield* complete(options,index);});
    try{
      const initial=await first(s.service);await s.service.followup(initial.id,'解释原结论',0);
      const failed=await settled(s.service),turn=failed.conversation![0]!;assert.equal(turn.status,'failed');assert.equal(turn.text,'');
      await s.service.resume(initial.id,{turnId:turn.id,expectedTurnCount:1,expectedAttempt:0});
      const recovered=await settled(s.service);assert.equal(recovered.text,initial.text);assert.equal(recovered.conversation!.length,1);
      assert.equal(recovered.conversation![0]!.id,turn.id);assert.equal(recovered.conversation![0]!.status,'complete');
      assert.equal(recovered.conversation![0]!.generation?.attempt,1);assert.ok(s.calls[2]!.messages.some(message=>message.content.some(block=>block.text==='解释原结论')));
    }finally{await s.service.dispose();}
  });
}
