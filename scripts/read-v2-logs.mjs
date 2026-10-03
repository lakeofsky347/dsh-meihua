// Read released DSH JSONL logs from the isolated web/native acceptance homes.
// Only the local offline fixture route is admitted; no provider call is made.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { Context } from '@deepseek-ai/cordis';
import { expandAssistantStream } from '@deepseek-ai/dsh-llm';
import jsonl from '../.local/runtime/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js';
import { RuleRegistry } from '../.local/v2-package/package/lib/core.js';
import { TAROT_CARDS, TAROT_SPREADS } from '../.local/v2-package/package/lib/tarot.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=value=>createHash('sha256').update(value).digest('hex');
const packageSHA=digest(await readFile(path.join(root,'artifacts/dsh-meihua-0.2.0.tgz')));
const since=Date.parse('2026-10-03T00:00:00+08:00');
const homes=[
  {surface:'web',home:path.resolve(root,process.argv[2]??'.local/test-home')},
  // Acceptance home remains stable when the final package is rebuilt.
  {surface:'native',home:path.resolve(root,process.argv[3]??'.local/native-v2-65a5693f2284/home')},
];
const output=path.resolve(root,process.argv[4]??'artifacts/verification-v2-2026-10-03/log-readback.json');
const fixtureSource=await readFile(path.join(root,'tests/fixtures/preview-provider.mjs'),'utf8');
let nativeFixtureTiming=null;
try {
  const nativeHome=homes.find(home=>home.surface==='native').home;
  const recorded=JSON.parse(await readFile(path.resolve(nativeHome,'../mock-timing.json'),'utf8'));
  const nativeFixture=await readFile(path.join(nativeHome,'profiles/desktop/offline-provider.mjs'),'utf8');
  assert.equal(digest(fixtureSource),recorded.originalFixtureSha256);
  assert.equal(digest(nativeFixture),recorded.slowFixtureSha256);
  assert.equal(nativeFixture,fixtureSource.replace(`setTimeout(r,${recorded.delayBeforeMs})`,`setTimeout(r,${recorded.delayAfterMs})`),'Owned native fixture only changes its artificial timer');
  nativeFixtureTiming={changedAt:recorded.changedAt,delayBeforeMs:recorded.delayBeforeMs,delayAfterMs:recorded.delayAfterMs,originalFixtureSHA256:recorded.originalFixtureSha256,slowFixtureSHA256:recorded.slowFixtureSha256,onlyTimerChanged:true,textAndChunkingUnchanged:true,publishedPackageUnchanged:true};
} catch(error) {if(error.code!=='ENOENT')throw error;}
// Execute the local, known fixture with immediate timer callbacks, solely to
// derive expected text from each durable prompt. Its stream makes no network calls.
const fixtureApply=runInNewContext(fixtureSource.replace(/^import \{ LlmAdapter \} from '@deepseek-ai\/dsh-llm';\n/m,'').replace(/\bexport (const|function)\b/g,'$1')+'\napply;',{
  LlmAdapter:class {},setTimeout:callback=>{callback();return 0;},
});
let fixtureAdapter;
fixtureApply({llm:{registerAdapter:(ids,adapter)=>{assert.deepEqual(Array.from(ids),['meihua-offline']);fixtureAdapter=adapter;}}});
assert.ok(fixtureAdapter);
const checks=[],excluded=[],pending=[],failures=[],roots=[];
const cardsById=new Map(TAROT_CARDS.map(card=>[card.id,card]));
const registry=new RuleRegistry();

