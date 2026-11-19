#!/usr/bin/env node
// scripts/pre-scan.test.mjs — pre-scan 自测：构造临时夹具，校验输出契约、各类检测与确定性。
// 运行：node scripts/pre-scan.test.mjs（成功退出 0，失败退出 1）
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
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
  'duplicate-link-target',
  'link-outside-root',
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
  'duplicate-link-target': 'A',
  'link-outside-root': 'B',
  'default-branch-master-link': 'B',
  'trailing-fullwidth-after-url': 'C',
  'stale-time-phrase': 'B',
  'placeholder-marker': 'B',
  'duplicate-heading': 'A',
  'duplicate-paragraph': 'A',
  'multiple-h1': 'A',
  'near-duplicate-files': 'A',
};

const paragraphEvidence = (line, text) => 'repeat of paragraph at line ' + line +
  ': sha256=' + createHash('sha256').update(text).digest('hex');

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
  addFile('docs/faq(1).md', '# FAQ One\n');
  addFile('docs/faq(2).md', '# FAQ Two\n');
  addFile('docs/paren-link.md', [
    '# Paren Link', '',
    '[valid bare](./faq(1).md)', '',
    '[valid angle](<./faq(2).md>)', '',
    '![valid image](./img/pic(1).png)', '',
    '[missing](./no(paren).md)', '',
    '[missing angle](<./no(2).md>)', '',
    '![missing image](./img/no(1).png)', '',
  ].join('\n'));
  addFile('docs/paren-heading.md', [
    '# See [FAQ [Guide]](./faq(1).md)', '',
    '[ok](#see-faq-guide)', '',
    '[pre-fix slug](#see-faq-md-here)', '',
  ].join('\n'));
  addFile('docs/commented-headings.md',
    '# Commented Headings\n\n<!--\n# Ghost Title\n\n## Hidden Notes\n-->\n\n' +
    '## Visible Notes\n\n[ghost](#ghost-title)\n\n[hidden](#hidden-notes)\n');
  addFile('docs/comment-fence.md',
    '# Comment Fence\n\n<!--\n```md\n-->\n\n[after](./missing-after.md)\n');
  addFile('docs/backslash-links.md',
    '# Backslash Links\n\n[win link](sub\\file.md)\n\n![win image](img\\present.png)\n\n' +
    '[escaped underscore](./my\\_file.md)\n');
  addFile('docs/my_file.md', '# My File\n\nTarget for the escaped-underscore link.\n');
  addFile('docs/suppression.md', [
    '# Suppression', '',
    '<!-- pre-scan-disable -->', '',
    'TODO: 计划中的内容，暂不报。', '',
    '[broken during disable](./nope.md)', '',
    '<!-- pre-scan-enable -->', '',
    'Visible TODO: 这行应该报。', '',
    '[visible broken](./nope.md)', '',
    '<!-- pre-scan-ignore --> TODO: 同行忽略。 [ignored link](./nope.md)', '',
    '<!-- pre-scan-ignore-next-line -->',
    'TODO: 下一行忽略。', '',
    '[after](./nope.md)', '',
  ].join('\n'));
  addFile('docs/suppression-code.md', [
    '# Suppression Code', '',
    '```md',
    '<!-- pre-scan-disable -->',
    '```', '',
    'TODO: reported.', '',
    '`<!-- pre-scan-ignore -->` TODO: reported too.', '',
  ].join('\n'));
  addFile('docs/indented-after-comment.md',
    '# Comment Then Code\n\n<!--\nnote\n-->\n    [bad after comment](./nope-after-comment.md)\n\n' +
    '[visible](./valid.md)\n');
  addFile('docs/indented-after-html.md',
    '# HTML Block Then Code\n\n<pre>\nraw\n</pre>\n    [bad after pre](./nope-after-pre.md)\n\n' +
    '[visible](./valid.md)\n');
  addFile('docs/indented-after-heading.md',
    '# Heading\n    [code after heading](./nope1.md)\n\n' +
    '## Heading2\n    [code after h2](./nope2.md)\n\n' +
    '[visible](./valid.md)\n');
  addFile('docs/indented-code.md',
    '# Indented Code\n\n' +
    '    [broken in indented code](./nope1.md)\n' +
    '    <!-- pre-scan-disable -->\n\n' +
    '[visible](./nope2.md)\n\n' +
    '- item\n\n    continuation paragraph with [broken](./nope3.md)\n\n' +
    '>     [broken in quote code](./nope4.md)\n>\n> [visible quote](./nope5.md)\n');
  addFile('docs/setext.md',
    '# Setext Heading\n\nSub Title\n---------\n\n[ok](#sub-title)\n\n' +
    'Another Section\n---------------\n\n[ok2](#another-section)\n\n' +
    '> Quoted Setext\n> -------------\n\n[quoted](#quoted-setext)\n\n' +
    '- List Setext\n  ------------\n\n[list](#list-setext)\n\n' +
    'Multi\nLine\n----\n\n[multi](#multi-line)\n\n' +
    '> ## Quoted ATX\n\n[qatx](#quoted-atx)\n\n' +
    '- ## List ATX\n\n[latx](#list-atx)\n\n' +
    '   ## Indented ATX\n\n[iatx](#indented-atx)\n');
  addFile('docs/setext-duplicate.md',
    '# Setext Dup\n\nRepeat\n------\n\nrepeat body.\n\nRepeat\n------\n\n[second](#repeat-1)\n');
  addFile('docs/html-multiline.md',
    '# HTML Multiline\n\n' +
    '<a\n  href="./missing-multi.md">multi</a>\n\n' +
    '<img\n  src="./img/absent.png" alt="multi">\n\n' +
    '<img srcset="./img/absent.png 1x, ./img/present.png 2x" alt="srcset">\n\n' +
    '<source srcset="./img/absent2.png 2x">\n\n' +
    '<img srcset="data:image/png;base64,AAAA 1x" alt="data uri">\n\n' +
    '<img srcset="./img/present.png?q=1,2 2x" alt="query comma">\n');
  addFile('docs/a&b.md', '# A and B\n\nTarget file with an ampersand.\n');
  addFile('docs/html-entities.md',
    '# Entities\n\n[plain](./a&b.md)\n\n<a href="./a&amp;b.md">html</a>\n');
  mkdirSync(join(tmp, 'repo', '.git'), { recursive: true });
  addFile('repo/README.md', '# Repo\n');
  addFile('outside.md', '# Outside\n');
  addFile('repo/docs/links.md',
    '# Links\n\n[in](../README.md)\n\n[out](../../outside.md)\n');
  addFile('docs/duplicate-link-target-extra.md', [
    '# Dup Extra', '',
    '<a href="./valid-only.md">h1</a>', '',
    '<a href="./valid-only.md">h2</a>', '',
    '<a href="./valid-only.md">h3</a>', '',
    '[ref]: ./anchors-target.md', '',
    '[r1][ref]', '',
    '[r2][ref]', '',
    '[r3][ref]', '',
  ].join('\n'));
  addFile('docs/duplicate-link-target.md', [
    '# Dup Links', '',
    '[one](./valid.md)', '',
    '[two](./valid.md)', '',
    '[three](./valid.md)', '',
    '[anchor](#dup-links)', '',
    '[anchor2](#dup-links)', '',
    '[anchor3](#dup-links)', '',
    '[ext](https://example.com/x)', '',
    '[ext2](https://example.com/x)', '',
    '[twice](./valid-only.md)', '',
    '[twice again](./valid-only.md)', '',
  ].join('\n'));
  addFile('docs/html-links.md',
    '# HTML Links\n\n' +
    '<a href="./missing-html.md">bad</a>\n\n' +
    '<a href="./valid.md">good</a>\n\n' +
    '<a href="#no-such-anchor">bad anchor</a>\n\n' +
    '<img src="./img/absent.png" alt="bad">\n\n' +
    '<img src="./img/present.png" alt="good">\n\n' +
    '<img src="https://example.com/x.png" alt="external">\n\n' +
    '<img src="./img/Present.png" alt="case">\n\n' +
    '<a data-href="./nope.md">data attribute</a>\n\n' +
    '<img data-src="./nope.png" alt="data attribute">\n\n' +
    '<a title="see href=./nope.md">attribute value</a>\n\n' +
    '<img title="see src=./nope.png" alt="attribute value">\n');
  addFile('docs/container-fence.md',
    '# Container Fence\n\n' +
    '> \`\`\`md\n> [broken in quote fence](./nope1.md)\n> <!-- pre-scan-disable -->\n> \`\`\`\n\n' +
    '- \`\`\`md\n  [broken in list fence](./nope2.md)\n  \`\`\`\n\n' +
    '[visible](./nope3.md)\n');
  addFile('docs/container-html.md',
    '# Container HTML\n\n' +
    '> <pre>\n> [broken in quote pre](./nope1.md)\n> </pre>\n\n' +
    '- <pre>\n  [broken in list pre](./nope2.md)\n  </pre>\n\n' +
    '[visible](./nope3.md)\n');
  addFile('docs/html-pre.md',
    '# Pre Block\n\n<pre>\n[broken in pre](./nope1.md)\n<!-- pre-scan-disable -->\n</pre>\n\n' +
    '[visible](./nope2.md)\n');
  addFile('docs/suppression-open.md',
    '# Suppression Open\n\n<!-- pre-scan-disable -->\n\nTODO: hidden.\n\n[hidden](./nope.md)\n');
  addFile('docs/suppression-enable.md',
    '# Enable Alone\n\n[before](./nope1.md) <!-- pre-scan-enable -->\n\n[after](./nope2.md)\n');
  addFile('docs/suppression-reason.md',
    '# Reason\n\n<!-- pre-scan-ignore: 这是规则示例 --> TODO: hidden.\n\n' +
    '<!-- pre-scan-disable: 规则说明 -->\nTODO: hidden in region.\n<!-- pre-scan-enable: 结束 -->\n');
  addFile('docs/suppression-outer-comment.md',
    '# Outer Comment\n\n<!--\nThe form is <!-- pre-scan-disable --> as shown\n-->\n\n' +
    '[visible](./nope.md)\n');
  mkdirSync(join(tmp, 'docs', 'img'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'img', 'present.png'), 'png');
  writeFileSync(join(tmp, 'docs', 'img', 'pic(1).png'), 'png');
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
    ok([...candidate.excerpt].length <= 160, 'excerpt <= 160 chars: ' + candidate.file + ':' + candidate.line);
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

  const multilineDefs = ofFile('docs/multiline-defs.md');
  eq(multilineDefs.map((c) => c.kind), ['duplicate-link-target'],
    'multiline/container definitions resolve; repeated targets are flagged');
  eq(multilineDefs[0].line, 10, 'repeated reference targets reported at first use');
  eq(ofFile('docs/escaped-brackets.md'), [], 'escaped brackets are not treated as links');

  const footnoteBody = ofFile('docs/footnote-body.md');
  eq(footnoteBody.map((c) => c.kind), ['undefined-reference-label', 'undefined-reference-label'],
    'references in a footnote definition body are still checked');
  eq(footnoteBody.map((c) => c.line), [3, 5], 'footnote body usage lines');

  const quoted = ofFile('docs/quoted-target.md');
  eq(quoted.map((c) => c.kind), ['broken-local-link', 'broken-local-link'],
    'quoted destinations are links, not empty targets');
  eq(quoted.map((c) => c.line), [3, 5], 'quoted destination lines');

  const parenLinks = ofFile('docs/paren-link.md');
  eq(parenLinks.map((c) => c.kind),
    ['broken-local-link', 'broken-local-link', 'broken-local-image'],
    'balanced parentheses in link destinations are not truncated');
  eq(parenLinks.map((c) => c.line), [9, 11, 13], 'paren link candidate lines');
  ok(parenLinks[0].evidence.includes('no(paren).md'), 'bare paren target evidence keeps the full path');
  ok(parenLinks[1].evidence.includes('no(2).md'), 'angle paren target evidence keeps the full path');
  ok(parenLinks[2].evidence.includes('no(1).png'), 'paren image target evidence keeps the full path');

  const parenHeading = ofFile('docs/paren-heading.md');
  eq(parenHeading.map((c) => c.kind), ['broken-anchor'],
    'parenthesized destination in a heading link is fully stripped; rendered slug is the anchor');
  eq(parenHeading[0].line, 5, 'pre-fix truncated slug is reported as a missing anchor');

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
    ['duplicate-link-target', 'undefined-reference-label', 'unused-reference-definition',
      'unused-reference-definition', 'duplicate-reference-definition', 'broken-local-link', 'broken-anchor'],
    'reference definitions checked for repeated targets, undefined use, unused/duplicate, broken target and anchor');
  eq(refDefs.map((c) => c.line), [3, 5, 7, 10, 12, 13, 14], 'reference definition candidate lines');
  ok(refDefs[4].evidence.includes('line 11'), 'duplicate definition evidence points at the first definition');

  eq(ofFile('docs/footnote.md'), [], 'footnote definitions and references are not treated as links');

  const suppression = ofFile('docs/suppression.md');
  eq(suppression.map((c) => c.kind), ['placeholder-marker', 'broken-local-link', 'broken-local-link'],
    'suppression markers hide disabled/ignored lines only');
  eq(suppression.map((c) => c.line), [11, 13, 20], 'only unsuppressed lines are reported');

  const suppressionCode = ofFile('docs/suppression-code.md');
  eq(suppressionCode.map((c) => c.kind), ['placeholder-marker', 'placeholder-marker'],
    'markers inside fenced/inline code do not suppress');
  eq(suppressionCode.map((c) => c.line), [7, 9], 'code-context marker lines');

  eq(ofFile('docs/suppression-open.md'), [], 'unclosed pre-scan-disable suppresses through end of file');

  const suppressionEnable = ofFile('docs/suppression-enable.md');
  eq(suppressionEnable.map((c) => c.kind), ['broken-local-link', 'broken-local-link'],
    'standalone pre-scan-enable is a no-op');
  eq(suppressionEnable.map((c) => c.line), [3, 5], 'links on both sides of a standalone enable are reported');

  eq(ofFile('docs/suppression-reason.md'), [], 'markers accept a ": reason" suffix');

  const indentedCode = ofFile('docs/indented-code.md');
  eq(indentedCode.map((c) => c.kind), ['broken-local-link', 'broken-local-link', 'broken-local-link'],
    'indented code blocks are ignored; list continuations and blockquotes are scanned');
  eq(indentedCode.map((c) => c.line), [6, 10, 14], 'indented code candidate lines');
  eq(ofFile('docs/indented-after-heading.md'), [], 'indented code right after headings is ignored');
  eq(ofFile('docs/indented-after-html.md'), [], 'indented code right after raw HTML blocks is ignored');
  eq(ofFile('docs/indented-after-comment.md'), [], 'indented code right after multi-line HTML comments is ignored');

  const setext = ofFile('docs/setext.md');
  eq(setext, [], 'setext headings produce usable anchors');
  const setextDup = ofFile('docs/setext-duplicate.md');
  eq(setextDup.map((c) => c.kind), ['duplicate-heading'], 'duplicate setext headings are detected');
  eq(setextDup[0].line, 8, 'duplicate setext heading line');

  const htmlMultiline = ofFile('docs/html-multiline.md');
  eq(htmlMultiline.map((c) => c.kind),
    ['broken-local-link', 'broken-local-image', 'broken-local-image', 'broken-local-image'],
    'multiline HTML attributes and srcset are checked');
  eq(htmlMultiline.map((c) => c.line), [3, 6, 9, 11], 'multiline HTML candidate lines');

  eq(ofFile('docs/html-entities.md'), [], 'HTML attribute entities are decoded before path checks');

  const duplicateLink = ofFile('docs/duplicate-link-target.md');
  eq(duplicateLink.map((c) => c.kind), ['duplicate-link-target'],
    'repeated local link targets are reported once per file');
  eq(duplicateLink[0].line, 3, 'duplicate link candidate points at the first occurrence');
  ok(duplicateLink[0].evidence.includes('3 times'), 'duplicate link evidence includes the count');

  const duplicateExtra = ofFile('docs/duplicate-link-target-extra.md');
  eq(duplicateExtra.map((c) => c.kind), ['duplicate-link-target', 'duplicate-link-target'],
    'HTML and reference-style links also count toward duplicate targets');
  eq(duplicateExtra.map((c) => c.line), [3, 11], 'HTML/reference duplicate target lines');

  const outsideRoot = ofFile('repo/docs/links.md');
  eq(outsideRoot.map((c) => c.kind), ['link-outside-root'],
    'links escaping the git repository root are reported');
  eq(outsideRoot[0].line, 5, 'inside-repo link is allowed, outside-root link reported');

  const htmlLinks = ofFile('docs/html-links.md');
  eq(htmlLinks.map((c) => c.kind),
    ['broken-local-link', 'broken-anchor', 'broken-local-image', 'case-mismatch-link'],
    'HTML <a href> and <img src> local targets are checked');
  eq(htmlLinks.map((c) => c.line), [3, 7, 9, 15], 'HTML link/image candidate lines');
  ok(htmlLinks[0].evidence.includes('missing-html.md'), 'HTML link evidence names the target');

  const containerFence = ofFile('docs/container-fence.md');
  eq(containerFence.map((c) => c.kind), ['broken-local-link'],
    'blockquote/list fences are ignored, including markers inside them');
  eq(containerFence[0].line, 12, 'only content after container fences is reported');

  const containerHtml = ofFile('docs/container-html.md');
  eq(containerHtml.map((c) => c.kind), ['broken-local-link'],
    'raw HTML blocks inside blockquote/list are ignored');
  eq(containerHtml[0].line, 11, 'only content after container raw HTML blocks is reported');

  const htmlPre = ofFile('docs/html-pre.md');
  eq(htmlPre.map((c) => c.kind), ['broken-local-link'],
    'raw HTML blocks (<pre>) are ignored, including markers inside them');
  eq(htmlPre[0].line, 8, 'only content after the raw HTML block is reported');

  const suppressionOuter = ofFile('docs/suppression-outer-comment.md');
  eq(suppressionOuter.map((c) => c.kind), ['broken-local-link'],
    'marker literal inside another HTML comment does not take effect');
  eq(suppressionOuter[0].line, 7, 'visible link after the outer comment is reported');

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

  const caseIdentityDir = join(tmp, 'node_modules', 'case-target-identity');
  for (const dir of ['one', 'two']) {
    mkdirSync(join(caseIdentityDir, dir), { recursive: true });
    writeFileSync(join(caseIdentityDir, dir, 'note.md'), '# Note\n');
  }
  const caseIdentityDoc = join(caseIdentityDir, 'links.md');
  const caseIdentityBase = join(tmp, 'case-identity.json');
  writeFileSync(caseIdentityDoc, '[one](./one/NOTE.md)\n');
  runCli([caseIdentityDir, '--write-baseline', caseIdentityBase]);
  writeFileSync(caseIdentityDoc, '[two](./two/NOTE.md)\n');
  const caseGate = spawnSync(process.execPath, [scriptPath, caseIdentityDir, '--fail-on', 'case-mismatch-link',
    '--baseline', caseIdentityBase], { encoding: 'utf8' });
  eq(caseGate.status, 1, 'a distinct wrong-case destination is not waived by an older baseline');
  writeFileSync(caseIdentityDoc, '[one](./one/NOTE.md) [two](./two/NOTE.md)\n');
  const wrongCase = JSON.parse(runCli([caseIdentityDir])).candidates;
  eq(wrongCase.length, 2, 'wrong-case paths sharing the same basename do not collapse');

  // 独立夹具不应改变前后全量扫描的基准计数。
  const targetTypesDir = join(tmp, 'node_modules', 'target-types');
  mkdirSync(join(targetTypesDir, 'assets'), { recursive: true });
  writeFileSync(join(targetTypesDir, 'assets', 'present.png'), 'fixture');
  writeFileSync(join(targetTypesDir, 'page.md'), '# Page\n');
  writeFileSync(join(targetTypesDir, 'links.md'), [
    '[file](./page.md)', '[directory](./assets/)', '![image](./assets/present.png)',
    '[file with slash](./page.md/)', '[encoded slash](./page.md%2F?raw#page)',
    '![directory image](./assets)', '<img src="./assets/">',
    '![file image with slash](./assets/present.png/)',
    '[file dot](./page.md/.)', '[encoded file dot](./page.md/%2e)', '[valid directory dot](./assets/.)',
  ].join('\n'));
  const badTypes = spawnSync(process.execPath,
    [scriptPath, targetTypesDir, '--fail-on', 'broken-local-link,broken-local-image'], { encoding: 'utf8' });
  eq(badTypes.status, 1, 'a file with a trailing slash or a directory image fails the gate');
  eq(JSON.parse(badTypes.stdout).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [4, 'broken-local-link', 'relative link target is not a directory: ./page.md/'],
    [5, 'broken-local-link', 'relative link target is not a directory: ./page.md%2F'],
    [6, 'broken-local-image', 'relative image target is not a file: ./assets'],
    [7, 'broken-local-image', 'relative image target is not a file: ./assets/'],
    [8, 'broken-local-image', 'relative image target is not a file: ./assets/present.png/'],
    [9, 'broken-local-link', 'relative link target is not a directory: ./page.md/.'],
    [10, 'broken-local-link', 'relative link target is not a directory: ./page.md/%2e'],
  ], 'relative links may point to directories, but slash suffixes and image destinations require the appropriate target type');

  const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(join(targetTypesDir, 'assets'), join(targetTypesDir, 'live-link'), dirLinkType);
  symlinkSync(join(targetTypesDir, 'no-directory'), join(targetTypesDir, 'dangling-link'), dirLinkType);
  writeFileSync(join(targetTypesDir, 'links.md'), [
    '[directory link](./live-link)', '[directory link with slash](./live-link/)',
    '[dangling](./dangling-link)', '[dangling with slash](./dangling-link/)',
    '![dangling image](./dangling-link)',
  ].join('\n'));
  const danglingGate = spawnSync(process.execPath,
    [scriptPath, targetTypesDir, '--fail-on', 'broken-local-link'], { encoding: 'utf8' });
  eq(danglingGate.status, 1, 'a link to a dangling entry fails the gate');
  eq(JSON.parse(danglingGate.stdout).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [3, 'broken-local-link', 'relative link target not found: ./dangling-link'],
    [4, 'broken-local-link', 'relative link target not found: ./dangling-link/'],
    [5, 'broken-local-image', 'relative image target not found: ./dangling-link'],
  ], 'linked directories must resolve; dangling targets are missing rather than wrong type');

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

  // ---- 重复检测行为基线：首条被抑制仍是比较基准，分组交错且大小写/空白归一 ----
  const repeatsDir = join(tmp, 'repeat-baseline');
  mkdirSync(repeatsDir);
  const paragraphA = 'Paragraph alpha provides enough ordinary prose to exceed the eighty character minimum for duplicate detection.';
  const paragraphB = 'Paragraph beta provides a separate block with enough ordinary prose to exceed the eighty character minimum.';
  writeFileSync(join(repeatsDir, 'repeat.md'), [
    '<!-- pre-scan-ignore-next-line -->', '## Alpha', '', '## Beta', '',
    '## ALPHA', '', '## Beta', '', '## Alpha', '',
    '<!-- pre-scan-ignore-next-line -->', paragraphA, '', paragraphB, '',
    paragraphA.replaceAll(' ', '  '), '', paragraphB, '', paragraphA, '',
    '<!-- pre-scan-ignore-next-line -->', '# Main', '', '# Other', '', '# Main', '',
  ].join('\n'));
  const repeatScan = JSON.parse(runCli([repeatsDir]));
  eq(repeatScan.candidates.map(({ line, kind, evidence }) => [line, kind, evidence]), [
    [6, 'duplicate-heading', 'repeat of heading at line 2: 2|alpha'],
    [8, 'duplicate-heading', 'repeat of heading at line 4: 2|beta'],
    [10, 'duplicate-heading', 'repeat of heading at line 2: 2|alpha'],
    [17, 'duplicate-paragraph', paragraphEvidence(13, paragraphA)],
    [19, 'duplicate-paragraph', paragraphEvidence(15, paragraphB)],
    [21, 'duplicate-paragraph', paragraphEvidence(13, paragraphA)],
    [26, 'multiple-h1', 'additional H1; first H1 at line 24: other'],
    [28, 'duplicate-heading', 'repeat of heading at line 24: 1|main'],
    [28, 'multiple-h1', 'additional H1; first H1 at line 24: main'],
  ], 'interleaved repeats retain first occurrence evidence and suppression semantics');

  // 同一行保留词形与跨类别命中；最终候选仅合并相同 evidence，不吞独立 soon。
  writeFileSync(join(repeatsDir, 'phrases.md'),
    '# Phrases\n\ncoming soon soon currently 目前 currently Recently\n\n' +
    '`currently coming soon` https://example.com/currently/soon\n');
  const phraseScan = JSON.parse(runCli([repeatsDir]));
  eq(phraseScan.candidates.filter((candidate) => candidate.file === 'phrases.md')
    .map(({ line, kind, evidence }) => [line, kind, evidence]), [
    [3, 'placeholder-marker', 'coming soon'],
    [3, 'stale-time-phrase', 'Recently'],
    [3, 'stale-time-phrase', 'coming soon'],
    [3, 'stale-time-phrase', 'currently'],
    [3, 'stale-time-phrase', 'soon'],
    [3, 'stale-time-phrase', '目前'],
  ], 'phrase order, case, separate categories and code/URL masking remain stable');

  const codeSpans = join(tmp, 'inline-code-runs');
  mkdirSync(codeSpans);
  writeFileSync(join(codeSpans, 'runs.md'), [
    'Text `` TODO [hidden](./missing.md) `` and FIXME',
    'Text ``` currently ` literal `` still hidden ``` then TBD',
    'Text ` TODO `` stays visible',
    'Text \\` TODO ` stays visible',
    'Text \\`` FIXME ` is code after the escaped backtick',
    'Text ` TBD \\` and FIXME',
  ].join('\n\n'));
  eq(JSON.parse(runCli([codeSpans])).candidates.map(({ line, kind, evidence }) => [line, kind, evidence]), [
    [1, 'placeholder-marker', 'FIXME'],
    [3, 'placeholder-marker', 'TBD'],
    [5, 'placeholder-marker', 'TODO'],
    [7, 'placeholder-marker', 'TODO'],
    [11, 'placeholder-marker', 'FIXME'],
  ], 'single-line code spans only pair complete equal-length backtick runs');

  const spanDir = join(tmp, 'multiline-code-spans');
  mkdirSync(spanDir);
  const spanInput = [
    'Example `` TODO <!--', '[hidden](./hidden.md) <!-- pre-scan-disable -->',
    'end `` FIXME [visible](./visible.md)', '',
    'Unclosed ` TODO', '', '~~~md', '[fenced](./fenced.md)', '~~~', '',
    'A real comment <!-- `', '[commented](./commented.md)', '--> TBD [after](./after.md)', '',
    'Unmatched `` TODO', 'one backtick ` [still visible](./still.md)', '',
    'Before ` TODO', '## Heading', 'after ` FIXME',
  ];
  for (const eol of ['\n', '\r\n']) {
    writeFileSync(join(spanDir, 'spans.md'), spanInput.join(eol));
    eq(JSON.parse(runCli([spanDir])).candidates.map(({ line, kind }) => [line, kind]), [
      [3, 'broken-local-link'], [3, 'placeholder-marker'], [5, 'placeholder-marker'],
      [13, 'broken-local-link'], [13, 'placeholder-marker'], [15, 'placeholder-marker'],
      [16, 'broken-local-link'], [18, 'placeholder-marker'], [20, 'placeholder-marker'],
    ], 'paragraph code, comment precedence, unmatched runs and line numbers are stable');
  }

  const anchorIdentityDir = join(tmp, 'anchor-identity');
  mkdirSync(anchorIdentityDir);
  for (const name of ['a.md', 'b.md']) writeFileSync(join(anchorIdentityDir, name), '# Valid\n');
  const anchorIdentityDoc = join(anchorIdentityDir, 'links.md');
  const anchorIdentityBaseline = join(tmp, 'anchor-identity.json');
  writeFileSync(anchorIdentityDoc, '[first](./a.md#missing)\n');
  runCli([anchorIdentityDir, '--write-baseline', anchorIdentityBaseline]);
  writeFileSync(anchorIdentityDoc, '[second](./b.md#missing)\n');
  const changedAnchor = spawnSync(process.execPath, [scriptPath, anchorIdentityDir, '--fail-on', 'broken-anchor',
    '--baseline', anchorIdentityBaseline], { encoding: 'utf8' });
  eq(changedAnchor.status, 1, 'target file changes must not be hidden by an older anchor baseline');
  const anchorArgs = [scriptPath, anchorIdentityDir, '--fail-on', 'broken-anchor', '--baseline', anchorIdentityBaseline];
  writeFileSync(anchorIdentityDoc, '[same target](a.md?raw#missing)\n');
  eq(spawnSync(process.execPath, anchorArgs, { encoding: 'utf8' }).status, 0, 'relative spelling and query preserve the target identity');
  const legacy = JSON.parse(readFileSync(anchorIdentityBaseline, 'utf8'));
  legacy.entries[0].evidence = 'anchor #missing has no matching heading slug or explicit HTML anchor';
  writeFileSync(anchorIdentityBaseline, JSON.stringify(legacy));
  eq(spawnSync(process.execPath, anchorArgs, { encoding: 'utf8' }).status, 1, 'legacy evidence cannot waive a cross-file anchor');
  writeFileSync(anchorIdentityDoc, '[same file](#missing)\n');
  eq(spawnSync(process.execPath, anchorArgs, { encoding: 'utf8' }).status, 0, 'legacy same-file evidence still matches');
  writeFileSync(anchorIdentityDoc, '[one](./a.md#missing) [two](./b.md#missing)\n');
  const anchorFindings = JSON.parse(runCli([anchorIdentityDir])).candidates;
  eq(anchorFindings.length, 2, 'the same missing fragment in two targets yields two findings');
  ok(anchorFindings.some((c) => c.evidence.includes('a.md')) && anchorFindings.some((c) => c.evidence.includes('b.md')),
    'each anchor diagnostic identifies its target');

  const titleAnchorDir = join(tmp, 'escaped-title-anchor');
  mkdirSync(titleAnchorDir);
  writeFileSync(join(titleAnchorDir, 'page.md'), '# Page\n');
  writeFileSync(join(titleAnchorDir, 'links.md'), [
    '## See [FAQ](./page.md "a \\"quote\\"")', '', '[valid](#see-faq)', '',
    "## Read [FAQ](./page.md 'a \\'quote\\'')", '', '[valid](#read-faq)',
    '', `## HTML <span title="a > b" data-x='c > d'>FAQ</span>`, '', '[valid](#html-faq)',
    '', '## Compare < 3 > and <span>FAQ</span>', '', '[valid](#compare--3--and-faq)',
  ].join('\n'));
  eq(JSON.parse(runCli([titleAnchorDir])).candidates, [], 'escaped quotes in link titles do not alter heading anchors');

  const anchorCollisions = join(tmp, 'heading-anchor-collisions');
  mkdirSync(anchorCollisions);
  writeFileSync(join(anchorCollisions, 'headings.md'), [
    '## Notes', '## Notes-1', '## Notes', '## Notes-2', '## Notes',
    '[original](#notes) [literal](#notes-1) [second](#notes-2)',
    '[nested suffix](#notes-2-1) [third](#notes-3)',
    '<span id="R&amp;D"></span>', '[exact](#R%26D) [wrong case](#r%26d)',
    '<a name="literal&amp;amp;"></a>', '[once](#literal%26amp%3B)',
    `<a name="legacy-alias" ID=real-id title='example id="ghost"'></a>`,
    '[legacy](#legacy-alias) [id](#real-id) [ghost](#ghost)',
    '<input name="field-name">', '[not an anchor](#field-name)',
    `<span title='example id="quoted-only"' id=first id=second></span>`,
    '[first](#first) [second](#second) [quoted text](#quoted-only)',
  ].join('\n'));
  eq(JSON.parse(runCli([anchorCollisions])).candidates.filter((c) => c.kind === 'broken-anchor')
    .map((c) => [c.line, c.evidence]), [
    [9, 'anchor #r%26d has no matching heading slug or explicit HTML anchor'],
    [13, 'anchor #ghost has no matching heading slug or explicit HTML anchor'],
    [15, 'anchor #field-name has no matching heading slug or explicit HTML anchor'],
    [17, 'anchor #quoted-only has no matching heading slug or explicit HTML anchor'],
    [17, 'anchor #second has no matching heading slug or explicit HTML anchor'],
  ], 'heading collisions and real HTML anchor attributes match without promoting attribute text or duplicate attributes');

  // ---- 大仓 near-duplicate：精确前缀过滤路径 ----
  const manyNearDir = join(tmp, 'many-near');
  mkdirSync(manyNearDir, { recursive: true });
  const lshSharedLines = Array.from({ length: 12 }, (_, i) => 'shared body line ' + i);
  writeFileSync(join(manyNearDir, 'a.md'), ['# Shared', '', ...lshSharedLines, 'only A'].join('\n'));
  writeFileSync(join(manyNearDir, 'b.md'), ['# Shared', '', ...lshSharedLines, 'only B'].join('\n'));
  for (let i = 0; i < 58; i++) {
    const name = 'd' + String(i).padStart(2, '0') + '.md';
    const body = Array.from({ length: 12 }, (_, j) => 'distractor ' + i + ' line ' + j);
    writeFileSync(join(manyNearDir, name), ['# Distractor ' + i, '', ...body].join('\n'));
  }
  const manyRun = spawnSync(process.execPath, [scriptPath, manyNearDir], { encoding: 'utf8' });
  eq(manyRun.status, 0, 'large corpus scan exits 0');
  const manyResult = JSON.parse(manyRun.stdout);
  const manyNear = manyResult.candidates.filter((candidate) => candidate.kind === 'near-duplicate-files');
  eq(manyNear.length, 1, 'prefix filter finds the single near-duplicate pair among 60 files');
  eq(manyNear[0].file, 'a.md', 'near-duplicate reported at the lexicographically smaller file');
  ok(manyNear[0].evidence.includes('b.md'), 'near-duplicate evidence names the paired file');
  ok(manyNear[0].evidence.includes('0.87'), 'near-duplicate evidence keeps the exact Jaccard');
  const manyExactRun = spawnSync(process.execPath,
    [scriptPath, manyNearDir, '--exact-near-duplicates'], { encoding: 'utf8' });
  eq(manyExactRun.status, 0, '--exact-near-duplicates scan exits 0');
  const manyExactResult = JSON.parse(manyExactRun.stdout);
  eq(manyExactResult.candidates.filter((c) => c.kind === 'near-duplicate-files').length, 1,
    'exact near-duplicate mode also finds the pair');
  eq(manyExactResult.candidates, manyResult.candidates,
    'prefix-filter output matches brute-force exact output');

  // 精确阈值与不同集合尺寸：锁住两种算法的候选和排序契约。
  const boundaryDir = join(tmp, 'near-boundary');
  mkdirSync(boundaryDir);
  const boundarySets = [10, 12, 15, 9].map((size) =>
    Array.from({ length: size }, (_, i) => 'boundary token ' + i));
  boundarySets.push([...boundarySets[1]]);
  boundarySets.forEach((body, i) => writeFileSync(join(boundaryDir, i + '.md'), body.join('\n')));
  const boundaryScan = JSON.parse(runCli([boundaryDir]));
  eq(JSON.parse(runCli([boundaryDir, '--exact-near-duplicates'])), boundaryScan,
    'exact and prefix modes agree at threshold and minimum document size');
  eq(boundaryScan.candidates.filter((c) => c.kind === 'near-duplicate-files').map((c) =>
    [c.file, c.evidence]), [
    ['0.md', 'near-duplicate of 1.md (Jaccard 0.83)'],
    ['0.md', 'near-duplicate of 4.md (Jaccard 0.83)'],
    ['1.md', 'near-duplicate of 2.md (Jaccard 0.80)'],
    ['1.md', 'near-duplicate of 4.md (Jaccard 1.00)'],
    ['2.md', 'near-duplicate of 4.md (Jaccard 0.80)'],
  ], 'threshold is inclusive and nine-line documents are excluded');

  // 公共模板行很多，但实际交集低于阈值；另有相同文档和刚好达标的不同尺寸文档。
  const denseDir = join(tmp, 'near-dense');
  mkdirSync(denseDir);
  const boilerplate = Array.from({ length: 12 }, (_, i) => 'common boilerplate ' + i);
  for (let i = 0; i < 96; i++) {
    const body = boilerplate.concat(Array.from({ length: 3 }, (_, j) => 'document ' + i + ' token ' + j));
    writeFileSync(join(denseDir, 'doc-' + i + '.md'), body.join('\n'));
    if (i === 0) writeFileSync(join(denseDir, 'clone.md'), body.join('\n'));
  }
  writeFileSync(join(denseDir, 'template.md'), boilerplate.join('\n'));
  const denseScan = JSON.parse(runCli([denseDir]));
  eq(denseScan, JSON.parse(runCli([denseDir, '--exact-near-duplicates'])),
    'dense template prefixes preserve every exact candidate and output order');
  const denseMatches = denseScan.candidates.filter((c) => c.kind === 'near-duplicate-files');
  eq(denseMatches.length, 98, 'only exact clone and inclusive 12/15 threshold pairs match');

  // ---- --report-out 报告草稿 ----
  const reportPath = join(tmp, 'draft-report.json');
  const reportRun = spawnSync(process.execPath, [scriptPath, tmp, '--report-out', reportPath], { encoding: 'utf8' });
  eq(reportRun.status, 0, '--report-out exits 0');
  ok(reportRun.stderr.includes('finding(s) to report'), '--report-out prints a summary');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const reportScan = JSON.parse(reportRun.stdout);
  eq(report.summary.files_audited, reportScan.files_scanned, 'report files_audited matches scan');
  eq(report.summary.examined, reportScan.candidates.length, 'report examined matches candidates');
  eq(report.summary.fixed, 0, 'report draft has fixed=0');
  eq(report.summary.needs_human, reportScan.candidates.length, 'report draft marks all as needs_human');
  eq(report.summary.no_action, 0, 'report draft has no_action=0');
  eq(report.findings.length, reportScan.candidates.length, 'report findings match candidate count');
  for (const finding of report.findings) {
    ok(typeof finding.file === 'string' && finding.file.length > 0, 'report finding has file');
    ok(Number.isInteger(finding.line) && finding.line >= 1, 'report finding has line');
    ok(['A', 'B', 'C'].includes(finding.category), 'report finding category is A/B/C');
    ok(['Critical', 'High', 'Medium', 'Low'].includes(finding.severity), 'report finding has severity');
    eq(finding.action, 'annotate', 'report finding action is annotate');
    ok(typeof finding.evidence === 'string' && finding.evidence.length > 0, 'report finding has evidence');
    ok(typeof finding.excerpt === 'string' && [...finding.excerpt].length <= 120, 'report excerpt <= 120 chars');
  }
  const unicodeDir = join(tmp, 'unicode-excerpts');
  mkdirSync(unicodeDir);
  const unicodeLine = 'X' + '😀'.repeat(170) + ' TODO';
  writeFileSync(join(unicodeDir, 'unicode.md'), unicodeLine + '\n');
  const unicodeReportPath = join(tmp, 'unicode-report.json');
  const unicodeScan = JSON.parse(runCli([unicodeDir, '--report-out', unicodeReportPath]));
  const unicodeReport = JSON.parse(readFileSync(unicodeReportPath, 'utf8'));
  eq(unicodeScan.candidates.map((c) => [c.kind, c.evidence, c.excerpt]),
    [['placeholder-marker', 'TODO', 'X' + '😀'.repeat(159)]],
    'scan excerpt takes 160 complete Unicode code points without changing evidence');
  eq(unicodeReport.findings.map((c) => [c.evidence, c.excerpt]),
    [['TODO', 'X' + '😀'.repeat(119)]], 'report excerpt takes 120 complete Unicode code points');

  const reportWriteFailure = spawnSync(process.execPath,
    [scriptPath, tmp, '--report-out', tmp], { encoding: 'utf8' });
  eq(reportWriteFailure.status, 2, 'report write failure exits 2');
  eq(reportWriteFailure.stdout, '', 'report write failure produces no stdout');

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

  // -- 之后即使目录名与开关一致，也必须按原样作为位置参数读取。
  const optionNamedDir = join(tmp, '--text');
  mkdirSync(optionNamedDir);
  writeFileSync(join(optionNamedDir, 'broken.md'), '[missing](./missing.md)\n');
  const runFromTmp = (args) => spawnSync(process.execPath, [scriptPath, ...args], { cwd: tmp, encoding: 'utf8' });
  const literalTarget = runFromTmp(['--fail-on', 'broken-local-link', '--', '--text']);
  eq(literalTarget.status, 1, 'options before the delimiter still apply to the literal target');
  eq(JSON.parse(literalTarget.stdout).candidates.map((c) => [c.file, c.kind]),
    [['broken.md', 'broken-local-link']], 'option-shaped target is scanned as a directory');
  const tooManyTargets = runFromTmp(['--', '--text', '--include-fixtures']);
  eq(tooManyTargets.status, 2, 'delimiter preserves the single-target limit');
  ok(tooManyTargets.stderr.includes('expected at most one target directory'), 'tokens after the delimiter are not parsed as options');
  const missingValueBeforeEnd = runFromTmp(['--report-out', '--', '--text']);
  eq(missingValueBeforeEnd.status, 2, 'delimiter is not consumed as an option value');
  ok(missingValueBeforeEnd.stderr.includes('--report-out requires a file path'), 'missing option value diagnosis is unchanged');
  const unknownBeforeEnd = runFromTmp(['--not-an-option', '--', '--text']);
  eq(unknownBeforeEnd.status, 2, 'unknown option before delimiter remains an error');
  ok(unknownBeforeEnd.stderr.includes('unknown option: --not-an-option'), 'unknown option is diagnosed before delimiter');

  const overflowDir = join(tmp, 'gate-overflow');
  mkdirSync(overflowDir);
  const overflowDoc = join(overflowDir, 'links.md');
  const overflowBaseline = join(tmp, 'overflow-baseline.json');
  writeFileSync(overflowDoc, '[existing](./missing-existing.md)\n');
  runCli([overflowDir, '--write-baseline', overflowBaseline]);
  writeFileSync(overflowDoc, ['[existing](./missing-existing.md)',
    ...Array.from({ length: 21 }, (_, i) => '[missing](./missing-' + i + '.md)'),
  ].join('\n'));
  const overflow = spawnSync(process.execPath, [scriptPath, overflowDir, '--text', '--baseline', overflowBaseline,
    '--fail-on', 'broken-local-link'], { encoding: 'utf8' });
  eq(overflow.status, 1, 'text gate still fails with more than 20 new candidates');
  ok(overflow.stderr.includes('1 baselined candidate(s) ignored'), 'overflow notes distinguish baseline candidates');
  ok(overflow.stderr.includes('1 more (all candidates are on stdout)'), 'overflow does not promise JSON or a filtered list');
  ok(overflow.stdout.includes('candidates: 22'), 'stdout retains total candidates including the baseline');

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

  // 输出冲突必须在写入前拒绝，源文档和输入基线保持不变。
  const protectedDoc = join(cleanDir, 'protected.md');
  const protectedContent = '# Protected\n';
  writeFileSync(protectedDoc, protectedContent);
  for (const option of ['--report-out', '--write-baseline']) {
    const collision = spawnSync(process.execPath,
      [scriptPath, cleanDir, option, protectedDoc], { encoding: 'utf8' });
    eq(collision.status, 2, option + ' cannot overwrite Markdown');
    eq(collision.stdout, '', 'unsafe output produces no contract JSON');
    eq(readFileSync(protectedDoc, 'utf8'), protectedContent, 'source Markdown preserved');
  }
  const sharedOutput = join(tmp, 'shared-output.json');
  writeFileSync(sharedOutput, 'sentinel');
  const outputCollision = spawnSync(process.execPath,
    [scriptPath, cleanDir, '--report-out', sharedOutput,
      '--write-baseline', join(tmp, '.', 'shared-output.json')], { encoding: 'utf8' });
  eq(outputCollision.status, 2, 'report and baseline cannot share an output');
  eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'collision rejected before either write');
  const reportBeforeBlockedBaseline = spawnSync(process.execPath,
    [scriptPath, cleanDir, '--report-out', sharedOutput, '--write-baseline', tmp], { encoding: 'utf8' });
  eq(reportBeforeBlockedBaseline.status, 2, 'a directory cannot be used as the second output');
  eq(reportBeforeBlockedBaseline.stdout, '', 'invalid second output produces no stdout');
  eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'invalid second output leaves the first output unchanged');
  const stagedBaseline = join(tmp, 'staged-baseline.json');
  for (const method of ['writeFileSync', 'renameSync']) {
    writeFileSync(sharedOutput, 'sentinel');
    writeFileSync(stagedBaseline, 'old baseline');
    const preload = 'import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";' +
      'const original=fs.' + method + '; let calls=0; fs.' + method + '=function(p,...args){' +
      'if(String(p).includes(".md-doc-output-") && ++calls===2) throw new Error("injected second output failure");' +
      'return original.call(this,p,...args)}; syncBuiltinESMExports();';
    const failed = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
      scriptPath, cleanDir, '--report-out', sharedOutput, '--write-baseline', stagedBaseline], { encoding: 'utf8' });
    eq(failed.status, 2, 'second output failure exits 2');
    eq(failed.stdout, '', 'no successful scan output after publication failure');
    ok(failed.stderr.includes('cannot write baseline file:'), 'second output diagnosis identifies baseline');
    eq(readFileSync(stagedBaseline, 'utf8'), 'old baseline', 'failed output preserves baseline');
    eq(readdirSync(tmp).filter((name) => name.startsWith('.md-doc-output-')), [], 'temporary output directories are cleaned');
    if (method === 'writeFileSync') {
      eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'failed staging preserves first output');
    } else {
      eq(JSON.parse(readFileSync(sharedOutput, 'utf8')).summary.fixed, 0, 'already replaced report is readable');
      ok(failed.stderr.includes('already updated:') && failed.stderr.includes(sharedOutput), 'partial update is explicitly reported');
    }
  }
  runCli([cleanDir, '--report-out', sharedOutput, '--write-baseline', stagedBaseline]);
  eq(JSON.parse(readFileSync(stagedBaseline, 'utf8')).entries, [], 'both outputs can be published together');
  writeFileSync(sharedOutput, 'sentinel');

  const lookupDir = join(tmp, 'lookup-error');
  const lookupAssets = join(lookupDir, 'node_modules'); // 不在目录采集阶段读取，由链接检查触发。
  mkdirSync(lookupAssets, { recursive: true });
  writeFileSync(join(lookupAssets, 'asset.txt'), 'fixture');
  writeFileSync(join(lookupDir, 'links.md'), '[document](./node_modules/asset.txt)\n');
  const lookupPreload = 'import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";' +
    'const original = fs.readdirSync; fs.readdirSync = function(path, ...args) {' +
    'if (String(path).toLowerCase() === ' + JSON.stringify(lookupAssets.toLowerCase()) + ') ' +
    'throw Object.assign(new Error("injected EACCES"), {code: "EACCES"});' +
    'return original.call(this, path, ...args); }; syncBuiltinESMExports();';
  const lookupFailed = spawnSync(process.execPath,
    ['--import', 'data:text/javascript,' + encodeURIComponent(lookupPreload), scriptPath, lookupDir,
      '--fail-on', 'broken-local-link', '--report-out', sharedOutput], { encoding: 'utf8' });
  eq(lookupFailed.status, 2, 'cannot read a link parent is a scan error, not a dead link');
  eq(lookupFailed.stdout, '', 'failed link lookup emits no partial scan');
  ok(lookupFailed.stderr.includes('cannot read link target directory:') && lookupFailed.stderr.includes('injected EACCES'), 'diagnostic gives the lookup operation and cause');
  eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'failed link lookup leaves the existing report intact');

  const statCacheDir = join(tmp, 'stat-cache');
  mkdirSync(statCacheDir);
  writeFileSync(join(statCacheDir, 'page.md'), '# Page\n');
  writeFileSync(join(statCacheDir, 'links.md'), [
    '[markdown](./page.md#page)', '<a href="./page.md?raw#missing">HTML</a>',
    '[reference][p]', '', '[p]: ./page.md', '[case](./PAGE.md#page)',
    '[wrong type](./page.md/)',
  ].join('\n'));
  const statPreload = 'import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";' +
    'const original = fs.statSync; let calls = 0; fs.statSync = function(path, ...args) {' +
    'if (String(path).toLowerCase() === ' + JSON.stringify(join(statCacheDir, 'page.md').toLowerCase()) + ') calls++;' +
    'return original.call(this, path, ...args); }; syncBuiltinESMExports();' +
    'process.on("exit", () => process.stderr.write("target stat calls: " + calls + "\\n"));';
  const statRun = spawnSync(process.execPath,
    ['--import', 'data:text/javascript,' + encodeURIComponent(statPreload), scriptPath, statCacheDir], { encoding: 'utf8' });
  eq(statRun.status, 0, 'repeated target scan succeeds');
  eq(JSON.parse(statRun.stdout).candidates.map(({ line, kind }) => [line, kind]), [
    [2, 'broken-anchor'], [6, 'case-mismatch-link'], [7, 'broken-local-link'],
  ], 'query, anchor, spelling and trailing slash retain independent diagnostics');
  eq(statRun.stderr.trim(), 'target stat calls: 1', 'resolve target metadata only once per scan');

  // 注入文件系统错误，无需依赖宿主权限或修改 ACL，Windows/Linux 均能复验。
  for (const [method, failedPath, expected] of [
    ['readdirSync', cleanDir, 'cannot read directory'],
    ['readFileSync', protectedDoc, 'cannot read Markdown file'],
  ]) {
    const preload = 'import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";' +
      'const original = fs.' + method + '; fs.' + method + ' = function(path, ...args) {' +
      'if (String(path) === ' + JSON.stringify(failedPath) + ') throw new Error("injected EACCES");' +
      'return original.call(this, path, ...args); }; syncBuiltinESMExports();';
    const failed = spawnSync(process.execPath,
      ['--import', 'data:text/javascript,' + encodeURIComponent(preload), scriptPath, cleanDir,
        '--fail-on', 'broken-local-link', '--report-out', sharedOutput], { encoding: 'utf8' });
    eq(failed.status, 2, method + ' failure must not pass gate');
    eq(failed.stdout, '', 'incomplete scan must not output a success contract');
    ok(failed.stderr.includes(expected) && failed.stderr.includes('injected EACCES'), 'actionable read error');
    eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'incomplete scan must not write report');
  }

  const encodingDir = join(tmp, 'encoding-input');
  mkdirSync(encodingDir);
  const encodingDoc = join(encodingDir, 'encoding.md');
  const encodingBaseline = join(tmp, 'encoding-baseline.json');
  const encodingBaselineBody = Buffer.from('{"tool":"md-doc-optimizer-pre-scan-baseline","schema_version":1,"entries":[],"note":"');
  writeFileSync(encodingDoc, Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]));
  const malformedMd = spawnSync(process.execPath,
    [scriptPath, encodingDir, '--report-out', sharedOutput, '--write-baseline', encodingBaseline], { encoding: 'utf8' });
  eq(malformedMd.status, 2, 'invalid UTF-8 Markdown fails the scan');
  ok(malformedMd.stderr.includes('invalid UTF-8') && malformedMd.stderr.includes('encoding.md'), 'encoding error identifies the Markdown file');
  eq(malformedMd.stdout, '', 'invalid Markdown emits no scan result');
  eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'invalid Markdown leaves existing report intact');
  throws(() => readFileSync(encodingBaseline), 'invalid Markdown does not create baseline output');

  writeFileSync(encodingDoc, '\uFEFF# 标题😀\r\n\r\nTODO：实际字符 �\r\n');
  const validEncoding = JSON.parse(runCli([encodingDir]));
  eq(validEncoding.candidates.map(({ line, kind, excerpt }) => [line, kind, excerpt]),
    [[3, 'placeholder-marker', 'TODO：实际字符 �']], 'UTF-8 BOM, CRLF, Unicode and literal replacement characters remain valid');
  writeFileSync(encodingBaseline, Buffer.concat([encodingBaselineBody, Buffer.from([0xff]), Buffer.from('"}')]));
  const malformedBaseline = spawnSync(process.execPath,
    [scriptPath, encodingDir, '--fail-on', 'placeholder-marker', '--baseline', encodingBaseline, '--report-out', sharedOutput], { encoding: 'utf8' });
  eq(malformedBaseline.status, 2, 'invalid UTF-8 baseline fails before scanning');
  ok(malformedBaseline.stderr.includes('invalid UTF-8') && malformedBaseline.stderr.includes('encoding-baseline.json'), 'encoding error identifies the baseline file');
  eq(malformedBaseline.stdout, '', 'invalid baseline emits no scan result');
  eq(readFileSync(sharedOutput, 'utf8'), 'sentinel', 'invalid baseline leaves report intact');

  // 三个路径选项保留空值/缺值诊断以及等号形式。
  for (const option of ['--baseline', '--write-baseline', '--report-out']) {
    for (const suffix of [[], [''], ['--text']]) {
      const invalid = spawnSync(process.execPath, [scriptPath, cleanDir, option, ...suffix], { encoding: 'utf8' });
      eq(invalid.status, 2, option + ' rejects missing or invalid path');
      eq(invalid.stderr.trim(), 'pre-scan: ' + option + ' requires a file path', 'path diagnostic remains stable');
      eq(invalid.stdout, '', 'invalid option produces no output');
    }
    const emptyEquals = spawnSync(process.execPath, [scriptPath, cleanDir, option + '='], { encoding: 'utf8' });
    eq(emptyEquals.status, 2, option + ' rejects empty equals value');
  }
  const firstPath = join(tmp, 'first-option.json');
  const secondPath = join(tmp, 'second-option.json');
  const sentinelBaseline = JSON.stringify({ tool: 'md-doc-optimizer-pre-scan-baseline', schema_version: 1, entries: [] });
  for (const option of ['--baseline', '--write-baseline', '--report-out']) {
    writeFileSync(firstPath, sentinelBaseline);
    writeFileSync(secondPath, sentinelBaseline);
    const gate = option === '--baseline' ? ['--fail-on', 'broken-local-link'] : [];
    const repeated = spawnSync(process.execPath,
      [scriptPath, cleanDir, ...gate, option, firstPath, option + '=' + secondPath], { encoding: 'utf8' });
    eq(repeated.status, 2, option + ' rejects duplicate separated and equals values');
    eq(repeated.stderr.trim(), 'pre-scan: ' + option + ' may only be specified once', 'duplicate option diagnostic');
    eq(repeated.stdout, '', 'duplicate option produces no scan');
    eq(readFileSync(firstPath, 'utf8'), sentinelBaseline, 'first path is untouched');
    eq(readFileSync(secondPath, 'utf8'), sentinelBaseline, 'second path is untouched');
  }

  for (const [option, label] of [['--report-out', 'report'], ['--write-baseline', 'baseline']]) {
    const nestedOutput = join(tmp, label + '-nested', 'out.json');
    const written = spawnSync(process.execPath, [scriptPath, cleanDir, option + '=' + nestedOutput], { encoding: 'utf8' });
    eq(written.status, 0, option + ' equals form creates parent directories');
    const output = readFileSync(nestedOutput, 'utf8');
    eq(output, JSON.stringify(JSON.parse(output), null, 2) + '\n', 'JSON formatting remains stable');
    const failed = spawnSync(process.execPath, [scriptPath, cleanDir, option, join(protectedDoc, 'out.json')], { encoding: 'utf8' });
    eq(failed.status, 2, 'parent creation failure exits 2');
    ok(failed.stderr.includes('cannot write ' + label + ' file:'), 'write diagnostic retains output kind');
    eq(failed.stdout, '', 'write failure has no stdout');
  }

  // .. 前缀不等于父目录：仓库内的 ..cache 仍是合法路径。
  const dotRepo = join(tmp, 'dot-prefix-repo');
  mkdirSync(join(dotRepo, '.git'), { recursive: true });
  mkdirSync(join(dotRepo, '..cache'), { recursive: true });
  writeFileSync(join(dotRepo, '..cache', 'ok.md'), '# Cache\n');
  writeFileSync(join(dotRepo, 'README.md'), '# Dot prefix\n\n[cache](..cache/ok.md)\n');
  const dotScan = JSON.parse(runCli([dotRepo]));
  eq(dotScan.candidates, [], 'dot-prefixed child is not an escaping link');

  // ---- baseline 棘轮（存量为基线，只拦新增）----
  const baselineDir = join(tmp, 'baseline-work');
  mkdirSync(baselineDir, { recursive: true });
  writeFileSync(join(baselineDir, 'bad1.md'), '# Bad1\n\n[one](./nope1.md)\n');
  const baselinePath = join(tmp, 'baseline.json');
  const writeBaselineRun = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--write-baseline', baselinePath], { encoding: 'utf8' });
  eq(writeBaselineRun.status, 0, '--write-baseline exits 0');
  ok(writeBaselineRun.stderr.includes('wrote 1 candidate(s) to baseline'), 'baseline write summary');
  const baselineData = JSON.parse(readFileSync(baselinePath, 'utf8'));
  eq(baselineData.tool, 'md-doc-optimizer-pre-scan-baseline', 'baseline tool field');
  eq(baselineData.schema_version, 1, 'baseline schema_version');
  eq(baselineData.entries, [{ file: 'bad1.md', kind: 'broken-local-link', evidence: 'relative link target not found: ./nope1.md' }],
    'baseline entries only store file/kind/evidence');
  const savedBaseline = readFileSync(baselinePath, 'utf8');
  const inputCollision = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--baseline', baselinePath, '--fail-on', 'broken-local-link',
      '--report-out', baselinePath], { encoding: 'utf8' });
  eq(inputCollision.status, 2, 'report cannot overwrite input baseline');
  eq(readFileSync(baselinePath, 'utf8'), savedBaseline, 'input baseline preserved');
  const baselinePathCopy = join(tmp, 'baseline-copy.json');
  spawnSync(process.execPath, [scriptPath, baselineDir, '--write-baseline', baselinePathCopy], { encoding: 'utf8' });
  eq(readFileSync(baselinePathCopy, 'utf8'), readFileSync(baselinePath, 'utf8'), 'baseline output is deterministic');

  writeFileSync(join(baselineDir, 'bad2.md'), '# Bad2\n\n[two](./nope2.md)\n');
  const baselineGate = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', baselinePath], { encoding: 'utf8' });
  eq(baselineGate.status, 1, 'baseline gate fails on new candidates only');
  ok(baselineGate.stderr.includes('1 new candidate(s) matched'), 'baseline gate counts only new candidates');
  ok(baselineGate.stderr.includes('1 baselined candidate(s) ignored'), 'baseline gate explains ignored baseline');
  ok(baselineGate.stderr.includes('bad2.md:3'), 'new candidate is listed');
  ok(!baselineGate.stderr.includes('bad1.md'), 'baselined candidate is not listed in details');

  const allBaselinedDir = join(tmp, 'baseline-all');
  mkdirSync(allBaselinedDir, { recursive: true });
  writeFileSync(join(allBaselinedDir, 'bad.md'), '# Bad\n\n[bad](./nope.md)\n');
  const allBaselinePath = join(tmp, 'baseline-all.json');
  spawnSync(process.execPath, [scriptPath, allBaselinedDir, '--write-baseline', allBaselinePath], { encoding: 'utf8' });
  const allBaselined = spawnSync(process.execPath,
    [scriptPath, allBaselinedDir, '--fail-on', 'broken-local-link', '--baseline', allBaselinePath], { encoding: 'utf8' });
  eq(allBaselined.status, 0, 'fully baselined repo passes the gate');
  ok(allBaselined.stderr.includes('1 baselined candidate(s) ignored'), 'fully baselined run explains ignored baseline');

  writeFileSync(join(allBaselinedDir, 'bad.md'), '# Bad\n\n[bad](./nope.md)\n\n[again](./nope.md)\n');
  const repeatedGate = spawnSync(process.execPath,
    [scriptPath, allBaselinedDir, '--fail-on', 'broken-local-link', '--baseline', allBaselinePath], { encoding: 'utf8' });
  eq(repeatedGate.status, 1, 'same-evidence new instance must fail baseline gate');
  ok(repeatedGate.stderr.includes('1 new candidate(s) matched'), 'only excess instances are new');
  ok(repeatedGate.stderr.includes('1 baselined candidate(s) ignored'), 'original instance remains baselined');

  // evidence 里的 line N 归一：插入行导致行号漂移后仍匹配基线
  const shiftDir = join(tmp, 'baseline-shift');
  mkdirSync(shiftDir, { recursive: true });
  writeFileSync(join(shiftDir, 'dup.md'), '# Dup\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond\n');
  const shiftBaselinePath = join(tmp, 'baseline-shift.json');
  spawnSync(process.execPath, [scriptPath, shiftDir, '--write-baseline', shiftBaselinePath], { encoding: 'utf8' });
  writeFileSync(join(shiftDir, 'dup.md'), '# Dup\n\nintro\n\nmore\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond\n');
  const shiftGate = spawnSync(process.execPath,
    [scriptPath, shiftDir, '--fail-on', 'duplicate-heading', '--baseline', shiftBaselinePath], { encoding: 'utf8' });
  eq(shiftGate.status, 0, 'baseline ignores line-number shifts in evidence');
  ok(shiftGate.stderr.includes('1 baselined candidate(s) ignored'), 'line-shift baseline match is explained');

  const paragraphGateDir = join(tmp, 'paragraph-baseline-identity');
  mkdirSync(paragraphGateDir);
  const paragraphDoc = join(paragraphGateDir, 'doc.md');
  const paragraphBaseline = join(tmp, 'paragraph-identity.json');
  const paragraphPrefix = 'Identical opening text deliberately exceeds the candidate excerpt boundary. '.repeat(3);
  const writeRepeatedParagraph = (suffix, prefix = '') => {
    const paragraph = paragraphPrefix + suffix;
    writeFileSync(paragraphDoc, prefix + paragraph + '\n\n' + paragraph + '\n');
  };
  writeRepeatedParagraph('first ending');
  runCli([paragraphGateDir, '--write-baseline', paragraphBaseline]);
  const paragraphArgs = [scriptPath, paragraphGateDir, '--fail-on', 'duplicate-paragraph', '--baseline', paragraphBaseline];
  writeRepeatedParagraph('first ending', '# Introduction\n\n');
  eq(spawnSync(process.execPath, paragraphArgs, { encoding: 'utf8' }).status, 0, 'same paragraph can move');
  writeRepeatedParagraph('second ending');
  const changedParagraph = spawnSync(process.execPath, paragraphArgs, { encoding: 'utf8' });
  eq(changedParagraph.status, 1, 'another paragraph with the same excerpt is not covered by the baseline');
  ok(changedParagraph.stderr.includes('1 new candidate(s) matched'), 'different complete paragraph identity is reported');

  const headingArgs = [scriptPath, shiftDir, '--fail-on', 'duplicate-heading', '--baseline', shiftBaselinePath];
  for (const changed of ['## Examples', '### Notes']) {
    writeFileSync(join(shiftDir, 'dup.md'), '# Dup\n\n' + changed + '\n\nfirst\n\n' + changed + '\n\nsecond\n');
    const differentHeading = spawnSync(process.execPath, headingArgs, { encoding: 'utf8' });
    eq(differentHeading.status, 1, 'different heading text or level is never covered by the old baseline');
    ok(differentHeading.stderr.includes('1 new candidate(s) matched'), 'new group has its own identity');
  }
  writeFileSync(shiftBaselinePath, JSON.stringify({ tool: 'md-doc-optimizer-pre-scan-baseline', schema_version: 1,
    entries: [{ file: 'dup.md', kind: 'duplicate-heading', evidence: 'repeat of heading at line 3' }] }));
  const legacyHeading = spawnSync(process.execPath, headingArgs, { encoding: 'utf8' });
  eq(legacyHeading.status, 1, 'legacy heading entries lacking the heading identity do not waive current candidates');

  const refBaselineDir = join(tmp, 'reference-baseline-identity');
  mkdirSync(refBaselineDir);
  const refBaselineDoc = join(refBaselineDir, 'doc.md');
  const refBaselinePath = join(tmp, 'reference-key-baseline.json');
  const writeRefBaselineFixture = (label, gap = '') => writeFileSync(refBaselineDoc,
    gap + '[' + label + ']: https://example.invalid/a\n[' + label + ']: https://example.invalid/b\n\n[missing][' + label + ' missing]\n');
  writeRefBaselineFixture('Ref Label');
  runCli([refBaselineDir, '--write-baseline', refBaselinePath]);
  const refBaselineArgs = [scriptPath, refBaselineDir, '--fail-on',
    'duplicate-reference-definition,unused-reference-definition,undefined-reference-label', '--baseline', refBaselinePath];
  writeRefBaselineFixture('ref  label', '# Intro\n\n');
  eq(spawnSync(process.execPath, refBaselineArgs, { encoding: 'utf8' }).status, 0, 'case and whitespace do not change reference identity');
  writeRefBaselineFixture('New Label');
  eq(spawnSync(process.execPath, refBaselineArgs, { encoding: 'utf8' }).status, 1, 'another reference label still fails');

  const h1Dir = join(tmp, 'multiple-h1-identity');
  mkdirSync(h1Dir);
  const h1Doc = join(h1Dir, 'doc.md');
  const h1Base = join(tmp, 'h1-baseline.json');
  writeFileSync(h1Doc, '# Main\n\n# Extra heading\n');
  runCli([h1Dir, '--write-baseline', h1Base]);
  const h1Args = [scriptPath, h1Dir, '--fail-on', 'multiple-h1', '--baseline', h1Base];
  for (const [text, status] of [
    ['Preface\n\n# Main\n\n# EXTRA  heading\n', 0],
    ['# Main\n\n# Different heading\n', 1],
  ]) {
    writeFileSync(h1Doc, text);
    eq(spawnSync(process.execPath, h1Args, { encoding: 'utf8' }).status, status,
      'multiple H1 baseline preserves the specific additional heading identity');
  }
  writeFileSync(h1Base, JSON.stringify({ tool: 'md-doc-optimizer-pre-scan-baseline', schema_version: 1,
    entries: [{ file: 'doc.md', kind: 'multiple-h1', evidence: 'additional H1; first H1 at line 1' }] }));
  eq(spawnSync(process.execPath, h1Args, { encoding: 'utf8' }).status, 1, 'legacy ambiguous H1 records do not waive current findings');

  if (process.platform !== 'win32') {
    const pathIdentityDir = join(tmp, 'path-identity');
    mkdirSync(join(pathIdentityDir, 'notes'), { recursive: true });
    mkdirSync(join(pathIdentityDir, 'C:'));
    for (const file of [join('C:', 'guide.md'), join('notes', 'guide.md'), 'notes\\guide.md']) {
      writeFileSync(join(pathIdentityDir, file), '[missing](./missing.md)\n');
    }
    const pathIdentityReport = join(tmp, 'path-identity-report.json');
    const pathIdentityBaseline = join(tmp, 'path-identity-baseline.json');
    const scan = JSON.parse(runCli([pathIdentityDir, '--report-out', pathIdentityReport, '--write-baseline', pathIdentityBaseline]));
    for (const entries of [scan.candidates, JSON.parse(readFileSync(pathIdentityReport, 'utf8')).findings,
      JSON.parse(readFileSync(pathIdentityBaseline, 'utf8')).entries]) {
      eq(entries.map(({ file }) => file), ['C:/guide.md', 'notes/guide.md', 'notes\\guide.md'], 'native colon and backslash names keep their POSIX identity');
    }
    const identityGate = spawnSync(process.execPath,
      [scriptPath, pathIdentityDir, '--fail-on', 'broken-local-link', '--baseline', pathIdentityBaseline], { encoding: 'utf8' });
    eq(identityGate.status, 0, 'POSIX filename identities round-trip through the baseline');
  }

  // 路径即使包含与内置诊断相同的行号短语，也必须作为原样证据匹配。
  const normDir = join(tmp, 'baseline-normalize');
  mkdirSync(normDir, { recursive: true });
  writeFileSync(join(normDir, 'ref.md'), '# Ref\n\n[ref]: <./already defined at line 12.md>\n');
  const normBaselinePath = join(tmp, 'baseline-normalize.json');
  spawnSync(process.execPath, [scriptPath, normDir, '--write-baseline', normBaselinePath], { encoding: 'utf8' });
  writeFileSync(join(normDir, 'ref.md'), '# Ref\n\n[ref]: <./already defined at line 34.md>\n');
  const normGate = spawnSync(process.execPath,
    [scriptPath, normDir, '--fail-on', 'broken-local-link', '--baseline', normBaselinePath], { encoding: 'utf8' });
  eq(normGate.status, 1, 'baseline normalization only applies to line-number evidence, not paths');
  ok(normGate.stderr.includes('1 new candidate(s) matched'), 'changed path is treated as a new candidate');

  const writeFailure = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--write-baseline', tmp], { encoding: 'utf8' });
  eq(writeFailure.status, 2, 'writing baseline to a directory exits 2');
  eq(writeFailure.stdout, '', 'baseline write failure produces no stdout contract JSON');
  ok(writeFailure.stderr.includes('cannot write baseline file'), 'write failure message');

  const baselineMissing = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'missing.json')], { encoding: 'utf8' });
  eq(baselineMissing.status, 2, 'missing baseline file exits 2');
  ok(baselineMissing.stderr.includes('cannot read baseline file'), 'missing baseline error message');

  writeFileSync(join(tmp, 'bad-baseline.json'), 'not json');
  const baselineBadJson = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'bad-baseline.json')], { encoding: 'utf8' });
  eq(baselineBadJson.status, 2, 'invalid baseline JSON exits 2');
  ok(baselineBadJson.stderr.includes('invalid baseline JSON'), 'invalid baseline JSON message');

  writeFileSync(join(tmp, 'wrong-tool-baseline.json'),
    JSON.stringify({ tool: 'something-else', schema_version: 1, entries: [] }));
  const baselineWrongTool = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'wrong-tool-baseline.json')], { encoding: 'utf8' });
  eq(baselineWrongTool.status, 2, 'baseline with unexpected tool exits 2');
  ok(baselineWrongTool.stderr.includes('unexpected tool'), 'unexpected tool message');

  writeFileSync(join(tmp, 'bad-entry-baseline.json'),
    JSON.stringify({ tool: 'md-doc-optimizer-pre-scan-baseline', schema_version: 1, entries: [{ file: 1 }] }));
  const baselineBadEntry = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'bad-entry-baseline.json')], { encoding: 'utf8' });
  eq(baselineBadEntry.status, 2, 'malformed baseline entry exits 2');
  ok(baselineBadEntry.stderr.includes('must contain non-empty string file/kind/evidence'), 'malformed entry message');

  const entryOf = (entry) => JSON.stringify({ tool: 'md-doc-optimizer-pre-scan-baseline', schema_version: 1, entries: [entry] });
  writeFileSync(join(tmp, 'unknown-kind-baseline.json'),
    entryOf({ file: 'a.md', kind: 'no-such-kind', evidence: 'x' }));
  const baselineUnknownKind = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'unknown-kind-baseline.json')], { encoding: 'utf8' });
  eq(baselineUnknownKind.status, 2, 'baseline entry with unknown kind exits 2');
  ok(baselineUnknownKind.stderr.includes('unknown kind: no-such-kind'), 'unknown kind message');

  writeFileSync(join(tmp, 'empty-evidence-baseline.json'),
    entryOf({ file: 'a.md', kind: 'broken-local-link', evidence: '  ' }));
  const baselineEmptyEvidence = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'empty-evidence-baseline.json')], { encoding: 'utf8' });
  eq(baselineEmptyEvidence.status, 2, 'baseline entry with empty evidence exits 2');

  writeFileSync(join(tmp, 'absolute-file-baseline.json'),
    entryOf({ file: '/abs/a.md', kind: 'broken-local-link', evidence: 'x' }));
  const baselineAbsoluteFile = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', join(tmp, 'absolute-file-baseline.json')], { encoding: 'utf8' });
  eq(baselineAbsoluteFile.status, 2, 'baseline entry with absolute path exits 2');
  ok(baselineAbsoluteFile.stderr.includes('scan-root-relative POSIX path'), 'absolute path message');

  const pathBaseline = join(tmp, 'path-baseline.json');
  for (const file of ['../bad1.md', './bad1.md', 'docs/../bad1.md', 'docs/./bad1.md', 'docs//bad1.md', 'docs/bad1.md/', 'bad\u0000.md']) {
    writeFileSync(pathBaseline, entryOf({ ...baselineData.entries[0], file }));
    const result = spawnSync(process.execPath,
      [scriptPath, baselineDir, '--fail-on', 'broken-local-link', '--baseline', pathBaseline], { encoding: 'utf8' });
    eq(result.status, 2, 'noncanonical baseline path rejected: ' + JSON.stringify(file));
    eq(result.stdout, '', 'invalid baseline paths do not produce scan output');
    ok(result.stderr.includes('relative POSIX path'), 'path validation is explicit');
  }
  const namedDir = join(tmp, 'baseline-relative-names');
  mkdirSync(join(namedDir, '..cache'), { recursive: true });
  writeFileSync(join(namedDir, '..cache', 'note.md'), '[missing](./missing.md)\n');
  runCli([namedDir, '--write-baseline', pathBaseline]);
  const namedBaseline = JSON.parse(readFileSync(pathBaseline, 'utf8'));
  eq(namedBaseline.entries.map((e) => e.file), ['..cache/note.md'], 'ordinary dotted segments remain valid');
  const namedGate = spawnSync(process.execPath,
    [scriptPath, namedDir, '--fail-on', 'broken-local-link', '--baseline', pathBaseline], { encoding: 'utf8' });
  eq(namedGate.status, 0, 'generated subdirectory baseline round-trips');

  const writeBaselineWithGate = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--write-baseline', join(tmp, 'x.json'), '--fail-on', 'broken-local-link'], { encoding: 'utf8' });
  eq(writeBaselineWithGate.status, 2, '--write-baseline with --fail-on exits 2');
  ok(writeBaselineWithGate.stderr.includes('cannot be combined with --fail-on'), 'write/gate combination message');

  const writeBaselineWithBaseline = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--write-baseline', join(tmp, 'x.json'), '--baseline', baselinePath], { encoding: 'utf8' });
  eq(writeBaselineWithBaseline.status, 2, '--write-baseline with --baseline exits 2');
  ok(writeBaselineWithBaseline.stderr.includes('cannot be combined with --baseline'), 'write/baseline combination message');

  const baselineWithoutGate = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--baseline', baselinePath], { encoding: 'utf8' });
  eq(baselineWithoutGate.status, 2, '--baseline without --fail-on exits 2');
  ok(baselineWithoutGate.stderr.includes('--baseline requires --fail-on'), 'baseline requires gate message');

  const writeBaselineMissingValue = spawnSync(process.execPath,
    [scriptPath, baselineDir, '--write-baseline'], { encoding: 'utf8' });
  eq(writeBaselineMissingValue.status, 2, '--write-baseline without a path exits 2');
  ok(writeBaselineMissingValue.stderr.includes('requires a file path'), 'missing baseline path message');

  // Markdown 目标实体只解码一次，HTML 通路与百分号编码不得二次解码。
  const entityDir = join(tmp, 'entity-targets');
  mkdirSync(entityDir);
  for (const name of ['a&b.md', 'literal&amp;.md', 'unknown&madeup;.md', 'a b.md']) {
    writeFileSync(join(entityDir, name), '# Entity Target\n');
  }
  writeFileSync(join(entityDir, 'a&b.png'), 'image');
  writeFileSync(join(entityDir, 'links.md'), [
    '# Entity Links', '',
    '[inline](./a&amp;b.md)',
    '[angle](<./a&#38;b.md>)',
    '![image](./a&#x26;b.png)',
    '[![badge](./a&amp;b.png)](./a&#38;b.md)',
    '[reference][doc]',
    '![reference image][image]',
    '[doc]: ./a&amp;b.md',
    '[image]: ./a&#38;b.png',
    '[once](./literal&amp;amp;.md)',
    '<a href="./literal&amp;amp;.md">html once</a>',
    '[percent](./literal%26amp%3B.md)',
    '[escaped](./literal\\&amp;.md)',
    '[unknown](./unknown&madeup;.md)',
    '[space](<./a&#32;b.md>)',
    '[external](https&#58;//example.com)',
    '[anchor](./a&amp;b.md&#35;entity-target)',
    '[query](./a&amp;b.md&#63;view=1)',
    '[multiline ref][multi]',
    '[multi]:',
    '  <./a&#38;b.md>',
    '[missing](./missing&amp;file.md)',
  ].join('\n'));
  const entityResult = JSON.parse(runCli([entityDir]));
  eq(entityResult.candidates.filter((c) => c.kind === 'broken-local-link').map((c) => c.evidence),
    ['relative link target not found: ./missing&file.md'], 'entity destinations resolve before query/fragment split; missing evidence remains complete');
  eq(entityResult.candidates.filter((c) => c.kind === 'broken-local-image' || c.kind === 'broken-anchor'), [],
    'inline, nested and reference images plus encoded fragments resolve');
  ok(entityResult.candidates.some((c) => c.kind === 'duplicate-link-target' && c.evidence.endsWith('./a&b.md')),
    'Markdown and reference duplicate targets use decoded destination');
  eq(entityResult.candidates.filter((c) => c.kind !== 'duplicate-link-target' && c.kind !== 'broken-local-link'), [],
    'no other entity fixture candidates');

  writeFileSync(join(entityDir, 'slash.md'), '[numeric slash](./a&#92;&amp;b.md)\n');
  const slashCandidates = JSON.parse(runCli([entityDir])).candidates.filter((c) => c.file === 'slash.md');
  eq(slashCandidates.map((c) => c.kind), ['broken-local-link'], 'entity-generated backslash is never reinterpreted as Markdown escape');
  ok(slashCandidates[0].evidence.includes('backslash separators'), 'generated slash is rejected instead of resolving a&b.md');

  const namedEntityDir = join(tmp, 'named-entity-boundaries');
  mkdirSync(namedEntityDir);
  for (const name of ['literal&constructor;.md', 'literal&Amp;.md', 'a&b.md']) {
    writeFileSync(join(namedEntityDir, name), '# Destination\n');
  }
  writeFileSync(join(namedEntityDir, 'links.md'), [
    '[unknown](./literal&constructor;.md)',
    '<a href="./literal&Amp;.md">Mixed case is literal</a>',
    '[uppercase](./a&AMP;b.md)',
    '[reference][mixed]', '',
    '[mixed]: ./literal&Amp;.md', '',
    '<span id="id&constructor;"></span>',
    '[anchor](#id%26constructor%3B)',
    '[missing](./missing&constructor;.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([namedEntityDir])).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [10, 'broken-local-link', 'relative link target not found: ./missing&constructor;.md'],
  ], 'only exact supported entity names decode; unknown names remain literal in paths, anchors and evidence');

  const numericEntityDir = join(tmp, 'numeric-entity-boundaries');
  mkdirSync(numericEntityDir);
  for (const name of ['zero�.md', 'surrogate�.md', 'range�.md', 'astral😀.md', 'decimalA.md', 'hexA.md']) {
    writeFileSync(join(numericEntityDir, name), '# Destination\n');
  }
  writeFileSync(join(numericEntityDir, 'links.md'), [
    '[zero](./zero&#0;.md)', '[surrogate](./surrogate&#xD800;.md)',
    '[range][range]', '', '[range]: ./range&#1114112;.md', '',
    '[astral](./astral&#X1f600;.md)', '[decimal](./decimal&#0000065;.md)',
    '[hex](./hex&#x000041;.md)', '<a href="./zero&#00000000;.md">HTML decimal</a>',
    '[long decimal](./decimal&#00000065;.md)', '[long hex](./hex&#x0000041;.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([numericEntityDir])).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [11, 'broken-local-link', 'relative link target not found: ./decimal&'],
    [12, 'broken-local-link', 'relative link target not found: ./hex&'],
  ], 'numeric entities reject invalid scalars, preserve astral characters, and respect Markdown digit limits');

  // 显式空引用目标不能借用下一行正文；换行的空/有效目标沿用同一套解析。
  const refDestinationDir = join(tmp, 'reference-destinations');
  mkdirSync(refDestinationDir);
  writeFileSync(join(refDestinationDir, 'target.md'), '# Target\n');
  writeFileSync(join(refDestinationDir, 'refs.md'), [
    '[use][empty] and [use][multi-empty] and [use][valid]', '',
    '[empty]: <> "title"', 'Visible', '',
    '[multi-empty]:', '  <> "title"', '',
    '[valid]:', '  <./target.md> "title"',
  ].join('\n'));
  const refGate = spawnSync(process.execPath,
    [scriptPath, refDestinationDir, '--fail-on', 'empty-link-target'], { encoding: 'utf8' });
  eq(refGate.status, 1, 'explicit empty reference targets fail the empty-target gate');
  eq(JSON.parse(refGate.stdout).candidates.map((c) => [c.line, c.kind]), [
    [3, 'empty-link-target'], [6, 'empty-link-target'],
  ], 'empty same-line and multiline targets are reported on the definition line');

  const titledDir = join(tmp, 'inline-parenthesized-titles');
  mkdirSync(titledDir);
  writeFileSync(join(titledDir, 'page.md'), '# Page\n');
  writeFileSync(join(titledDir, 'image.png'), 'fixture');
  writeFileSync(join(titledDir, 'links.md'), [
    '[valid](./page.md (Title))', '![valid](./image.png (Image title))',
    '[missing](./missing.md (Title))', '![missing](./missing.png (Image title))',
    '[![badge](./missing-badge.png (Badge title))](./missing-outer.md (Outer title))',
    '[empty](<> (Title))',
  ].join('\n'));
  const titled = JSON.parse(runCli([titledDir]));
  eq(titled.candidates.map(({ line, kind }) => [line, kind]), [
    [3, 'broken-local-link'], [4, 'broken-local-image'], [5, 'broken-local-image'],
    [5, 'broken-local-link'], [6, 'empty-link-target'],
  ], 'parenthesized titles work for inline links, images and both badge targets');

  const mixedRefDir = join(tmp, 'mixed-reference');
  mkdirSync(join(mixedRefDir, 'assets'), { recursive: true });
  writeFileSync(join(mixedRefDir, 'image.png'), 'fixture');
  writeFileSync(join(mixedRefDir, 'refs.md'), [
    '[directory][d] ![directory image][d]', '[file][f] ![file image][f]', '',
    '[d]: ./assets/', '[f]: ./image.png',
  ].join('\n'));
  const mixedRef = spawnSync(process.execPath,
    [scriptPath, mixedRefDir, '--fail-on', 'broken-local-image'], { encoding: 'utf8' });
  eq(mixedRef.status, 1, 'a link use must not hide a broken image use of the same label');
  eq(JSON.parse(mixedRef.stdout).candidates.map(({ line, kind }) => [line, kind]),
    [[4, 'broken-local-image']], 'the directory is only invalid when used as an image');

  const refBoundaryDir = join(tmp, 'reference-boundaries');
  mkdirSync(refBoundaryDir);
  writeFileSync(join(refBoundaryDir, 'target.md'), '# Target\n');
  writeFileSync(join(refBoundaryDir, 'refs.md'), [
    '[quote][quoted] [list][listed] [next][next] [split][split] [separator][separator]', '',
    '> [quoted]:', '>   <./target.md> (title)', '',
    '- [listed]:', '  ./target.md "title"', '',
    '[split]:', '[next]: ./target.md', '',
    '> [outside]:', './target.md', '',
    '- [out-list]:', './target.md', '',
    '[separator]:', '---', '',
    '[ordinary text]:', 'A sentence with spaces.', '',
    '[flat]: ./target.md (title)', '',
    '[bad-flat]: ./target.md extra prose', '',
    '[flat][] and [bad-flat][] and [outside][] and [out-list][] and [ordinary text][]',
  ].join('\n'));
  const refBoundaryGate = spawnSync(process.execPath,
    [scriptPath, refBoundaryDir, '--fail-on', 'broken-local-link,empty-link-target'], { encoding: 'utf8' });
  eq(refBoundaryGate.status, 1, 'invalid definitions still trip the selected structural gate');
  eq(JSON.parse(refBoundaryGate.stdout).candidates.filter((c) => c.kind !== 'duplicate-link-target').map((c) => [c.line, c.kind]), [
    [9, 'empty-link-target'], [12, 'empty-link-target'], [15, 'empty-link-target'],
    [18, 'empty-link-target'], [21, 'empty-link-target'], [26, 'empty-link-target'],
  ], 'reference targets stop at block boundaries; continuation inside the same container supports titles');
  ok(JSON.parse(refBoundaryGate.stdout).candidates.some((c) => c.line === 26 && c.evidence.includes('no valid destination')),
    'malformed nonempty destinations explain why they are not resolved as a path');
  writeFileSync(join(refBoundaryDir, 'refs.md'), '[used][quoted]\n\n> [quoted]:\n> ./missing.md (title)\n');
  const missingQuoted = JSON.parse(runCli([refBoundaryDir]));
  eq(missingQuoted.candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [3, 'broken-local-link', 'relative link target not found: ./missing.md'],
  ], 'missing paths in valid continuations still report on the definition line');

  const refOrderDir = join(tmp, 'reference-precedence');
  mkdirSync(refOrderDir);
  for (const name of ['later.md', 'first.md']) writeFileSync(join(refOrderDir, name), '# ' + name + '\n');
  const refOrderFile = join(refOrderDir, 'refs.md');
  const scanRefOrder = () => spawnSync(process.execPath,
    [scriptPath, refOrderDir, '--fail-on', 'duplicate-link-target'], { encoding: 'utf8' });
  const uses = '[one][ref] [REF][] [three][Ref]\n\n';
  for (const first of ['[Ref]: <>', '[Ref]:\n  <> "title"']) {
    writeFileSync(refOrderFile, uses + first + '\n[ref]: ./later.md\n');
    const result = scanRefOrder();
    eq(result.status, 0, 'explicit empty destination is the effective first definition');
    eq(JSON.parse(result.stdout).candidates.map((c) => c.kind),
      ['empty-link-target', 'duplicate-reference-definition'], 'empty and duplicate definitions still produce their own candidates');
  }
  for (const [first, expected] of [
    ['[Ref]:', './later.md'], ['[Ref]: invalid trailing text', './later.md'], ['[Ref]: ./first.md', './first.md'],
  ]) {
    writeFileSync(refOrderFile, uses + first + '\n\n[ref]: ./later.md\n');
    const result = scanRefOrder();
    eq(result.status, 1, 'three actual references to a local destination fail the duplicate gate');
    eq(JSON.parse(result.stdout).candidates.filter((c) => c.kind === 'duplicate-link-target').map((c) => [c.line, c.evidence]),
      [[1, 'same link target appears 3 times in this file: ' + expected]], 'first syntactically valid definition determines the target');
  }

  // 引语围栏不能吞掉引语结束后的正文；setext 下划线不能跨越引语边界。
  const quoteDir = join(tmp, 'quote-boundaries');
  mkdirSync(quoteDir);
  writeFileSync(join(quoteDir, 'fence.md'), [
    '> ```md', '> TODO hidden', '', 'TODO visible', '',
    '> ```md', '> TODO still hidden', '> ```', '> TODO quoted',
  ].join('\n'));
  writeFileSync(join(quoteDir, 'setext.md'), [
    '> Not A Heading', '---', '', '[bad](#not-a-heading)', '',
    '> Earlier Quote', 'Real Heading', '===', '', '[good](#real-heading)',
  ].join('\n'));
  eq(JSON.parse(runCli([quoteDir])).candidates.map((c) => [c.file, c.line, c.kind]), [
    ['fence.md', 4, 'placeholder-marker'],
    ['fence.md', 9, 'placeholder-marker'],
    ['setext.md', 4, 'broken-anchor'],
  ], 'quote boundaries isolate fences and setext heading text');

  // 成对的反斜杠是字面反斜杠，不会转义其后的链接起始括号。
  const multiLinkDir = join(tmp, 'multiline-inline-links');
  mkdirSync(multiLinkDir);
  writeFileSync(join(multiLinkDir, 'valid.md'), '# Valid\n');
  writeFileSync(join(multiLinkDir, 'links.md'), [
    '[folded', 'label](./missing.md)', '',
    '[missing](', './other.md "title")', '',
    '[valid](', './valid.md', ')', '',
    '[suppressed]( <!-- pre-scan-ignore -->', './ignored.md)', '',
    '[split', '', 'label](./not-a-link.md)', '',
    '[before heading', '## Heading', 'label](./not-a-link.md)', '',
    '[broken](', './first.md) [another](./second.md)',
  ].join('\r\n'));
  const multi = JSON.parse(runCli([multiLinkDir]));
  eq(multi.candidates.map(({ line, kind }) => [line, kind]), [
    [1, 'broken-local-link'], [4, 'broken-local-link'], [22, 'broken-local-link'], [23, 'broken-local-link'],
  ], 'plain paragraph links preserve start lines and do not cross blocks');

  writeFileSync(join(multiLinkDir, 'links.md'), [
    '[angle](', '<./missing file.md>)', '',
    '[first', '-', 'text](./not-a-link.md)', '',
    '[second', '--', 'text](./not-a-link.md)', '',
    '[HTML', '<div>', 'text](./not-a-link.md)', '</div>',
  ].join('\n'));
  eq(JSON.parse(runCli([multiLinkDir])).candidates.map(({ line, evidence }) => [line, evidence]), [
    [1, 'relative link target not found: ./missing file.md'],
  ], 'angle destination continuation is accepted but setext and HTML boundaries are not crossed');

  const listFenceDir = join(tmp, 'list-fences');
  mkdirSync(listFenceDir);
  writeFileSync(join(listFenceDir, 'list.md'), [
    '1.  Item', '', '    ~~~md', '    [hidden](./hidden.md)', '    ~~~',
    '', '[visible](./outside.md)', '', '- ~~~md', '  [hidden](./hidden-again.md)',
    '', '- [sibling](./sibling.md)', '', '  [continuation](./continued.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([listFenceDir])).candidates.map(({ line, kind }) => [line, kind]),
    [[7, 'broken-local-link'], [12, 'broken-local-link'], [14, 'broken-local-link']],
    'list fence uses list indentation and ends at a sibling item');
  writeFileSync(join(listFenceDir, 'list.md'), [
    '> - ~~~md', '>   > literal quote', '>   - ~~~', '>   [hidden](./hidden.md)', '>   ~~~',
    '', '[visible](./after.md)', '', '~~~md', '- ~~~', '[hidden](./hidden-again.md)', '~~~', '', '[visible](./last.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([listFenceDir])).candidates.map(({ line, kind }) => [line, kind]),
    [[7, 'broken-local-link'], [14, 'broken-local-link']], 'literal quote and list markers inside a fence cannot close it');
  const parenEscapeDir = join(tmp, 'escaped-parenthesis-targets');
  mkdirSync(parenEscapeDir);
  writeFileSync(join(parenEscapeDir, 'open(draft.md'), '# Draft\n');
  writeFileSync(join(parenEscapeDir, 'links.md'), [
    '[existing](./open\\(draft.md)', '[missing](./close\\)draft.md)',
    '[![badge](./logo\\(small.svg)](./open\\(draft.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([parenEscapeDir])).candidates.map(({ line, kind, evidence }) => [line, kind, evidence]), [
    [2, 'broken-local-link', 'relative link target not found: ./close)draft.md'],
    [3, 'broken-local-image', 'relative image target not found: ./logo(small.svg'],
  ], 'escaped parentheses are literal in inline and badge destinations');

  const escapesDir = join(tmp, 'bracket-escape-parity');
  mkdirSync(escapesDir);
  writeFileSync(join(escapesDir, 'links.md'), [
    String.raw`\[literal](./ignored.md)`,
    String.raw`\\[link](./missing.md)`,
    String.raw`\\\[literal](./ignored.md)`,
    String.raw`\\\\[missing reference][unknown]`,
    String.raw`\\\[literal\]\[unknown\]`,
  ].join('\n'));
  const escapesGate = spawnSync(process.execPath,
    [scriptPath, escapesDir, '--fail-on', 'broken-local-link,undefined-reference-label'], { encoding: 'utf8' });
  eq(escapesGate.status, 1, 'links preceded by escaped backslashes still fail the gate');
  eq(JSON.parse(escapesGate.stdout).candidates.map((c) => [c.line, c.kind]), [
    [2, 'broken-local-link'], [4, 'undefined-reference-label'],
  ], 'only odd backslash runs escape an opening bracket');

  const htmlBoundaryDir = join(tmp, 'html-tag-boundaries');
  mkdirSync(htmlBoundaryDir);
  writeFileSync(join(htmlBoundaryDir, 'ok.md'), '# Existing target\n');
  writeFileSync(join(htmlBoundaryDir, 'examples.md'), [
    '<a title="x > y"',
    'href="./no-link.md">real link</a>',
    "<img title='x > y'",
    'src="./no-image.png">',
    '<source title="x > y"',
    'srcset="./no-source.png 2x">',
    '<a href="./ok.md" HREF="./ignored-duplicate.md">duplicate href</a>',
    '<img src="" SRC="./ignored-duplicate.png">',
    '<source srcset="data:image/png;base64,AAAA 1x" SRCSET="./ignored-srcset.png 2x">',
    `<span title="a > b <a href='./ignored-inner.md'>">label</span>`,
    '<span title="a > b',
    `<img src='./ignored-inner.png'>">label</span> <a href="./after-tag.md">after</a>`,
  ].join('\n'));
  const htmlBoundaryGate = spawnSync(process.execPath,
    [scriptPath, htmlBoundaryDir, '--fail-on', 'broken-local-link,broken-local-image'], { encoding: 'utf8' });
  eq(htmlBoundaryGate.status, 1, 'actual links after a quoted greater-than sign fail the gate');
  eq(JSON.parse(htmlBoundaryGate.stdout).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [1, 'broken-local-link', 'relative link target not found: ./no-link.md'],
    [3, 'broken-local-image', 'relative image target not found: ./no-image.png'],
    [5, 'broken-local-image', 'relative image target not found: ./no-source.png'],
    [12, 'broken-local-link', 'relative link target not found: ./after-tag.md'],
  ], 'recognize real tag boundaries, ignore attribute text and use only the first occurrence of an attribute');

  const anchorTagsDir = join(tmp, 'html-anchor-boundaries');
  mkdirSync(anchorTagsDir);
  writeFileSync(join(anchorTagsDir, 'target.md'), [
    '<span title="quoted > delimiter"', 'id="MiX&amp;Match" ID="ignored">visible</span>',
    '<a', "name='Legacy'>old</a>",
    '<span title="start of an attribute', "<a id='fake'>\">literal tag text</span>",
    '<span name="not-an-anchor"></span>',
    '<span id="" ID="empty-first"></span>',
    '<!-- <span id="commented"></span> -->',
    '~~~html', '<span id="fenced"></span>', '~~~',
    '', '[same file](#MiX%26Match)',
  ].join('\n'));
  const anchorLinksPath = join(anchorTagsDir, 'links.md');
  const validAnchorLinks = [
    '[id](./target.md#MiX%26Match)', '[name](./target.md#Legacy)',
    '<a href="./target.md#Legacy">HTML link</a>',
  ];
  writeFileSync(anchorLinksPath, validAnchorLinks.join('\n'));
  const anchorGate = () => spawnSync(process.execPath,
    [scriptPath, anchorTagsDir, '--fail-on', 'broken-anchor'], { encoding: 'utf8' });
  const validAnchors = anchorGate();
  eq(validAnchors.status, 0, 'multiline explicit anchors resolve in same-file and cross-file links');
  eq(JSON.parse(validAnchors.stdout).candidates, [], 'valid multiline anchor fixture has no candidates');
  const invalidAnchors = ['mix%26match', 'ignored', 'fake', 'not-an-anchor', 'empty-first', 'commented', 'fenced'];
  writeFileSync(anchorLinksPath, [...validAnchorLinks, ...invalidAnchors.map((id) => '[missing](./target.md#' + id + ')')].join('\n'));
  const invalidGate = anchorGate();
  eq(invalidGate.status, 1, 'false anchors remain invalid with the structural gate');
  eq(JSON.parse(invalidGate.stdout).candidates.map(({ file, line, kind, evidence }) => [file, line, kind, evidence]),
    invalidAnchors.map((id, i) => ['links.md', i + 4, 'broken-anchor', 'anchor #' + id + ' in "target.md" has no matching heading slug or explicit HTML anchor']),
    'anchor attributes are case-sensitive, use the first value and ignore non-rendered tags');

  // 徽章外层链接与其他链接形式共用重复计数；图片路径本身不计。
  const mixedMarkupDir = join(tmp, 'mixed-html-destinations');
  mkdirSync(mixedMarkupDir);
  writeFileSync(join(mixedMarkupDir, 'links.md'), [
    '[missing](<LICENSE>)',
    '<span title="[example](./not-a-target.md) [empty]()">[body](./body.md)</span>',
    '[title](./bad.md "<a href=\'./not-a-target.md\'>")',
  ].join('\n'));
  eq(JSON.parse(runCli([mixedMarkupDir])).candidates.map(({ line, kind, evidence }) => [line, kind, evidence]), [
    [1, 'broken-local-link', 'relative link target not found: LICENSE'],
    [2, 'broken-local-link', 'relative link target not found: ./body.md'],
    [3, 'broken-local-link', 'relative link target not found: ./bad.md'],
  ], 'angle destinations and Markdown body links remain visible without parsing attribute examples');
  writeFileSync(join(mixedMarkupDir, 'links.md'), [
    `<span title="<!-- literal">Label</span>`,
    '<a href="./a`b`.md">literal</a>',
    `<span title="start`,
    '[example]: ./not-a-target.md',
    `end">Text</span>`,
    '', '> <pre>', '> [hidden](./hidden.md)', '', '[after](./after.md)', '',
    'Use `code` [ordinary', 'link](./visible.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([mixedMarkupDir])).candidates.map(({ line, evidence }) => [line, evidence]), [
    [2, 'relative link target not found: ./a`b`.md'],
    [10, 'relative link target not found: ./after.md'],
    [12, 'relative link target not found: ./visible.md'],
  ], 'inline HTML delimiters, quoted definitions and container termination preserve normal links');

  const duplicateForms = join(tmp, 'duplicate-target-forms');
  mkdirSync(duplicateForms);
  writeFileSync(join(duplicateForms, 'guide.md'), '# Guide\n');
  writeFileSync(join(duplicateForms, 'links.md'), [
    '[inline](guide.md)', '<a href="./guide.md">HTML</a>', '[Guide]',
    '![Guide]', '[Guide] <!-- pre-scan-ignore -->', '[unresolved]', '',
    '[Guide]: ././guide.md', '',
    '[query](./guide.md?raw)', '[fragment](./guide.md#guide)', '[case](./GUIDE.md)',
  ].join('\n'));
  const forms = JSON.parse(runCli([duplicateForms])).candidates;
  eq(forms.map(({ line, kind, evidence }) => [line, kind, kind === 'duplicate-link-target' ? evidence : '']), [
    [1, 'duplicate-link-target', 'same link target appears 3 times in this file: guide.md'],
    [12, 'case-mismatch-link', ''],
  ], 'resolved shortcuts and leading ./ aliases count together without including images, suppression, query, fragment or casing variants');
  writeFileSync(join(duplicateForms, 'links.md'), [
    '[Guide] [Guide] [Guide] [undefined-shortcut]', '', '[Guide]: <>', '[Guide]: ./guide.md',
  ].join('\n'));
  eq(JSON.parse(runCli([duplicateForms])).candidates.map(({ kind }) => kind), ['empty-link-target', 'duplicate-reference-definition'],
    'the first empty definition prevents shortcuts from falling through to a later target');

  writeFileSync(join(duplicateForms, 'links.md'), [
    '<span title="[Guide]">x</span>', '<span title="[Guide]">[Guide]</span>',
    '<span title="begin', '[Guide]">x</span>', '[Guide]', '', '[Guide]: ./guide.md',
  ].join('\n'));
  eq(JSON.parse(runCli([duplicateForms])).candidates, [], 'HTML attribute text does not add shortcuts');
  writeFileSync(join(duplicateForms, 'links.md'), [
    '<span title="[Guide]">[Guide]</span>', '[Guide]', '[Guide]', '', '[Guide]: ./guide.md',
  ].join('\n'));
  eq(JSON.parse(runCli([duplicateForms])).candidates.map(({ line, evidence }) => [line, evidence]),
    [[1, 'same link target appears 3 times in this file: ./guide.md']], 'HTML-tagged body text is still eligible');
  const duplicateAliasBase = join(tmp, 'duplicate-alias.json');
  runCli([duplicateForms, '--write-baseline', duplicateAliasBase]);
  writeFileSync(join(duplicateForms, 'links.md'), '[one](guide.md) [two](./guide.md) [three](././guide.md)\n');
  const aliasGate = spawnSync(process.execPath, [scriptPath, duplicateForms, '--fail-on', 'duplicate-link-target',
    '--baseline', duplicateAliasBase], { encoding: 'utf8' });
  eq(aliasGate.status, 0, 'changed leading ./ diagnostic spelling preserves a known duplicate target');
  ok(aliasGate.stderr.includes('1 baselined candidate(s) ignored'), 'baseline notes count the unchanged duplicate');

  const badgeDir = join(tmp, 'badge-duplicates');
  mkdirSync(badgeDir);
  writeFileSync(join(badgeDir, 'target.md'), '# Target\n');
  writeFileSync(join(badgeDir, 'badge.svg'), '<svg/>');
  writeFileSync(join(badgeDir, 'links.md'), [
    '[![ignored](./badge.svg)](./target.md) <!-- pre-scan-ignore -->',
    '[![badge](./badge.svg)](./target.md)',
    '<a href="./target.md">HTML</a>',
    '[inline](./target.md)',
  ].join('\n'));
  eq(JSON.parse(runCli([badgeDir])).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [2, 'duplicate-link-target', 'same link target appears 3 times in this file: ./target.md'],
  ], 'outer badge link counts once and suppressed badge does not count');

  // HTML 注释在所有正文检测通路里都不可见；保留注释后的正文和原始行号。
  const commentDir = join(tmp, 'comment-prose');
  mkdirSync(commentDir);
  const longProse = 'A visible paragraph with enough meaningful words to exceed the eighty character duplicate detection threshold.';
  const commentFile = join(commentDir, 'visible.md');
  writeFileSync(commentFile, [
    '# Visible', '',
    '<!-- currently TODO -->',
    '<!--', 'recently FIXME', '--> soon TBD', '',
    '`<!--` currently TODO `-->`', '',
    '<!-- ' + longProse + ' -->', '',
    '<!--', longProse, '-->', '',
    longProse + ' <!-- first note -->', '',
    longProse + ' <!-- different note -->', '',
  ].join('\n'));
  const commentResult = JSON.parse(runCli([commentDir]));
  eq(commentResult.candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [6, 'placeholder-marker', 'TBD'],
    [6, 'stale-time-phrase', 'soon'],
    [8, 'placeholder-marker', 'TODO'],
    [8, 'stale-time-phrase', 'currently'],
    [18, 'duplicate-paragraph', paragraphEvidence(16, longProse)],
  ], 'hidden prose is ignored; visible prose after comments and literal comment delimiters in code remain checked');
  const commentGate = spawnSync(process.execPath, [scriptPath, commentDir, '--fail-on', 'placeholder-marker'], { encoding: 'utf8' });
  eq(commentGate.status, 1, 'visible placeholder still fails gate');
  const commentBaseline = join(tmp, 'comment-baseline.json');
  runCli([commentDir, '--write-baseline', commentBaseline]);
  eq(JSON.parse(readFileSync(commentBaseline, 'utf8')).entries.length, 5, 'baseline contains only visible candidates');
  const commentReport = join(tmp, 'comment-report.json');
  runCli([commentDir, '--report-out', commentReport]);
  eq(JSON.parse(readFileSync(commentReport, 'utf8')).findings.length, 5, 'report contains only visible candidates');
  writeFileSync(commentFile, '# Hidden Only\n\n<!-- currently TODO -->\n<!--\nrecently FIXME\n-->\n');
  const hiddenGate = spawnSync(process.execPath, [scriptPath, commentDir, '--fail-on', 'placeholder-marker,stale-time-phrase'], { encoding: 'utf8' });
  eq(hiddenGate.status, 0, 'hidden phrases cannot fail gate');
  eq(JSON.parse(hiddenGate.stdout).candidates, [], 'hidden-only document has no candidates');

  writeFileSync(commentFile, [
    '<!-- `hidden --> TODO `',
    '', '<!--', '`hidden --> FIXME `',
    '', '<!-- first --> <!--', '`hidden --> <!-- pre-scan-ignore --> TBD `',
    'TODO visible',
  ].join('\n'));
  eq(JSON.parse(runCli([commentDir])).candidates.map((c) => [c.line, c.kind, c.evidence]), [
    [1, 'placeholder-marker', 'TODO'],
    [4, 'placeholder-marker', 'FIXME'],
    [8, 'placeholder-marker', 'TODO'],
  ], 'backticks in HTML comments cannot hide their closing delimiter or visible prose');

  const similarityDir = join(tmp, 'comment-similarity');
  mkdirSync(similarityDir);
  const shared = Array.from({ length: 12 }, (_, i) => 'Shared content line ' + i);
  for (const name of ['a', 'b']) {
    writeFileSync(join(similarityDir, name + '.md'), '# ' + name + '\n\n<!--\n' + shared.join('\n') + '\n-->\n');
  }
  eq(JSON.parse(runCli([similarityDir])).candidates, [], 'shared hidden lines do not create near duplicates');
  for (const name of ['a', 'b']) {
    writeFileSync(join(similarityDir, name + '.md'), shared.map((line) => line + ' <!-- ' + name + ' -->').join('\n'));
  }
  const visibleSimilar = JSON.parse(runCli([similarityDir]));
  eq(visibleSimilar.candidates.map((c) => c.kind), ['near-duplicate-files'], 'different inline comments do not hide visible near duplicates');
  eq(JSON.parse(runCli([similarityDir, '--exact-near-duplicates'])), visibleSimilar, 'comment-aware prefix and exact similarity modes agree');
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
