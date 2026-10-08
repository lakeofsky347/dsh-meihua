// Check an extracted release on the target machine, without a provider or user data.
import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  assert.ok(['--plugin', '--runtime', '--output'].includes(args[index]) && args[index + 1], 'Use --plugin <directory> [--runtime <directory>] [--output <json>]');
  options[args[index].slice(2)] = args[index + 1];
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(options.plugin ?? root);
const manifest = JSON.parse(await readFile(resolve(plugin, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'dsh-meihua');
const checks = [];
async function check(name, action) {
  try { checks.push({ name, status: 'PASS', result: await action() }); }
  catch (error) { checks.push({ name, status: 'FAIL', error: error.message }); }
}
const report = { checkedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  node: process.version, icu: process.versions.icu, plugin: { path: plugin, version: manifest.version },
  evidence: 'Target-machine release imports and synthetic deterministic checks; no model call or desktop UI claim', checks };
const load = entry => import(pathToFileURL(resolve(plugin, manifest.exports[entry].default)).href);
await check('Node runtime', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major >= 24 || major === 22 && minor >= 18, 'Use Node 22.18+ or 24+');
  return process.version;
});
await check('Chinese calendar and leap month', async () => {
  const core = await load('./core');
  const normal = core.lunarMoment({ capturedAt: '2024-04-13T00:00:00Z', timeZone: 'Asia/Shanghai', details: {} });
  const leap = core.lunarMoment({ capturedAt: '2023-03-22T04:00:00Z', timeZone: 'Asia/Shanghai', details: {} });
  assert.deepEqual([normal.month, normal.day, normal.hourBranch], [3, 5, '辰']);
  assert.deepEqual([leap.month, leap.day, leap.leapMonth], [2, 1, true]);
  return { normal: [3, 5, '辰'], leap: [2, 1, true], timeZone: 'Asia/Shanghai' };
});
await check('Meihua release entry', async () => {
  const core = await load('./core');
  const result = new core.RuleRegistry().calculate({ ruleId: 'three-numbers', question: '环境验收合成样例', values: { a: 2, b: 3, c: 2 },
    environment: { capturedAt: '2024-04-13T00:00:00Z', timeZone: 'Asia/Shanghai', details: {} } });
  assert.deepEqual([result.primary.title, result.movingLine], ['泽火革', 1]);
  return { primary: result.primary.title, movingLine: result.movingLine };
});
await check('Tarot release entry', async () => {
  const tarot = await load('./tarot');
  assert.equal(tarot.TAROT_CARDS.length, 78);
  assert.equal(new Set(tarot.shuffleTarotDeck(false, maximum => maximum - 1).map(card => card.card.id)).size, 78);
  return { cards: 78, spreads: tarot.TAROT_SPREADS.length };
});
await check('Xiaoliu release entry', async () => {
  const module = await load('./xiaoliu');
  const result = module.calculateXiaoliu({ question: '环境验收合成样例', environment: { capturedAt: '2024-04-13T00:00:00Z', timeZone: 'Asia/Shanghai', details: {} } });
  const names = [result.monthPalace.name, result.dayPalace.name, result.hourPalace.name];
  assert.deepEqual(names, ['速喜', '大安', '小吉']);
  return names;
});
await check('Lenormand release entry', async () => {
  const module = await load('./lenormand');
  assert.equal(module.LENORMAND_CARDS.length, 36);
  const result = module.calculateLenormand({ question: '环境验收合成样例', spreadId: 'line-3', cardIds: [24, 27, 33], createdAt: '2024-04-13T00:00:00Z' });
  assert.equal(result.center.card.name, '信');
  return { cards: 36, center: result.center.card.name };
});
await check('Liuyao release entry', async () => {
  const module = await load('./liuyao');
  const result = module.calculateLiuyao({ question: '环境验收合成样例', values: [7, 8, 8, 6, 9, 8],
    environment: { capturedAt: '2024-08-08T04:00:00Z', timeZone: 'Asia/Shanghai', details: {} } });
  assert.deepEqual([result.primary.number, result.changed.number], [3, 51]);
  assert.deepEqual(result.movingLines, [4, 5]);
  return { primary: 3, changed: 51, movingLines: [4, 5] };
});
await check('Private-storage cryptography', () => {
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync('synthetic-only-passphrase', salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update('环境适配合成验收', 'utf8'), cipher.final()]);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(cipher.getAuthTag());
  assert.equal(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'), '环境适配合成验收');
  key.fill(0);
  return { algorithm: 'aes-256-gcm', kdf: 'scrypt', roundTrip: true };
});
if (options.runtime) await check('Installed DSH peer versions', () => {
  const require = createRequire(resolve(options.runtime, 'package.json'));
  const requirePlugin = createRequire(resolve(plugin, 'package.json'));
  const packages = Object.fromEntries(Object.keys(manifest.peerDependencies).map(name => [name, require(`${name}/package.json`).version]));
  for (const [name, expected] of Object.entries(manifest.peerDependencies)) {
    if (name !== '@deepseek-ai/cordis') assert.equal(packages[name], expected, `${name} must match the supported DSH release`);
    else assert.match(packages[name], /^4\./);
    assert.equal(realpathSync(requirePlugin.resolve(`${name}/package.json`)), realpathSync(require.resolve(`${name}/package.json`)), `${name} must resolve from the same runtime used by the extracted plugin`);
  }
  return packages;
});
if (options.runtime) await check('Actual host dependency imports', async () => {
  const host = await import(pathToFileURL(resolve(plugin, manifest.main)).href);
  assert.equal(typeof host.apply, 'function');
  return { entry: manifest.main, apply: true };
});
report.plugin.bundles = await Promise.all(['lib/index.js', 'lib/client.js'].map(async path => {
  const bytes = await readFile(resolve(plugin, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
report.status = checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL';
if (options.output) { const output = resolve(options.output); await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
