import { build } from 'tsdown';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import ts from 'typescript';
const id = 'dsh-meihua';
await build({ entry: { index: 'src/host/index.ts', core: 'src/core/index.ts' }, format: 'esm', platform: 'node', outDir: 'lib', clean: true, dts: false, sourcemap: false, outputOptions:{entryFileNames:'[name].js',chunkFileNames:'chunk-[hash].js'} });
await build({
  entry: { client: 'src/client/index.tsx' }, format: 'cjs', platform: 'browser', outDir: 'lib', clean: false, dts: false, sourcemap: false,
  deps:{neverBundle:['react','react/jsx-runtime']},
  plugins: [{name:'meihua-css-text',resolveId(source){if(source.endsWith('.css?inline'))return '\0meihua-css';},async load(id){if(id==='\0meihua-css')return `export default ${JSON.stringify(await readFile('src/client/styles.css','utf8'))};`;}}],
  outputOptions: {
    entryFileNames:'client.js',
    banner: `window.__ModuleLoader__.load({id: ${JSON.stringify(id)}, factory: (require) => {`,
    intro: 'var module = {exports: {}}; var exports = module.exports;',
    footer: 'return module.exports; }});'
  }
});
const css = await readFile('src/client/styles.css', 'utf8');
await writeFile('lib/styles.css', css);
const files = ['src/core/types.ts','src/core/hexagrams.ts','src/core/calendar.ts','src/core/rules.ts','src/core/index.ts'];
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true, rewriteRelativeImportExtensions: true, rootDir: 'src', outDir: 'lib/types', types: ['node'] });
const emitted = program.emit();
const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter(d => d.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
await mkdir('artifacts', {recursive: true});
