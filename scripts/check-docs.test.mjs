#!/usr/bin/env node
// Zero-dependency regression tests; all mutations stay in a disposable fixture.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'check-docs-test-'));
const root = join(temp, 'md-doc-optimizer');
const schema = JSON.parse(readFileSync(join(source, 'references/pre-scan.schema.json'), 'utf8'));
const tree = 'md-doc-optimizer/\n├── scripts/\n│   ├── check-docs.mjs\n│   ├── pre-scan.mjs\n│   └── skill-version.mjs\n├── references/\n│   ├── report.schema.json\n│   └── pre-scan.schema.json\n└── examples/\n    └── report.sample.json';
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
  write('scripts/skill-version.mjs', readFileSync(join(source, 'scripts/skill-version.mjs')));
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
  run('invalid Markdown bytes', () => {
    readme(tree, '\nVisible: ');
    const path = join(root, 'README.md');
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0xc3, 0x28])]));
  }, 'README.md 不是有效 UTF-8');
  run('invalid JSON string bytes', () => {
    write('examples/report.sample.json', Buffer.concat([Buffer.from('{"note":"'), Buffer.from([0xff]), Buffer.from('"}')]));
  }, 'examples/report.sample.json 不是有效 UTF-8');
  run('Markdown BOM and literal replacement character remain valid', () => {
    readme(tree, '\n原文字符 � 😀\n');
    const path = join(root, 'README.md');
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(path)]));
  });
  run('README path is a directory', () => {
    rmSync(join(root, 'README.md'));
    mkdirSync(join(root, 'README.md'));
  }, '无法读取文件: README.md');
  const treeBlock = (marker, listing = tree, close = marker) =>
    ['## 目录结构', '', marker + 'text', listing, close].join('\n');
  run('backtick tree fence with tilde text', () => {
    write('README.md', treeBlock('```', tree.replace('scripts/', 'scripts/ # literal ~~~ text')));
  });
  run('commented tree does not shadow visible tree', () => {
    write('README.md', '<!--\n' + treeBlock('~~~', '├── removed.md') + '\n-->\n\n' + treeBlock('~~~'));
  });
  run('tree example in outer fence does not shadow visible tree', () => {
    write('README.md', '~~~~md\n' + treeBlock('~~~', '├── removed.md') + '\n~~~~\n\n' + treeBlock('~~~'));
  });
  run('commented tree alone is not sufficient', () => {
    write('README.md', '<!--\n' + treeBlock('~~~') + '\n-->');
  }, '找不到「目录结构」围栏块');
  run('tree requires a closing fence of sufficient length', () => {
    write('README.md', treeBlock('~~~~', tree, '~~~'));
  }, '找不到「目录结构」围栏块');
  run('hidden changelog versions', () => write('CHANGELOG.md', [
    '\uFEFF<!--', '## 9.0.0', '-->', '', '~~~md', '## 9.1.0', '~~~', '  ## 1.0.0', '',
  ].join('\r\n')));
  run('only hidden changelog versions', () => write('CHANGELOG.md', '~~~md\n## 1.0.0\n'), '找不到版本标题');
  for (const body of ['other:\n  version: "1.0.0"', 'metadata:\n  nested:\n    version: "1.0.0"']) {
    run('version outside direct metadata children: ' + body, () => {
      write('SKILL.md', '---\nname: md-doc-optimizer\n' + body + '\n---\n' +
        'references/report.schema.json\nreferences/pre-scan.schema.json\n');
    }, '缺少 metadata.version');
  }
  for (const duplicate of ['metadata:\n  version: "9.0.0"', 'metadata: {version: "9.0.0"}', '"metadata": {}', "'metadata': null", 'metadata : {}']) {
    run('duplicate top-level metadata: ' + duplicate, () => {
      write('SKILL.md', '---\nname: md-doc-optimizer\nmetadata:\n  version: "1.0.0"\n' + duplicate + '\n---\n' +
        'references/report.schema.json\nreferences/pre-scan.schema.json\n');
    }, '缺少 metadata.version');
  }
  run('nested metadata does not conflict', () => {
    write('SKILL.md', '---\nname: md-doc-optimizer\nother:\n  metadata: {}\nmetadata:\n  version: "1.0.0"\n---\n' +
      'references/report.schema.json\nreferences/pre-scan.schema.json\n');
  });
  for (const duplicate of ['"version": "9.0.0"', "'version': null", 'version : "1.0.0"']) {
    for (const reverse of [false, true]) {
      run('duplicate direct version: ' + duplicate + ', reverse=' + reverse, () => {
        const versions = ['version: "1.0.0"', duplicate];
        if (reverse) versions.reverse();
        write('SKILL.md', '---\nname: md-doc-optimizer\nmetadata:\n  ' + versions.join('\n  ') + '\n---\n' +
          'references/report.schema.json\nreferences/pre-scan.schema.json\n');
      }, '缺少 metadata.version');
    }
  }
  run('nested version does not conflict with direct version', () => {
    write('SKILL.md', '---\nname: md-doc-optimizer\nmetadata:\n  nested:\n    "version": "9.0.0"\n  version: "1.0.0"\n---\n' +
      'references/report.schema.json\nreferences/pre-scan.schema.json\n');
  });
  for (const suffix of ['-rc.1', '+build.1', '.1']) {
    run('different latest changelog version ' + suffix, () => {
      write('CHANGELOG.md', '## 1.0.0' + suffix + '\n\n## 1.0.0\n');
    }, '版本不一致');
  }
  run('list heading cannot shadow the top-level release version', () => {
    write('CHANGELOG.md', '- Example heading\n\n  ## 9.0.0\n\n ## 1.0.0\n');
  });
  run('generic HTML and nested lists cannot shadow the current version', () => {
    write('CHANGELOG.md', '<div>\n## 8.0.0\n</div>\n\n- Example\n  - nested\n  ## 9.0.0\n\n## 1.0.0\n');
  });
  run('raw HTML cannot shadow the current version', () => {
    write('CHANGELOG.md', '<pre>\n## 9.0.0\n</pre>\n\n## 1.0.0\n');
  });
  run('an inline comment is not part of the version token', () => {
    write('CHANGELOG.md', '## 1.0.0<!-- note -->\n');
  });
  run('category extraction is independent of source quoting and line endings', () => {
    const script = readFileSync(join(root, 'scripts/pre-scan.mjs'), 'utf8');
    write('scripts/pre-scan.mjs', script.replace("'broken-local-link': 'B'", '"broken-local-link": "B"').replace(/\r?\n/g, '\r\n'));
  });
  run('invalid JSON', () => write('references/pre-scan.schema.json', '{'), '不是合法 JSON');
  run('missing schema', () => rmSync(join(root, 'references/pre-scan.schema.json')), '缺失文件');
  for (const value of [null, false, 0, '', [], {}]) {
    run('invalid schema shape ' + JSON.stringify(value), () => write('references/pre-scan.schema.json', JSON.stringify(value)), '缺少 $defs.kind 或 $defs.candidate');
  }
  for (const value of [null, false, 42, [], {}]) {
    run('malformed allOf ' + JSON.stringify(value), () => changeSchema((s) => { s.$defs.candidate.allOf[0] = value; }), 'allOf 条目');
  }
  run('candidate category enum must include every scanner category', () => {
    changeSchema((s) => { s.$defs.candidate.properties.category.enum = ['B']; });
  }, 'candidate.category 枚举必须匹配 CATEGORY');
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
  run('missing nested README', () => write('examples/README.md', '# Example\n'), 'README 目录结构未列出: examples/README.md');
  run('missing non-Markdown file', () => write('examples/notes.txt', 'fixture'), 'README 目录结构未列出: examples/notes.txt');
  run('stale directory tree entry', () => readme(tree + '\n├── removed.md'), 'README 目录结构列出了不存在的文件: removed.md');
  run('stale directory entry', () => readme(tree + '\n├── removed/'), 'README 目录结构列出了不存在的目录: removed');
  run('file shown as directory', () => {
    write('LICENSE', 'fixture');
    readme(tree + '\n├── LICENSE/');
  }, 'README 目录结构列出了不存在的目录: LICENSE');
  run('orphan indentation cannot promote an entry to root', () => {
    write('LICENSE', 'fixture');
    readme(tree.replace('├── scripts/', '│   ├── LICENSE\n├── scripts/'));
  }, 'README 目录结构层级无效');
  run('duplicate leaf entries are reported', () => {
    readme(tree.replace('│   ├── pre-scan.mjs', '│   ├── pre-scan.mjs / pre-scan.mjs'));
  }, 'README 目录结构重复列出: scripts/pre-scan.mjs');
  run('duplicate directory entries are reported', () => {
    readme(tree + '\n├── scripts/');
  }, 'README 目录结构重复列出: scripts');
  run('existing empty directory can be documented', () => {
    mkdirSync(join(root, 'empty'));
    readme(tree + '\n├── empty/');
  });
  run('combined listing', () => {
    write('LICENSE', 'fixture');
    readme(tree + '\n├── LICENSE / CHANGELOG.md');
  });
  // Windows 用 junction，避免测试依赖创建目录符号链接的特权。
  const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
  const sibling = join(temp, 'external');
  mkdirSync(sibling);
  writeFileSync(join(sibling, 'not-in-project.md'), '# Outside\n');
  run('directory link is counted without following its contents', () => {
    symlinkSync(sibling, join(root, 'external-link'), directoryLink);
    readme(tree + '\n├── external-link');
  });
  run('unlisted directory link is reported by its own path', () => {
    symlinkSync(sibling, join(root, 'external-link'), directoryLink);
  }, 'README 目录结构未列出: external-link\n');
  run('directory link back to repository root is not traversed', () => {
    symlinkSync(root, join(root, 'self-link'), directoryLink);
    readme(tree + '\n├── self-link');
  });
  const parenTree = tree + '\n├── faq(1).md';
  run('parenthesized link target', () => {
    readme(parenTree, '[faq](./faq(1).md)');
    write('faq(1).md', '# FAQ\n');
  });
  run('missing parenthesized link target', () => {
    readme(tree, '[bad](./no(1).md)');
  }, 'README 本地链接失效: no(1).md');
  run('README example links are not targets', () => readme(tree, [
    '~~~md', '[example](./no-fenced.md)', '~~~', '',
    '`[example](./no-code.md)`', '', '<!-- [example](./no-comment.md) -->',
  ].join('\n')));
  run('encoded and quoted README targets', () => readme(tree, [
    '[encoded](./references/%72eport.schema.json)',
    '[query and fragment](./references/report.schema.json?view=raw#schema)',
    '[title](<./references/report.schema.json> "Schema")',
  ].join('\n')));
  run('README checks a plain multiline inline target', () => {
    readme(tree, '[broken](\n./missing-multi.md)');
  }, 'README 本地链接失效: missing-multi.md');
  run('README ignores Markdown examples in HTML attributes', () => {
    readme(tree, '<span title="[example](./not-a-target.md)">Text</span>');
  });
  run('README image cannot point to a directory', () => {
    readme(tree, '![invalid](./references/)');
  }, 'README 本地链接失效: references/');
  run('README file path cannot have a directory suffix', () => {
    readme(tree, '[invalid](./references/report.schema.json/)');
  }, 'README 本地链接失效: references/report.schema.json/');
  run('README uses actual casing', () => {
    readme(tree, '[invalid](./REFERENCES/report.schema.json)');
  }, 'case differs');
  run('missing README target with a parenthesized title', () => {
    readme(tree, '[broken](./no-title.md (example title))');
  }, 'README 本地链接失效: no-title.md');
  run('missing README target with title', () => {
    readme(tree, '[broken](./no-title.md "example title")');
  }, 'README 本地链接失效: no-title.md');
  run('README badges validate the outer target', () => {
    readme(tree, '[![badge](https://example.invalid/badge.svg)](./no-badge-target.md)');
  }, 'README 本地链接失效: no-badge-target.md');
  run('README candidate suppression does not disable consistency checks', () => {
    readme(tree, '[broken](./no-suppressed.md) <!-- pre-scan-ignore -->');
  }, 'README 本地链接失效: no-suppressed.md');
  // 比较可复制模板和真实工作流，忽略空行及整行说明/可选注释。
  const configs = readFileSync(join(source, 'references/tool-configs.md'), 'utf8').replace(/\r\n/g, '\n');
  const workflowSection = configs.slice(configs.indexOf('## GitHub Actions'));
  const template = workflowSection.match(/~~~yaml\n([\s\S]*?)\n~~~/)?.[1];
  assert.ok(template, 'copyable CI template exists');
  const normalizeWorkflow = (text) => text.replace(/\r\n/g, '\n').split('\n')
    .filter((line) => line.trim() && !/^\s*#/.test(line)).join('\n');
  const qa = normalizeWorkflow(readFileSync(join(source, '.github/workflows/docs-qa.yml'), 'utf8'));
  assert.equal(normalizeWorkflow(template), qa,
    'copyable CI template matches the real workflow, including release ref and all self-tests');
  scenarios++;
  const release = normalizeWorkflow(readFileSync(join(source, '.github/workflows/release.yml'), 'utf8'));
  assert.match(qa, /legacy_missing_self_tests:\n[^\n]*\n        required: false\n        type: boolean\n        default: false/);
  for (const scriptName of ['check-docs.test.mjs', 'release-target.test.mjs']) {
    assert.ok(qa.includes("if: ${{ !inputs.legacy_missing_self_tests || hashFiles('scripts/" + scriptName +
      "') != '' }}\n        run: node scripts/" + scriptName), 'regular QA requires ' + scriptName + ' even if missing');
  }
  assert.ok(release.includes("legacy_missing_self_tests: ${{ needs.resolve.outputs.version == 'v1.17.0' }}"));
  assert.match(qa, /legacy_missing_application_tests:\n[^\n]*\n        required: false\n        type: boolean\n        default: false/);
  assert.ok(qa.includes('!inputs.legacy_missing_application_tests'));
  const applicationException = release.split('\n').find((line) => line.includes('legacy_missing_application_tests:'));
  assert.deepEqual(applicationException?.match(/v\d+\.\d+\.\d+/g), ['v1.17.0', 'v1.18.0', 'v1.18.1']);
  const scanStep = qa.indexOf('id: pre_scan');
  const retained = qa.indexOf('name: retain failed pre-scan outputs');
  assert.ok(scanStep >= 0 && scanStep < retained, 'the artifact step follows the named pre-scan step');
  const artifact = qa.slice(retained, qa.indexOf('name: validate report schema', retained));
  assert.ok(artifact.includes("failure() && steps.pre_scan.outcome == 'failure'"));
  assert.ok(artifact.includes('actions/upload-artifact@v4'));
  for (const name of ['pre-scan-out.json', 'pre-scan-report.json']) {
    assert.ok(artifact.includes('/' + name) && qa.slice(scanStep, retained).includes('/' + name));
  }
  scenarios++;
  scenarios++;
  scenarios++;
  console.log('check-docs self-test: OK (' + scenarios + ' scenarios)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
