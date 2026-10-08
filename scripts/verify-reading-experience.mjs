// Real isolated DSH Web + shipped plugin. Only the local demo provider is allowed.
// Start preview on 19418 with .local/v7-preview.log, then run this script.
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),log=resolve(root,'.local/v7-preview.log');
const baseURL=process.env.DSH_READING_URL??(existsSync(log)?readFileSync(log,'utf8').match(/dsh web:\s*(http:\/\/127\.0\.0\.1:19418\/[^\s]*)/)?.[1]:undefined)??'http://127.0.0.1:19418';
const base=new URL(baseURL);if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Use an isolated loopback runtime only.');
const runId=new Date().toISOString().replaceAll(':','-').replaceAll('.','-'),out=resolve(root,'artifacts/verification-v7',runId);mkdirSync(out,{recursive:true});
const require=createRequire(resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--disable-component-update']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',colorScheme:'light',reducedMotion:'reduce'});
const report={runId,evidence:'real isolated DSH Web runtime and shipped plugin; synthetic local provider only',origin:base.origin,checks:[],screenshots:[],geometry:[],consoleErrors:[],pageErrors:[],failedResponses:[],blockedExternalRequests:[],blockedModelRequests:[],rpcCounts:{},servedClientMatches:false};
const clientBytes=readFileSync(resolve(root,'lib/client.js'));report.clientSha256=createHash('sha256').update(clientBytes).digest('hex');
const redact=value=>String(value).replace(/([?&](?:token|auth|secret|api_key|password)=)[^\s&"']*/gi,'$1[redacted]').replace(/data:image\/[^\s"'<>]+/gi,'[embedded-image]');
const requests=[];
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){report.blockedExternalRequests.push({origin:url.origin,path:url.pathname});return route.abort('blockedbyclient');}
  if(url.pathname.startsWith('/api/')){
    const method=url.pathname.slice(5);report.rpcCounts[method]=(report.rpcCounts[method]??0)+1;
    if(/\/(interpret|followup|resume)$/.test(method)){
      const data=req.postDataJSON(),payload=data?.payload??{};
      if(payload.provider&&payload.provider!=='meihua-offline'){report.blockedModelRequests.push(method);return route.abort('blockedbyclient');}
      requests.push({method,id:payload.id,turnId:payload.turnId,expectedTurnCount:payload.expectedTurnCount,expectedAttempt:payload.expectedAttempt});
    }
  }
  return route.continue();
});
const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(120000);
page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(redact(message.text()).slice(0,1500));});
page.on('pageerror',error=>report.pageErrors.push(redact(error.message).slice(0,1500)));
const responseReads=[];
page.on('response',response=>{
  const path=new URL(response.url()).pathname;
  if(response.status()>=400)report.failedResponses.push({path,status:response.status()});
  if(response.ok()&&response.request().resourceType()==='script')responseReads.push(response.body().then(bytes=>{if(bytes.indexOf(clientBytes)>=0)report.servedClientMatches=true;}).catch(()=>{}));
});
await page.addLocatorHandler(page.getByText('预览版说明',{exact:true}),async()=>{await page.getByRole('button',{name:/^(继续|Continue)$/,exact:true}).click();});
const modules=[{id:'meihua',title:'梅花易数',page:'.mh-page'},{id:'tarot',title:'塔罗牌',page:'.tr-page'},{id:'xiaoliu',title:'小六壬',page:'.wx-method-page'},{id:'lenormand',title:'雷诺曼',page:'.wx-method-page'},{id:'liuyao',title:'六爻纳甲',page:'.wx-method-page'}];
const hub=page.locator('.wx-hub'),active=()=>hub.locator('.wx-view:not([hidden])'),panel=()=>active().locator('.mh-page,.tr-page,.wx-method-page');
async function check(name,action){try{const result=await action();report.checks.push({name,status:'PASS',...(result===undefined?{}:{result})});}catch(error){report.checks.push({name,status:'FAIL',error:redact(error.message).slice(0,2000)});}}
async function settled(){await page.waitForFunction(()=>{const h=document.querySelector('.wx-hub');return h&&!h.classList.contains('wx-travelling');});await page.evaluate(()=>document.fonts.ready);await hub.evaluate(el=>new Promise(resolve=>{let last='',stable=0;const frame=()=>{const rect=el.getBoundingClientRect(),nav=el.querySelector('.wx-topbar')?.getBoundingClientRect(),value=[rect.width,rect.height,nav?.height].join(':');stable=value===last?stable+1:0;last=value;if(stable>=4)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);}));}
async function navigate(id){const view=await hub.getAttribute('data-view');if(view===id)return settled();if(id==='portal')await hub.locator('.wx-home').click();else if(view==='portal')await hub.locator(`.wx-gateway-${id}`).click();else await hub.locator(`.wx-module-tabs [data-module="${id}"]`).click();await page.waitForFunction(id=>document.querySelector('.wx-hub')?.getAttribute('data-view')===id,id);await settled();}
async function capture(name){const file=resolve(out,`${name}.png`);await hub.screenshot({path:file,animations:'disabled'});report.screenshots.push({name,file,view:await hub.getAttribute('data-view'),position:await panel().count()?await panel().evaluate(el=>el.scrollTop):null});}
async function position(target){return panel().evaluate((el,selector)=>{const node=el.querySelector(selector),box=el.getBoundingClientRect(),rect=node?.getBoundingClientRect();return {scrollTop:el.scrollTop,panelTop:box.top,panelBottom:box.bottom,targetTop:rect?.top,targetBottom:rect?.bottom};},target);}
async function geometry(name){
  await settled();const result=await hub.evaluate(el=>{
    const box=el.getBoundingClientRect(),view=el.querySelector('.wx-view:not([hidden])'),nav=el.querySelector('.wx-topbar'),navBox=nav?.getBoundingClientRect(),viewBox=view?.getBoundingClientRect();
    const overflow=[];for(const node of [el,...el.querySelectorAll('main,section,article,aside,form,input,select,textarea,button,h1,h2,h3,p,table,.wx-reading-jump,.wx-topbar')]){
      if(!(node instanceof HTMLElement)||!node.getClientRects().length||node.closest('[aria-hidden="true"]'))continue;
      if(getComputedStyle(node).visibility==='hidden'||node.closest('.tr-card-river,.wx-module-tabs,.wx-liuyao-table'))continue;
      const rect=node.getBoundingClientRect(),css=getComputedStyle(node);if(rect.left<box.left-2||rect.right>box.right+2||node.scrollWidth>node.clientWidth+2&&['visible','hidden','clip'].includes(css.overflowX))overflow.push({tag:node.tagName,className:node.className,width:rect.width,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,left:rect.left-box.left,right:rect.right-box.left});
    }
    const round=n=>Math.round(n*100)/100;return {viewport:{width:innerWidth,height:innerHeight},panel:{width:round(box.width),height:round(box.height)},view:el.dataset.view,overflow,navOverlap:nav&&!nav.hidden?round(navBox.bottom-viewBox.top):0,scrollTop:view?.querySelector('.mh-page,.tr-page,.wx-method-page')?.scrollTop??0};
  });report.geometry.push({name,...result});assert.equal(result.overflow.length,0,JSON.stringify(result.overflow.slice(0,8)));assert.ok(Math.abs(result.navOverlap)<=2,`nav/view gap or overlap ${result.navOverlap}`);return {width:result.panel.width,navOverlap:result.navOverlap};
}
async function moduleResultVisible(){await settled();const result=await position('[data-reading-result]');assert.ok(result.targetTop>=result.panelTop-2&&result.targetTop<result.panelBottom-50,JSON.stringify(result));return result;}
async function useSyntheticProvider(){const selects=active().locator('[data-reading-interpretation] select');if(await selects.count()){await selects.nth(0).selectOption('meihua-offline');await selects.nth(1).selectOption('offline-demo');}}

