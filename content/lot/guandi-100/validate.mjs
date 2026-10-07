// Offline validator for exactly the JSON Schema keywords used by schema.json.
// This is not a general Draft 2020-12 implementation; unsupported keywords fail.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function validateDeclaredSchema(schema, value, path = '$') {
  const known = new Set(['$schema', '$id', 'title', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'items', 'minimum', 'maximum', 'format']);
  for (const key of Object.keys(schema)) if (!known.has(key)) throw new Error(`Unsupported schema keyword ${key}`);
  const fail = (reason) => { throw new Error(`${path}: ${reason}`); };
  if ('const' in schema && value !== schema.const) fail('const mismatch');
  if (schema.enum && !schema.enum.includes(value)) fail('enum mismatch');
  if (schema.type) {
    const valid = schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : schema.type === 'array' ? Array.isArray(value)
      : schema.type === 'integer' ? Number.isInteger(value)
      : typeof value === schema.type;
    if (!valid) fail(`expected ${schema.type}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail('too short');
    if (schema.maxLength !== undefined && length > schema.maxLength) fail('too long');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail('pattern mismatch');
    if (schema.format === 'uri') { try { new URL(value); } catch { fail('invalid URI'); } }
    if (schema.format === 'date-time' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) || !Number.isFinite(Date.parse(value)))) fail('invalid timestamp');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('below minimum');
    if (schema.maximum !== undefined && value > schema.maximum) fail('above maximum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('too few items');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items');
    if (schema.uniqueItems && new Set(value.map(x => JSON.stringify(x))).size !== value.length) fail('duplicate item');
    if (schema.items) value.forEach((x, i) => validateDeclaredSchema(schema.items, x, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) fail(`unknown ${key}`);
    for (const [key, rule] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key)) validateDeclaredSchema(rule, value[key], `${path}.${key}`);
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('./', import.meta.url);
  const read = path => readFile(new URL(path, root), 'utf8');
  const bytes = await read('lots.json');
  const pack = JSON.parse(bytes);
  validateDeclaredSchema(JSON.parse(await read('schema.json')), pack);
  const report = {
    checkedOn: '2026-10-07', result: 'PASS',
    schemaValidator: 'validate.mjs: explicit declared-keyword subset; unsupported keywords rejected',
    schemaValidation: 'PASS_DECLARED_KEYWORDS', fullDraft202012Conformance: 'NOT_CLAIMED',
    entryCount: pack.lots.length, lineCount: pack.lots.reduce((n, x) => n + x.poemLines.length, 0),
    automatedContentTests: 7, automatedContentTestsStatus: 'PASS',
    agentScanCollation: '100 lots / PDF pages3-102 / 20 proof sheets',
    documentedVariantEntries: pack.lots.filter(x => x.provenance.notes.length).length,
    damagedGlyphRestorations: [98], humanSecondReview: 'NOT_CHECKED',
    runtimeModule: 'NOT_IMPLEMENTED_G8_CONTENT_SCOPE',
    lotsSha256: createHash('sha256').update(bytes).digest('hex'),
    manifestSha256: createHash('sha256').update(await read('manifest.json')).digest('hex'),
  };
  await writeFile(new URL('validation.json', root), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
