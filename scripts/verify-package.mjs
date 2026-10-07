// Reproducible release readback: inspect the tarball, extracted installation,
// embedded images and package exports without calling a provider or network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localManifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const archive=path.resolve(root,process.argv[2]??`artifacts/dsh-meihua-${localManifest.version}.tgz`);
const installed=path.resolve(root,process.argv[3]??'.local/package-readback/package');
const output=path.resolve(root,process.argv[4]??'artifacts/verification-package/package-integrity.json');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha1=bytes=>createHash('sha1').update(bytes).digest('hex');
const archiveBytes=await readFile(archive);
// Parse regular USTAR entries directly. A textual `tar -t` inventory alone cannot
// prove that an apparently safe path is not a hard link, symlink or special file.
const tar=gunzipSync(archiveBytes,{maxOutputLength:128*1024*1024});
const archiveFiles=new Map();
let offset=0,terminated=false;
while(offset+512<=tar.length){
  const header=tar.subarray(offset,offset+512);
  if(header.every(byte=>byte===0)){
    assert.ok(offset+1024<=tar.length&&tar.subarray(offset).every(byte=>byte===0),'Tar ends with at least two zero blocks');
    terminated=true;break;
  }
  const string=(start,length)=>header.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
  const octal=(start,length)=>{const text=string(start,length).trim();assert.match(text,/^[0-7]+$/,'Tar number uses ordinary octal');return Number.parseInt(text,8);};
  const checksum=octal(148,8),computed=header.reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
  assert.equal(checksum,computed,'Tar header checksum is valid');
  assert.ok(header[156]===0||header[156]===48,'Tar contains only ordinary regular files');
  assert.equal(string(157,100),'','Regular tar entry has no link target');
  assert.equal(octal(100,8)&0o6000,0,'Tar has no setuid/setgid file mode');
  assert.match(string(257,6),/^ustar/,'Release archive uses USTAR regular headers');
  const prefix=string(345,155),name=(prefix?`${prefix}/`:'')+string(0,100),size=octal(124,12);
  assert.match(name,/^package\/[A-Za-z0-9_./-]+$/,'Archive uses ordinary package-relative ASCII paths');
  assert.ok(!name.split('/').some(part=>!part||part==='.'||part==='..'),'Archive has no traversal or ambiguous path');
  assert.ok(Number.isSafeInteger(size)&&size>=0&&offset+512+size<=tar.length,'Tar file size stays inside the archive');
  assert.ok(!archiveFiles.has(name),`Archive entry is unique: ${name}`);
  archiveFiles.set(name,tar.subarray(offset+512,offset+512+size));
  offset+=512+Math.ceil(size/512)*512;
}
assert.ok(terminated,'Tar has a complete terminator');
const names=[...archiveFiles.keys()];
const manifest=JSON.parse(archiveFiles.get('package/package.json')?.toString('utf8')??'null');
assert.equal(manifest?.name,'dsh-meihua');assert.match(manifest.version,/^0\.(?:4|6)\.\d+$/,'Verifier explicitly supports 0.4 and 0.6 release layouts');
const expanded=manifest.version.startsWith('0.6.');
const originalFixed=[
  'LICENSE','README.md','cordis.patch.yml','package.json',
  'lib/client.js','lib/core.js','lib/index.js','lib/styles.css','lib/tarot-assets-sources.json','lib/tarot-assets.md','lib/tarot.js',
  'lib/types/core/calendar.d.ts','lib/types/core/hexagrams.d.ts','lib/types/core/index.d.ts','lib/types/core/rules.d.ts','lib/types/core/types.d.ts',
  'lib/types/tarot/cards.d.ts','lib/types/tarot/index.d.ts','lib/types/tarot/spreads.d.ts','lib/types/tarot/types.d.ts'
];
const expansionFixed=[
  'lib/xiaoliu.js','lib/lenormand.js','lib/liuyao.js','lib/lenormand-assets-sources.json','lib/lunar-javascript-provenance.json',
  'lib/THIRD_PARTY_LICENSES/lunar-javascript-LICENSE','lib/THIRD_PARTY_LICENSES/lenormand-LICENSE',
  'lib/types/xiaoliu/index.d.ts','lib/types/xiaoliu/types.d.ts','lib/types/liuyao/index.d.ts','lib/types/liuyao/types.d.ts',
  'lib/types/lenormand/assets.d.ts','lib/types/lenormand/cards.d.ts','lib/types/lenormand/combinations.d.ts',
  'lib/types/lenormand/index.d.ts','lib/types/lenormand/spreads.d.ts','lib/types/lenormand/types.d.ts'
];
const expectedFixed=expanded?[...originalFixed,...expansionFixed]:originalFixed;
const chunks=names.map(name=>name.slice('package/'.length)).filter(name=>/^lib\/chunk-[A-Za-z0-9_-]{8}\.js$/.test(name));
assert.equal(chunks.length,expanded?3:2,'Release has the exact shared-chunk count produced by the declared build entry points');
assert.equal(names.length,expanded?40:22,`Release archive has the expected ${expanded?40:22} files`);
assert.deepEqual(names.map(name=>name.slice('package/'.length)).sort(),[...expectedFixed,...chunks].sort(),'Every release file is in the explicit versioned allowlist');
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
assert.ok((await lstat(installed)).isDirectory()&&!(await lstat(installed)).isSymbolicLink(),'Installed package root is a real directory');
assert.ok(path.relative(installed,output).startsWith(`..${path.sep}`)||path.isAbsolute(path.relative(installed,output)),'Report is written outside the inspected installation');
assert.deepEqual(installedNames,names.map(name=>name.slice('package/'.length)).sort(),'Installed file set exactly matches archive');
const verifiedFiles=[];
for(const name of [...names].sort()){
  const relative=name.slice('package/'.length);
  assert.ok((await lstat(path.join(installed,relative))).isFile());
  const tarBytes=archiveFiles.get(name);
  const diskBytes=await readFile(path.join(installed,relative));
  assert.deepEqual(diskBytes,tarBytes,`Installed bytes match archive: ${relative}`);
  verifiedFiles.push({path:relative,bytes:tarBytes.length,sha256:sha256(tarBytes),byteIdentical:true});
}

