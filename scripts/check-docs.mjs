#!/usr/bin/env node
// 仓库自洽检查：版本号、引用关系、README 目录树必须跟实际文件同步。
// 运行：node scripts/check-docs.mjs（CI 的 docs-qa 工作流会跑）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillFrontmatter, metadataVersion, latestChangelogVersion } from './skill-version.mjs';
import { CATEGORY, decodeUtf8, fencedSectionBody, inlineMarkdownTargetsIn, inspectLocalPath, splitLinkTarget } from './pre-scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const rel = (p) => relative(root, p).split(sep).join('/');
const abs = (p) => join(root, p);

function read(relPath) {
  let bytes;
  try {
    bytes = readFileSync(abs(relPath));
  } catch (err) {
    errors.push(err.code === 'ENOENT' ? '缺失文件: ' + relPath : '无法读取文件: ' + relPath + ' (' + err.message + ')');
    return undefined;
  }
  try {
    return decodeUtf8(bytes);
  } catch (err) {
    errors.push(relPath + ' 不是有效 UTF-8');
    return undefined;
  }
}

// 1) SKILL.md frontmatter 的 name/version 与实际目录、CHANGELOG 一致
const skill = read('SKILL.md');
const fm = skill === undefined ? undefined : skillFrontmatter(skill);
if (!fm) {
  if (skill !== undefined) errors.push('SKILL.md 缺少 frontmatter');
} else {
  const name = fm.match(/^name:\s*(\S+)/m);
  const version = metadataVersion(fm);
  if (!name) {
    errors.push('SKILL.md frontmatter 缺少 name');
  } else if (name[1] !== basename(root)) {
    errors.push(`SKILL.md name（${name[1]}）与目录名（${basename(root)}）不一致`);
  }
  if (!version) {
    errors.push('SKILL.md frontmatter 缺少 metadata.version');
  } else {
    const changelog = read('CHANGELOG.md');
    if (changelog !== undefined) {
      const latest = latestChangelogVersion(changelog);
      if (!latest) {
        errors.push('CHANGELOG.md 找不到版本标题（形如 ## 1.4.0）');
      } else if (latest !== version) {
        errors.push(`版本不一致: SKILL.md ${version} vs CHANGELOG.md ${latest}`);
      }
    }
  }
}

// 2) SKILL.md 引用的文件必须存在
const referenced = new Set();
for (const m of (skill ?? '').matchAll(/references\/[A-Za-z0-9._-]+/g)) referenced.add(m[0]);
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
mustReference.push('references/pre-scan.schema.json');
for (const r of mustReference) {
  if (skill !== undefined && !skill.includes(r)) errors.push(`${r} 未被 SKILL.md 引用`);
}

// 4) README 目录结构必须覆盖仓库文件（按层级还原完整相对路径）
const readme = read('README.md');
const tree = readme === undefined ? undefined : fencedSectionBody(readme, '目录结构');
if (readme !== undefined && tree === undefined) errors.push('README.md 找不到「目录结构」围栏块');
const listedFiles = new Set();
const listedDirs = new Set();
const parents = [];
function recordTreeEntry(path, entries) {
  if (listedFiles.has(path) || listedDirs.has(path)) errors.push('README 目录结构重复列出: ' + path);
  entries.add(path);
}
for (const line of (tree ?? '').split('\n')) {
  const entry = line.match(/^((?:│   |    )*)[├└]──\s+(.+?)(?:\s+#.*)?$/);
  if (!entry) continue;
  const depth = entry[1].length / 4;
  if (depth > parents.length) {
    errors.push('README 目录结构层级无效: ' + line.trim());
    continue;
  }
  const name = entry[2].trim();
  parents.length = depth;
  const prefix = parents.length ? parents.join('/') + '/' : '';
  if (name.endsWith('/')) {
    const dir = name.slice(0, -1);
    recordTreeEntry(prefix + dir, listedDirs);
    parents.push(dir);
  } else {
    for (const file of name.split(/\s+\/\s+/)) recordTreeEntry(prefix + file, listedFiles);
  }
}
const ignore = new Set(['.git', '.gitignore', 'node_modules']);
const actualFiles = new Set();
const actualDirs = new Set();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const p = join(dir, entry.name);
    // 目录链接（含 Windows junction）本身是条目，不进入它的目标。
    if (entry.isDirectory()) {
      actualDirs.add(rel(p));
      walk(p);
    } else {
      actualFiles.add(rel(p));
    }
  }
}
if (tree !== undefined) walk(root);
const optionalRootEntries = new Set(['README.md', 'SKILL.md', 'LICENSE', 'CHANGELOG.md']);
for (const f of actualFiles) {
  if (!optionalRootEntries.has(f) && !listedFiles.has(f)) errors.push('README 目录结构未列出: ' + f);
}
for (const f of listedFiles) {
  if (!actualFiles.has(f)) errors.push('README 目录结构列出了不存在的文件: ' + f);
}
for (const d of listedDirs) {
  if (!actualDirs.has(d)) errors.push('README 目录结构列出了不存在的目录: ' + d);
}

