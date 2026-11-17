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
  run('conflicting nested category enum', () => changeSchema((s) => {
    s.$defs.candidate.allOf[0].then.properties.category.enum = ['A'];
  }), 'allOf 映射结构');
  run('mapping annotations', () => changeSchema((s) => {
    const item = s.$defs.candidate.allOf[0];
    for (const node of [item, item.if, item.if.properties.kind, item.then, item.then.properties.category]) {
      Object.assign(node, { $comment: 'mapping note', description: 'mapping description', title: 'mapping title' });
    }
  }));
  const invalidMappings = [
    ['condition enum', (m) => { m.if.properties.kind.enum = ['other']; }],
    ['condition not', (m) => { m.if.not = {}; }],
    ['consequence not', (m) => { m.then.not = {}; }],
    ['condition ref', (m) => { m.if.$ref = '#/$defs/kind'; }],
    ['extra condition property', (m) => { m.if.properties.category = { const: 'A' }; }],
    ['extra consequence property', (m) => { m.then.properties.kind = { const: 'other' }; }],
    ['property map description is not annotation', (m) => { m.if.properties.description = 'invalid'; }],
    ['property map title is not annotation', (m) => { m.then.properties.title = 'invalid'; }],
    ['missing required', (m) => { delete m.if.required; }],
    ['empty required', (m) => { m.if.required = []; }],
    ['extra required', (m) => { m.if.required.push('category'); }],
    ['duplicate required', (m) => { m.if.required.push('kind'); }],
    ['wrong required', (m) => { m.if.required = ['category']; }],
    ['unexpected then required', (m) => { m.then.required = ['category']; }],
    ['else constraint', (m) => { m.else = false; }],
  ];
  for (const [name, mutate] of invalidMappings) {
    run(name, () => changeSchema((s) => mutate(s.$defs.candidate.allOf[0])), 'allOf');
  }
  for (const value of [null, false, 0, '', [], {}]) {
    for (const branch of ['if', 'then']) {
      run('malformed branch ' + branch + JSON.stringify(value), () => changeSchema((s) => {
        s.$defs.candidate.allOf[0][branch] = value;
      }), 'allOf 映射结构');
    }
  }
  for (const value of [null, false, 42, '', [], {}]) {
    for (const [branch, property] of [['if', 'kind'], ['then', 'category']]) {
      for (const leaf of [false, true]) {
        run('malformed mapping node ' + branch + '/' + leaf + JSON.stringify(value), () => changeSchema((s) => {
          const node = s.$defs.candidate.allOf[0][branch];
          if (leaf) node.properties[property] = value;
          else node.properties = value;
        }), 'allOf 映射结构');
      }
    }
  }
  for (const level of ['item', 'if', 'kind', 'then', 'category']) {
    run('non-string annotation ' + level, () => changeSchema((s) => {
      const item = s.$defs.candidate.allOf[0];
      const nodes = { item, if: item.if, kind: item.if.properties.kind, then: item.then, category: item.then.properties.category };
      nodes[level].description = false;
    }), 'allOf 映射结构');
  }
  run('duplicate mapping', () => changeSchema((s) => { s.$defs.candidate.allOf[1] = structuredClone(s.$defs.candidate.allOf[0]); }), '重复定义类别');
  run('unknown mapping', () => changeSchema((s) => { s.$defs.candidate.allOf[0].if.properties.kind.const = 'unknown'; }), 'allOf 多出 unknown kind');
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
  // 比较可复制模板和真实工作流，忽略空行及整行说明/可选注释。
  const configs = readFileSync(join(source, 'references/tool-configs.md'), 'utf8').replace(/\r\n/g, '\n');
  const workflowSection = configs.slice(configs.indexOf('## GitHub Actions'));
  const template = workflowSection.match(/~~~yaml\n([\s\S]*?)\n~~~/)?.[1];
  assert.ok(template, 'copyable CI template exists');
  const normalizeWorkflow = (text) => text.replace(/\r\n/g, '\n').split('\n')
    .filter((line) => line.trim() && !/^\s*#/.test(line)).join('\n');
  assert.equal(normalizeWorkflow(template), normalizeWorkflow(readFileSync(join(source, '.github/workflows/docs-qa.yml'), 'utf8')),
    'copyable CI template matches the real workflow, including release ref and all self-tests');
  scenarios++;
  console.log('check-docs self-test: OK (' + scenarios + ' scenarios)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
