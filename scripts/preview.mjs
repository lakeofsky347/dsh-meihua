// Start the shipped DSH runtime in a disposable profile, with a local mock provider.
import { existsSync,mkdirSync,writeFileSync,readFileSync,lstatSync,realpathSync,unlinkSync,readdirSync,rmdirSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { resolveProjectRoot,resolveDshCli,cliInvocation,linkDirectory,resolvePreviewHome,assertPreviewPath } from './environment.mjs';
const root=resolveProjectRoot(import.meta.url);
const pluginRoot=resolve(process.env.DSH_PREVIEW_PLUGIN??root);
const cli=resolveDshCli({root});
if(!existsSync(resolve(pluginRoot,'lib/index.js')))throw new Error('Run npm run build first or set DSH_PREVIEW_PLUGIN to an extracted package.');
const home=resolvePreviewHome(root),profile=resolve(home,'profiles/meihua-v1');
const env={...process.env,DSH_HOME:home};
for(const path of [profile,resolve(profile,'cordis.yml'),resolve(profile,'package.json'),resolve(profile,'node_modules')])assertPreviewPath(home,path);
mkdirSync(home,{recursive:true});
if(!existsSync(resolve(profile,'cordis.yml'))){
  // The released CLI refuses to initialize an existing profile, even if empty.
  if(existsSync(profile)&&readdirSync(profile).length===0)rmdirSync(profile);
  const invocation=cliInvocation(cli,['--profile','meihua-v1','--from-default-profile','web','--help']);
  const init=spawnSync(invocation.command,invocation.args,{cwd:root,env,encoding:'utf8',...invocation.options});
  if(init.status!==0)throw new Error(init.error?.message||init.stderr||'Could not create the test profile');
}
const link=resolve(profile,'node_modules/dsh-meihua');mkdirSync(dirname(link),{recursive:true});
let currentLink;try{currentLink=lstatSync(link);}catch(error){if(error.code!=='ENOENT')throw error;}
if(currentLink?.isSymbolicLink()){
  if(!existsSync(link)||realpathSync(link)!==realpathSync(pluginRoot))unlinkSync(link);
}else if(currentLink&&realpathSync(link)!==realpathSync(pluginRoot))throw new Error('The preview contains an installed plugin directory instead of the selected package link. Select a new isolated preview home.');
if(!existsSync(link))linkDirectory(pluginRoot,link);
const manifestPath=resolve(profile,'package.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
manifest.dependencies={'dsh-meihua':`link:${pluginRoot}`};manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-meihua'];
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const patch=resolve(root,'.local/offline.patch.yml');
writeFileSync(patch,`- id: llm-pi-ai\n  disabled: true\n- id: llm-deepseek\n  disabled: true\n- id: llm-deepseek-account\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: meihua-offline\n    model: offline-demo\n- insert:\n  - id: meihua-offline\n    name: ${JSON.stringify(resolve(root,'tests/fixtures/preview-provider.mjs'))}\n`);
console.log('Isolated DSH preview. Select 本地演示 · 模拟供应商 for an offline interpretation.');
const invocation=cliInvocation(cli,['--profile','meihua-v1','--patch',patch,'--no-open','--host','127.0.0.1','--port',process.env.DSH_PREVIEW_PORT??'19402']);
const child=spawn(invocation.command,invocation.args,{cwd:root,env,stdio:'inherit',...invocation.options});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.once('error',error=>{console.error(`Could not start the isolated DSH preview: ${error.message}`);process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??0;});