// 5) README 的 ./ 内联目标与预扫共用磁盘解析；锚点及引用另行核对。
const readmeTargetStats = new Map();
for (const { target, image } of inlineMarkdownTargetsIn(readme ?? '')) {
  if (!target.startsWith('./')) continue;
  const { pathPart, decodedPath } = splitLinkTarget(target);
  const result = inspectLocalPath(abs(decodedPath), decodedPath, image, readmeTargetStats);
  const diagnostic = 'README 本地链接失效: ' + pathPart.slice(2);
  if (result.error) errors.push(diagnostic + ' (' + result.error + ')');
  else if (result.mismatch) errors.push(diagnostic + ' (case differs: ' + result.mismatch.linked + ' -> ' + result.mismatch.disk + ')');
}

// 6) schema 与示例必须是合法 JSON；保留解析结果，供契约校验复用
const parsedJson = new Map();
for (const p of ['references/report.schema.json', 'references/pre-scan.schema.json', 'examples/report.sample.json']) {
  const content = read(p);
  if (content === undefined) continue;
  try {
    parsedJson.set(p, JSON.parse(content));
  } catch (e) {
    errors.push(`${p} 不是合法 JSON: ${e.message}`);
  }
}

// 7) 预扫 schema 的 kind 枚举与类别映射必须与 scripts/pre-scan.mjs 的 CATEGORY 一致
{
  const scriptKinds = new Map(Object.entries(CATEGORY));
  const schemaPath = 'references/pre-scan.schema.json';
  const preScanSchema = parsedJson.get(schemaPath);
  const def = preScanSchema && preScanSchema.$defs && preScanSchema.$defs.candidate;
  const kindDef = preScanSchema && preScanSchema.$defs && preScanSchema.$defs.kind;
  const byKind = preScanSchema && preScanSchema.properties && preScanSchema.properties.summary &&
    preScanSchema.properties.summary.properties && preScanSchema.properties.summary.properties.by_kind;
  if (scriptKinds.size === 0) errors.push('scripts/pre-scan.mjs 的 CATEGORY 为空');
  if (!def || !kindDef) {
    if (parsedJson.has(schemaPath)) errors.push('references/pre-scan.schema.json 缺少 $defs.kind 或 $defs.candidate');
  } else {
    // kind 枚举只允许在 $defs.kind 定义一次；candidate.kind 与 summary.by_kind.propertyNames 必须「只」引用它，
    // 旁挂 enum / 重复或冲突的 allOf 映射都会让 check-docs 通过而 ajv 拒绝，因此这里做严格结构校验。
    const isOnlyKindRef = (value) => Boolean(value) && typeof value === 'object' &&
      Object.keys(value).length === 1 && value.$ref === '#/$defs/kind';
    if (!def.properties || !isOnlyKindRef(def.properties.kind)) {
      errors.push('pre-scan schema 的 candidate.kind 必须且只能引用 #/$defs/kind');
    }
    if (!byKind || !isOnlyKindRef(byKind.propertyNames)) {
      errors.push('pre-scan schema 的 summary.by_kind.propertyNames 必须且只能引用 #/$defs/kind');
    }
    const enumList = Array.isArray(kindDef.enum) ? kindDef.enum : [];
    const enumKinds = new Set(enumList);
    if (enumKinds.size !== enumList.length) errors.push('pre-scan schema 的 $defs.kind.enum 有重复项');
    const allOf = Array.isArray(def.allOf) ? def.allOf : [];
    const mappedKinds = new Map();
    const annotations = new Set(['$comment', 'description', 'title']);
    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    // 只接受本仓库的纯 kind -> category 映射；不能仅抽取 const 而忽略旁挂的冲突约束。
    const hasShape = (value, required) => isObject(value) &&
      required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) => required.includes(key) ||
        (annotations.has(key) && typeof value[key] === 'string'));
    const categorySchema = def.properties?.category;
    const categories = [...new Set(scriptKinds.values())].sort();
    if (!hasShape(categorySchema, ['enum']) || !Array.isArray(categorySchema.enum) ||
        JSON.stringify([...categorySchema.enum].sort()) !== JSON.stringify(categories)) {
      errors.push('pre-scan schema 的 candidate.category 枚举必须匹配 CATEGORY');
    }
    const isMappingBranch = (branch, property, conditional) => {
      if (!hasShape(branch, conditional ? ['properties', 'required'] : ['properties'])) return false;
      const properties = branch.properties;
      if (!isObject(properties) || Object.keys(properties).length !== 1 || !Object.hasOwn(properties, property)) return false;
      if (!hasShape(properties[property], ['const'])) return false;
      return !conditional || (Array.isArray(branch.required) && branch.required.length === 1 && branch.required[0] === property);
    };
    const allOfKeys = new Set(['if', 'then', ...annotations]);
    for (const item of allOf) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push('pre-scan schema 的 allOf 条目必须是包含 if/then 的对象');
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(item, 'if') || !Object.prototype.hasOwnProperty.call(item, 'then')) {
        errors.push('pre-scan schema 的 allOf 条目必须包含 if/then');
      }
      for (const key of Object.keys(item)) {
        if (!allOfKeys.has(key)) errors.push('pre-scan schema 的 allOf 条目包含未知键: ' + key);
      }
      if (!hasShape(item, ['if', 'then']) ||
        !isMappingBranch(item.if, 'kind', true) || !isMappingBranch(item.then, 'category', false)) {
        errors.push('pre-scan schema 的 allOf 映射结构必须为纯 kind 条件与 category 常量（仅允许字符串注释元数据）');
        continue;
      }
      const kind = item.if.properties.kind.const;
      const category = item.then && item.then.properties && item.then.properties.category && item.then.properties.category.const;
      if (!kind || !['A', 'B', 'C'].includes(category)) {
        errors.push('pre-scan schema 的 allOf 条目必须把 kind 映射到 A/B/C');
        continue;
      }
      if (mappedKinds.has(kind)) errors.push(`pre-scan schema 的 allOf 重复定义类别: ${kind}`);
      mappedKinds.set(kind, category);
    }
    if (allOf.length !== scriptKinds.size) {
      errors.push(`pre-scan schema 的 allOf 条目数（${allOf.length}）应等于 CATEGORY kind 数（${scriptKinds.size}）`);
    }
    for (const [kind, category] of scriptKinds) {
      if (!enumKinds.has(kind)) errors.push(`pre-scan schema 的 kind 枚举缺少: ${kind}`);
      if (mappedKinds.get(kind) !== category) errors.push(`pre-scan schema 类别不一致: ${kind} 应为 ${category}`);
    }
    for (const kind of enumKinds) {
      if (!scriptKinds.has(kind)) errors.push(`pre-scan schema 多出 unknown kind: ${kind}`);
    }
    for (const kind of mappedKinds.keys()) {
      if (!scriptKinds.has(kind)) errors.push(`pre-scan schema allOf 多出 unknown kind: ${kind}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`check-docs: ${errors.length} 个问题`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`check-docs: OK（${referenced.size} 个引用、${mustReference.length} 个 references 文件、README 与仓库文件同步）`);
