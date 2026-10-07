import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateDeclaredSchema } from '../content/lot/guandi-100/validate.mjs';

const root = new URL('../content/lot/guandi-100/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const pack = JSON.parse(read('lots.json'));
const manifest = JSON.parse(read('manifest.json'));
const collation = JSON.parse(read('collation.json'));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('固定签库完整覆盖1—100：编号、ID、四句七言与原创释义均完整', () => {
  assert.equal(pack.libraryId, 'guandi-qing-collated-100');
  assert.equal(pack.lots.length, 100);
  assert.deepEqual(pack.lots.map((x: any) => x.number), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(new Set(pack.lots.map((x: any) => x.id)).size, 100);
  assert.equal(new Set(pack.lots.map((x: any) => x.poemLines.join(''))).size, 100);
  assert.equal(new Set(pack.lots.map((x: any) => x.originalInterpretation)).size, 100);
  for (const lot of pack.lots) {
    assert.equal(lot.id, `guandi-qing-${String(lot.number).padStart(3, '0')}`);
    assert.equal(lot.poemLines.length, 4);
    for (const line of lot.poemLines) assert.match(line, /^\p{Script=Han}{7}$/u);
    assert.ok(lot.originalInterpretation.length >= 20);
    assert.equal(new Set(lot.keywords).size, 3);
  }
});

test('每首映射原PDF页和固定修订，转录哈希可以从快照独立回读', () => {
  const pages = [...JSON.parse(read('sources/wikisource-1-50.json')).query.pages,
    ...JSON.parse(read('sources/wikisource-51-100.json')).query.pages];
  assert.equal(pages.length, 100);
  for (const lot of pack.lots) {
    const p = pages.find((x: any) => x.title === `關聖帝君靈籤/${lot.number}`);
    assert.ok(p, `source ${lot.number}`);
    const rev = p.revisions[0];
    assert.equal(lot.provenance.revisionId, rev.revid);
    assert.equal(lot.provenance.wikitextSha256, sha(rev.slots.main.content));
    assert.equal(lot.provenance.pdfPage, lot.number + 2);
    assert.equal(new URL(lot.provenance.transcriptionUrl).searchParams.get('oldid'), String(rev.revid));
    assert.ok(existsSync(new URL(lot.provenance.reviewSheet, root)));
  }
});

test('校勘覆盖全部100首：扫描异文、等级调整和破损补字明确留痕', () => {
  assert.deepEqual(collation.scanPagesRead, Array.from({ length: 100 }, (_, i) => i + 3));
  assert.equal(collation.entries.length, 100);
  assert.equal(collation.humanSecondReview, 'NOT_CHECKED');
  const at = (n: number) => pack.lots[n - 1];
  for (const n of [4, 6, 10, 80, 84]) assert.equal(at(n).traditionalGrade, '下下');
  assert.equal(at(50).traditionalGrade, '上吉');
  assert.equal(at(83).traditionalGrade, '中平');
  assert.equal(at(38).poemLines[2], '等待榮華貴公子');
  assert.equal(at(48).poemLines[2], '不遇虎頭人一喚');
  assert.equal(at(74).poemLines[3], '長江一道放春回');
  assert.equal(at(98).provenance.status, 'damaged_glyphs_restored');
  for (const n of [31, 84, 99]) assert.ok(at(n).provenance.notes.some((x: any) => x.scanReading !== x.chosenReading));
  for (const entry of collation.entries) assert.deepEqual(entry.changes, at(entry.number).provenance.notes);
});

test('第98签补字引用同库固定转录，道藏旁证的經商异文没有静默混入', () => {
  const ps = JSON.parse(read('sources/edition-and-98-corroboration.json')).query.pages;
  const other = ps.find((x: any) => x.title === '護國嘉濟江東王靈籤/98');
  assert.equal(other.revisions[0].revid, 1334869);
  assert.ok(other.revisions[0].slots.main.content.includes('經商百出費精神'));
  assert.deepEqual(pack.lots[97].poemLines, ['經營百出費精神', '南北奔馳運未新', '玉兔交時當得意', '恰如枯木再逢春']);
});

test('内容包源文件和运行数据均匹配manifest，扫描声明公共领域', () => {
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL(file.path, root));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(sha(bytes), file.sha256, file.path);
  }
  const scan = JSON.parse(read('sources/scan-metadata.json')).query.pages[0].imageinfo[0];
  assert.equal(scan.pagecount, 104);
  assert.equal(scan.extmetadata.LicenseShortName.value, 'Public domain');
  assert.equal(scan.extmetadata.Copyrighted.value, 'False');
  assert.equal(manifest.totalVerseCharacters, 2800);
});

test('许可与素材边界完整：原创释义MIT，编辑快照CC，无未授权运行素材', () => {
  assert.equal(manifest.licenses.interpretations, 'MIT');
  assert.match(manifest.licenses.wikisourceSnapshot, /CC-BY-SA-4\.0/);
  assert.equal(manifest.acceptance.runtimeModuleImplemented, false);
  for (const lot of pack.lots) {
    assert.deepEqual(lot.assets, []);
    assert.equal(lot.interpretationLicense, 'MIT');
  }
  assert.deepEqual(manifest.runtimeFiles, ['lots.json']);
  assert.match(read('LICENSES.md'), /NOT_CHECKED/);
  assert.equal(JSON.parse(read('schema.json')).properties.lots.minItems, 100);
});

test('离线schema全部声明关键字通过，额外私人字段与错行内容被拒绝', () => {
  const schema = JSON.parse(read('schema.json'));
  assert.equal(validateDeclaredSchema(schema, pack), true);
  const unknown = structuredClone(pack); unknown.lots[0].birthday = 'synthetic-only';
  assert.throws(() => validateDeclaredSchema(schema, unknown), /unknown birthday/);
  const wrong = structuredClone(pack); wrong.lots[0].poemLines[0] += '字';
  assert.throws(() => validateDeclaredSchema(schema, wrong), /too long/);
  assert.throws(() => validateDeclaredSchema({ allOf: [] }, {}), /Unsupported schema keyword/);
});
