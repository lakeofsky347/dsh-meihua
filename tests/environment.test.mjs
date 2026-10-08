import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, symlinkSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveReference, resolveDshResources, resolveRuntimeSource, resolveDshCli, cliInvocation, resolvePreviewHome, assertPreviewPath } from '../scripts/environment.mjs';

const fake = (platform, env, files, root = platform === 'win32' ? 'C:\\work\\plugin' : '/work/plugin') => ({ platform, env, root, home: platform === 'win32' ? 'C:\\Users\\tester' : '/home/tester', exists: filename => files.includes(filename) });

test('参考工具默认使用相邻 checkout，显式不存在的目录不降级', () => {
  assert.equal(resolveReference(fake('linux', {}, ['/work/dsh_clone/package.json'])), '/work/dsh_clone');
  assert.throws(() => resolveReference(fake('linux', { DSH_REFERENCE: '/missing' }, ['/work/dsh_clone/package.json'])), /DSH_REFERENCE/);
});
test('macOS 保留系统应用资源探测，也支持用户 Applications', () => {
  assert.equal(resolveDshResources(fake('darwin', {}, ['/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'])), '/Applications/DeepSeek Harness.app/Contents/Resources');
  assert.equal(resolveDshResources(fake('darwin', {}, ['/home/tester/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'])), '/home/tester/Applications/DeepSeek Harness.app/Contents/Resources');
});
test('Windows 从安装目录探测 resources，环境变量优先且路径保留空格', () => {
  const options = fake('win32', { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }, ['C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar']);
  assert.equal(resolveDshResources(options), 'C:\\Users\\tester\\AppData\\Local\\Programs\\DeepSeek Harness\\resources');
  const explicit = fake('win32', { DSH_RESOURCES: 'D:\\Harness resources' }, ['D:\\Harness resources\\app.asar']);
  assert.equal(resolveDshResources(explicit), 'D:\\Harness resources');
  assert.throws(() => resolveDshResources(fake('linux', { DSH_RESOURCES: '/missing' }, ['/opt/deepseek-harness/resources/app.asar'])), /DSH_RESOURCES/);
});
test('Linux 可使用完整发布 runtime，拒绝缺少依赖的不完整目录', () => {
  assert.deepEqual(resolveRuntimeSource(fake('linux', { DSH_RUNTIME: '/opt/dsh-release' }, ['/opt/dsh-release/package.json', '/opt/dsh-release/node_modules'])), { kind: 'directory', root: '/opt/dsh-release' });
  assert.throws(() => resolveRuntimeSource(fake('linux', { DSH_RUNTIME: '/opt/dsh-release' }, ['/opt/dsh-release/package.json'])), /complete released runtime/);
  assert.throws(() => resolveRuntimeSource(fake('linux', {}, [])), /DSH_RUNTIME/);
});
test('CLI 显式覆盖、PATH 与发行目录的选择不会依赖开发者路径', () => {
  assert.equal(resolveDshCli(fake('linux', { DSH_CLI: '/opt/official/dsh' }, ['/opt/official/dsh'])), '/opt/official/dsh');
  assert.equal(resolveDshCli(fake('linux', { PATH: '/custom/bin:/usr/bin' }, ['/custom/bin/dsh'])), '/custom/bin/dsh');
  assert.equal(resolveDshCli(fake('win32', { DSH_RUNTIME: 'D:\\dsh-runtime' }, ['D:\\dsh-runtime\\cli\\bin\\dsh.cmd'])), 'D:\\dsh-runtime\\cli\\bin\\dsh.cmd');
  assert.throws(() => resolveDshCli(fake('linux', { DSH_CLI: '/missing', PATH: '/usr/bin' }, ['/usr/bin/dsh'])), /DSH_CLI/);
});
test('Windows .cmd 启动保留空格与 &，禁用延迟展开并拒绝变量展开字符', () => {
  const invocation = cliInvocation('C:\\Harness & tools\\dsh.cmd', ['--patch', 'C:\\test home\\offline.patch.yml'], { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } });
  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/v:off', '/s', '/c']);
  assert.equal(invocation.args[4], '""C:\\Harness & tools\\dsh.cmd" "--patch" "C:\\test home\\offline.patch.yml""');
  assert.equal(invocation.options.windowsVerbatimArguments, true);
  assert.throws(() => cliInvocation('C:\\dsh.cmd', ['%PATH%'], { platform: 'win32', env: {} }), /percent/);
  assert.throws(() => cliInvocation('C:\\dsh.cmd', ['a"b'], { platform: 'win32', env: {} }), /quotes/);
});
test('可执行文件直接启动，JavaScript CLI 使用当前 Node', () => {
  assert.deepEqual(cliInvocation('/usr/bin/dsh', ['--help'], { platform: 'linux' }), { command: '/usr/bin/dsh', args: ['--help'], options: {} });
  assert.deepEqual(cliInvocation('/opt/dsh/cli.mjs', ['--help'], { platform: 'linux', node: '/usr/bin/node' }), { command: '/usr/bin/node', args: ['/opt/dsh/cli.mjs', '--help'], options: {} });
});

