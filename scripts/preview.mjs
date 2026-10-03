// Start the shipped DSH runtime in a disposable profile, with a local mock provider.
import { existsSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,lstatSync,readlinkSync,unlinkSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const pluginRoot=resolve(process.env.DSH_PREVIEW_PLUGIN??root);
const cli=process.env.DSH_CLI??'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
if(!existsSync(cli))throw new Error('Set DSH_CLI to the official dsh executable.');
if(!existsSync(resolve(pluginRoot,'lib/index.js')))throw new Error('Run npm run build first or set DSH_PREVIEW_PLUGIN to an extracted package.');
const home=resolve(root,'.local/test-home'),profile=resolve(home,'profiles/meihua-v1');
const env={...process.env,DSH_HOME:home};
mkdirSync(profile,{recursive:true});
if(!existsSync(resolve(profile,'cordis.yml'))){
  const init=spawnSync(cli,['--profile','meihua-v1','--from-default-profile','web','--help'],{cwd:root,env,encoding:'utf8'});
  if(init.status!==0)throw new Error(init.stderr||'Could not create the test profile');
}
const manifestPath=resolve(profile,'package.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
manifest.dependencies={'dsh-meihua':`link:${pluginRoot}`};manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-meihua'];
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const link=resolve(profile,'node_modules/dsh-meihua');mkdirSync(dirname(link),{recursive:true});
if(existsSync(link)&&lstatSync(link).isSymbolicLink()&&resolve(dirname(link),readlinkSync(link))!==pluginRoot)unlinkSync(link);
if(!existsSync(link))symlinkSync(pluginRoot,link,'dir');
const patch=resolve(root,'.local/offline.patch.yml');
writeFileSync(patch,`- insert:\n  - id: meihua-offline\n    name: ${JSON.stringify(resolve(root,'tests/fixtures/preview-provider.mjs'))}\n`);
console.log('Isolated DSH preview. Select 本地演示 · 模拟供应商 for an offline interpretation.');
const child=spawn(cli,['--profile','meihua-v1','--patch',patch,'--no-open','--port',process.env.DSH_PREVIEW_PORT??'19402'],{cwd:root,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.once('exit',code=>{process.exitCode=code??0;});
