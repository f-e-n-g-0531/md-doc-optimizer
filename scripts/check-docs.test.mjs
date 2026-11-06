#!/usr/bin/env node
// Zero-dependency regression tests; all mutations stay in a disposable fixture.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'check-docs-test-'));
const root = join(temp, 'md-doc-optimizer');
const schema = JSON.parse(readFileSync(join(source, 'references/pre-scan.schema.json'), 'utf8'));
const tree = 'md-doc-optimizer/\n├── scripts/\n│   ├── check-docs.mjs\n│   └── pre-scan.mjs\n├── references/\n│   ├── report.schema.json\n│   └── pre-scan.schema.json\n└── examples/\n    └── report.sample.json';
const write = (path, value) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), value);
};
const readme = (listing = tree, links = '') => write('README.md', '## 目录结构\n\n~~~text\n' + listing + '\n~~~\n' + links);
let scenarios = 0;
function run(name, mutate = () => {}, diagnostic) {
  rmSync(root, { recursive: true, force: true });
  write('scripts/check-docs.mjs', readFileSync(join(source, 'scripts/check-docs.mjs')));
  write('scripts/pre-scan.mjs', readFileSync(join(source, 'scripts/pre-scan.mjs')));
  write('SKILL.md', '---\nname: md-doc-optimizer\nmetadata:\n  version: "1.0.0"\n---\nreferences/report.schema.json\nreferences/pre-scan.schema.json\n');
  write('CHANGELOG.md', '## 1.0.0\n');
  write('references/report.schema.json', '{}');
  write('references/pre-scan.schema.json', JSON.stringify(schema));
  write('examples/report.sample.json', '{}');
  readme();
  mutate();
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-docs.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, diagnostic ? 1 : 0, name + ': ' + result.stderr);
  if (diagnostic) {
    assert.match(result.stderr, /check-docs: \d+ 个问题/, name + ': controlled diagnostic');
    assert.ok(result.stderr.includes(diagnostic), name + ': ' + result.stderr);
    assert.doesNotMatch(result.stderr, /TypeError|at file:/, name + ': no uncaught exception');
  }
  scenarios++;
}
const changeSchema = (mutate) => {
  const copy = structuredClone(schema);
  mutate(copy);
  write('references/pre-scan.schema.json', JSON.stringify(copy));
};
try {
  run('valid');
  run('invalid JSON', () => write('references/pre-scan.schema.json', '{'), '不是合法 JSON');
  run('missing schema', () => rmSync(join(root, 'references/pre-scan.schema.json')), '缺失文件');
  for (const value of [null, false, 0, '', [], {}]) {
    run('invalid schema shape ' + JSON.stringify(value), () => write('references/pre-scan.schema.json', JSON.stringify(value)), '缺少 $defs.kind 或 $defs.candidate');
  }
  for (const value of [null, false, 42, [], {}]) {
    run('malformed allOf ' + JSON.stringify(value), () => changeSchema((s) => { s.$defs.candidate.allOf[0] = value; }), 'allOf 条目');
  }
  run('duplicate enum', () => changeSchema((s) => s.$defs.kind.enum.push(s.$defs.kind.enum[0])), 'enum 有重复项');
  run('wrong category', () => changeSchema((s) => { s.$defs.candidate.allOf[0].then.properties.category.const = 'C'; }), '类别不一致');
  run('extra kind constraint', () => changeSchema((s) => { s.$defs.candidate.properties.kind.enum = []; }), '必须且只能引用');
  run('basename collision', () => write('other/report.sample.json', '{}'), 'README 目录结构未列出: other/report.sample.json');
  run('substring collision', () => write('examples/sample.json', '{}'), 'README 目录结构未列出: examples/sample.json');
  run('combined listing', () => readme(tree + '\n├── LICENSE / CHANGELOG.md'));
  const parenTree = tree + '\n├── faq(1).md';
  run('parenthesized link target', () => {
    readme(parenTree, '[faq](./faq(1).md)');
    write('faq(1).md', '# FAQ\n');
  });
  run('missing parenthesized link target', () => {
    readme(parenTree, '[bad](./no(1).md)');
  }, 'README 本地链接失效: no(1).md');
  console.log('check-docs self-test: OK (' + scenarios + ' scenarios)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