test('预览只接受 checkout 内的独立 .local 子目录，拒绝日常 home 和穿越', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wenxiang-environment-'));
  try {
    const selected = path.join(root, '.local/test-home');
    assert.equal(resolvePreviewHome(root, {}, path.join(root, 'user')), selected);
    assert.throws(() => resolvePreviewHome(root, { DSH_PREVIEW_HOME: '../daily' }, path.join(root, 'user')), /dedicated directory/);
    assert.throws(() => resolvePreviewHome(root, { DSH_PREVIEW_HOME: '.local' }, path.join(root, 'user')), /dedicated directory/);
    assert.throws(() => resolvePreviewHome(root, { DSH_HOME: selected }, path.join(root, 'user')), /daily DSH home/);
    assert.throws(() => resolvePreviewHome(root, { DSH_PREVIEW_HOME: '.local/daily/profiles/test', DSH_HOME: path.join(root, '.local/daily') }, path.join(root, 'user')), /daily DSH home/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('预览目录与 profile 中的 symlink 都不能逃到日常目录', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wenxiang-environment-'));
  try {
    mkdirSync(path.join(root, '.local/test-home'), { recursive: true });
    mkdirSync(path.join(root, 'daily'));
    symlinkSync(path.join(root, 'daily'), path.join(root, '.local/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolvePreviewHome(root, { DSH_PREVIEW_HOME: '.local/escape' }, path.join(root, 'user')), /dedicated directory/);
    symlinkSync(path.join(root, 'daily'), path.join(root, '.local/test-home/profiles'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertPreviewPath(path.join(root, '.local/test-home'), path.join(root, '.local/test-home/profiles/meihua-v1')), /symlink outside/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prepare 可链接完整 runtime、重复核对指纹，版本变化明确阻止旧缓存复用', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'wenxiang-prepare-'));
  const root = path.join(fixture, 'plugin'), source = path.join(fixture, 'released-runtime');
  try {
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules/fixture-tool'), { recursive: true });
    mkdirSync(path.join(source, 'node_modules/fixture-host'), { recursive: true });
    const manifest = { name: 'fixture-plugin', type: 'module', devDependencies: { 'fixture-tool': '1.0.0' }, peerDependencies: { 'fixture-host': '0.2.0-rc.2' } };
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    writeFileSync(path.join(root, 'node_modules/fixture-tool/package.json'), '{"name":"fixture-tool","version":"1.0.0"}');
    writeFileSync(path.join(source, 'node_modules/fixture-host/package.json'), '{"name":"fixture-host","version":"0.2.0-rc.2"}');
    writeFileSync(path.join(source, 'package.json'), '{"name":"fixture-runtime","version":"0.2.0-rc.2"}');
    for (const name of ['prepare-local.mjs', 'environment.mjs']) copyFileSync(new URL(`../scripts/${name}`, import.meta.url), path.join(root, 'scripts', name));
    const execute = () => spawnSync(process.execPath, [path.join(root, 'scripts/prepare-local.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, DSH_REFERENCE: '', DSH_RESOURCES: '', DSH_RUNTIME: source } });
    const initial = execute(); assert.equal(initial.status, 0, initial.stderr);
    assert.equal(realpathSync(path.join(root, '.local/runtime')), realpathSync(source));
    const marker = readFileSync(path.join(root, '.local/runtime-source.json'), 'utf8');
    assert.equal(execute().status, 0);
    assert.equal(readFileSync(path.join(root, '.local/runtime-source.json'), 'utf8'), marker);
    writeFileSync(path.join(source, 'package.json'), '{"name":"fixture-runtime","version":"0.3.0"}');
    const changed = execute(); assert.notEqual(changed.status, 0); assert.match(changed.stderr, /cached .local\/runtime differs/);
    assert.equal(readFileSync(path.join(root, '.local/runtime-source.json'), 'utf8'), marker);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('preview 使用选择的 CLI 与包、保留 meihua-v1，并只写入隔离 home', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'wenxiang-preview-'));
  const root = path.join(fixture, 'plugin'), daily = path.join(fixture, 'daily');
  try {
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    mkdirSync(path.join(root, 'package/lib'), { recursive: true });
    mkdirSync(daily);
    writeFileSync(path.join(root, 'package/lib/index.js'), 'export function apply() {}');
    for (const name of ['preview.mjs', 'environment.mjs']) copyFileSync(new URL(`../scripts/${name}`, import.meta.url), path.join(root, 'scripts', name));
    const cli = path.join(fixture, 'mock-dsh.mjs'), record = path.join(fixture, 'launcher-record.json');
    writeFileSync(cli, `import fs from 'node:fs';import path from 'node:path';
const home=process.env.DSH_HOME,args=process.argv.slice(2),profile=path.join(home,'profiles/meihua-v1');
if(args.includes('--help')){fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'cordis.yml'),'# fixture');fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({dependencies:{},dsh:{profile:{}}}));}
else fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({home,args}));
`);
    const launched = spawnSync(process.execPath, [path.join(root, 'scripts/preview.mjs')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, DSH_HOME: daily, DSH_CLI: cli, DSH_PREVIEW_HOME: '.local/smoke', DSH_PREVIEW_PLUGIN: path.join(root, 'package'), DSH_PREVIEW_PORT: '19499' },
    });
    assert.equal(launched.status, 0, launched.stderr);
    const saved = JSON.parse(readFileSync(record, 'utf8'));
    assert.equal(realpathSync(saved.home), realpathSync(path.join(root, '.local/smoke')));
    assert.deepEqual(saved.args.slice(0, 2), ['--profile', 'meihua-v1']);
    assert.deepEqual(saved.args.slice(-5), ['--no-open', '--host', '127.0.0.1', '--port', '19499']);
    const installed = path.join(saved.home, 'profiles/meihua-v1/node_modules/dsh-meihua');
    assert.equal(realpathSync(installed), realpathSync(path.join(root, 'package')));
    const profile = JSON.parse(readFileSync(path.join(saved.home, 'profiles/meihua-v1/package.json'), 'utf8'));
    assert.equal(profile.dependencies['dsh-meihua'], `link:${path.join(root, 'package')}`);
    assert.match(readFileSync(path.join(root, '.local/offline.patch.yml'), 'utf8'), /provider: meihua-offline/);
    assert.deepEqual(readdirSync(daily), []);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
