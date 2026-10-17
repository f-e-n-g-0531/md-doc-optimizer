#!/usr/bin/env node
// md-doc-optimizer 预扫描（pre-scan）：只读扫描目标目录下的 Markdown，输出确定性候选清单。
// 用法：node scripts/pre-scan.mjs [target-dir] [--text]（默认扫描当前目录；退出码 0 成功、2 用法错误）
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

const TOOL = 'md-doc-optimizer-pre-scan';
const SCHEMA_VERSION = 1;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.venv', 'venv']);
const FIXTURE_SEGMENTS = new Set(['test', 'tests', 'fixtures', '__fixtures__', '__snapshots__']);
const MD_EXT = /\.(?:md|markdown)$/i;
const FULLWIDTH_CHARS = new Set(['）', '】', '」', '》']);

// 每个候选 kind 固定归入 A（冗余）/ B（过期失效）/ C（事实不符）三类
const CATEGORY = {
  'broken-local-link': 'B', 'broken-anchor': 'B', 'default-branch-master-link': 'B',
  'trailing-fullwidth-after-url': 'C', 'stale-time-phrase': 'B', 'placeholder-marker': 'B',
  'duplicate-heading': 'A', 'duplicate-paragraph': 'A', 'multiple-h1': 'A', 'near-duplicate-files': 'A',
};

// 长短语在前，命中区间重叠时只保留第一个（避免 coming soon 再报一次 soon）
const STALE_RE = /by the end of \d{4}|\bin the near future\b|\bcoming soon\b|\bnext quarter\b|\bcurrently\b|\brecently\b|\bthis year\b|\bsoon\b|目前|最近|近期|即将|不久后/gi;
const PLACEHOLDER_RE = /\bTODO\b|\bFIXME\b|\bTBD\b|待补充|待完善|\bcoming soon\b|\bstay tuned\b/gi;
const LINK_RE = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REF_DEF_RE = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)/;
const MASTER_RE = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:tree|blob)\/master(?=[/?#)\s]|$)/gi;
const INLINE_CODE_RE = /(`+)([\s\S]*?)\1/g;
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
const LINK_TARGET_URL_RE = /\]\(\s*<?(https?:\/\/[^\s()<>）】」》]+)/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"'`()）】」》]+/g;

function usageError(message) {
  process.stderr.write('pre-scan: ' + message + '\n');
  process.exit(2);
}

const toPosix = (p) => p.replace(/\\/g, '/');

// context: 测试夹具目录 / example- 开头的文件名算 fixture，其余算 docs
function contextOf(relFile) {
  const parts = relFile.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (FIXTURE_SEGMENTS.has(parts[i])) return 'fixture';
  }
  return parts[parts.length - 1].startsWith('example-') ? 'fixture' : 'docs';
}

// 递归收集 *.md / *.markdown，忽略依赖/构建/版本控制目录，排序保证遍历确定
function collectFiles(targetAbs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(absPath);
      } else if (entry.isFile() && MD_EXT.test(entry.name)) {
        out.push(absPath);
      }
    }
  };
  walk(targetAbs);
  out.sort((a, b) => (toPosix(a) < toPosix(b) ? -1 : toPosix(a) > toPosix(b) ? 1 : 0));
  return out;
}

// 行内代码替换成等长空格（保留下标，避免把示例代码里的链接/短语当成正文）
function maskInlineCode(line) {
  return line.replace(INLINE_CODE_RE, (match) => ' '.repeat(match.length));
}
// 同样遮掉裸 URL，避免 URL 里的 currently / TODO 等词造成误报
function maskUrls(text) {
  return text.replace(BARE_URL_RE, (match) => ' '.repeat(match.length));
}

// GitHub-ish 锚点：小写，只保留 CJK/字母/数字/空格/连字符，空格转连字符
function slugify(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}
// 标题里的链接/图片/行内代码标记先去掉，再算 slug
function headingPlainText(raw) {
  return raw.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').trim();
}

