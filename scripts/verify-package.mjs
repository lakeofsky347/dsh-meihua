// Reproducible release readback: inspect the tarball, extracted installation,
// embedded images and package exports without calling a provider or network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archive=path.resolve(root,process.argv[2]??'artifacts/dsh-meihua-0.2.0.tgz');
const installed=path.resolve(root,process.argv[3]??'.local/v2-package/package');
const output=path.resolve(root,process.argv[4]??'artifacts/verification-v2-2026-10-03/package-integrity.json');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha1=bytes=>createHash('sha1').update(bytes).digest('hex');
const archiveBytes=await readFile(archive);
const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n').filter(Boolean);
assert.equal(names.length,22,'Release archive has the expected 22 files');
assert.equal(new Set(names).size,22,'Archive file entries are unique');
const excluded=[];
for(const name of names){
  assert.ok(name.startsWith('package/'),'Every archive entry is inside package/');
  assert.ok(!name.endsWith('/')&&!name.includes('..')&&!name.includes('\\'),'Archive contains only regular relative file paths');
  if(/(?:^|\/)(?:\.local|\.cache|node_modules|tests?|fixtures?|src|tarot-originals)(?:\/|$)|\.(?:jpe?g|png|webp|map)$|\/Users\/|\/home\//i.test(name))excluded.push(name);
}
assert.deepEqual(excluded,[],'No fixtures, local original assets, source tree or home paths are packaged');

async function enumerate(directory,prefix=''){
  const results=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const relative=prefix?`${prefix}/${entry.name}`:entry.name;
    assert.ok(!entry.isSymbolicLink(),`Installed package contains no symlink: ${relative}`);
    if(entry.isDirectory())results.push(...await enumerate(path.join(directory,entry.name),relative));
    else {assert.ok(entry.isFile(),`Installed entry is a regular file: ${relative}`);results.push(relative);}
  }
  return results.sort();
}
const installedNames=await enumerate(installed);
assert.deepEqual(installedNames,names.map(name=>name.slice('package/'.length)).sort(),'Installed file set exactly matches archive');
const verifiedFiles=[];
for(const name of [...names].sort()){
  const relative=name.slice('package/'.length);
  assert.ok((await lstat(path.join(installed,relative))).isFile());
  const tarBytes=execFileSync('tar',['-xOzf',archive,name],{maxBuffer:64*1024*1024});
  const diskBytes=await readFile(path.join(installed,relative));
  assert.deepEqual(diskBytes,tarBytes,`Installed bytes match archive: ${relative}`);
  verifiedFiles.push({path:relative,bytes:tarBytes.length,sha256:sha256(tarBytes),byteIdentical:true});
}

