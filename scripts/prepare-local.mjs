// Reuse released DSH artifacts and installed development tools without changing them.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, symlinkSync, lstatSync, readlinkSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolveProjectRoot, resolveReference, resolveRuntimeSource, linkDirectory } from './environment.mjs';

const root = resolveProjectRoot(import.meta.url), local = resolve(root, '.local/runtime');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const source = resolveRuntimeSource({ root });
const hash = value => createHash('sha256').update(value).digest('hex');
const markerPath = resolve(root, '.local/runtime-source.json');
const stale = () => new Error('The cached .local/runtime differs from the selected DSH release. Move .local/runtime and .local/runtime-source.json aside inside this checkout, then run prepare:local again. The installed DSH runtime will not be overwritten.');
const present = value => { try { return lstatSync(value); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
const compatible = (expected, actual) => expected === actual || (expected.startsWith('^') && /^\d+\.\d+\.\d+$/.test(actual) && (() => {
  const wanted = expected.slice(1).split('.').map(Number), found = actual.split('.').map(Number);
  return found[0] === wanted[0] && (found[1] > wanted[1] || found[1] === wanted[1] && found[2] >= wanted[2]);
})());

// Resolve all tools before writing the cache. Normal local npm installs also work.
const loaders = [createRequire(resolve(root, 'package.json'))];
if (process.env.DSH_REFERENCE?.trim() || existsSync(resolve(root, '../dsh_clone/package.json'))) {
  const reference = resolveReference({ root });
  loaders.push(createRequire(resolve(reference, 'package.json')));
  const uiManifest = resolve(reference, 'packages/client/ui-plugin-manager/package.json');
  if (existsSync(uiManifest)) loaders.push(createRequire(uiManifest));
}
const tools = Object.entries(manifest.devDependencies).map(([name, expected]) => {
  for (const loader of loaders) {
    let entry; try { entry = loader.resolve(`${name}/package.json`); } catch { continue; }
    const installed = JSON.parse(readFileSync(entry, 'utf8'));
    if (installed.version === expected) return [name, dirname(entry)];
  }
  throw new Error(`Development tool ${name}@${expected} was not found. Install the declared development dependencies or set DSH_REFERENCE to a prepared checkout.`);
});

let entries = [], bytesFor, runtimeManifest, releaseMetadata, fingerprint;
if (source.kind === 'asar') {
  const archive = readFileSync(source.archive), headerSize = archive.readUInt32LE(4);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString()), dataStart = 8 + headerSize;
  if (!header.files?.dsh?.files) throw new Error('The selected app.asar has no complete dsh runtime. Use DSH_RUNTIME for a released directory layout.');
  const walk = (tree, prefix = 'dsh') => {
    for (const [name, item] of Object.entries(tree.files)) {
      if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('The release archive contains an unsafe path.');
      const archivePath = `${prefix}/${name}`;
      if (item.files) walk(item, archivePath); else entries.push({ archivePath, item, output: resolve(local, archivePath.slice(4)) });
    }
  };
  walk(header.files.dsh);
  bytesFor = ({ archivePath, item }) => item.unpacked ? readFileSync(resolve(source.resources, 'app.asar.unpacked', archivePath)) : archive.subarray(dataStart + Number(item.offset), dataStart + Number(item.offset) + item.size);
  const json = name => { const entry = entries.find(item => item.archivePath === `dsh/${name}`); return entry ? JSON.parse(bytesFor(entry).toString('utf8')) : undefined; };
  runtimeManifest = json('package.json'); releaseMetadata = json('desktop-runtime.json');
  fingerprint = hash(archive);
} else {
  runtimeManifest = JSON.parse(readFileSync(resolve(source.root, 'package.json'), 'utf8'));
  const releaseFile = resolve(source.root, 'desktop-runtime.json');
  releaseMetadata = existsSync(releaseFile) ? JSON.parse(readFileSync(releaseFile, 'utf8')) : undefined;
  fingerprint = hash(JSON.stringify({ source: realpathSync(source.root), manifest: runtimeManifest, release: releaseMetadata }));
}
if (!runtimeManifest?.version) throw new Error('The selected runtime has no release version.');
if (releaseMetadata?.platform && releaseMetadata.platform !== process.platform || releaseMetadata?.arch && releaseMetadata.arch !== process.arch) throw new Error(`The selected runtime is for ${releaseMetadata.platform}/${releaseMetadata.arch}; this Node process is ${process.platform}/${process.arch}. Select a runtime from this machine.`);
const descriptor = { schemaVersion: 1, kind: source.kind, fingerprint, name: runtimeManifest.name, version: runtimeManifest.version, platform: process.platform, arch: process.arch };
if (existsSync(markerPath)) {
  const previous = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (previous.fingerprint !== fingerprint || previous.kind !== source.kind || previous.platform !== process.platform || previous.arch !== process.arch) throw stale();
}

// Check the declared host faces before extracting or linking any release files.
for (const [name, expected] of Object.entries(manifest.peerDependencies)) {
  let peer;
  if (source.kind === 'directory') {
    const file = resolve(source.root, 'node_modules', name, 'package.json');
    if (existsSync(file)) peer = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    const entry = entries.find(item => item.archivePath === `dsh/node_modules/${name}/package.json`);
    if (entry) peer = JSON.parse(bytesFor(entry).toString('utf8'));
  }
  if (!peer || !compatible(expected, peer.version)) throw new Error(`The selected runtime does not provide ${name}@${expected}. Confirm the DSH host version before preparing this plugin.`);
}

let extracted = 0;
if (source.kind === 'directory') {
  if (present(local)) {
    if (realpathSync(local) !== realpathSync(source.root)) throw stale();
  } else { mkdirSync(dirname(local), { recursive: true }); linkDirectory(source.root, local); }
} else {
  if (present(local)?.isSymbolicLink()) throw stale();
  const linkTarget = entry => {
    const target = resolve(local, entry.item.link.replace(/^dsh\//, ''));
    if (target !== local && !target.startsWith(local + sep)) throw new Error('The release archive contains a link outside its runtime.');
    return target;
  };
  // A cache from the old script has no fingerprint. Compare every existing byte
  // before adopting it, so same-version builds cannot silently be mixed.
  for (const entry of entries) {
    const info = present(entry.output); if (!info) continue;
    if (entry.item.link) {
      if (!info.isSymbolicLink() || resolve(dirname(entry.output), readlinkSync(entry.output)) !== linkTarget(entry)) throw stale();
    } else if (!info.isFile() || !readFileSync(entry.output).equals(bytesFor(entry))) throw stale();
  }
  for (const entry of entries) {
    if (present(entry.output)) continue;
    mkdirSync(dirname(entry.output), { recursive: true });
    if (entry.item.link) linkDirectory(linkTarget(entry), entry.output);
    else if (entry.item.unpacked) copyFileSync(resolve(source.resources, 'app.asar.unpacked', entry.archivePath), entry.output);
    else writeFileSync(entry.output, bytesFor(entry), { mode: entry.item.executable ? 0o755 : 0o644 });
    extracted++;
  }
}
mkdirSync(dirname(markerPath), { recursive: true });
writeFileSync(markerPath, JSON.stringify(descriptor, null, 2) + '\n');

function link(name, target) {
  const destination = resolve(root, 'node_modules', name), info = present(destination);
  mkdirSync(dirname(destination), { recursive: true });
  if (info?.isSymbolicLink()) {
    if (existsSync(destination) && realpathSync(destination) === realpathSync(target)) return;
    unlinkSync(destination);
  } else if (info) {
    const file = resolve(destination, 'package.json'), installed = existsSync(file) && JSON.parse(readFileSync(file, 'utf8'));
    if (installed && compatible(manifest.devDependencies[name] ?? manifest.peerDependencies[name], installed.version)) return;
    throw new Error(`Existing node_modules/${name} is not a matching dependency. Move that directory aside before preparing tools.`);
  }
  linkDirectory(target, destination);
}
for (const [name, target] of tools) link(name, target);
for (const name of Object.keys(manifest.peerDependencies)) link(name, resolve(local, 'node_modules', name));
mkdirSync(resolve(root, 'node_modules/.bin'), { recursive: true });
for (const [name, entry] of [['tsc', 'typescript/bin/tsc'], ['tsx', 'tsx/dist/cli.mjs']]) {
  const out = resolve(root, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  if (!present(out)) {
    if (process.platform === 'win32') writeFileSync(out, `@echo off\r\nnode "%~dp0..\\${entry.replaceAll('/', '\\')}" %*\r\n`);
    else symlinkSync(resolve(root, 'node_modules', entry), out);
  }
}
console.log(`Local tools ready for DSH ${runtimeManifest.version}; ${source.kind === 'asar' ? `extracted ${extracted} release files` : 'linked the released runtime read-only'}. Runtime fingerprint checked; installed DSH and reference tools remain unchanged.`);