try{
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:/问象.*占卜|Wenxiang.*Divination/}).first().click({timeout:120000});await hub.waitFor();await settled();
  await check('artifact: loaded the newly built client',async()=>{await Promise.all(responseReads);assert.equal(report.servedClientMatches,true);return {sha256:report.clientSha256};});
  await check('local vault: initialize isolated synthetic background',async()=>{
    await hub.locator('.wm-entry-portal').click();await hub.locator('.wm-panel').waitFor();const auth=hub.locator('.wm-auth');if(await auth.count()){const fields=auth.locator('input[type=password]');for(let index=0;index<await fields.count();index++)await fields.nth(index).fill('synthetic-v7-reading-only');await auth.locator('button[type=submit]').click();}await hub.getByRole('button',{name:'关闭共享背景',exact:true}).click();assert.equal(await hub.locator('.wm-panel').count(),0);
  });
  await check('meihua: new local result enters its result region',async()=>{
    await navigate('meihua');await active().locator('#mh-question').fill('界面验收：如何清楚安排接下来的学习步骤？');await active().getByRole('button',{name:'三数起卦',exact:true}).click();for(const [i,value]of ['2','3','2'].entries())await active().locator('.mh-number-row input').nth(i).fill(value);await active().locator('.mh-cast').click();await active().locator('.mh-hexagrams').waitFor();const result=await moduleResultVisible();await capture('meihua-local-result-position');return result;
  });
  await check('tarot: ten-card spread stays aligned through select and reveal',async()=>{
    await navigate('tarot');await active().locator('#tr-question').fill('界面验收：十字牌阵与卡片详情');await active().getByRole('button',{name:'凯尔特十字 10 张',exact:true}).click();await active().locator('.tr-start').click();await active().locator('.tr-card-river').waitFor();for(let i=0;i<10;i++)await active().locator('.tr-river-card').nth(i).click();await active().getByRole('button',{name:'全部揭示 ↗',exact:true}).click();await active().locator('.tr-meaning-list article').nth(9).waitFor();await moduleResultVisible();await capture('tarot-celtic-cross');return {cards:await active().locator('.tr-position').count()};
  });
  await check('xiaoliu: local result is visible after action',async()=>{
    await navigate('xiaoliu');await active().locator('#xiaoliu-question').fill('界面验收：小六壬结果');await active().locator('#xiaoliu-time').fill('2024-04-13T08:00');await active().locator('form button[type=submit]').click();await active().locator('.wx-six-palaces article').nth(2).waitFor();return moduleResultVisible();
  });
  await check('lenormand: five cards and local combination results',async()=>{
    await navigate('lenormand');await active().locator('#lenormand-question').fill('界面验收：雷诺曼结果');await active().locator('#lenormand-spread').selectOption('line-5');await active().locator('form button[type=submit]').click();await active().locator('.wx-small-deck button').nth(35).waitFor();for(const slot of [1,3,8,15,31])await active().locator('.wx-small-deck button').nth(slot-1).click();await active().getByRole('button',{name:'揭示这组牌',exact:true}).click();await active().locator('.wx-small-cards article').nth(4).waitFor();return moduleResultVisible();
  });
  await check('liuyao: six recorded sums become a complete local result',async()=>{
    await navigate('liuyao');await active().locator('#liuyao-question').fill('界面验收：六爻装卦结果');await active().locator('#liuyao-time').fill('2024-04-13T08:00');await active().locator('form button[type=submit]').click();for(const sum of [6,7,8,9,7,8])await active().getByRole('button',{name:new RegExp(`^记录 ${sum}`)}).click();await active().locator('.wx-liuyao-table tbody tr').nth(5).waitFor();return moduleResultVisible();
  });

  // These controlled Hub widths exercise a narrow plugin pane in a wide window.
  for(const width of [360,390,600,1200]){
    await page.setViewportSize({width:width===1200?1600:1440,height:1000});await hub.evaluate((el,width)=>{el.style.width=`${width}px`;el.style.maxWidth='100%';},width);
    for(const module of modules){await navigate(module.id);await check(`geometry: ${module.id} at controlled ${width}px Hub in ${width===1200?1600:1440}px window`,()=>geometry(`${module.id}-hub-${width}`));if(width===360||width===1200)await capture(`${module.id}-hub-${width}`);}
    await navigate('tarot');await check(`modal: card details at ${width}px Hub`,async()=>{
      // Position 2 intentionally crosses the middle of position 1. Its exposed
      // upper face remains a pointer target; keyboard opening must work too.
      let crossLayout;
      if(width===1200){crossLayout=await active().locator('.tr-board-celtic-cross').evaluate(el=>{const first=el.querySelector('[data-position="1"] .tr-position-card').getBoundingClientRect(),slot=el.querySelector('[data-position="2"]').getBoundingClientRect(),second=el.querySelector('[data-position="2"] .tr-position-card').getBoundingClientRect(),label=el.querySelector('[data-position="2"] .tr-position-label').getBoundingClientRect(),direction=el.querySelector('[data-position="1"]>.tr-orientation').getBoundingClientRect();return {horizontal:second.width>second.height,overlap:second.left<first.right&&second.right>first.left&&second.top<first.bottom&&second.bottom>first.top,labelInsideSlot:label.left>=slot.left-1&&label.right<=slot.right+1,labelBelowFirst:label.top>=direction.bottom,cardInsideSlot:second.left>=slot.left-1&&second.right<=slot.right+1};});assert.ok(Object.values(crossLayout).every(Boolean),JSON.stringify(crossLayout));}
      const first=active().locator('.tr-position[data-position="1"] .tr-position-card');await first.scrollIntoViewIfNeeded();
      const point=await first.evaluate(el=>{const rect=el.getBoundingClientRect(),x=rect.width/2,y=12;return {x,y,hit:el.contains(document.elementFromPoint(rect.left+x,rect.top+y))};});assert.ok(point.hit,'First card has no reachable upper face');await first.click({position:{x:point.x,y:point.y}});
      const dialog=hub.locator('.tr-dialog');await dialog.waitFor();const details=await dialog.evaluate(el=>{const hub=el.closest('.wx-hub'),box=hub.getBoundingClientRect(),rect=el.getBoundingClientRect(),close=el.querySelector('.tr-dialog-close').getBoundingClientRect();return {portalledToHub:el.parentElement.parentElement===hub,panelWidth:box.width,dialogWidth:rect.width,inside:rect.left>=box.left&&rect.right<=box.right+1&&rect.top>=box.top&&rect.bottom<=box.bottom+1,closeInside:close.top>=box.top&&close.bottom<=box.bottom};});assert.ok(details.portalledToHub&&details.inside&&details.closeInside,JSON.stringify(details));await dialog.locator('.tr-dialog-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});await capture(`tarot-dialog-hub-${width}`);await dialog.getByRole('button',{name:'关闭牌面详情',exact:true}).click();assert.equal(await hub.locator('.tr-dialog').count(),0);
      await first.focus();await page.keyboard.press('Enter');await dialog.waitFor();await page.keyboard.press('Escape');assert.equal(await hub.locator('.tr-dialog').count(),0);assert.ok(await first.evaluate(el=>document.activeElement===el),'Keyboard focus must return to card 1');
      await active().locator('.tr-position[data-position="2"] .tr-position-card').click();await dialog.waitFor();assert.match(await dialog.locator('.tr-eyebrow').innerText(),/^02/);await page.keyboard.press('Escape');return {...details,firstCardPointer:true,firstCardKeyboard:true,secondCardPointer:true,...(crossLayout?{crossLayout}:{})};
    });
  }
  await hub.evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('max-width');});
  for(const width of [390,600]){await page.setViewportSize({width,height:844});for(const module of modules){await navigate(module.id);await check(`geometry: ${module.id} actual host viewport ${width}`,()=>geometry(`${module.id}-viewport-${width}`));}}
  await page.setViewportSize({width:1440,height:1000});await navigate('meihua');

  await check('long answer: max-tokens is incomplete and never auto-resumes',async()=>{
    await page.waitForFunction(()=>document.querySelector('.wx-hub .wm-entry small')?.textContent==='已解锁',undefined,{timeout:30000});await useSyntheticProvider();await active().locator('.mh-interpret-button').click();await active().locator('.mh-status-failed').waitFor({timeout:30000});const text=await active().locator('.mh-reading-text').innerText();assert.ok(text.length>900);assert.match(await active().locator('.wx-generation').innerText(),/最高思考档位/);assert.match(await active().locator('.wx-generation').innerText(),/65,536/);assert.equal(await active().locator('.wx-resume button').innerText(),'继续完成');const before=report.rpcCounts['meihua/resume']??0;await page.waitForTimeout(450);assert.equal(report.rpcCounts['meihua/resume']??0,before);await capture('meihua-incomplete-explicit-resume');return {characters:text.length,resumeRequests:before};
  });
  await check('resume: keeps prefix, does not steal backscroll, follows after explicit latest',async()=>{
    const prefix=await active().locator('.mh-reading-text').innerText();await active().locator('.wx-resume button').click();await active().locator('.mh-status-streaming').waitFor();await page.waitForFunction(length=>(document.querySelector('.wx-view:not([hidden]) .mh-reading-text')?.textContent?.length??0)>length+120,prefix.length,{timeout:30000});
    await panel().hover({position:{x:180,y:150}});await page.mouse.wheel(0,-20000);await page.waitForFunction(()=>document.querySelector('.wx-view:not([hidden]) .mh-page')?.scrollTop<3);
    const before=await active().locator('.mh-reading-text').evaluate(el=>el.textContent.length);await page.waitForFunction(length=>(document.querySelector('.wx-view:not([hidden]) .mh-reading-text')?.textContent?.length??0)>length+80,before,{timeout:10000});const held=await panel().evaluate(el=>el.scrollTop);assert.ok(held<3,`Reading position moved to ${held}`);await capture('meihua-stream-backscroll-protected');
    await active().locator('.wx-reading-jump button').last().click();const initial=await panel().evaluate(el=>el.scrollTop);await page.waitForFunction(initial=>document.querySelector('.wx-view:not([hidden]) .mh-page')?.scrollTop>initial+20,initial,{timeout:10000});await active().locator('.mh-status-complete').waitFor({timeout:30000});const completed=await active().locator('.mh-reading-text').innerText();assert.ok(completed.startsWith(prefix));assert.ok(completed.length>prefix.length+2000);assert.ok(await active().locator('.mh-reading-text h4').count()>10);assert.ok(await active().locator('.mh-reading-text li').count()>10);await capture('meihua-resumed-long-complete');return {prefixCharacters:prefix.length,completedCharacters:completed.length,heldScrollTop:held,resumeRequest:requests.filter(req=>req.method==='meihua/resume').at(-1)};
  });
  await check('follow-up: positions the new reply and renders shared Markdown',async()=>{
    await active().locator('.wx-conversation-form textarea').fill('请用白话解释今天可以先做什么，并分成三个步骤。');await active().locator('.wx-conversation-form button[type=submit]').click();await active().locator('.wx-conversation-turn').last().waitFor();const initial=await position('.wx-conversation-turn:last-child');assert.ok(initial.targetTop<initial.panelBottom&&initial.targetBottom>initial.panelTop,JSON.stringify(initial));await active().locator('.wx-conversation-turn[data-status=complete]').last().waitFor({timeout:30000});const last=active().locator('.wx-conversation-turn').last();assert.ok(await last.locator('.wx-reading-text h4').count()>10);assert.ok(await last.locator('.wx-reading-text li').count()>10);await capture('meihua-followup-markdown-complete');return {positionAfterSubmit:initial,headings:await last.locator('h4').count(),lists:await last.locator('li').count()};
  });
  await check('module return: restores the current reading position',async()=>{
    await panel().hover({position:{x:180,y:150}});await page.mouse.wheel(0,-600);await page.waitForTimeout(80);const before=await panel().evaluate(el=>el.scrollTop);await navigate('tarot');await navigate('meihua');const after=await panel().evaluate(el=>el.scrollTop);assert.ok(Math.abs(before-after)<2,`${before} -> ${after}`);return {before,after};
  });
  for(const width of [360,600]){await hub.evaluate((el,width)=>{el.style.width=`${width}px`;el.style.maxWidth='100%';},width);await check(`long text geometry: ${width}px Hub`,()=>geometry(`long-meihua-${width}`));await capture(`meihua-long-hub-${width}`);}
  await hub.evaluate(el=>{el.style.removeProperty('width');el.style.removeProperty('max-width');});
  for(const zoom of [1.5,2]){
    await page.evaluate(zoom=>{document.body.style.zoom=String(zoom);},zoom);
    for(const module of modules){await navigate(module.id);await check(`CSS zoom simulation: ${zoom*100}% ${module.id}`,()=>geometry(`css-zoom-${zoom}-${module.id}`));if(module.id==='meihua')await check(`CSS zoom navigation: ${zoom*100}% interpretation and latest`,async()=>{
      await active().locator('.wx-reading-jump button').first().click();const heading=await position('[data-reading-interpretation]'),toolbarHeight=await active().locator('.wx-reading-jump').evaluate(el=>el.getBoundingClientRect().height);assert.ok(Math.abs(heading.targetTop-heading.panelTop-toolbarHeight-18*zoom)<3,JSON.stringify({heading,toolbarHeight}));
      await active().locator('.wx-reading-jump button').last().click();const latest=await panel().evaluate(el=>{const end=Array.from(el.querySelectorAll('[data-reading-end]')).at(-1).getBoundingClientRect(),box=el.getBoundingClientRect();return {top:end.top,bottom:end.bottom,panelTop:box.top,panelBottom:box.bottom};});assert.ok(latest.bottom<=latest.panelBottom+2&&latest.top>=latest.panelTop,JSON.stringify(latest));return {heading,latest};
    });}
    await capture(`css-zoom-${zoom}-liuyao`);
  }
  await page.evaluate(()=>document.body.style.removeProperty('zoom'));
  await check('runtime: no external/model escape or browser errors',()=>{assert.deepEqual(report.blockedModelRequests,[]);assert.deepEqual(report.blockedExternalRequests,[]);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.failedResponses,[]);});
}catch(error){report.checks.push({name:'complete browser lane',status:'FAIL',error:redact(error.message).slice(0,2500)});try{await page.screenshot({path:resolve(out,'failure.png')});}catch{}}
finally{
  report.requests=requests;report.finishedAt=new Date().toISOString();report.status=report.checks.some(check=>check.status==='FAIL')?'FAIL':'PASS';writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(check=>check.status==='FAIL'),report:resolve(out,'report.json')},null,2));if(report.status!=='PASS')process.exitCode=1;
}
