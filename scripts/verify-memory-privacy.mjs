// Inspect synthetic acceptance files only. Never scan the user's real DSH home.
// Example: node scripts/verify-memory-privacy.mjs --root .local/memory-acceptance/home
//   --canaries .local/memory-acceptance/canaries.json --output artifacts/verification-memory/privacy-scan.json
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const allowedRoot=resolve(projectRoot,'.local/memory-acceptance');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(parent,child)=>child===parent||child.startsWith(parent+sep);
const args=new Map();
for(let index=2;index<process.argv.length;index+=2){
  const key=process.argv[index],value=process.argv[index+1];
  if(!['--root','--canaries','--output','--tree-kind'].includes(key)||!value||args.has(key))throw new Error('Use --root, --canaries, --output and optional --tree-kind host|logs|browser.');
  args.set(key,value);
}
if(!['--root','--canaries','--output'].every(key=>args.has(key)))throw new Error('Use --root, --canaries and --output exactly once.');
const treeKind=args.get('--tree-kind')??'host';
if(!['host','logs','browser'].includes(treeKind))throw new Error('tree-kind must be host, logs or browser.');
const scanRoot=await realpath(resolve(projectRoot,args.get('--root')));
const allowedReal=await realpath(allowedRoot);
if(allowedReal!==allowedRoot)throw new Error('The isolated acceptance root must not resolve through a symlink.');
if(!within(allowedReal,scanRoot))throw new Error('Scan root must be inside .local/memory-acceptance.');
const canaryPath=await realpath(resolve(projectRoot,args.get('--canaries')));
if(!within(allowedReal,canaryPath))throw new Error('Synthetic canary input must be inside .local/memory-acceptance.');
const output=resolve(projectRoot,args.get('--output'));
if(within(scanRoot,canaryPath)||within(scanRoot,output))throw new Error('Canary inputs and scan reports must be outside the scanned tree.');
const source=JSON.parse(await readFile(canaryPath,'utf8'));
if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length<3)throw new Error('Canaries must be an object with at least 3 synthetic markers.');
if(Object.values(source).filter(value=>typeof value==='string'&&value.length>=12).length<3)throw new Error('Use at least 3 distinctive synthetic markers of 12 or more characters.');
const markers=Object.entries(source).map(([id,value])=>{
  if(!/^[a-z][a-z0-9-]{0,63}$/i.test(id)||typeof value!=='string'||value.length<8||value.length>4000)throw new Error('Use short public marker IDs and synthetic text between 8 and 4000 characters.');
  const utf16le=Buffer.from(value,'utf16le'),utf16be=Buffer.from(utf16le).swap16();
  return {id,sha256:sha256(value),needles:[...[...new Set([value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value)])].map(value=>Buffer.from(value)),utf16le,utf16be]};
});
const files=[],matches=[],unverified=[],skipped=[],encodingLimits=[];
let sessionFiles=0,ciphertextFiles=0;
async function walk(directory){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const full=resolve(directory,entry.name),name=relative(scanRoot,full).split(sep).join('/');
    const stat=await lstat(full);
    if(stat.isSymbolicLink()){skipped.push({path:name,reason:'symlink-not-followed'});continue;}
    if(stat.isDirectory()){await walk(full);continue;}
    if(!stat.isFile()){unverified.push({path:name,reason:'non-regular-file'});continue;}
    let bytes;
    try{bytes=await readFile(full);}catch{unverified.push({path:name,reason:'read-failed'});continue;}
    const variants=[{kind:'raw',bytes}];
    if(treeKind==='browser'&&/\.(?:ldb|sst)$/i.test(name))encodingLimits.push({path:name,reason:'LevelDB-table-block-compression-not-decoded'});
    if(/\.(?:zstd|zst|gz)$/i.test(name)){
      try{variants.push({kind:/\.gz$/i.test(name)?'gunzip':'zstd-decompressed',bytes:/\.gz$/i.test(name)?gunzipSync(bytes,{maxOutputLength:256*1024*1024}):zstdDecompressSync(bytes,{maxOutputLength:256*1024*1024})});}
      catch{unverified.push({path:name,reason:'decompression-failed'});}
    }
    if(name.startsWith('sessions/'))sessionFiles++;
    // Counting a ciphertext-bearing storage record prevents an empty-tree PASS.
    if(name.startsWith('storages/')&&variants.some(item=>/"(?:ciphertext|cipherText|encrypted|envelope)"\s*:/.test(item.bytes.toString('utf8'))))ciphertextFiles++;
    for(const variant of variants)for(const marker of markers)if(marker.needles.some(needle=>variant.bytes.includes(needle)))matches.push({path:name,representation:variant.kind,markerId:marker.id});
    files.push({path:name,bytes:bytes.length,sha256:sha256(bytes),representations:variants.map(item=>item.kind)});
  }
}
await walk(scanRoot);
const missingCoverage=[];
if(!files.length)missingCoverage.push('no-files');
if(treeKind==='host'&&!ciphertextFiles)missingCoverage.push('no-ciphertext-storage-record');
if(treeKind==='host'&&!sessionFiles)missingCoverage.push('no-session-metadata-file');
const status=matches.length?'FAIL':unverified.length||missingCoverage.length||encodingLimits.length?'NOT_CHECKED':'PASS';
const report={schemaVersion:1,checkedAt:new Date().toISOString(),status,treeKind,scanRoot:relative(projectRoot,scanRoot),expectedCoverage:{files:'required',ciphertextStorage:treeKind==='host'?'required':'not-applicable-for-this-tree',sessionMetadata:treeKind==='host'?'required':'not-applicable-for-this-tree'},markerInputs:markers.map(({id,sha256})=>({id,sha256})),markerEncodings:['utf8','json-escaped','uri-encoded','utf16le','utf16be'],counts:{files:files.length,sessionFiles,ciphertextFiles,matches:matches.length,unverified:unverified.length,skippedSymlinks:skipped.length,encodingLimits:encodingLimits.length},files,matches,unverified,skipped,encodingLimits,missingCoverage,evidenceBoundary:{syntheticDataOnly:true,realProfileScanned:false,providerCalls:0,interpretationQuality:'NOT_CHECKED',claims:'Known synthetic marker scan of raw bytes, UTF-8/UTF-16 representations and supported zstd/gzip files in this isolated tree. Browser cache formats, encrypted browser fields, external plugins, providers, memory, backups and other files are outside this claim; LevelDB compressed tables are explicitly NOT_CHECKED.'}};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status,...report.counts,output:relative(projectRoot,output)}));
if(status!=='PASS')process.exitCode=1;
