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
  'broken-local-image',
  'case-mismatch-link',
  'broken-anchor',
  'empty-link-target',
  'undefined-reference-label',
  'unused-reference-definition',
  'duplicate-reference-definition',
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
  'broken-local-image': 'B',
  'case-mismatch-link': 'B',
  'broken-anchor': 'B',
  'empty-link-target': 'B',
  'undefined-reference-label': 'B',
  'unused-reference-definition': 'A',
  'duplicate-reference-definition': 'A',
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
  addFile('docs/anchor-edge.md',
    '# Anchor Edge\n\n' +
    '## foo_bar\n\n[underscore](#foo_bar)\n\n' +
    '## R&amp;D\n\n[entity](#rd)\n\n' +
    '<a name="legacy"></a>\n\n[html name anchor](#legacy)\n\n' +
    '<span id="span-id"></span>\n\n[html id anchor](#span-id)\n\n' +
    '## <code>Tag</code> Title\n\n[html tag](#tag-title)\n\n' +
    '[bad](#missing-edge-anchor)\n');
  addFile('docs/anchor-duplicate.md',
    '# Dup Anchors\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond\n\n' +
    '[second](#notes-1)\n\n[first](#notes)\n\n[missing](#notes-2)\n');
  addFile('docs/case-target.md', '# Case Target\n\nTarget file for case mismatch.\n');
  addFile('docs/case-link.md',
    '# Case Link\n\n[wrong file case](./Case-Target.md)\n\n[right case](./case-target.md)\n\n' +
    '[wrong dir case](sub/File.md)\n');
  addFile('docs/sub/file.md', '# Sub File\n\nLinked with a wrong-case path.\n');
  addFile('docs/images.md',
    '# Images\n\n' +
    '![missing](./img/missing.png)\n\n' +
    '![present](./img/present.png)\n\n' +
    '![case](./img/Present.png)\n\n' +
    '![external](https://example.com/x.png)\n\n' +
    '![data](data:image/png;base64,AAAA)\n\n' +
    '![ref missing][img-ref]\n\n' +
    '![ref present][img-ok]\n\n' +
    '[img-ref]: ./img/missing.png\n' +
    '[img-ok]: ./img/present.png\n');
  addFile('docs/empty-targets.md',
    '# Empty\n\n[empty]()\n\n[empty title]( "title")\n\n[empty angle](<>)\n\n' +
    '[angle title](<> "title")\n\n![empty image]()\n\n[same one]() and [same two]()\n\n' +
    '[empty-ref]:\n\n[valid](#empty)\n');
  addFile('docs/ref-defs.md',
    '# Ref Defs\n\n' +
    'Use [good][a], [collapsed][], shortcut [c], [dup][dup], [missing][], and [anchored][].\n\n' +
    '![image][d]\n\n' +
    '[good-link]: ./valid.md\n' +
    '[collapsed]: ./valid.md\n' +
    '[c]: ./valid.md\n' +
    '[unused]: ./valid.md\n' +
    '[dup]: ./valid.md\n' +
    '[dup]: ./valid.md\n' +
    '[missing]: ./nope.md\n' +
    '[anchored]: ./anchors-target.md#no-such-heading\n' +
    '[a]: ./valid.md\n');
  addFile('docs/footnote.md',
    '# Footnotes\n\nText with a footnote[^1] and another[^note].\n\n' +
    '[^1]: First footnote body.\n\n[^note]: Named footnote body.\n\n' +
    '## Footnote Heading\n\nAnother reference[^1].\n');
  addFile('docs/comments.md',
    '# Comments\n\n' +
    '<!-- [old](./missing.md) and [fake][nodef] -->\n\n' +
    'Visible [ok](./valid.md).\n\n' +
    '<a name="real"></a>\n\n' +
    '<!-- <a name="ghost"></a> -->\n\n' +
    '[real anchor](#real) and [ghost anchor](#ghost)\n\n' +
    '<!-- multi-line comment starts\n[broken](./nope.md)\n-->\n');
  addFile('docs/image-shortcut.md',
    '# Image Shortcut\n\n![shot present]\n\n![shot missing]\n\n' +
    '[shot present]: ./img/present.png\n[shot missing]: ./img/absent.png\n');
  addFile('docs/nested-image-link.md',
    '# Nested Image Link\n\n' +
    '[![alt missing](./img/absent.png)](./valid.md)\n\n' +
    '[![alt present](./img/present.png)](./outer-missing.md)\n\n' +
    '[![alt present](./img/present.png)](./valid.md)\n');
  addFile('docs/nested-brackets.md',
    '# Nested Brackets\n\n' +
    '![alt [x]](./img/absent.png)\n\n' +
    '[see [inner][nodef]](./outer-missing.md)\n\n' +
    '[see [inner][nodef]](./valid.md)\n');
  addFile('docs/multiline-defs.md',
    '# Multiline Defs\n\n[multi]:\n  ./valid.md\n\n' +
    '> [quoted-def]: ./valid.md\n\n- [list-def]: ./valid.md\n\n' +
    'Use [multi][], [quoted-def][], and [list-def][].\n');
  addFile('docs/footnote-body.md',
    '# Footnote Body\n\n[^named]: Body [bad ref][nodef2] and a footnote ref[^x].\n\n' +
    'Next [also bad][nodef3].\n\n[^x]: Another footnote.\n');
  addFile('docs/quoted-target.md',
    '# Quoted Target\n\n[quoted]("missing.md")\n\n[quoted-ref]: "missing.md"\n\n' +
    'Use [quoted-ref][].\n');
  addFile('docs/escaped-brackets.md',
    '# Escaped\n\nLiteral \\[text](./missing.md) and \\[x]() and \\[y](<>).\n');
  addFile('docs/commented-headings.md',
    '# Commented Headings\n\n<!--\n# Ghost Title\n\n## Hidden Notes\n-->\n\n' +
    '## Visible Notes\n\n[ghost](#ghost-title)\n\n[hidden](#hidden-notes)\n');
  addFile('docs/comment-fence.md',
    '# Comment Fence\n\n<!--\n```md\n-->\n\n[after](./missing-after.md)\n');
  addFile('docs/backslash-links.md',
    '# Backslash Links\n\n[win link](sub\\file.md)\n\n![win image](img\\present.png)\n\n' +
    '[escaped underscore](./my\\_file.md)\n');
  addFile('docs/my_file.md', '# My File\n\nTarget for the escaped-underscore link.\n');
  mkdirSync(join(tmp, 'docs', 'img'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'img', 'present.png'), 'png');
  addFile('clean/ok.md', '# OK\n\n[ok](#ok)\n');
  addFile('gateonly/test/fixtures/bad.md', '# Fixture\n\n[bad](./nope.md)\n');
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

  const anchorEdge = ofFile('docs/anchor-edge.md');
  eq(anchorEdge.map((c) => c.kind), ['broken-anchor'],
    'underscore / entity / HTML-property headings and explicit HTML anchors are recognized');
  eq(anchorEdge[0].line, 23, 'only the genuinely missing anchor is reported');
  ok(anchorEdge[0].evidence.includes('explicit HTML anchor'), 'broken anchor evidence mentions HTML anchors');

  const anchorDup = ofFile('docs/anchor-duplicate.md');
  eq(anchorDup.map((c) => c.kind), ['duplicate-heading', 'broken-anchor'],
    'duplicate headings get -1 suffix; only the nonexistent -2 anchor is reported');
  eq(anchorDup.map((c) => c.line), [7, 15], 'duplicate heading and anchor lines');

  const images = ofFile('docs/images.md');
  eq(images.map((c) => c.kind),
    ['broken-local-image', 'case-mismatch-link', 'broken-local-image'],
    'inline image, image path case, and image-only reference target are all checked');
  eq(images.map((c) => c.line), [3, 7, 17], 'image candidate lines');
  ok(images[0].evidence.includes('relative image target not found: ./img/missing.png'), 'broken image evidence');
  ok(images[1].evidence.includes('image path case differs'), 'image case-mismatch evidence mentions image');
  ok(images[2].evidence.includes('./img/missing.png'), 'reference image target checked at its definition line');

  const imageShortcut = ofFile('docs/image-shortcut.md');
  eq(imageShortcut.map((c) => c.kind), ['broken-local-image'],
    'shortcut image usage counts; its definition target is checked as an image');
  eq(imageShortcut[0].line, 8, 'shortcut image definition line');

  const nested = ofFile('docs/nested-image-link.md');
  eq(nested.map((c) => c.kind), ['broken-local-image', 'broken-local-link'],
    'nested image-link checks both the image and the outer link');
  eq(nested.map((c) => c.line), [3, 5], 'nested image-link lines');

  const nestedBrackets = ofFile('docs/nested-brackets.md');
  eq(nestedBrackets.map((c) => c.kind), ['broken-local-image', 'broken-local-link'],
    'link text with one level of nested brackets is parsed (image alt and reference-like text)');
  eq(nestedBrackets.map((c) => c.line), [3, 5], 'nested bracket lines');

  eq(ofFile('docs/multiline-defs.md'), [], 'multiline and container reference definitions are resolved');
  eq(ofFile('docs/escaped-brackets.md'), [], 'escaped brackets are not treated as links');

  const footnoteBody = ofFile('docs/footnote-body.md');
  eq(footnoteBody.map((c) => c.kind), ['undefined-reference-label', 'undefined-reference-label'],
    'references in a footnote definition body are still checked');
  eq(footnoteBody.map((c) => c.line), [3, 5], 'footnote body usage lines');

  const quoted = ofFile('docs/quoted-target.md');
  eq(quoted.map((c) => c.kind), ['broken-local-link', 'broken-local-link'],
    'quoted destinations are links, not empty targets');
  eq(quoted.map((c) => c.line), [3, 5], 'quoted destination lines');

  const commentedHeadings = ofFile('docs/commented-headings.md');
  eq(commentedHeadings.map((c) => c.kind), ['broken-anchor', 'broken-anchor'],
    'headings inside HTML comments create neither anchors nor duplicate headings');
  eq(commentedHeadings.map((c) => c.line), [11, 13], 'commented-heading anchor lines');

  const commentFence = ofFile('docs/comment-fence.md');
  eq(commentFence.map((c) => c.kind), ['broken-local-link'],
    'fence markers inside comments do not swallow later text');
  eq(commentFence[0].line, 7, 'comment fence case line');

  const backslash = ofFile('docs/backslash-links.md');
  eq(backslash.map((c) => c.kind), ['broken-local-link', 'broken-local-image'],
    'backslash path separators are reported for links and images');
  eq(backslash.map((c) => c.line), [3, 5], 'backslash path lines');
  ok(backslash[0].evidence.includes('backslash'), 'backslash evidence');

  const empties = ofFile('docs/empty-targets.md');
  eq(empties.map((c) => c.kind),
    ['empty-link-target', 'empty-link-target', 'empty-link-target', 'empty-link-target',
      'empty-link-target', 'empty-link-target', 'empty-link-target', 'empty-link-target'],
    'empty inline link/image targets (angle+title, same line) and empty definitions detected');
  eq(empties.map((c) => c.line), [3, 5, 7, 9, 11, 13, 13, 15], 'empty target lines');

  const refDefs = ofFile('docs/ref-defs.md');
  eq(refDefs.map((c) => c.kind),
    ['undefined-reference-label', 'unused-reference-definition', 'unused-reference-definition',
      'duplicate-reference-definition', 'broken-local-link', 'broken-anchor'],
    'reference definitions checked for undefined use, unused/duplicate, broken target and anchor');
  eq(refDefs.map((c) => c.line), [5, 7, 10, 12, 13, 14], 'reference definition candidate lines');
  ok(refDefs[3].evidence.includes('line 11'), 'duplicate definition evidence points at the first definition');

  eq(ofFile('docs/footnote.md'), [], 'footnote definitions and references are not treated as links');

  const comments = ofFile('docs/comments.md');
  eq(comments.map((c) => c.kind), ['broken-anchor'],
    'links/references in HTML comments are ignored; a commented-out anchor does not count');
  eq(comments[0].line, 11, 'only the visible broken anchor is reported');

  const caseLinks = ofFile('docs/case-link.md');
  eq(caseLinks.map((c) => c.kind), ['case-mismatch-link', 'case-mismatch-link'],
    'file and directory case mismatches are reported on every platform');
  eq(caseLinks.map((c) => c.line), [3, 7], 'case mismatch lines');
  ok(caseLinks[0].evidence.includes('Case-Target.md -> case-target.md'),
    'case mismatch evidence shows linked name -> on-disk name');
  eq(ofFile('docs/case-target.md'), [], 'correctly-cased target file itself is clean');

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

  const FIXTURE_SEGMENTS = ['test', 'tests', 'fixtures', '__fixtures__', '__snapshots__'];
  for (const candidate of candidates) {
    const parts = candidate.file.split('/');
    const fixtureFile = parts.slice(0, -1).some((part) => FIXTURE_SEGMENTS.includes(part)) ||
      parts[parts.length - 1].startsWith('example-');
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
  ok(text.includes('stale-time-phrase -- currently |'), 'text output includes matched evidence');
  ok(text.includes('candidates (file:line [category] kind -- evidence | excerpt):'),
    'text output explains the columns');
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

  // ---- --fail-on 门禁 ----
  const cleanDir = join(tmp, 'clean');
  const gateMiss = spawnSync(process.execPath, [scriptPath, cleanDir, '--fail-on', 'broken-local-link'], { encoding: 'utf8' });
  eq(gateMiss.status, 0, '--fail-on miss on clean fixture exits 0');
  eq(gateMiss.stderr, '', '--fail-on miss writes nothing to stderr');

  const gateHit = spawnSync(process.execPath, [scriptPath, tmp, '--fail-on', 'broken-local-link'], { encoding: 'utf8' });
  eq(gateHit.status, 1, '--fail-on hit exits 1');
  ok(gateHit.stderr.includes('matched --fail-on (broken-local-link)'), 'gate stderr names the configured kind');
  ok(gateHit.stderr.includes('docs/broken-link.md:3'), 'gate stderr lists the matching candidate');
  ok(gateHit.stdout.includes('"tool": "md-doc-optimizer-pre-scan"'), 'gate still writes the full JSON to stdout');

  const gateEqualsForm = spawnSync(process.execPath,
    [scriptPath, tmp, '--fail-on=broken-local-link,placeholder-marker', '--text'], { encoding: 'utf8' });
  eq(gateEqualsForm.status, 1, '--fail-on= form with multiple kinds works');
  ok(gateEqualsForm.stdout.startsWith('md-doc-optimizer pre-scan'), 'gate with --text keeps text output');

  const gateUnknown = spawnSync(process.execPath, [scriptPath, tmp, '--fail-on', 'no-such-kind'], { encoding: 'utf8' });
  eq(gateUnknown.status, 2, 'unknown --fail-on kind exits 2');
  ok(gateUnknown.stderr.includes('unknown --fail-on kind: no-such-kind'), 'unknown kind error message');

  const gateMissingValue = spawnSync(process.execPath, [scriptPath, tmp, '--fail-on'], { encoding: 'utf8' });
  eq(gateMissingValue.status, 2, '--fail-on without a value exits 2');

  const gateEmptyList = spawnSync(process.execPath, [scriptPath, tmp, '--fail-on='], { encoding: 'utf8' });
  eq(gateEmptyList.status, 2, '--fail-on with an empty list exits 2');
  ok(gateEmptyList.stderr.includes('without empty entries'), 'empty list error message');

  const gateTrailingComma = spawnSync(process.execPath,
    [scriptPath, cleanDir, '--fail-on', 'broken-local-link,'], { encoding: 'utf8' });
  eq(gateTrailingComma.status, 2, 'trailing comma in kinds exits 2');
  ok(gateTrailingComma.stderr.includes('without empty entries'), 'trailing comma error message');

  const gateSwallowedFlag = spawnSync(process.execPath,
    [scriptPath, cleanDir, '--fail-on', '--text'], { encoding: 'utf8' });
  eq(gateSwallowedFlag.status, 2, '--fail-on followed by an option exits 2');
  ok(gateSwallowedFlag.stderr.includes('before "--text"'), 'swallowed option error message');

  const gateTwoTargets = spawnSync(process.execPath, [scriptPath, cleanDir, cleanDir], { encoding: 'utf8' });
  eq(gateTwoTargets.status, 2, 'two positional targets exit 2');
  ok(gateTwoTargets.stderr.includes('multiple kinds need --fail-on'), 'multiple positional error hints at --fail-on');

  const gateDuplicateKinds = spawnSync(process.execPath,
    [scriptPath, cleanDir, '--fail-on', 'broken-local-link,broken-local-link'], { encoding: 'utf8' });
  eq(gateDuplicateKinds.status, 0, 'duplicate kinds are accepted and deduped');

  // 默认跳过 fixture 上下文（夹具里的坏链接是内容本身）；--include-fixtures 显式包含
  const gateDir = join(tmp, 'gateonly');
  const gateFixtureSkip = spawnSync(process.execPath,
    [scriptPath, gateDir, '--fail-on', 'broken-local-link'], { encoding: 'utf8' });
  eq(gateFixtureSkip.status, 0, '--fail-on skips fixture candidates by default');
  ok(gateFixtureSkip.stderr.includes('fixture candidate(s) skipped (use --include-fixtures)'),
    'skipped fixture count is explained');

  const gateFixtureInclude = spawnSync(process.execPath,
    [scriptPath, gateDir, '--fail-on', 'broken-local-link', '--include-fixtures'], { encoding: 'utf8' });
  eq(gateFixtureInclude.status, 1, '--include-fixtures makes the gate fail on fixture candidates');
  ok(gateFixtureInclude.stderr.includes('test/fixtures/bad.md:3'),
    'included fixture candidate is listed');
  ok(gateFixtureInclude.stderr.includes('[fixture]'), 'fixture candidates are marked in gate details');
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