// 解析单个 Markdown 文件：行、围栏/frontmatter 忽略标记、标题、规范化行集合
function analyzeFile(absPath, targetAbs) {
  let content;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    return null;
  }
  content = content.replace(/^\uFEFF/, ''); // 兼容 UTF-8 BOM
  const lines = content.split(/\r\n|\r|\n/); // 兼容 CRLF / CR
  const ignored = new Array(lines.length).fill(false);

  // 跳过 YAML frontmatter（首行 ---、前 80 行内有闭合 --- 且有 key: 行）
  if (lines.length > 0 && lines[0].trim() === '---') {
    let end = -1;
    for (let i = 1; i < Math.min(lines.length, 80); i++) {
      if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end > 0 && lines.slice(1, end).some((line) => /^[\w-]+\s*:/.test(line))) {
      for (let i = 0; i <= end; i++) ignored[i] = true;
    }
  }

  // 围栏代码块：3+ 反引号或 3+ 波浪线开关，围栏内容整体忽略
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const line = lines[i];
    if (fence) {
      ignored[i] = true;
      const close = line.match(FENCE_CLOSE_RE);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN_RE);
    if (!open) continue;
    if (open[1][0] === '`' && open[2].includes('`')) continue;
    fence = { char: open[1][0], len: open[1].length };
    ignored[i] = true;
  }

  // ATX 标题（# 到 ######）与锚点 slug
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const m = lines[i].match(/^(#{1,6})[ \t]+(.+?)\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[ \t]+#+\s*$/, '').trim();
    if (text) headings.push({ line: i + 1, level: m[1].length, text: text, slug: slugify(headingPlainText(text)) });
  }

  // 文件相似度用的规范化非空行集合（围栏内容不计入）
  const nonEmptyLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const normalized = lines[i].replace(/\s+/g, ' ').trim();
    if (normalized) nonEmptyLines.add(normalized);
  }
  const rel = toPosix(relative(targetAbs, absPath));
  return {
    absPath: absPath,
    rel: rel,
    context: contextOf(rel),
    lines: lines,
    ignored: ignored,
    headings: headings,
    nonEmptyLines: nonEmptyLines,
  };
}

// 文本中互不重叠的短语命中（返回原文短语，便于写 evidence）
function phraseHits(text, re) {
  const hits = [];
  for (const m of text.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    if (hits.some((hit) => start < hit.end && end > hit.start)) continue;
    hits.push({ start: start, end: end, phrase: m[0] });
  }
  return hits.map((hit) => hit.phrase);
}