function inspectFrozenPayload(prompt,moduleId){
  const payload=JSON.parse(prompt.slice(prompt.indexOf('{')));
  if(moduleId==='tarot'){
    assert.equal(payload.moduleId,'tarot');assert.equal(payload.algorithmVersion,'tarot-v1');
    assert.equal(payload.deck.id,'rws-78');assert.equal(payload.deck.cardCount,78);
    assert.equal(payload.deck.version,'tarot-v1');assert.equal(typeof payload.includeReversed,'boolean');
    const spread=TAROT_SPREADS.find(spread=>spread.id===payload.spread.id);assert.ok(spread);
    assert.equal(payload.spread.cardCount,spread.cardCount);assert.deepEqual(payload.spread.positions,spread.positions);
    assert.equal(payload.cards.length,spread.cardCount);assert.equal(new Set(payload.cards.map(drawn=>drawn.card.id)).size,spread.cardCount);
    for(const [index,drawn] of payload.cards.entries()){
      assert.equal(drawn.positionIndex,index);assert.equal(drawn.positionLabel,spread.positions[index]);assert.equal(drawn.revealed,true);
      assert.ok(drawn.orientation==='upright'||drawn.orientation==='reversed');
      if(!payload.includeReversed)assert.equal(drawn.orientation,'upright');
      assert.deepEqual(drawn.card,cardsById.get(drawn.card.id),'Logged frozen card facts match the shipped catalogue');
    }
    assert.ok(!Object.hasOwn(payload,'hiddenDeck'));assert.ok(!Object.hasOwn(payload,'selectedSlots'));
    return {moduleId,algorithmVersion:payload.algorithmVersion,payloadSHA256:digest(JSON.stringify(payload)),questionSHA256:digest(payload.question),spreadId:spread.id,cardCount:spread.cardCount,includeReversed:payload.includeReversed,fullyRevealed:true,positions:payload.cards.map(d=>({index:d.positionIndex,label:d.positionLabel,cardId:d.card.id,name:d.card.name,orientation:d.orientation})),shippedCatalogueMatches:true};
  }
  assert.equal(payload.algorithmVersion,'meihua-v1');
  const recomputed=registry.calculate(payload.input);assert.deepEqual(payload,recomputed,'Logged facts reproduce the shipped Meihua calculation');
  return {moduleId,algorithmVersion:payload.algorithmVersion,payloadSHA256:digest(JSON.stringify(payload)),questionSHA256:digest(payload.input.question),ruleId:payload.rule.id,primary:payload.primary.title,mutual:payload.mutual.title,changed:payload.changed.title,movingLine:payload.movingLine,shippedCalculationMatches:true};
}

async function expectedFixture(prompt){
  let text='';
  for await(const chunk of fixtureAdapter.stream({messages:[{content:[{type:'text',text:prompt}]}],signal:new AbortController().signal}))if(chunk.type==='text-delta')text+=chunk.text;
  assert.ok(text.length>0);return text;
}

