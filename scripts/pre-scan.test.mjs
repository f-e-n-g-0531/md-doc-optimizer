#!/usr/bin/env node
// scripts/pre-scan.test.mjs — pre-scan 自测：构造临时夹具，校验输出契约、各类检测与确定性。
// 运行：node scripts/pre-scan.test.mjs（成功退出 0，失败退出 1）
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'pre-scan.mjs');

const ALLOWED_KINDS = [
  'broken-local-link',
  'broken-anchor',
  'default-branch-master-link',
  'trailing-fullwidth-after-url',
  'stale-time-phrase',
  'placeholder-marker',
  'duplicate-heading',
  'duplicate-paragraph',
  'multiple-h1',
  'near-duplicate-files',
];
const CATEGORY_OF = {
  'broken-local-link': 'B',
  'broken-anchor': 'B',
  'default-branch-master-link': 'B',
  'trailing-fullwidth-after-url': 'C',
  'stale-time-phrase': 'B',
  'placeholder-marker': 'B',
  'duplicate-heading': 'A',
  'duplicate-paragraph': 'A',
  'multiple-h1': 'A',
  'near-duplicate-files': 'A',
};

let assertions = 0;
function ok(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}
function eq(actual, expected, message) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}
function throws(fn, message) {
  assertions += 1;
  assert.throws(fn, message);
}
function toPosix(p) {
  return p.split(sep).join('/');
}
function runCli(args) {
  return execFileSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', stdio: 'pipe' });
}
// 与 pre-scan.mjs 保持一致的排序键：file -> line -> kind
function compareCandidates(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return 0;
}