const provenance=JSON.parse(await readFile(path.join(installed,'lib/tarot-assets-sources.json'),'utf8'));
assert.equal(manifest.name,'dsh-meihua');assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
assert.deepEqual(provenance,JSON.parse(await readFile(path.join(root,'src/assets/tarot/assets-sources.json'),'utf8')),'Packaged Tarot provenance matches the source manifest');
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
  assert.match(card.asset.path,/^src\/assets\/tarot\/(?:major-\d{2}|(?:wands|cups|swords|pentacles)-\d{2})\.webp$/);
  assert.deepEqual(bytes,await readFile(path.join(root,card.asset.path)),`Tarot embedded bytes match source image: ${card.id}`);
  assert.equal(card.license.shortName,'Public domain',card.id);
  assert.equal(card.source.author,'Pamela Colman Smith',card.id);
  assert.equal(card.source.date,'1910',card.id);
  verifiedCards.push({id:card.id,embeddedBytes:bytes.length,sha256:sha256(bytes),matchesProvenance:true,matchesSourceBytes:true,license:card.license.shortName,source:card.source.descriptionURL});
}
assert.equal(new Set(verifiedCards.map(card=>card.sha256)).size,78,'All 78 packaged card images are unique');
const absolutePaths=[];
const jsNames=installedNames.filter(name=>name.endsWith('.js'));
for(const name of [...jsNames,'README.md','cordis.patch.yml']){
  const text=await readFile(path.join(installed,name),'utf8');
  if(/\/Users\/|\/home\/|tarot-originals\/|tests\/fixtures\//.test(text))absolutePaths.push(name);
}
assert.deepEqual(absolutePaths,[],'Release payload contains no developer home paths or original/fixture references');

const importEdges=[];
for(const name of jsNames){
  const source=await readFile(path.join(installed,name),'utf8');
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)(["'])(\.[^"']+)\1/g)){
    const specifier=match[2];assert.ok(!specifier.includes('\\')&&!specifier.includes('?')&&!specifier.includes('#'),'Relative module specifier is ordinary');
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier));
    assert.ok(!resolved.startsWith('../')&&installedNames.includes(resolved),`Relative dependency stays in package: ${name} -> ${specifier}`);
    importEdges.push({from:name,to:resolved});
  }
}
assert.ok(chunks.every(chunk=>importEdges.some(edge=>edge.to===chunk)),'Every allowed shared chunk is actually referenced');