const provenance=JSON.parse(await readFile(path.join(installed,'lib/tarot-assets-sources.json'),'utf8'));
const manifest=JSON.parse(await readFile(path.join(installed,'package.json'),'utf8'));
assert.equal(manifest.name,'dsh-meihua');assert.equal(manifest.version,'0.2.0');
const expected=[...Array.from({length:22},(_,n)=>`major-${String(n).padStart(2,'0')}`),...['wands','cups','swords','pentacles'].flatMap(suit=>Array.from({length:14},(_,n)=>`${suit}-${String(n+1).padStart(2,'0')}`))];
assert.equal(provenance.cards.length,78);
assert.deepEqual(provenance.cards.map(card=>card.id).sort(),[...expected].sort());
const client=await readFile(path.join(installed,'lib/client.js'),'utf8');
const pattern=/("|')(major-\d{2}|(?:wands|cups|swords|pentacles)-\d{2})\1\s*:\s*("|')(data:image\/webp;base64,[a-zA-Z0-9+/=]+)\3/g;
const embedded=new Map();
for(const match of client.matchAll(pattern)){
  assert.ok(!embedded.has(match[2]),`Embedded card is not duplicated: ${match[2]}`);
  embedded.set(match[2],match[4]);
}
assert.deepEqual([...embedded.keys()].sort(),[...expected].sort(),'Packaged client contains every one of the 78 image IDs');
const verifiedCards=[];
for(const card of provenance.cards){
  const uri=embedded.get(card.id);assert.ok(uri);
  const bytes=Buffer.from(uri.slice('data:image/webp;base64,'.length),'base64');
  assert.equal(bytes.length,card.asset.bytes,card.id);
  assert.equal(bytes.toString('ascii',0,4),'RIFF',card.id);assert.equal(bytes.toString('ascii',8,12),'WEBP',card.id);
  assert.equal(sha256(bytes),card.asset.sha256,`Packaged image bytes match provenance: ${card.id}`);
  assert.equal(card.license.shortName,'Public domain',card.id);
  assert.equal(card.source.author,'Pamela Colman Smith',card.id);
  assert.equal(card.source.date,'1910',card.id);
  verifiedCards.push({id:card.id,embeddedBytes:bytes.length,sha256:sha256(bytes),matchesProvenance:true,license:card.license.shortName,source:card.source.descriptionURL});
}
assert.equal(new Set(verifiedCards.map(card=>card.sha256)).size,78,'All 78 packaged card images are unique');
const absolutePaths=[];
for(const name of ['lib/client.js','lib/core.js','lib/tarot.js','lib/index.js','README.md','cordis.patch.yml']){
  const text=await readFile(path.join(installed,name),'utf8');
  if(/\/Users\/|\/home\/|tarot-originals\/|tests\/fixtures\//.test(text))absolutePaths.push(name);
}
assert.deepEqual(absolutePaths,[],'Release payload contains no developer home paths or original/fixture references');

const exportPath=(key)=>{const entry=manifest.exports[key];return typeof entry==='string'?entry:entry.default;};
const core=await import(pathToFileURL(path.resolve(installed,exportPath('./core'))).href);
const tarot=await import(pathToFileURL(path.resolve(installed,exportPath('./tarot'))).href);
const sample=new core.RuleRegistry().calculate({ruleId:'three-numbers',question:'发行包独立回读',values:{a:2,b:3,c:2},environment:{capturedAt:'2026-10-03T10:00:00Z',timeZone:'Asia/Shanghai',details:{}}});
assert.equal(sample.primary.title,'泽火革');assert.equal(sample.movingLine,1);assert.ok(Object.isFrozen(sample));
assert.equal(tarot.TAROT_CARDS.length,78);assert.equal(tarot.TAROT_SPREADS.length,4);
assert.equal(tarot.tarotCard('major-00').name,'愚人');assert.equal(tarot.tarotSpread('celtic-cross').cardCount,10);
assert.deepEqual(tarot.TAROT_CARDS.map(card=>card.id).sort(),[...expected].sort());
const upright=tarot.shuffleTarotDeck(false,max=>max-1),reversed=tarot.shuffleTarotDeck(true,max=>max-1);
assert.equal(new Set(upright.map(item=>item.card.id)).size,78);assert.ok(upright.every(item=>item.orientation==='upright'));
assert.ok(reversed.every(item=>item.orientation==='reversed'));assert.ok(Object.isFrozen(upright));

const report={
  schemaVersion:1,checkedAt:new Date().toISOString(),result:'passed',
  package:{name:manifest.name,version:manifest.version,archive:path.relative(root,archive),installedDirectory:path.relative(root,installed),archiveBytes:archiveBytes.length,sha256:sha256(archiveBytes),npmSHA1:sha1(archiveBytes)},
  installation:{archiveFileCount:names.length,installedFileCount:installedNames.length,allFilesByteIdentical:true,files:verifiedFiles},
  embeddedTarot:{cardCount:verifiedCards.length,totalImageBytes:verifiedCards.reduce((sum,card)=>sum+card.embeddedBytes,0),allMatchPackagedProvenance:true,uniqueImageCount:78,cards:verifiedCards},
  exportSmoke:{core:{export:exportPath('./core'),sampleNumbers:[2,3,2],primary:sample.primary.title,movingLine:sample.movingLine,frozen:true},tarot:{export:exportPath('./tarot'),cards:78,spreads:4,major00:'愚人',celticCrossCards:10,shuffleUniqueCards:78,orientationDisabledAllUpright:true,orientationEnabledRandomSourceValidated:true}},
  exclusions:{noFixtureOrSourceFiles:true,noOriginalMediaFiles:true,noAbsoluteHomePaths:true,noSymlinks:true},
  boundary:'Pure local archive/readback and public exports verification; no model/provider/network or native host calls.',
};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(`Verified ${names.length} byte-identical package files, ${verifiedCards.length} embedded Tarot images and both public core exports.`);
console.log(`Archive SHA-256: ${report.package.sha256}`);
console.log(`Saved ${path.relative(root,output)}`);