function detectLocal(doc, docsByAbs, add) {
  const lines = doc.lines;

  const checkAnchor = (lineNo, absTarget, rawAnchor) => {
    if (!MD_EXT.test(absTarget)) return; // 非 Markdown 目标无法校验锚点
    const targetDoc = docsByAbs.get(absTarget);
    if (!targetDoc) return; // 目标不在本次扫描范围（如指向仓库外）
    let anchor = rawAnchor;
    try {
      anchor = decodeURIComponent(anchor);
    } catch (err) {
      // 保留原值
    }
    anchor = anchor.trim().toLowerCase();
    if (!anchor || targetDoc.headings.some((heading) => heading.slug === anchor)) return;
    add(doc, lineNo, 'broken-anchor', 'anchor #' + rawAnchor + ' has no matching heading slug');
  };

  const checkLink = (lineNo, rawTarget) => {
    let target = String(rawTarget || '').trim().replace(/^<|>$/g, '');
    if (!target || target === '#') return;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return; // http(s)/mailto/tel/data 等外部协议
    if (target.startsWith('/')) return; // 站点根相对路径，无法确定基准目录
    const hashAt = target.indexOf('#');
    const beforeHash = hashAt >= 0 ? target.slice(0, hashAt) : target;
    const rawAnchor = hashAt >= 0 ? target.slice(hashAt + 1) : '';
    const pathPart = beforeHash.split('?')[0];
    if (!pathPart) {
      if (rawAnchor) checkAnchor(lineNo, doc.absPath, rawAnchor); // 同文件锚点
      return;
    }
    let decodedPath = pathPart;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch (err) {
      // 保留原值
    }
    const absTarget = resolve(dirname(doc.absPath), decodedPath);
    if (!existsSync(absTarget)) {
      add(doc, lineNo, 'broken-local-link', 'relative link target not found: ' + pathPart);
      return;
    }
    if (rawAnchor) checkAnchor(lineNo, absTarget, rawAnchor);
  };

  // 1) 链接 / 锚点 / 硬编码 master 分支 / URL 后贴全角标点
  for (let i = 0; i < lines.length; i++) {
    if (doc.ignored[i]) continue;
    const lineNo = i + 1;
    const masked = maskInlineCode(lines[i]);
    for (const m of masked.matchAll(LINK_RE)) {
      if (m[1] === '!' || m[2].startsWith('!')) continue; // 图片链接暂不检查
      checkLink(lineNo, m[3]);
    }
    const refDef = masked.match(REF_DEF_RE);
    if (refDef) checkLink(lineNo, refDef[2]);
    for (const m of masked.matchAll(MASTER_RE)) {
      add(doc, lineNo, 'default-branch-master-link', 'hardcoded /master/ path; verify repository default branch');
      break;
    }
    // URL 后紧跟全角标点（同一 URL 只报一次）
    const glued = new Set();
    for (const m of masked.matchAll(LINK_TARGET_URL_RE)) {
      const urlStart = m.index + m[0].length - m[1].length;
      if (FULLWIDTH_CHARS.has(masked[urlStart + m[1].length])) glued.add(urlStart);
    }
    for (const m of masked.matchAll(BARE_URL_RE)) {
      if (!FULLWIDTH_CHARS.has(masked[m.index + m[0].length]) || glued.has(m.index)) continue;
      glued.add(m.index);
    }
    if (glued.size > 0) {
      add(doc, lineNo, 'trailing-fullwidth-after-url', 'full-width punctuation likely glued into URL');
    }
  }

  // 2) 过期时间表述 / 占位标记（只看 prose：剔除行内代码与 URL）
  for (let i = 0; i < lines.length; i++) {
    if (doc.ignored[i]) continue;
    const prose = maskUrls(maskInlineCode(lines[i]));
    if (!prose.trim()) continue;
    for (const phrase of phraseHits(prose, STALE_RE)) add(doc, i + 1, 'stale-time-phrase', phrase);
    for (const phrase of phraseHits(prose, PLACEHOLDER_RE)) add(doc, i + 1, 'placeholder-marker', phrase);
  }

  // 3) 重复标题（同层级同文本，大小写与空白归一）与多个 H1
  const headingGroups = new Map();
  for (const heading of doc.headings) {
    const key = heading.level + '|' + heading.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!headingGroups.has(key)) headingGroups.set(key, []);
    headingGroups.get(key).push(heading);
  }
  for (const group of headingGroups.values()) {
    for (let i = 1; i < group.length; i++) {
      add(doc, group[i].line, 'duplicate-heading', 'repeat of heading at line ' + group[0].line);
    }
  }
  const h1s = doc.headings.filter((heading) => heading.level === 1);
  for (let i = 1; i < h1s.length; i++) {
    add(doc, h1s[i].line, 'multiple-h1', 'additional H1; first H1 at line ' + h1s[0].line);
  }

  // 4) 重复段落（空行分隔，空白归一后 >= 80 字符，排除纯标题/纯列表块）
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    const textLines = current.map((item) => item.text);
    const structuralOnly = textLines.every((text) =>
      /^#{1,6}(?:\s|$)/.test(text) || /^\s*(?:[-*+]|\d+[.)])\s+/.test(text));
    const normalized = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!structuralOnly && normalized.length >= 80) {
      blocks.push({ line: current[0].line, normalized: normalized });
    }
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (doc.ignored[i] || !lines[i].trim()) {
      flush();
      continue;
    }
    current.push({ line: i + 1, text: lines[i].trim() });
  }
  flush();
  const paragraphGroups = new Map();
  for (const block of blocks) {
    if (!paragraphGroups.has(block.normalized)) paragraphGroups.set(block.normalized, []);
    paragraphGroups.get(block.normalized).push(block);
  }
  for (const group of paragraphGroups.values()) {
    for (let i = 1; i < group.length; i++) {
      add(doc, group[i].line, 'duplicate-paragraph', 'repeat of paragraph at line ' + group[0].line);
    }
  }
}

