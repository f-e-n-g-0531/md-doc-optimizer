#!/usr/bin/env node
// 仓库自洽检查：版本号、引用关系、README 目录树必须跟实际文件同步。
// 运行：node scripts/check-docs.mjs（CI 的 docs-qa 工作流会跑）。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const rel = (p) => relative(root, p).split('\\').join('/');
const abs = (p) => join(root, p);

function read(relPath) {
  if (!existsSync(abs(relPath))) {
    errors.push(`缺失文件: ${relPath}`);
    return '';
  }
  return readFileSync(abs(relPath), 'utf8');
}

// 1) SKILL.md frontmatter 的 name/version 与实际目录、CHANGELOG 一致
const skill = read('SKILL.md');
const fm = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fm) {
  errors.push('SKILL.md 缺少 frontmatter');
} else {
  const name = fm[1].match(/^name:\s*(\S+)/m);
  const version = fm[1].match(/^\s+version:\s*"([^"]+)"/m);
  if (!name) {
    errors.push('SKILL.md frontmatter 缺少 name');
  } else if (name[1] !== basename(root)) {
    errors.push(`SKILL.md name（${name[1]}）与目录名（${basename(root)}）不一致`);
  }
  if (!version) {
    errors.push('SKILL.md frontmatter 缺少 metadata.version');
  } else {
    const changelog = read('CHANGELOG.md');
    const latest = changelog.match(/^##\s+(\d+\.\d+\.\d+)/m);
    if (!latest) {
      errors.push('CHANGELOG.md 找不到版本标题（形如 ## 1.4.0）');
    } else if (latest[1] !== version[1]) {
      errors.push(`版本不一致: SKILL.md ${version[1]} vs CHANGELOG.md ${latest[1]}`);
    }
  }
}

// 2) SKILL.md 引用的文件必须存在
const referenced = new Set();
for (const m of skill.matchAll(/references\/[A-Za-z0-9._-]+/g)) referenced.add(m[0]);
for (const r of referenced) {
  if (!existsSync(abs(r))) errors.push(`SKILL.md 引用了不存在的文件: ${r}`);
}

// 3) references 下的规则文件与 schema 必须能被 SKILL.md 引用（保证可发现）
const mustReference = [];
const refDir = abs('references');
if (existsSync(refDir)) {
  for (const f of readdirSync(refDir)) {
    if (f.endsWith('.md')) mustReference.push(`references/${f}`);
  }
}
mustReference.push('references/report.schema.json');
for (const r of mustReference) {
  if (!skill.includes(r)) errors.push(`${r} 未被 SKILL.md 引用`);
}

// 4) README 目录结构必须覆盖仓库文件（检查「目录结构」围栏块内的文件名，忽略 .git 与 .gitignore）
const readme = read('README.md').replace(/\r\n/g, '\n');
const treeMatch = readme.match(/##\s*目录结构[^\n]*\n+~~~\w*\n([\s\S]*?)~~~/);
const tree = treeMatch ? treeMatch[1] : readme;
if (!treeMatch) errors.push('README.md 找不到「目录结构」围栏块');
const ignore = new Set(['.git', '.gitignore', 'node_modules']);
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (ignore.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(rel(p));
  }
  return out;
}
for (const f of walk(root)) {
  if (f.endsWith('README.md') || f.endsWith('SKILL.md') || f.endsWith('LICENSE') || f.endsWith('CHANGELOG.md')) continue;
  const base = basename(f);
  if (!tree.includes(base)) errors.push(`README 目录结构未列出: ${f}`);
}

// 5) README 的本地相对链接必须存在
for (const m of readme.matchAll(/\]\(\.\/([^)#\s]+)/g)) {
  if (!existsSync(abs(m[1]))) errors.push(`README 本地链接失效: ${m[1]}`);
}

// 6) 报告 schema 与示例必须是合法 JSON
for (const p of ['references/report.schema.json', 'examples/report.sample.json']) {
  try {
    JSON.parse(read(p));
  } catch (e) {
    errors.push(`${p} 不是合法 JSON: ${e.message}`);
  }
}

if (errors.length > 0) {
  console.error(`check-docs: ${errors.length} 个问题`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`check-docs: OK（${referenced.size} 个引用、${mustReference.length} 个 references 文件、README 与仓库文件同步）`);