const expectedExports=expanded?['.','./client','./core','./tarot','./xiaoliu','./lenormand','./liuyao','./package.json']:['.','./client','./core','./tarot','./package.json'];
assert.deepEqual(Object.keys(manifest.exports).sort(),expectedExports.sort(),'Release exposes exactly the declared public entry points');
assert.equal(manifest.main,'lib/index.js');assert.equal(manifest.exports['.'],'./lib/index.js');
assert.equal(manifest.exports['./client'],'./lib/client.js');assert.equal(manifest.exports['./package.json'],'./package.json');
assert.equal(manifest.dsh.bundle.patch,'./cordis.patch.yml');
const exportPath=(key)=>{const entry=manifest.exports[key],target=typeof entry==='string'?entry:entry.default;
  assert.match(target,/^\.\/lib\/[a-z]+\.js$/);assert.ok(installedNames.includes(target.slice(2)));
  if(typeof entry!=='string'){assert.match(entry.types,/^\.\/lib\/types\/[a-z]+\/index\.d\.ts$/);assert.ok(installedNames.includes(entry.types.slice(2)));}
  return target;
};
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

const exportSmoke={
  core:{export:exportPath('./core'),sampleNumbers:[2,3,2],primary:sample.primary.title,movingLine:sample.movingLine,frozen:true},
  tarot:{export:exportPath('./tarot'),cards:78,spreads:4,major00:'愚人',celticCrossCards:10,shuffleUniqueCards:78,orientationDisabledAllUpright:true,orientationEnabledRandomSourceValidated:true}
};
let embeddedLenormand=null,thirdParty=null;
if(expanded){
  // Import installed public entry points, never src/*.ts. Each fixture has an
  // independently documented literal expected result, not a new algorithm oracle.
  const xiaoliu=await import(pathToFileURL(path.resolve(installed,exportPath('./xiaoliu'))).href);
  const lenormand=await import(pathToFileURL(path.resolve(installed,exportPath('./lenormand'))).href);
  const liuyao=await import(pathToFileURL(path.resolve(installed,exportPath('./liuyao'))).href);
  const small=xiaoliu.calculateXiaoliu({question:'原书三月初五辰时',environment:{capturedAt:'2024-04-13T00:00:00Z',timeZone:'Asia/Shanghai',details:{}}});
  assert.deepEqual([small.lunar.month,small.lunar.day,small.lunar.hourBranch],[3,5,'辰']);
  assert.deepEqual([small.monthPalace.name,small.dayPalace.name,small.hourPalace.name],['速喜','大安','小吉']);
  assert.equal(xiaoliu.XIAOLIU_PALACES.length,6);assert.ok(Object.isFrozen(small)&&Object.isFrozen(small.input.environment));

  assert.equal(lenormand.LENORMAND_CARDS.length,36);assert.equal(lenormand.LENORMAND_SPREADS.length,2);
  assert.deepEqual(lenormand.LENORMAND_CARDS.map(card=>card.id),Array.from({length:36},(_,i)=>i+1));
  const deck=lenormand.createLenormandDeck(max=>max-1);
  assert.deepEqual([...deck],Array.from({length:36},(_,i)=>i+1));assert.ok(Object.isFrozen(deck));
  const line3=lenormand.calculateLenormand({question:'三张连读验收',spreadId:'line-3',cardIds:[24,27,33],createdAt:'2024-04-13T00:00:00Z'});
  const line5=lenormand.calculateLenormand({question:'五张对照验收',spreadId:'line-5',cardIds:[1,27,24,25,23],createdAt:'2024-04-13T00:00:00Z'});
  assert.equal(line3.center.card.name,'信');assert.equal(line3.adjacentPairs.length,2);assert.deepEqual(line3.mirrors,[]);
  assert.equal(line3.adjacentPairs[0].phrase,'情感通过书面消息表达');
  assert.equal(line5.center.card.name,'心');assert.equal(line5.adjacentPairs.length,4);assert.deepEqual(line5.mirrors.map(pair=>pair.cardIds),[[1,23],[27,25]]);
  assert.notEqual(lenormand.lenormandPair(24,27).phrase,lenormand.lenormandPair(27,24).phrase);
  assert.ok(Object.isFrozen(line3)&&Object.isFrozen(line5.cards[0].card));
  assert.throws(()=>lenormand.calculateLenormand({question:'重复牌',spreadId:'line-3',cardIds:[1,1,2],createdAt:'2024-04-13T00:00:00Z'}));

  const six=liuyao.calculateLiuyao({question:'屯之震原书形态重放',values:[7,8,8,6,9,8],environment:{capturedAt:'2024-08-08T04:00:00Z',timeZone:'Asia/Shanghai',details:{}}});
  assert.deepEqual([six.primary.number,six.changed.number,six.palace.name,six.palace.shi,six.palace.ying],[3,51,'坎',2,5]);
  assert.deepEqual(six.movingLines,[4,5]);assert.deepEqual([six.calendar.monthBranch,six.calendar.dayGanzhi],['申','甲辰']);
  assert.deepEqual(six.calendar.voidBranches,['寅','卯']);
  assert.deepEqual(six.lines.map(line=>line.najia),['庚子','庚寅','庚辰','戊申','戊戌','戊子']);
  assert.deepEqual(six.lines.map(line=>line.relative),['兄弟','子孙','官鬼','父母','官鬼','兄弟']);
  assert.deepEqual(six.lines.map(line=>line.spirit),['青龙','朱雀','勾陈','螣蛇','白虎','玄武']);
  assert.deepEqual(six.lines.map(line=>line.changed.najia),['庚子','庚寅','庚辰','庚午','庚申','庚戌']);
  assert.equal(six.lines[3].changed.relative,'妻财');assert.ok(Object.isFrozen(six)&&Object.isFrozen(six.lines[0].changed));
  assert.equal(six.calendar.calendarVersion,'lunar-javascript-1.7.7');
  const before=liuyao.liuyaoCalendar({capturedAt:'2026-02-03T19:57:00Z',timeZone:'Asia/Shanghai',details:{}});
  const after=liuyao.liuyaoCalendar({capturedAt:'2026-02-03T20:07:00Z',timeZone:'Asia/Shanghai',details:{}});
  assert.equal(before.monthBranch,'丑');assert.equal(after.monthBranch,'寅');assert.equal(after.previousJie.name,'立春');

  const artManifest=JSON.parse(await readFile(path.join(installed,'lib/lenormand-assets-sources.json'),'utf8'));
  assert.deepEqual(artManifest,JSON.parse(await readFile(path.join(root,'src/assets/lenormand/manifest.json'),'utf8')),'Released original-art provenance matches the source manifest');
  assert.equal(artManifest.version,'lenormand-art-v1');assert.equal(artManifest.license,'MIT');assert.equal(artManifest.viewBox,'0 0 300 480');
  assert.deepEqual(artManifest.cards.map(card=>card.id),Array.from({length:36},(_,i)=>i+1));
  const artLicense=await readFile(path.join(installed,'lib/THIRD_PARTY_LICENSES/lenormand-LICENSE'));
  assert.deepEqual(artLicense,await readFile(path.join(root,'src/assets/lenormand/LICENSE')));
  assert.match(artLicense.toString('utf8'),/^MIT License\s+Copyright \(c\) 2026 问象 contributors/);
  const originalEmbedded=new Map();
  for(const match of client.matchAll(/\b([1-9]\d?)\s*:\s*("data:image\/svg\+xml;utf8,[^"\r\n]*")/g)){
    const id=Number(match[1]);assert.ok(!originalEmbedded.has(id),`Original SVG client ID appears once: ${id}`);
    originalEmbedded.set(id,JSON.parse(match[2]));
  }
  assert.deepEqual([...originalEmbedded.keys()].sort((a,b)=>a-b),Array.from({length:36},(_,i)=>i+1),'Client contains exactly 36 original SVG IDs');
  assert.deepEqual(Object.keys(lenormand.lenormandAssets).map(Number).sort((a,b)=>a-b),Array.from({length:36},(_,i)=>i+1),'Public core contains the same 36 original SVG IDs');
  const verifiedArt=[];
  for(const card of artManifest.cards){
    assert.equal(card.file,`${String(card.id).padStart(2,'0')}-${card.slug}.svg`);assert.match(card.file,/^(?:0[1-9]|[12]\d|3[0-6])-[a-z-]+\.svg$/);
    assert.equal(card.license,'MIT');assert.equal(card.creator,'问象');assert.match(card.provenance,/Original geometric SVG/);
    assert.equal(card.symbolReference,'https://shop.vermilion.cc/pages/guidebook-for-as-we-wish-lenormand');
    const identity=lenormand.lenormandCard(card.id);assert.equal(identity.slug,card.slug);assert.equal(identity.name,card.name);assert.equal(identity.license,'MIT');
    assert.equal(identity.provenance.kind,'original');assert.equal(identity.provenance.creator,'问象');
    const uri=originalEmbedded.get(card.id);assert.equal(uri,lenormand.lenormandAssets[card.id]);
    const bytes=Buffer.from(decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length)),'utf8');
    assert.equal(sha256(bytes),card.sha256,`Released original SVG hash: ${card.id}`);
    assert.deepEqual(bytes,await readFile(path.join(root,'src/assets/lenormand',card.file)),`Released original SVG is byte-identical to source: ${card.id}`);
    const svg=bytes.toString('utf8');assert.match(svg,/^<svg\b/);assert.match(svg,/viewBox="0 0 300 480"/);assert.match(svg,/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg,/<title id="title">/);assert.match(svg,/<desc id="desc">/);assert.ok(svg.includes(card.name));
    assert.ok(!/<(?:script|foreignObject|image)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|url\s*\(/i.test(svg),'Released SVG uses passive local primitives without external resource references');
    verifiedArt.push({id:card.id,name:card.name,file:card.file,embeddedBytes:bytes.length,sha256:sha256(bytes),matchesManifest:true,matchesSourceBytes:true,publicCoreAndClientIdentical:true,license:'MIT',creator:'问象'});
  }
  assert.equal(new Set(verifiedArt.map(card=>card.sha256)).size,36,'All 36 original SVGs have distinct bytes');
  embeddedLenormand={cardCount:36,totalImageBytes:verifiedArt.reduce((sum,card)=>sum+card.embeddedBytes,0),uniqueImageCount:36,allMatchPackagedManifest:true,allMatchSourceBytes:true,clientAndPublicCoreIdentical:true,licenseFile:'lib/THIRD_PARTY_LICENSES/lenormand-LICENSE',licenseSha256:sha256(artLicense),cards:verifiedArt};

  const vendor=JSON.parse(await readFile(path.join(installed,'lib/lunar-javascript-provenance.json'),'utf8'));
  assert.deepEqual(vendor,JSON.parse(await readFile(path.join(root,'src/liuyao/vendor/provenance.json'),'utf8')),'Packaged vendor provenance matches reviewed source provenance');
  assert.equal(vendor.name,'lunar-javascript');assert.equal(vendor.version,'1.7.7');assert.equal(vendor.license,'MIT');
  assert.equal(vendor.gitHead,'eecd5d12c8221b82ce574dc2bad2d7aefcb46e56');
  assert.equal(vendor.source,'https://github.com/6tail/lunar-javascript/blob/eecd5d12c8221b82ce574dc2bad2d7aefcb46e56/lunar.js');
  assert.equal(vendor.tarballSha256,'d1359ab9ca4913d1db3978a42ddfc290eb8ea9de54ce043f5b1f718ff71eea36');
  assert.equal(vendor.files['lunar.cjs'].sha256,'9750324bfe1aa63c146f8c72b1143df924466c11c8a5277d7d9225c541a18aaa');
  assert.deepEqual(Object.keys(vendor.files).sort(),['LICENSE','lunar.cjs']);
  for(const [name,item] of Object.entries(vendor.files)){
    const bytes=await readFile(path.join(root,'src/liuyao/vendor',name));assert.equal(bytes.length,item.bytes);assert.equal(sha256(bytes),item.sha256);
  }
  const vendorLicense=await readFile(path.join(installed,'lib/THIRD_PARTY_LICENSES/lunar-javascript-LICENSE'));
  assert.deepEqual(vendorLicense,await readFile(path.join(root,'src/liuyao/vendor/LICENSE')));
  assert.equal(sha256(vendorLicense),'d9210caf1844dcf410095cea464b79800aad30dbd49df092076b9f0ddc015404');
  assert.match(vendorLicense.toString('utf8'),/^MIT License\s+Copyright \(c\) 2018 6tail/);
  thirdParty={calendar:{name:vendor.name,version:vendor.version,gitHead:vendor.gitHead,provenanceFile:'lib/lunar-javascript-provenance.json',licenseFile:'lib/THIRD_PARTY_LICENSES/lunar-javascript-LICENSE',licenseSha256:sha256(vendorLicense),sourceBytes:vendor.files['lunar.cjs'].bytes,sourceSha256:vendor.files['lunar.cjs'].sha256,packagedLicenseAndProvenanceMatchSource:true},originalArt:{license:'MIT',licenseSha256:sha256(artLicense)}};
  exportSmoke.xiaoliu={export:exportPath('./xiaoliu'),palaces:6,manualFixture:'玉匣记三月初五辰时',lunar:[3,5,'辰'],palaceSequence:['速喜','大安','小吉'],frozen:true};
  exportSmoke.lenormand={export:exportPath('./lenormand'),cards:36,spreads:2,deckUniqueCards:36,line3Ids:[24,27,33],line3Center:'信',line5Ids:[1,27,24,25,23],line5Center:'心',directionalPairs:true,duplicatesRejected:true,frozen:true};
  exportSmoke.liuyao={export:exportPath('./liuyao'),manualFixture:'申月甲辰日屯之震形态重放',date:'2024-08-08',values:[7,8,8,6,9,8],primary:3,changed:51,movingLines:[4,5],palace:'坎',shi:2,ying:5,monthBranch:'申',dayGanzhi:'甲辰',voidBranches:['寅','卯'],allSixNajiaRelativesSpiritsChecked:true,changedRelativesUsePrimaryPalace:true,solarTermBoundaryChecked:true,frozen:true};
}