// 两文件规范化非空行集合的 Jaccard 相似度 >= 0.8 即 near-duplicate，只在字典序较小文件报一条
function detectNearDuplicates(docs, add) {
  const listed = docs.filter((doc) => doc.nonEmptyLines.size >= 10)
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (let i = 0; i < listed.length; i++) {
    for (let j = i + 1; j < listed.length; j++) {
      const a = listed[i];
      const b = listed[j];
      let intersection = 0;
      for (const line of a.nonEmptyLines) {
        if (b.nonEmptyLines.has(line)) intersection++;
      }
      const union = a.nonEmptyLines.size + b.nonEmptyLines.size - intersection;
      if (union === 0 || intersection / union < 0.8) continue;
      add(a, 1, 'near-duplicate-files',
        'near-duplicate of ' + b.rel + ' (Jaccard ' + (intersection / union).toFixed(2) + ')');
    }
  }
}

function compareCandidates(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.evidence !== b.evidence) return a.evidence < b.evidence ? -1 : 1;
  if (a.excerpt !== b.excerpt) return a.excerpt < b.excerpt ? -1 : 1;
  return 0;
}

function renderText(result) {
  const kinds = Object.keys(result.summary.by_kind)
    .map((kind) => kind + '=' + result.summary.by_kind[kind])
    .join(', ');
  const lines = [
    'md-doc-optimizer pre-scan',
    'target: ' + result.target,
    'files scanned: ' + result.files_scanned,
    'candidates: ' + result.summary.total,
    'by category: A=' + result.summary.by_category.A +
      ', B=' + result.summary.by_category.B +
      ', C=' + result.summary.by_category.C,
    'by kind: ' + (kinds || '(none)'),
  ];
  if (result.candidates.length > 0) {
    lines.push('candidates:');
    for (const candidate of result.candidates) {
      lines.push('  ' + candidate.file + ':' + candidate.line + ' [' + candidate.category + '] ' +
        candidate.kind + ' -- ' + candidate.excerpt);
    }
  }
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  let textMode = false;
  const positional = [];
  for (const arg of args) {
    if (arg === '--text') {
      textMode = true;
    } else if (arg.startsWith('-') && arg !== '-') {
      usageError('unknown option: ' + arg);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) usageError('expected at most one target directory');
  const targetArg = positional.length === 1 ? positional[0] : process.cwd();
  let targetStat = null;
  try {
    targetStat = statSync(targetArg);
  } catch (err) {
    targetStat = null;
  }
  if (!targetStat || !targetStat.isDirectory()) {
    usageError('target is not a directory: ' + targetArg);
  }
  const targetAbs = resolve(targetArg);

  const docs = [];
  for (const absPath of collectFiles(targetAbs)) {
    const doc = analyzeFile(absPath, targetAbs);
    if (doc) docs.push(doc);
  }
  const docsByAbs = new Map();
  for (const doc of docs) docsByAbs.set(doc.absPath, doc);

  const candidates = [];
  const add = (doc, line, kind, evidence, excerptOverride) => {
    const excerpt = excerptOverride === undefined
      ? (doc.lines[line - 1] || '').trim().slice(0, 160)
      : excerptOverride;
    candidates.push({
      file: doc.rel,
      line: line,
      kind: kind,
      category: CATEGORY[kind],
      excerpt: excerpt,
      evidence: evidence,
      context: doc.context,
    });
  };
  for (const doc of docs) detectLocal(doc, docsByAbs, add);
  detectNearDuplicates(docs, add);

  // 去重 + 稳定排序（file -> line -> kind），保证同一目标重复运行输出一致
  const seen = new Set();
  const sorted = [];
  for (const candidate of candidates) {
    const key = [candidate.file, candidate.line, candidate.kind, candidate.evidence].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    sorted.push(candidate);
  }
  sorted.sort(compareCandidates);

  const byKind = {};
  for (const candidate of sorted) {
    byKind[candidate.kind] = (byKind[candidate.kind] || 0) + 1;
  }
  const byKindSorted = {};
  for (const kind of Object.keys(byKind).sort()) byKindSorted[kind] = byKind[kind];
  const byCategory = { A: 0, B: 0, C: 0 };
  for (const candidate of sorted) byCategory[candidate.category] += 1;
  const result = {
    tool: TOOL,
    schema_version: SCHEMA_VERSION,
    target: toPosix(targetAbs),
    files_scanned: docs.length,
    candidates: sorted,
    summary: { total: sorted.length, by_kind: byKindSorted, by_category: byCategory },
  };

  if (textMode) {
    process.stdout.write(renderText(result));
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}

main();