function runAssertions(tmp) {
  const files = new Map();
  const addFile = (rel, content) => {
    const absPath = join(tmp, ...rel.split('/'));
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
    files.set(rel, content);
  };

  // ---- 夹具：每个 kind 至少一处，另含不应误报的对照文件 ----
  addFile('docs/valid.md',
    '# Valid\n\n## Valid Heading\n\nA valid target document.\n\n[back to valid-only](./valid-only.md)\n');
  addFile('docs/valid-only.md',
    '# Valid Only\n\n[relative](./valid.md)\n[same file anchor](#valid-only)\n' +
    '[external](https://example.com/docs)\n[email](mailto:test@example.com)\n[data](data:text/plain,hello)\n\n' +
    '## 中文标题\n\n[中文锚点](#中文标题)\n');
  addFile('docs/broken-link.md',
    '# Broken Link\n\n[missing local file](./does-not-exist.md)\n\n[existing local file](./valid.md)\n');
  addFile('docs/anchors.md',
    '# Anchors\n\n## Existing Heading\n\n[ok](#existing-heading)\n\n[bad](#missing-anchor)\n');
  addFile('docs/anchors-target.md',
    '# Anchor Target\n\n## Target Heading\n\n## 中文标题\n\nTarget document.\n');
  addFile('docs/cross-anchor.md',
    '# Cross Anchor\n\n[ok](anchors-target.md#target-heading)\n[中文](anchors-target.md#中文标题)\n\n' +
    '[bad](anchors-target.md#no-such-heading)\n');
  addFile('docs/master.md',
    '# Master Branch\n\n[tree link](https://github.com/some-owner/some-repo/tree/master/docs)\n');
  addFile('docs/fullwidth.md',
    '# Fullwidth\n\n[glued](https://example.com/page）\n\n裸链接 https://example.com/bare）\n');
  // BOM + CRLF，验证 stale 检测仍生效
  addFile('docs/stale.md',
    '\uFEFF# Stale\r\n\r\nThis feature is currently in beta.\r\n\r\n预计近期上线。\r\n');
  addFile('docs/placeholder.md',
    '# Placeholder\n\nTODO: fill in the API reference.\n\n待补充：安装说明。\n\nstay tuned for updates.\n');
  addFile('docs/duplicate-heading.md',
    '# Duplicate Heading\n\n## Notes\n\nFirst notes.\n\n## Notes\n\nSecond notes.\n');
  addFile('docs/duplicate-paragraph.md',
    '# Duplicate Paragraph\n\n' +
    'This is a deliberately long paragraph used to test duplicate-paragraph detection. ' +
    'It must exceed eighty characters in normalized form and be repeated twice in the same file.\n\n' +
    'This is a deliberately long paragraph used to test duplicate-paragraph detection. ' +
    'It must exceed eighty characters in normalized form and be repeated twice in the same file.\n');
  addFile('docs/headings.md', '# First Title\n\nIntro text.\n\n# Second Title\n\nMore text.\n');

  const sharedLines = [];
  for (let i = 1; i <= 10; i++) {
    sharedLines.push('Shared line ' + i + ' for the near-duplicate file similarity check.');
  }
  addFile('docs/near-a.md', ['# Near', '', ...sharedLines, 'Only present in near-a file.', ''].join('\n'));
  addFile('docs/near-b.md', ['# Near', '', ...sharedLines, 'Only present in near-b file.', ''].join('\n'));

  // 围栏代码里的坏链接/锚点/master/全角/TODO 必须全部不报
  addFile('docs/fence.md', [
    '# Fence', '',
    '```md',
    '[broken](./nope.md)',
    '[anchor](#nope)',
    '[master](https://github.com/a/b/tree/master/docs)',
    '[x](https://example.com/x）',
    'TODO currently coming soon',
    '```',
    '',
  ].join('\n'));
  // 行内代码里的坏链接/短语必须不报
  addFile('docs/inline-code.md', [
    '# Inline Code', '',
    'Use `[broken](./nope.md)` and `TODO` and `currently` here.', '',
  ].join('\n'));

  addFile('test/fixtures/fixture-file.md', '# Fixture\n\n[missing](./nope.md)\n');
  addFile('example-doc.md', '# Example\n\nThis is currently an example file.\n');

  // 必须被忽略的目录
  addFile('.git/ignored.md', '# Ignored\n\n[missing](./nope.md)\nTODO currently\n');
  addFile('node_modules/ignored.md', '# Dependency\n\n[missing](./nope.md)\n');

  const expectedScanned = [...files.keys()]
    .filter((rel) => !rel.startsWith('.git/') && !rel.startsWith('node_modules/')).length;

  // ---- 默认 JSON 输出 ----
  const jsonRun = spawnSync(process.execPath, [scriptPath, tmp], { encoding: 'utf8' });
  eq(jsonRun.status, 0, 'JSON run exit code 0');
  eq(jsonRun.stderr, '', 'JSON run writes nothing to stderr');
  const json1 = jsonRun.stdout;
  const result = JSON.parse(json1);
  eq(result.tool, 'md-doc-optimizer-pre-scan', 'tool field');
  eq(result.schema_version, 1, 'schema_version field');
  eq(result.target, toPosix(resolve(tmp)), 'target is absolute posix path');
  eq(result.files_scanned, expectedScanned, 'files_scanned ignores .git/node_modules and counts md files');

  const candidates = result.candidates;
  ok(Array.isArray(candidates) && candidates.length > 0, 'candidates is a non-empty array');
  eq([...new Set(candidates.map((candidate) => candidate.kind))].sort(), [...ALLOWED_KINDS].sort(),
    'every expected kind detected and no unexpected kind reported');
  for (const candidate of candidates) {
    ok(ALLOWED_KINDS.includes(candidate.kind), 'kind allowed: ' + candidate.kind);
    eq(candidate.category, CATEGORY_OF[candidate.kind], 'category fixed for ' + candidate.kind);
    ok(candidate.context === 'docs' || candidate.context === 'fixture', 'context value: ' + candidate.context);
    ok(Number.isInteger(candidate.line) && candidate.line >= 1, 'line is 1-based integer: ' + candidate.file);
    ok(candidate.excerpt.length <= 160, 'excerpt <= 160 chars: ' + candidate.file + ':' + candidate.line);
    ok(typeof candidate.evidence === 'string' && candidate.evidence.length > 0, 'evidence non-empty');

    const content = files.get(candidate.file);
    ok(content !== undefined, 'candidate file was created by fixture: ' + candidate.file);
    const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    ok(candidate.line <= lines.length, 'line within file length: ' + candidate.file + ':' + candidate.line);
    eq(candidate.excerpt, lines[candidate.line - 1].trim().slice(0, 160),
      'excerpt is the trimmed source line: ' + candidate.file + ':' + candidate.line);
  }

  // 排序与确定性
  const ordered = candidates.slice().sort(compareCandidates);
  eq(candidates.map((candidate) => JSON.stringify(candidate)),
    ordered.map((candidate) => JSON.stringify(candidate)),
    'candidates sorted by file, then line, then kind');
  const jsonAgain = runCli([tmp]);
  eq(jsonAgain, json1, 'two runs produce byte-identical JSON');
  ok(!result.target.includes(String.fromCharCode(92)), 'target path uses forward slashes');

  // 汇总一致性
  eq(result.summary.total, candidates.length, 'summary.total equals candidate count');
  const expectedByKind = {};
  for (const candidate of candidates) {
    expectedByKind[candidate.kind] = (expectedByKind[candidate.kind] || 0) + 1;
  }
  eq(result.summary.by_kind, expectedByKind, 'summary.by_kind matches candidate kinds');
  let kindSum = 0;
  for (const value of Object.values(result.summary.by_kind)) kindSum += value;
  eq(kindSum, candidates.length, 'by_kind values sum to candidate count');
  const expectedByCategory = { A: 0, B: 0, C: 0 };
  for (const candidate of candidates) expectedByCategory[candidate.category] += 1;
  eq(result.summary.by_category, expectedByCategory, 'summary.by_category matches candidates');
  eq(Object.keys(result.summary.by_category), ['A', 'B', 'C'], 'by_category has A/B/C keys');

  // ---- 逐 kind / 逐夹具断言 ----
  const ofFile = (file) => candidates.filter((candidate) => candidate.file === file);

  const brokenLinks = ofFile('docs/broken-link.md');
  eq(brokenLinks.map((c) => c.kind), ['broken-local-link'], 'broken relative link detected once');
  eq(brokenLinks[0].line, 3, 'broken relative link line');

  const anchors = ofFile('docs/anchors.md');
  eq(anchors.map((c) => c.kind), ['broken-anchor'], 'same-file broken anchor detected, valid anchor ignored');
  eq(anchors[0].line, 7, 'same-file broken anchor line');

  const crossAnchors = ofFile('docs/cross-anchor.md');
  eq(crossAnchors.map((c) => c.kind), ['broken-anchor'], 'cross-file broken anchor detected, CJK anchor ignored');
  eq(crossAnchors[0].line, 6, 'cross-file broken anchor line');

  const masterLinks = ofFile('docs/master.md');
  eq(masterLinks.map((c) => c.kind), ['default-branch-master-link'], 'master-branch link detected');
  eq(masterLinks[0].evidence, 'hardcoded /master/ path; verify repository default branch', 'master evidence');

  const fullwidth = ofFile('docs/fullwidth.md');
  eq(fullwidth.map((c) => c.kind),
    ['trailing-fullwidth-after-url', 'trailing-fullwidth-after-url'], 'link target and bare URL both checked');
  eq(fullwidth.map((c) => c.line), [3, 5], 'fullwidth candidates lines');
  eq(fullwidth[0].evidence, 'full-width punctuation likely glued into URL', 'fullwidth evidence');

  const stale = ofFile('docs/stale.md');
  eq(stale.map((c) => c.kind), ['stale-time-phrase', 'stale-time-phrase'], 'stale phrases found in BOM/CRLF file');
  eq(stale.map((c) => c.line), [3, 5], 'stale phrase lines');
  eq(stale.map((c) => c.evidence), ['currently', '近期'], 'stale evidence is the matched phrase');

  const placeholders = ofFile('docs/placeholder.md');
  eq(placeholders.map((c) => c.kind),
    ['placeholder-marker', 'placeholder-marker', 'placeholder-marker'], 'placeholder markers detected');
  eq(placeholders.map((c) => c.evidence), ['TODO', '待补充', 'stay tuned'], 'placeholder evidence phrases');
  eq(placeholders.map((c) => c.line), [3, 5, 7], 'placeholder lines');

  const dupHeading = ofFile('docs/duplicate-heading.md');
  eq(dupHeading.length, 1, 'only repeated heading occurrences reported');
  eq(dupHeading[0].kind, 'duplicate-heading', 'duplicate-heading kind');
  eq(dupHeading[0].line, 7, 'duplicate heading is the second occurrence');
  ok(dupHeading[0].evidence.includes('line 3'), 'duplicate heading evidence points at first occurrence');

  const dupParagraph = ofFile('docs/duplicate-paragraph.md');
  eq(dupParagraph.length, 1, 'only repeated paragraph occurrences reported');
  eq(dupParagraph[0].kind, 'duplicate-paragraph', 'duplicate-paragraph kind');
  eq(dupParagraph[0].line, 5, 'duplicate paragraph is the second occurrence');
  ok(dupParagraph[0].evidence.includes('line 3'), 'duplicate paragraph evidence points at first occurrence');

  const h1 = ofFile('docs/headings.md');
  eq(h1.length, 1, 'only extra H1 reported');
  eq(h1[0].kind, 'multiple-h1', 'multiple-h1 kind');
  eq(h1[0].line, 5, 'extra H1 line');
  ok(h1[0].evidence.includes('line 1'), 'multiple-h1 evidence points at first H1');

  const near = ofFile('docs/near-a.md');
  eq(near.length, 1, 'near-duplicate pair reported once, at lexicographically smaller file');
  eq(near[0].kind, 'near-duplicate-files', 'near-duplicate-files kind');
  eq(near[0].line, 1, 'near-duplicate candidate at line 1');
  eq(near[0].context, 'docs', 'near-duplicate context of reported file');
  ok(near[0].evidence.includes('docs/near-b.md'), 'near-duplicate evidence names the other file');
  ok(near[0].evidence.includes('0.85'), 'near-duplicate evidence has 2-decimal similarity');
  eq(ofFile('docs/near-b.md').length, 0, 'near-duplicate not double-reported');

  const fixture = ofFile('test/fixtures/fixture-file.md');
  eq(fixture.length, 1, 'fixture dir candidates present');
  eq(fixture[0].context, 'fixture', 'test/fixtures path context is fixture');
  eq(fixture[0].kind, 'broken-local-link', 'fixture candidate kind');

  const example = ofFile('example-doc.md');
  eq(example.length, 1, 'example- basename candidate present');
  eq(example[0].context, 'fixture', 'example- basename context is fixture');

  for (const candidate of candidates) {
    const fixtureFile = candidate.file.startsWith('test/') ||
      candidate.file.split('/').pop().startsWith('example-');
    eq(candidate.context, fixtureFile ? 'fixture' : 'docs', 'context derived from path: ' + candidate.file);
  }

  // 不应误报的文件：围栏内容、行内代码、合法链接与合法锚点、被忽略目录
  eq(ofFile('docs/fence.md'), [], 'links/phrases inside fenced code are not reported');
  eq(ofFile('docs/inline-code.md'), [], 'links/phrases inside inline code are not reported');
  eq(ofFile('docs/valid-only.md'), [], 'valid links and anchors are not reported');
  for (const candidate of candidates) {
    ok(!candidate.file.startsWith('.git/') && !candidate.file.startsWith('node_modules/'),
      'ignored directory not scanned: ' + candidate.file);
  }

  // ---- --text 输出 ----
  const textRun = spawnSync(process.execPath, [scriptPath, tmp, '--text'], { encoding: 'utf8' });
  eq(textRun.status, 0, '--text run exit code 0');
  const text = textRun.stdout;
  ok(text.includes('md-doc-optimizer pre-scan'), 'text header present');
  ok(text.includes('files scanned: ' + expectedScanned), 'text files_scanned count matches JSON');
  ok(text.includes('candidates: ' + candidates.length), 'text candidate count matches JSON');
  ok(text.includes('by category: A=' + expectedByCategory.A +
    ', B=' + expectedByCategory.B + ', C=' + expectedByCategory.C), 'text category counts match JSON');
  throws(() => JSON.parse(text), 'text mode is not JSON');

  // ---- 用法错误：不存在 / 非目录目标 ----
  let missingError = null;
  try {
    runCli([join(tmp, 'does-not-exist-dir')]);
  } catch (err) {
    missingError = err;
  }
  ok(missingError !== null, 'nonexistent target exits non-zero');
  eq(missingError.status, 2, 'nonexistent target exit code 2');
  ok(String(missingError.stderr).includes('not a directory'), 'nonexistent target stderr message');

  let fileTargetError = null;
  try {
    runCli([join(tmp, 'example-doc.md')]);
  } catch (err) {
    fileTargetError = err;
  }
  ok(fileTargetError !== null, 'file (non-directory) target exits non-zero');
  eq(fileTargetError.status, 2, 'file target exit code 2');
}

function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'md-doc-pre-scan-'));
  try {
    runAssertions(tmp);
    console.log('pre-scan self-test: OK (' + assertions + ' assertions)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error('pre-scan self-test: FAIL');
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
}