const report={
  schemaVersion:2,checkedAt:new Date().toISOString(),result:'passed',
  package:{name:manifest.name,version:manifest.version,archive:path.relative(root,archive),installedDirectory:path.relative(root,installed),archiveBytes:archiveBytes.length,sha256:sha256(archiveBytes),npmSHA1:sha1(archiveBytes)},
  installation:{archiveFileCount:names.length,installedFileCount:installedNames.length,allFilesByteIdentical:true,regularUSTARHeaders:true,explicitAllowlist:{layout:expanded?'0.6':'0.4',fixedPaths:expectedFixed.sort(),sharedChunks:chunks.sort(),expectedFileCount:expanded?40:22},relativeModuleEdges:importEdges,files:verifiedFiles},
  embeddedTarot:{cardCount:verifiedCards.length,totalImageBytes:verifiedCards.reduce((sum,card)=>sum+card.embeddedBytes,0),allMatchPackagedProvenance:true,uniqueImageCount:78,cards:verifiedCards},
  ...(expanded?{embeddedLenormand,thirdParty}:{}),
  exportSmoke,
  exclusions:{noFixtureOrSourceFiles:true,noOriginalMediaFiles:true,noAbsoluteHomePaths:true,noSymlinks:true,noHardLinksOrSpecialTarEntries:true,noSetuidOrSetgidModes:true},
  boundary:'Pure local archive/readback, workspace asset/provenance comparison and installed public exports verification; no model/provider/network or native host calls. Calendar external oracle covers documented fixtures, not all supported dates.',
};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(`Verified ${names.length} byte-identical package files, ${verifiedCards.length} embedded Tarot images${expanded?', 36 original Lenormand SVGs and all five public core exports':' and both public core exports'}.`);
console.log(`Archive SHA-256: ${report.package.sha256}`);
console.log(`Saved ${path.relative(root,output)}`);
