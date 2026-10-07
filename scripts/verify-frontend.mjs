// Exercise the shipped plugin through a real, isolated DSH Web runtime.
// Start with: DSH_PREVIEW_HOME=.local/frontend-review-home DSH_PREVIEW_PORT=19408 npm run preview
// Then run: node scripts/verify-frontend.mjs
// Uses installed browser/runtime tools only. It never presses an AI action.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const previewLog = resolve(root, '.local/frontend-review-preview.log');
const loggedURL = existsSync(previewLog) ? readFileSync(previewLog, 'utf8').match(/dsh web:\s*(http:\/\/127\.0\.0\.1:19408\/[^\s]*)/)?.[1] : undefined;
// The runtime's short-lived token is consumed only for browser entry; no token
// or full request URL is written to evidence or stdout.
const baseURL = process.env.DSH_FRONTEND_URL ?? loggedURL ?? 'http://127.0.0.1:19408';
const base = new URL(baseURL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('The frontend verification must target a loopback runtime.');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const out = resolve(root, 'artifacts/verification-frontend-20261007', runId);
mkdirSync(out, { recursive: true });
const requireBundled = createRequire('/Users/skylake/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = requireBundled('playwright');
const chrome = process.env.DSH_FRONTEND_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce' });
const report = {
  runId, baseURL: base.origin, evidence: 'real DSH Web runtime, real plugin bundle, browser DOM actions',
  browser: { name: 'Chromium', version: browser.version(), executable: existsSync(chrome) ? chrome : 'existing Playwright browser' },
  checks: [], screenshots: [], geometry: [], consoleErrors: [], pageErrors: [], failedResponses: [],
  blockedExternalRequests: [], rpcMethods: {}, prohibitedAiRequests: [], status: 'RUNNING',
};
const previewManifest = resolve(root, '.local/frontend-review-home/profiles/meihua-v1/package.json');
if (existsSync(previewManifest)) {
  const dependency = JSON.parse(readFileSync(previewManifest, 'utf8')).dependencies?.['dsh-meihua'];
  if (dependency?.startsWith('link:')) {
    const pluginRoot = resolve(dependency.slice(5));
    const packageJson = resolve(pluginRoot, 'package.json');
    const clientBundle = resolve(pluginRoot, 'lib/client.js');
    const hostBundle = resolve(pluginRoot, 'lib/index.js');
    report.pluginArtifact = {
      previewProfile: relative(root, previewManifest), previewPluginPath: pluginRoot,
      ...(existsSync(packageJson) ? { version: JSON.parse(readFileSync(packageJson, 'utf8')).version } : {}),
      bundles: [clientBundle, hostBundle].filter(existsSync).map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
    };
  }
}
const archivePath = resolve(root, process.env.DSH_FRONTEND_ARCHIVE ?? 'artifacts/dsh-meihua-0.6.0-frontend-20261007.tgz');
if (existsSync(archivePath)) report.packageArchive = { path: archivePath, sha256: createHash('sha256').update(readFileSync(archivePath)).digest('hex') };
// Browser-level defense in depth. The disposable preview disables real providers;
// this lane additionally prevents interpretation/follow-up requests and external fetches.
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    report.blockedExternalRequests.push({ origin: url.origin, path: url.pathname });
    return route.abort('blockedbyclient');
  }
  if (url.pathname.startsWith('/api/')) {
    const method = url.pathname.slice(5);
    report.rpcMethods[method] = (report.rpcMethods[method] ?? 0) + 1;
    if (/\/(interpret|followup)$/.test(method) || /(?:llm|agent).*\/(?:generate|run|send|stream)$/.test(method)) {
      report.prohibitedAiRequests.push(method);
      return route.abort('blockedbyclient');
    }
  }
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const redact = value => String(value).replace(/([?&](?:token|auth|secret|api_key|password)=)[^\s&"']*/gi, '$1[redacted]');
page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(redact(message.text()).slice(0, 1500)); });
page.on('pageerror', error => report.pageErrors.push(redact(error.message).slice(0, 1500)));
page.on('response', response => {
  if (response.status() >= 400) {
    const url = new URL(response.url());
    report.failedResponses.push({ status: response.status(), path: url.pathname });
  }
});

const modules = [
  { id: 'meihua', title: '梅花易数', selector: '.mh-page' },
  { id: 'tarot', title: '塔罗牌', selector: '.tr-page' },
  { id: 'xiaoliu', title: '小六壬', selector: '.wx-method-page' },
  { id: 'lenormand', title: '雷诺曼', selector: '.wx-method-page' },
  { id: 'liuyao', title: '六爻纳甲', selector: '.wx-method-page' },
];
const hub = page.locator('.wx-hub');
const active = () => hub.locator('.wx-view:not([hidden])');
async function check(name, action) {
  try { const result = await action(); report.checks.push({ name, status: 'PASS', ...(result === undefined ? {} : { result }) }); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: redact(error.message ?? error).slice(0, 1800) }); }
}
async function settled(view) {
  await page.waitForFunction(view => {
    const hub = document.querySelector('.wx-hub');
    return hub?.getAttribute('data-view') === view && !hub.classList.contains('wx-travelling');
  }, view);
  await page.evaluate(() => document.fonts.ready);
}
async function navigate(id, fromPortal = false) {
  const current = await hub.getAttribute('data-view');
  if (current === id) return settled(id);
  if (id === 'portal') await hub.locator('.wx-home').click();
  else if (fromPortal || current === 'portal') await hub.locator(`.wx-gateway-${id}`).click();
  else await hub.locator('.wx-module-tabs').getByRole('button', { name: modules.find(module => module.id === id).title, exact: true }).click();
  await settled(id);
}
async function capture(name, bottom = false) {
  await stableLayout();
  const view = active();
  await view.evaluate((view, bottom) => {
    for (const node of view.querySelectorAll('*')) {
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) node.scrollTop = bottom ? node.scrollHeight : 0;
    }
  }, bottom);
  const file = resolve(out, `${name}.png`);
  await hub.screenshot({ path: file, animations: 'disabled' });
  report.screenshots.push({ name, file: relative(root, file), view: await hub.getAttribute('data-view'), scheme: await hub.getAttribute('data-scheme'), position: bottom ? 'bottom' : 'top' });
}
async function stableLayout() {
  // A viewport resize first updates the browser, then the host's sidebar store
  // and the plugin's ResizeObserver. Measure only after actual geometry stays
  // unchanged for several rendered frames; do not sample the intermediate 280px
  // desktop sidebar in a 390px viewport.
  await hub.evaluate(hub => new Promise(resolve => {
    let previous = '', frames = 0;
    const tick = () => {
      const box = hub.getBoundingClientRect();
      const nav = hub.querySelector('.wx-topbar')?.getBoundingClientRect();
      const view = hub.querySelector('.wx-view:not([hidden])')?.getBoundingClientRect();
      const signature = [box.left, box.top, box.width, box.height, nav?.height, view?.top].map(value => Math.round((value ?? 0) * 100)).join(',');
      frames = signature === previous ? frames + 1 : 0;
      previous = signature;
      if (frames >= 5) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}
async function geometry(name) {
  await stableLayout();
  const result = await hub.evaluate(hub => {
    const box = hub.getBoundingClientRect();
    const view = hub.querySelector('.wx-view:not([hidden])');
    const round = number => Math.round(number * 100) / 100;
    const describe = node => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className && typeof node.className === 'string' ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
    const overflow = [], allowedScroll = [], controls = [];
    const hasLayout = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    for (const node of [hub, ...hub.querySelectorAll('section,article,main,aside,form,input,select,textarea,button,h1,h2,h3,p,table,[role="region"],.tr-card-river,.wx-module-tabs,.wx-topbar')]) {
      if (!(node instanceof HTMLElement) || !hasLayout(node) || node.closest('[aria-hidden="true"]')) continue;
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      const isScroll = ['auto', 'scroll'].includes(css.overflowX) && node.scrollWidth > node.clientWidth + 2;
      const allowed = node.closest('.wx-liuyao-table,.wx-module-tabs,.tr-card-river');
      const allowedDescendant = allowed && allowed !== node;
      if (isScroll && allowed) allowedScroll.push({ selector: describe(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth });
      if ((!allowedDescendant && (rect.left < box.left - 2 || rect.right > box.right + 2)) || (!allowed && node.scrollWidth > node.clientWidth + 2 && ['visible', 'hidden', 'clip'].includes(css.overflowX))) {
        overflow.push({ selector: describe(node), left: round(rect.left - box.left), right: round(rect.right - box.left), width: round(rect.width), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: css.overflowX });
      }
      if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) controls.push({ selector: describe(node), width: round(rect.width), height: round(rect.height) });
    }
    const nav = hub.querySelector('.wx-topbar'), navBox = nav?.getBoundingClientRect(), viewBox = view?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight }, hub: { width: round(box.width), height: round(box.height), scrollWidth: hub.scrollWidth, clientWidth: hub.clientWidth },
      view: hub.dataset.view, scheme: hub.dataset.scheme, bodyDarkTheme: document.body.hasAttribute('data-ds-dark-theme'),
      nav: nav && !nav.hidden ? { height: round(navBox.height), viewStart: round(viewBox.top - box.top), overlap: round(navBox.bottom - viewBox.top) } : null,
      overflow, allowedScroll, controls,
    };
  });
  report.geometry.push({ name, ...result });
  assert.equal(result.overflow.length, 0, `Horizontal overflow: ${result.overflow.slice(0, 5).map(item => item.selector).join(', ')}`);
  if (result.nav) assert.ok(result.nav.overlap <= 2, `Navigation overlaps module by ${result.nav.overlap}px`);
  return { panelWidth: result.hub.width, allowedScrollContainers: result.allowedScroll.length };
}
async function setScheme(scheme) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  try { await page.waitForFunction(scheme => document.querySelector('.wx-hub')?.getAttribute('data-scheme') === scheme, scheme, { timeout: 2000 }); return 'DSH system preference via prefers-color-scheme'; }
  catch {}
  // Persisted non-system preference in the isolated profile: use the real settings UI.
  await page.setViewportSize({ width: 1440, height: 900 });
  const settings = page.getByRole('button', { name: /^(设置|Settings|打开设置|Open settings)$/ });
  await settings.first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  const general = dialog.getByRole('button', { name: /^(通用设置|General)$/ });
  if (await general.count()) await general.first().click();
  await dialog.getByRole('button', { name: scheme === 'light' ? /^(浅色|Light)$/ : /^(深色|Dark)$/, exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(scheme => document.querySelector('.wx-hub')?.getAttribute('data-scheme') === scheme, scheme);
  return 'DSH appearance settings in disposable profile';
}

try {
  if (process.env.DSH_FRONTEND_EXPECT_PACKAGE_SHA256) await check('artifact: expected final package SHA256', () => {
    assert.equal(report.packageArchive?.sha256, process.env.DSH_FRONTEND_EXPECT_PACKAGE_SHA256);
    assert.equal(report.pluginArtifact?.previewPluginPath, resolve(root, '.local/frontend-package/readback/package'));
    return { packageSha256: report.packageArchive.sha256, previewPluginPath: report.pluginArtifact.previewPluginPath };
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  const entry = page.getByRole('button', { name: /问象.*占卜|Wenxiang.*Divination/ });
  await entry.first().waitFor({ state: 'visible', timeout: 30000 });
  const welcome = page.getByText('预览版说明', { exact: true });
  if (await welcome.isVisible()) {
    await page.getByRole('button', { name: /^(继续|Continue)$/, exact: true }).click();
    await welcome.waitFor({ state: 'hidden' });
    report.checks.push({ name: 'host: acknowledge first-run preview notice in isolated profile', status: 'PASS' });
  }
  await entry.first().click();
  await hub.waitFor({ state: 'visible' });
  await settled('portal');
  await check('portal: five real module gateways', async () => {
    assert.equal(await hub.locator('.wx-gateway').count(), 5);
    for (const module of modules) assert.equal(await hub.locator(`.wx-gateway-${module.id}`).count(), 1);
    return modules.map(module => module.id);
  });
  await capture('portal-initial');
  for (const module of modules) await check(`portal: enter ${module.id} and return`, async () => {
    await navigate(module.id, true);
    assert.equal(await active().locator(module.selector).count(), 1);
    assert.match(await active().locator('h1').innerText(), new RegExp(module.title));
    await navigate('portal');
  });

  await check('xiaoliu: local fixed-time result', async () => {
    await navigate('xiaoliu');
    await active().locator('#xiaoliu-question').fill('前端验收：如何稳妥推进本周的学习安排？');
    await active().locator('#xiaoliu-time').fill('2024-04-13T08:00');
    await active().locator('form button[type="submit"]').click();
    await active().locator('.wx-six-palaces article').nth(2).waitFor();
    const palaces = await active().locator('.wx-six-palaces article h3').allTextContents();
    assert.deepEqual(palaces.map(value => value.trim()), ['速喜', '大安', '小吉']);
    assert.match(await active().innerText(), /农历\s*3月5日.*辰时/);
    assert.match(await active().innerText(), /当地时间\s+2024-04-13 08:00:00\s*·\s*Asia\/Shanghai/);
    await capture('xiaoliu-local-result');
    return { wallTime: '2024-04-13T08:00', palaces, result: '小吉' };
  });

  for (const count of [3, 5]) await check(`lenormand: local ${count}-card select and reveal`, async () => {
    await navigate('lenormand');
    await active().locator('#lenormand-question').fill('前端验收：观察当前安排中可以调整的一步。');
    await active().locator('#lenormand-spread').selectOption(`line-${count}`);
    await active().locator('form button[type="submit"]').click();
    const deck = active().locator('.wx-small-deck');
    await deck.waitFor();
    assert.equal(await deck.locator('button').count(), 36);
    await capture(`lenormand-${count}-deck-wide`);
    await page.setViewportSize({ width: 390, height: 844 });
    await check(`geometry: lenormand ${count}-card selecting compact`, () => geometry(`lenormand-${count}-selecting-compact`));
    await capture(`lenormand-${count}-deck-compact`, true);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (let slot = 1; slot <= count; slot++) {
      const button = deck.getByRole('button', { name: `选择第 ${slot} 张背牌`, exact: true });
      await button.click();
      if (slot < count) await button.waitFor({ state: 'visible' });
      if (slot < count) await page.waitForFunction(slot => document.querySelector(`.wx-small-deck button[aria-label="选择第 ${slot} 张背牌"]`)?.disabled === true, slot);
    }
    await capture(`lenormand-${count}-ready-to-reveal`);
    await active().getByRole('button', { name: '揭示这组牌', exact: true }).click();
    await active().locator('.wx-small-cards article').nth(count - 1).waitFor();
    assert.equal(await active().locator('.wx-small-cards article').count(), count);
    await page.waitForFunction(count => {
      const images = [...document.querySelectorAll('.wx-view:not([hidden]) .wx-small-cards img')];
      return images.length === count && images.every(image => image.complete && image.naturalWidth > 0);
    }, count);
    const images = await active().locator('.wx-small-cards img').evaluateAll(images => images.map(image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })));
    assert.ok(images.every(image => image.complete && image.width > 0));
    assert.match(await active().innerText(), /相邻组合/);
    if (count === 5) {
      assert.match(await active().innerText(), /镜像对照/);
      assert.match(await active().innerText(), /位置\s+1\s*→\s*2/);
    }
    await capture(`lenormand-${count}-local-result`);
    await capture(`lenormand-${count}-local-result-bottom`, true);
    return { cards: count, imagesLoaded: images.length, selectedSlots: Array.from({ length: count }, (_, index) => index + 1), randomness: 'real local shuffled deck; identities vary between runs' };
  });

  await check('liuyao: record six physical-coin values and complete table', async () => {
    await navigate('liuyao');
    await active().locator('#liuyao-question').fill('前端验收：核对六次记录与装卦显示。');
    await active().locator('#liuyao-time').fill('2024-04-13T08:00');
    await active().locator('form button[type="submit"]').click();
    const values = [6, 7, 8, 9, 7, 8];
    for (const [index, value] of values.entries()) {
      const button = active().locator('.wx-coin-values').getByRole('button', { name: new RegExp(`^记录\\s*${value}`) });
      await button.click();
      if (index < 5) await active().getByRole('heading', { name: new RegExp(`第\\s*${index + 2}\\s*次`) }).waitFor();
      if (index === 2) {
        await capture('liuyao-recording-wide');
        await page.setViewportSize({ width: 390, height: 844 });
        await check('geometry: liuyao recording compact', () => geometry('liuyao-recording-compact'));
        await capture('liuyao-recording-compact', true);
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    }
    await active().locator('.wx-liuyao-table tbody tr').nth(5).waitFor();
    const rows = await active().locator('.wx-liuyao-table tbody tr').allTextContents();
    assert.equal(rows.length, 6);
    assert.ok(rows[0].trim().startsWith('6') && rows[5].trim().startsWith('1'), 'Table displays top line 6 through bottom line 1');
    assert.equal(rows.filter(row => /动/.test(row)).length, 2);
    assert.match(await active().innerText(), /当地时间\s+2024-04-13 08:00:00\s*·\s*Asia\/Shanghai/);
    await capture('liuyao-local-result');
    await capture('liuyao-local-result-bottom', true);
    return { valuesFromBottom: values, rows: rows.length, movingLines: [1, 4] };
  });

  for (const scheme of ['light', 'dark']) {
    await check(`theme: host ${scheme}`, async () => ({ mechanism: await setScheme(scheme) }));
    for (const viewport of [{ name: 'wide', width: 1440, height: 900 }, { name: 'narrow-panel', width: 600, height: 900 }, { name: 'compact', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await navigate('portal');
      await check(`geometry: portal ${scheme} ${viewport.name}`, () => geometry(`portal-${scheme}-${viewport.name}`));
      await capture(`portal-${scheme}-${viewport.name}`);
      if (viewport.name !== 'wide') await capture(`portal-${scheme}-${viewport.name}-bottom`, true);
      for (const module of modules) {
        await navigate(module.id);
        await check(`geometry: ${module.id} ${scheme} ${viewport.name}`, () => geometry(`${module.id}-${scheme}-${viewport.name}`));
        await capture(`${module.id}-${scheme}-${viewport.name}`);
        if (viewport.name !== 'wide' && ['lenormand', 'liuyao'].includes(module.id)) await capture(`${module.id}-${scheme}-${viewport.name}-bottom`, true);
      }
    }
  }
  await check('runtime: no browser page errors', () => assert.deepEqual(report.pageErrors, []));
  await check('runtime: no console errors', () => assert.deepEqual(report.consoleErrors, []));
  await check('runtime: no failed HTTP responses', () => assert.deepEqual(report.failedResponses, []));
  await check('runtime: no interpretation or follow-up requests', () => assert.deepEqual(report.prohibitedAiRequests, []));
} catch (error) {
  report.checks.push({ name: 'runtime: complete frontend lane', status: 'FAIL', error: redact(error.message ?? error).slice(0, 1800) });
  try { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); report.screenshots.push({ name: 'failure', file: relative(root, resolve(out, 'failure.png')) }); } catch {}
} finally {
  report.status = report.checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  const reportPath = resolve(out, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(root, 'artifacts/verification-frontend-20261007/latest.json'), JSON.stringify({ runId, status: report.status, report: relative(root, reportPath) }, null, 2) + '\n');
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ status: report.status, passed: report.checks.filter(check => check.status === 'PASS').length, failed: report.checks.filter(check => check.status === 'FAIL').length, screenshots: report.screenshots.length, report: reportPath }, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
