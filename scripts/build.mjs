import { build } from 'tsdown';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import ts from 'typescript';
import './build-tarot-assets.mjs';
const id = 'dsh-meihua';
const css = (await readFile('src/client/styles.css','utf8'))+'\n'+(await readFile('src/client/tarot.css','utf8'))+'\n'+(await readFile('src/client/memory.css','utf8'))+'\n'+(await readFile('src/client/method.css','utf8'));
await build({ entry: { index: 'src/host/index.ts', core: 'src/core/index.ts',tarot:'src/tarot/index.ts',xiaoliu:'src/xiaoliu/index.ts',lenormand:'src/lenormand/index.ts',liuyao:'src/liuyao/index.ts' }, format: 'esm', platform: 'node', outDir: 'lib', clean: true, dts: false, sourcemap: false, outputOptions:{entryFileNames:'[name].js',chunkFileNames:'chunk-[hash].js'} });
await build({
  entry: { client: 'src/client/index.tsx' }, format: 'cjs', platform: 'browser', outDir: 'lib', clean: false, dts: false, sourcemap: false,
  deps:{neverBundle:['react','react/jsx-runtime']},
  plugins: [{name:'divination-css-text',resolveId(source){if(source.endsWith('.css?inline'))return '\0divination-css';},load(id){if(id==='\0divination-css')return `export default ${JSON.stringify(css)};`;}}],
  outputOptions: {
    entryFileNames:'client.js',
    banner: `window.__ModuleLoader__.load({id: ${JSON.stringify(id)}, factory: (require) => {`,
    intro: 'var module = {exports: {}}; var exports = module.exports;',
    footer: 'return module.exports; }});'
  }
});
await writeFile('lib/styles.css', css);
await copyFile('src/assets/tarot/assets-sources.json','lib/tarot-assets-sources.json');
await copyFile('src/assets/tarot/README.md','lib/tarot-assets.md');
await mkdir('lib/THIRD_PARTY_LICENSES',{recursive:true});
await copyFile('src/liuyao/vendor/LICENSE','lib/THIRD_PARTY_LICENSES/lunar-javascript-LICENSE');
await copyFile('src/liuyao/vendor/provenance.json','lib/lunar-javascript-provenance.json');
await copyFile('src/assets/lenormand/manifest.json','lib/lenormand-assets-sources.json');
await copyFile('src/assets/lenormand/LICENSE','lib/THIRD_PARTY_LICENSES/lenormand-LICENSE');
const files = ['src/core/index.ts','src/tarot/index.ts','src/xiaoliu/index.ts','src/lenormand/index.ts','src/liuyao/index.ts'];
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true, rewriteRelativeImportExtensions: true, rootDir: 'src', outDir: 'lib/types', types: ['node'] });
const emitted = program.emit();
const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter(d => d.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
await mkdir('artifacts', {recursive: true});