for(const home of homes){
  const sessions=path.join(home.home,'sessions'),directory=path.join(sessions,'_no-cwd');
  try{await access(directory);}catch(error){
    if(error.code!=='ENOENT')throw error;
    roots.push({surface:home.surface,home:path.relative(root,home.home),status:'pending-no-session-directory',counts:null});continue;
  }
  const ids=(await readdir(directory)).sort().filter(id=>/^(meihua|tarot)-/.test(id));
  const ctx=new Context(),fiber=ctx.plugin(jsonl,{root:sessions,compression:'zstd'});await fiber.await();
  const before=checks.length;
  try{
    for(const id of ids){
      const moduleId=id.startsWith('tarot-')?'tarot':'meihua';
      try {
      const handle=await ctx.get('sessionPersistence').open(id,'read');let events;
      try{({events}=await handle.read());}finally{await handle.close();}
      const headers=events.filter(event=>event.type==='request/header');
      const route=headers[0]?.data.header.config;
      if(route?.provider!=='meihua-offline'||route?.model!=='offline-demo'){
        excluded.push({surface:home.surface,sessionId:id,reason:'outside-offline-fixture-route'});continue;
      }
      const startTime=events[0]?.time;
      if(typeof startTime==='number'&&startTime<since){excluded.push({surface:home.surface,sessionId:id,reason:'pre-v2-date-boundary',startedAt:new Date(startTime).toISOString()});continue;}
      assert.equal(headers.length,1,'Exactly one durable request header, no automatic retry');
      const users=events.filter(event=>event.type==='user/message'),systems=events.filter(event=>event.type==='system/message');
      assert.equal(users.length,1);assert.equal(systems.length,1);
      const prompt=users[0].data.content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
      const frozen=inspectFrozenPayload(prompt,moduleId),expected=await expectedFixture(prompt);
      if(events.at(-1)?.type!=='turn/end'){
        pending.push({surface:home.surface,sessionId:id,moduleId,reason:'request-is-durable-terminal-not-yet-flushed',eventTypes:events.map(event=>event.type),frozen});continue;
      }
      const message=events.find(event=>event.type==='assistant/message'),attempt=events.find(event=>event.type==='assistant/attempt');
      assert.ok((!!message)!=(!!attempt),'One durable final assistant record');
      assert.deepEqual(events.map(event=>event.type),['turn/start','step/start','request/header','system/message','user/message',message?'assistant/message':'assistant/attempt','step/end','turn/end']);
      assert.ok(events.every((event,index)=>index===0||event.seq>events[index-1].seq),'Event sequence order is preserved');
      const records=expandAssistantStream((message??attempt).data.stream);
      const text=records.filter(record=>record.chunk.type==='text-delta').map(record=>record.chunk.text).join('');
      const terminal=events.at(-1).data.reason;
      const outcome=message?'complete':'cancelled';
      if(message){assert.equal(terminal.kind,'completed');assert.equal(text,expected,'Complete local fixture text is durably intact');}
      else{
        assert.equal(terminal.kind,'error');assert.equal(terminal.error.code,'CANCELLED');
        assert.ok(text.length>0&&text.length<expected.length,'Cancellation retains a nonempty incomplete prefix');
        assert.ok(expected.startsWith(text),'Cancelled text is exactly the received fixture prefix');
      }
      assert.equal(route.maxTokens,moduleId==='tarot'&&frozen.spreadId==='celtic-cross'?5000:3000);
      const mockDelayMs=home.surface==='native'&&nativeFixtureTiming&&startTime>=Date.parse(nativeFixtureTiming.changedAt)?nativeFixtureTiming.delayAfterMs:400;
      checks.push({surface:home.surface,sessionId:id,moduleId,startedAt:typeof startTime==='number'?new Date(startTime).toISOString():null,mockDelayMs,route:{provider:route.provider,model:route.model,maxTokens:route.maxTokens},eventTypes:events.map(event=>event.type),durableRequestAndTerminal:true,noAutomaticRetry:true,outcome,frozen,text:{length:text.length,sha256:digest(text),expectedFixtureLength:expected.length,expectedFixtureSHA256:digest(expected),completeMatches:!!message,cancelledPrefixMatches:!!attempt},terminal:{kind:terminal.kind,...(terminal.error?{code:terminal.error.code}:{})}});
      } catch(error) {
        // Do not serialize raw headers, exception dumps or prompt contents.
        failures.push({surface:home.surface,sessionId:id,moduleId,code:typeof error.code==='string'?error.code:'READBACK_ERROR',reason:error.code==='ERR_ASSERTION'?'Offline record failed a documented invariant':'Offline record could not be read or parsed'});
      }
    }
  }finally{await fiber.dispose();}
  const surfaceChecks=checks.slice(before);
  roots.push({surface:home.surface,home:path.relative(root,home.home),status:failures.some(f=>f.surface===home.surface)?'read-has-failures':surfaceChecks.length?'read-success':'read-success-no-admitted-terminal-records',counts:{sessions:surfaceChecks.length,complete:surfaceChecks.filter(c=>c.outcome==='complete').length,cancelled:surfaceChecks.filter(c=>c.outcome==='cancelled').length},pendingSessions:pending.filter(p=>p.surface===home.surface).length,failedSessions:failures.filter(f=>f.surface===home.surface).length});
}
const counts={sessions:checks.length,complete:checks.filter(c=>c.outcome==='complete').length,cancelled:checks.filter(c=>c.outcome==='cancelled').length,tarot:checks.filter(c=>c.moduleId==='tarot').length,meihua:checks.filter(c=>c.moduleId==='meihua').length};
const missingCoverage=homes.flatMap(home=>['complete','cancelled'].filter(outcome=>!checks.some(check=>check.surface===home.surface&&check.outcome===outcome)).map(outcome=>({surface:home.surface,outcome})));
const report={schemaVersion:1,verifiedAt:new Date().toISOString(),status:failures.length?'failed':missingCoverage.length||pending.length?'partial':'passed',backend:'Released DSH JSONL backend, read-only handles, zstd',packageSHA256:packageSHA,fixtureSourceSHA256:digest(fixtureSource),nativeFixtureTiming,dateBoundary:{since:'2026-10-03T00:00:00+08:00',reason:'Exclude older workspace acceptance runs'},acceptedRoute:{provider:'meihua-offline',model:'offline-demo'},evidenceBoundary:{offlineFixtureOnly:true,providerCallsMadeByVerifier:0,realProviderEvidence:false,realProviderInterpretationQuality:'unverified',claims:'Durable local mock-provider request/result, frozen facts and cancellation-prefix readback only'},requiredCoverage:'Each web/native surface has one complete and one cancelled offline fixture record',missingCoverage,roots,counts,checks,pending,excluded,failures};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,...counts,pendingSessions:pending.length,excludedSessions:excluded.length,failedSessions:failures.length,realProviderEvidence:false,output:path.relative(root,output)}));
if(failures.length)process.exitCode=1;
