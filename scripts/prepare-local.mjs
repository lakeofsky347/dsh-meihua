// Read-only use of installed Desktop artifacts and reference development tools.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, symlinkSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
const reference = process.env.DSH_REFERENCE ?? '/Users/skylake/Work/Projects/dsh_clone';
const resources = process.env.DSH_RESOURCES ?? '/Applications/DeepSeek Harness.app/Contents/Resources';
const local = resolve(root, '.local/runtime');
const archive = readFileSync(resolve(resources, 'app.asar'));
const headerSize = archive.readUInt32LE(4);
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const dataStart = 8 + headerSize;
let extracted = 0;
function extract(tree, path = 'dsh') {
  for (const [name, item] of Object.entries(tree.files)) {
    const archivePath = `${path}/${name}`;
    const out = resolve(local, archivePath.slice(4));
    if (item.files) { mkdirSync(out, { recursive: true }); extract(item, archivePath); }
    else if (!existsSync(out)) {
      mkdirSync(dirname(out), { recursive: true });
      if (item.link) symlinkSync(relative(dirname(out), resolve(local, item.link.replace(/^dsh\//, ''))), out);
      else if (item.unpacked) copyFileSync(resolve(resources, 'app.asar.unpacked', archivePath), out);
      else writeFileSync(out, archive.subarray(dataStart + Number(item.offset), dataStart + Number(item.offset) + item.size), { mode: item.executable ? 0o755 : 0o644 });
      extracted++;
    }
  }
}
extract(header.files.dsh);
const requireRoot = createRequire(resolve(reference, 'package.json'));
const requireUI = createRequire(resolve(reference, 'packages/client/ui-plugin-manager/package.json'));
function link(name, target) {
  const dest = resolve(root, 'node_modules', name);
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest)) symlinkSync(target, dest, 'dir');
}
for (const name of ['tsdown', 'tsx', 'typescript', 'jsdom', '@types/node']) link(name, dirname(requireRoot.resolve(`${name}/package.json`)));
for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom']) link(name, dirname(requireUI.resolve(`${name}/package.json`)));
for (const name of Object.keys(JSON.parse(readFileSync(resolve(root, 'package.json'))).peerDependencies)) link(name, resolve(local, 'node_modules', name));
mkdirSync(resolve(root,'node_modules/.bin'),{recursive:true});
for (const [name,path] of [['tsc','typescript/bin/tsc'],['tsx','tsx/dist/cli.mjs']]) {
  const out=resolve(root,'node_modules/.bin',name);
  if (!existsSync(out)) symlinkSync(resolve(root,'node_modules',path),out);
}
console.log(`Local tools ready; extracted ${extracted} release files into .local/runtime. Reference and Desktop installation remain read-only.`);
