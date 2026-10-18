#!/usr/bin/env node
// md-doc-optimizer 预扫描（pre-scan）：只读扫描目标目录下的 Markdown，输出确定性候选清单。
// 用法：node scripts/pre-scan.mjs [target-dir] [--text] [--fail-on kind1,kind2] [--include-fixtures]
//                              [--baseline file] [--write-baseline file]
// 默认扫描当前目录；退出码 0 成功、1 --fail-on 命中、2 用法错误
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, dirname, parse } from 'node:path';

const TOOL = 'md-doc-optimizer-pre-scan';
const SCHEMA_VERSION = 1;
const BASELINE_TOOL = 'md-doc-optimizer-pre-scan-baseline';
const BASELINE_SCHEMA_VERSION = 1;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.venv', 'venv']);
const FIXTURE_SEGMENTS = new Set(['test', 'tests', 'fixtures', '__fixtures__', '__snapshots__']);
const MD_EXT = /\.(?:md|markdown)$/i;
const FULLWIDTH_CHARS = new Set(['）', '】', '」', '》']);

// 每个候选 kind 固定归入 A（冗余）/ B（过期失效）/ C（事实不符）三类
const CATEGORY = {
  'broken-local-link': 'B', 'broken-local-image': 'B', 'case-mismatch-link': 'B', 'broken-anchor': 'B',
  'default-branch-master-link': 'B', 'empty-link-target': 'B', 'undefined-reference-label': 'B',
  'trailing-fullwidth-after-url': 'C', 'stale-time-phrase': 'B', 'placeholder-marker': 'B',
  'duplicate-heading': 'A', 'duplicate-paragraph': 'A', 'multiple-h1': 'A', 'near-duplicate-files': 'A',
  'unused-reference-definition': 'A', 'duplicate-reference-definition': 'A',
};

// 长短语在前，命中区间重叠时只保留第一个（避免 coming soon 再报一次 soon）
const STALE_RE = /by the end of \d{4}|\bin the near future\b|\bcoming soon\b|\bnext quarter\b|\bcurrently\b|\brecently\b|\bthis year\b|\bsoon\b|目前|最近|近期|即将|不久后/gi;
const PLACEHOLDER_RE = /\bTODO\b|\bFIXME\b|\bTBD\b|待补充|待完善|\bcoming soon\b|\bstay tuned\b/gi;
// 链接文字允许一层嵌套方括号：![alt [x]](img)、[see [inner][label]](url)
const LINK_RE = /(!?)\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\((\s*)<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
// 图片作为链接文字（常见徽章写法）：[![alt](img)](link)
const NESTED_IMAGE_LINK_RE = /\[(!\[[^\]\n]*\]\([^)\n]*\))\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
// 引用式定义：可位于 blockquote / 列表项内；脚注 [^1]: ... 也会被匹配，解析时再排除
const REF_DEF_RE = /^\s{0,3}(?:(?:>\s{0,3})|(?:[-*+]|\d+[.)])\s+)*\[([^\]]+)\]:\s*(.*)$/;
// 引用式使用：完整 [text][label]、折叠 [label][]、快捷 [label]；快捷形式歧义大，只用于「定义是否被使用」
const REF_USAGE_RE = /(!?)\[([^\]]*)\](?:\[([^\]]*)\])?/g;
// 空目标：[]()、[]( "title")、[](<>) 等；]("title") 的引号是 destination 的一部分，不算空
const EMPTY_TARGET_RE = /(!?)\[[^\]]*\]\(\s*(?:\)|<>\s*(?:"[^"]*"|'[^']*')?\s*\)|\s+(?:"[^"]*"|'[^']*')\s*\))/g;
const ESCAPED_BRACKET_RE = /\\([\[\]])/g;
const ESCAPED_OPEN_BRACKET_RE = /\\\[/g;
const MASTER_RE = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:tree|blob)\/master(?=[/?#)\s]|$)/gi;
const INLINE_CODE_RE = /(`+)([\s\S]*?)\1/g;
const FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
const LINK_TARGET_URL_RE = /\]\(\s*<?(https?:\/\/[^\s()<>）】」》]+)/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"'`()）】」》]+/g;
// 显式 HTML 锚点（<a name="x"> / <span id='y'>）：GitHub 上 #x 可直接命中
const HTML_ANCHOR_RE = /<[a-zA-Z][a-zA-Z0-9-]*[^<>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

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

// 引用标签归一：内部空白折叠、大小写不敏感（CommonMark 引用标签规则）
function normalizeLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// GitHub-ish 锚点：小写；保留字母/数字/下划线/连字符（GitHub 保留 _）；空格逐个转连字符
function slugify(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
}
// HTML 实体解码：标题里写成 R&amp;D 时，GitHub 按渲染后的 R&D 算 slug
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec || hex) {
      const code = parseInt(dec || hex, dec ? 10 : 16);
      if (Number.isFinite(code)) {
        try { return String.fromCodePoint(code); } catch (err) { return match; }
      }
      return match;
    }
    const value = named[name.toLowerCase()];
    return value === undefined ? match : value;
  });
}
// 标题先取渲染文本（去 HTML 标签、链接语法、行内代码标记），再解码实体，最后算 slug
function headingPlainText(raw) {
  const rendered = raw.replace(/<[^>]*>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').trim();
  return decodeEntities(rendered).trim();
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

  // 围栏代码块：3+ 反引号或 3+ 波浪线开关，围栏内容整体忽略。
  // 同时跟踪 HTML 注释：注释里的围栏标记不算围栏，避免把注释之后的正文一起吞掉。
  let fence = null;
  let fenceCommentOpen = false;
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const line = lines[i];
    if (fence) {
      ignored[i] = true;
      const close = line.match(FENCE_CLOSE_RE);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      continue;
    }
    if (fenceCommentOpen) {
      if (maskInlineCode(line).includes('-->')) fenceCommentOpen = false;
      continue; // 注释内容不是 Markdown，不参与围栏判断
    }
    const open = line.match(FENCE_OPEN_RE);
    if (open) {
      if (!(open[1][0] === '`' && open[2].includes('`'))) {
        fence = { char: open[1][0], len: open[1].length };
        ignored[i] = true;
      }
      continue;
    }
    // 非围栏行：检查是否开启 HTML 注释（行内代码里的 <!-- 不算）
    const maskedLine = maskInlineCode(line);
    let searchFrom = 0;
    for (;;) {
      const start = maskedLine.indexOf('<!--', searchFrom);
      if (start < 0) break;
      const end = maskedLine.indexOf('-->', start + 4);
      if (end < 0) {
        fenceCommentOpen = true;
        break;
      }
      searchFrom = end + 3;
    }
  }

  // 链接扫描用文本：先遮行内代码，再遮 HTML 注释，并遮掉转义的开方括号。
  // 注释里的链接/引用/锚点不算正文；跨行注释整行遮掉，注释后的正文仍保留。
  // commentMasked 只遮注释、保留行内代码原文，供标题解析（标题里的代码要保留文本）。
  const linkMasked = new Array(lines.length).fill('');
  const commentMasked = new Array(lines.length).fill('');
  let commentOpen = false;
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    let masked = maskInlineCode(lines[i]);
    let rawMasked = lines[i];
    if (commentOpen) {
      const closeAt = masked.indexOf('-->');
      if (closeAt < 0) continue;
      masked = ' '.repeat(closeAt + 3) + masked.slice(closeAt + 3);
      rawMasked = ' '.repeat(closeAt + 3) + rawMasked.slice(closeAt + 3);
      commentOpen = false;
    }
    for (;;) {
      const openAt = masked.indexOf('<!--');
      if (openAt < 0) break;
      const closeAt = masked.indexOf('-->', openAt + 4);
      if (closeAt < 0) {
        masked = masked.slice(0, openAt);
        rawMasked = rawMasked.slice(0, openAt);
        commentOpen = true;
        break;
      }
      const blank = ' '.repeat(closeAt + 3 - openAt);
      masked = masked.slice(0, openAt) + blank + masked.slice(closeAt + 3);
      rawMasked = rawMasked.slice(0, openAt) + blank + rawMasked.slice(closeAt + 3);
    }
    commentMasked[i] = rawMasked;
    linkMasked[i] = masked.replace(ESCAPED_OPEN_BRACKET_RE, '  ');
  }

  // ATX 标题（# 到 ######）；slug 统一生成，复现 GitHub 对重复标题追加 -1/-2 的规则
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const m = commentMasked[i].match(/^(#{1,6})[ \t]+(.+?)\s*$/);
    if (!m) continue;
    const text = m[2].replace(/[ \t]+#+\s*$/, '').trim();
    if (text) headings.push({ line: i + 1, level: m[1].length, text: text });
  }
  const headingSlugs = new Set();
  for (const heading of headings) {
    const base = slugify(headingPlainText(heading.text));
    let slug = base;
    let suffix = 1;
    while (headingSlugs.has(slug)) slug = base + '-' + (suffix++);
    if (slug) headingSlugs.add(slug);
    heading.slug = slug;
  }

  // 显式 HTML 锚点：<a name="x"> / <span id="x">，与标题 slug 一起作为合法锚点
  const explicitAnchors = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    for (const m of linkMasked[i].matchAll(HTML_ANCHOR_RE)) {
      const anchor = String(m[1] !== undefined ? m[1] : m[2] || '').trim();
      if (anchor) explicitAnchors.add(anchor);
    }
  }

  // 引用式链接：定义 [label]: target 与使用 [text][label] / [label][] / [label]
  // 脚注 [^label]: ... 不是链接定义，先排除，避免把脚注正文当成本地路径
  const refDefinitions = [];
  const labelUsage = new Map(); // 归一标签 -> { link, image }
  const explicitUses = []; // 完整/折叠形式的使用，用于「引用了不存在的定义」
  const addUsage = (label, isImage) => {
    const normalized = normalizeLabel(label);
    if (!normalized || normalized.startsWith('^')) return '';
    const entry = labelUsage.get(normalized) || { link: false, image: false };
    if (isImage) entry.image = true; else entry.link = true;
    labelUsage.set(normalized, entry);
    return normalized;
  };
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i] || !linkMasked[i]) continue;
    const masked = linkMasked[i];
    const def = masked.match(REF_DEF_RE);
    if (def && !def[1].startsWith('^')) {
      const rest = def[2];
      const dest = rest.match(/^(?:<([^>]*)>|(\S+))/);
      let target = dest ? (dest[1] !== undefined ? dest[1] : dest[2]) : '';
      if (!target) {
        // 目标换行：下一行必须是孤立的 destination（可带 title）
        const nextMasked = linkMasked[i + 1];
        if (nextMasked) {
          const nextDest = nextMasked.match(/^\s{0,3}(?:<([^>]*)>|(\S+))\s*(?:"[^"]*"|'[^']*')?\s*$/);
          if (nextDest) target = nextDest[1] !== undefined ? nextDest[1] : nextDest[2];
        }
      }
      refDefinitions.push({ line: i + 1, label: def[1], normalized: normalizeLabel(def[1]), target: target });
      continue; // 定义行本身不算使用
    }
    // 脚注定义行不是链接定义，但其正文里可能还有引用式链接，继续向下扫描使用
    // 先去掉行内链接/图片与转义方括号，避免误判成引用式使用
    const usageText = masked
      .replace(LINK_RE, (match) => ' '.repeat(match.length))
      .replace(ESCAPED_BRACKET_RE, (match) => ' '.repeat(match.length));
    for (const m of usageText.matchAll(REF_USAGE_RE)) {
      const isImage = m[1] === '!';
      if (m[3] !== undefined) {
        const label = m[3] === '' ? m[2] : m[3];
        const normalized = addUsage(label, isImage);
        if (normalized) explicitUses.push({ line: i + 1, label: label, normalized: normalized });
      } else if (m[2]) {
        addUsage(m[2], isImage); // 快捷图片 ![alt] 也是合法引用（定义存在时）
      }
    }
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
    headingSlugs: headingSlugs,
    explicitAnchors: explicitAnchors,
    linkMasked: linkMasked,
    commentMasked: commentMasked,
    refDefinitions: refDefinitions,
    labelUsage: labelUsage,
    explicitUses: explicitUses,
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

// 目录名缓存：大小写核对要逐段 readdir，避免同一目录重复读取
const dirEntries = new Map();
function listDir(dir) {
  if (!dirEntries.has(dir)) {
    let names = null;
    try { names = readdirSync(dir); } catch (err) { names = null; }
    dirEntries.set(dir, names);
  }
  return dirEntries.get(dir);
}
// 逐段核对磁盘上的真实大小写。Windows/macOS 的文件系统不区分大小写，existsSync 会放行
// 在 Linux/CI 上必然 404 的路径；这里按 readdir 的真实文件名比对，跨平台结果一致。
function resolveOnDisk(absTarget) {
  const root = parse(absTarget).root;
  const segments = absTarget.slice(root.length).split(/[\\/]/).filter(Boolean);
  let actualAbs = root;
  let mismatch = null;
  for (const segment of segments) {
    const names = listDir(actualAbs);
    if (!names) return { exists: false };
    let actualName = names.includes(segment) ? segment : null;
    if (!actualName) {
      const lower = segment.toLowerCase();
      actualName = names.find((name) => name.toLowerCase() === lower) || null;
      if (!actualName) return { exists: false };
      if (!mismatch) mismatch = { linked: segment, disk: actualName };
    }
    actualAbs = join(actualAbs, actualName);
  }
  return { exists: true, actualAbs: actualAbs, mismatch: mismatch };
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
    anchor = anchor.trim();
    if (!anchor) return;
    if (targetDoc.explicitAnchors.has(anchor)) return; // 显式 HTML 锚点区分大小写
    if (targetDoc.headingSlugs.has(anchor.toLowerCase())) return;
    add(doc, lineNo, 'broken-anchor', 'anchor #' + rawAnchor + ' has no matching heading slug or explicit HTML anchor');
  };

  const checkLink = (lineNo, rawTarget, options) => {
    const isImage = Boolean(options && options.image);
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
    // CommonMark 允许用反斜杠转义 ASCII 标点（如 ./a\_b.md）；先解转义，剩下的反斜杠才是路径分隔符
    const unescapedPath = decodedPath.replace(/\\([!-/:-@\[-\`{-~])/g, '$1');
    if (unescapedPath.includes('\\')) {
      // GitHub/Linux 不把 \ 当目录分隔符：本地 Windows 能打开，线上是 %5C 404
      add(doc, lineNo, isImage ? 'broken-local-image' : 'broken-local-link',
        'path uses backslash separators; use "/" instead (GitHub resolves "\\" as %5C)');
      return;
    }
    const absTarget = resolve(dirname(doc.absPath), unescapedPath);
    const onDisk = resolveOnDisk(absTarget);
    if (!onDisk.exists) {
      add(doc, lineNo, isImage ? 'broken-local-image' : 'broken-local-link',
        (isImage ? 'relative image' : 'relative link') + ' target not found: ' + pathPart);
      return;
    }
    if (onDisk.mismatch) {
      add(doc, lineNo, 'case-mismatch-link',
        (isImage ? 'image path' : 'path') + ' case differs from on-disk name: ' +
        onDisk.mismatch.linked + ' -> ' + onDisk.mismatch.disk +
        ' (case-sensitive file systems will 404)');
    }
    if (rawAnchor && !isImage) checkAnchor(lineNo, onDisk.actualAbs, rawAnchor);
  };

  // 1) 链接 / 锚点 / 硬编码 master 分支 / URL 后贴全角标点
  for (let i = 0; i < lines.length; i++) {
    if (doc.ignored[i]) continue;
    const lineNo = i + 1;
    const masked = doc.linkMasked[i] || '';
    // 先处理「图片作为链接文字」：[![alt](img)](url)，内外两层都要核对
    let remaining = masked;
    for (const nested of masked.matchAll(NESTED_IMAGE_LINK_RE)) {
      const inner = nested[1].match(/^(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)$/);
      if (inner) checkLink(lineNo, inner[3], { image: true });
      checkLink(lineNo, nested[2], { image: false });
      remaining = remaining.slice(0, nested.index) + ' '.repeat(nested[0].length) +
        remaining.slice(nested.index + nested[0].length);
    }
    for (const m of remaining.matchAll(LINK_RE)) {
      if (/^["']/.test(m[4]) && m[3].length > 0) continue; // 空目标 + 标题，交给 EMPTY_TARGET_RE
      checkLink(lineNo, m[4], { image: m[1] === '!' });
    }
    for (const m of masked.matchAll(EMPTY_TARGET_RE)) {
      add(doc, lineNo, 'empty-link-target',
        (m[1] === '!' ? 'image' : 'link') + ' target is empty: ' + m[0].trim());
    }
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

  // 1.1) 引用式定义：目标有效性 / 空目标 / 重复定义 / 未被引用；以及引用了不存在的定义
  const definedLabels = new Set(doc.refDefinitions.map((def) => def.normalized).filter(Boolean));
  const firstDefinitionLine = new Map();
  for (const def of doc.refDefinitions) {
    if (!def.normalized) continue;
    const usage = doc.labelUsage.get(def.normalized);
    const imageOnly = Boolean(usage && usage.image && !usage.link);
    if (!def.target) {
      add(doc, def.line, 'empty-link-target', 'reference definition [' + def.label + '] has an empty target');
    } else {
      checkLink(def.line, def.target, { image: imageOnly });
    }
    if (firstDefinitionLine.has(def.normalized)) {
      add(doc, def.line, 'duplicate-reference-definition',
        'definition [' + def.label + '] already defined at line ' + firstDefinitionLine.get(def.normalized));
    } else {
      firstDefinitionLine.set(def.normalized, def.line);
    }
    if (!usage && def.target) {
      add(doc, def.line, 'unused-reference-definition', 'definition [' + def.label + '] is never referenced');
    }
  }
  for (const use of doc.explicitUses) {
    if (!definedLabels.has(use.normalized)) {
      add(doc, use.line, 'undefined-reference-label',
        'reference [' + use.label + '] has no matching definition in this file');
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

// 基线条目只记 file + kind + evidence；比较时把 evidence 里的行号引用（如 "line 3"）归一，
// 行号漂移不会误伤；文档大改导致证据文本本身变化时仍需刷新 baseline。
function baselineEvidence(evidence) {
  return String(evidence).replace(
    /((?:repeat of heading|repeat of paragraph|first H1|already defined) at )line \d+/g,
    '$1line #');
}
function candidateKey(candidate) {
  return [candidate.file, candidate.kind, baselineEvidence(candidate.evidence)].join('\u0000');
}
function baselineEntryKey(entry) {
  return [entry.file, entry.kind, baselineEvidence(entry.evidence)].join('\u0000');
}

// 读取并校验 baseline 文件，返回已记录候选的 key 集合
function readBaseline(file) {
  const absPath = resolve(file);
  let raw;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    usageError('cannot read baseline file: ' + absPath + ' (' + err.message + ')');
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    usageError('invalid baseline JSON: ' + absPath + ' (' + err.message + ')');
  }
  if (!data || data.tool !== BASELINE_TOOL) {
    usageError('baseline file has unexpected tool (expected "' + BASELINE_TOOL + '"): ' + absPath);
  }
  if (data.schema_version !== BASELINE_SCHEMA_VERSION) {
    usageError('unsupported baseline schema_version: ' + data.schema_version);
  }
  if (!Array.isArray(data.entries)) usageError('baseline file is missing entries array: ' + absPath);
  const keys = new Set();
  for (const entry of data.entries) {
    if (!entry || typeof entry.file !== 'string' || entry.file.trim() === '' ||
      typeof entry.kind !== 'string' || typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
      usageError('baseline entry must contain non-empty string file/kind/evidence: ' + absPath);
    }
    if (!Object.prototype.hasOwnProperty.call(CATEGORY, entry.kind)) {
      usageError('baseline entry has unknown kind: ' + entry.kind);
    }
    if (entry.file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry.file) || entry.file.includes('\\')) {
      usageError('baseline entry file must be a repository-relative POSIX path: ' + entry.file);
    }
    keys.add(baselineEntryKey(entry));
  }
  return keys;
}

// 把当前候选写成 baseline（按 file/kind/evidence 排序，输出稳定可 diff）
function writeBaseline(file, result) {
  const absPath = resolve(file);
  const entries = result.candidates
    .map((candidate) => ({ file: candidate.file, kind: candidate.kind, evidence: candidate.evidence }))
    .sort((a, b) => {
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      if (a.evidence !== b.evidence) return a.evidence < b.evidence ? -1 : 1;
      return 0;
    });
  const payload = {
    tool: BASELINE_TOOL,
    schema_version: BASELINE_SCHEMA_VERSION,
    entries: entries,
  };
  try {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, JSON.stringify(payload, null, 2) + '\n');
  } catch (err) {
    usageError('cannot write baseline file: ' + absPath + ' (' + err.message + ')');
  }
  return entries.length;
}

// --fail-on 命中时把新增（未被 baseline 记录）的匹配项写到 stderr 并返回 1；
// stdout 的 JSON/文本输出保持不变。默认跳过 fixture 上下文（测试夹具里的坏链接是内容本身）。
function evaluateGate(result, failOn, includeFixtures, baselineKeys) {
  if (failOn.size === 0) return 0;
  const matched = result.candidates.filter((candidate) => failOn.has(candidate.kind));
  const relevant = includeFixtures ? matched : matched.filter((candidate) => candidate.context !== 'fixture');
  const skipped = matched.length - relevant.length;
  const baselined = baselineKeys ? relevant.filter((candidate) => baselineKeys.has(candidateKey(candidate))) : [];
  const fresh = baselineKeys ? relevant.filter((candidate) => !baselineKeys.has(candidateKey(candidate))) : relevant;
  const notes = [];
  if (baselined.length > 0) notes.push(baselined.length + ' baselined candidate(s) ignored');
  if (skipped > 0) notes.push(skipped + ' fixture candidate(s) skipped (use --include-fixtures)');
  const noteText = notes.length > 0 ? '; ' + notes.join('; ') : '';
  if (fresh.length === 0) {
    if (noteText) process.stderr.write('pre-scan: 0 new candidate(s) matched --fail-on' + noteText + '\n');
    return 0;
  }
  process.stderr.write('pre-scan: ' + fresh.length + ' new candidate(s) matched --fail-on (' +
    Array.from(failOn).join(', ') + ')' + noteText + '\n');
  const limit = 20;
  for (const candidate of fresh.slice(0, limit)) {
    process.stderr.write('  ' + candidate.file + ':' + candidate.line + ' [' + candidate.category + '] ' +
      candidate.kind + (candidate.context === 'fixture' ? ' [fixture]' : '') +
      ' -- ' + candidate.evidence + '\n');
  }
  if (fresh.length > limit) {
    process.stderr.write('  ... and ' + (fresh.length - limit) + ' more (full list is in the JSON output)\n');
  }
  return 1;
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
    lines.push('candidates (file:line [category] kind -- evidence | excerpt):');
    for (const candidate of result.candidates) {
      lines.push('  ' + candidate.file + ':' + candidate.line + ' [' + candidate.category + '] ' +
        candidate.kind + ' -- ' + candidate.evidence + ' | ' + candidate.excerpt);
    }
  }
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  let textMode = false;
  let includeFixtures = false;
  let baselinePath = null;
  let writeBaselinePath = null;
  const failOn = new Set();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--text') {
      textMode = true;
      continue;
    }
    if (arg === '--include-fixtures') {
      includeFixtures = true;
      continue;
    }
    if (arg === '--fail-on' || arg.startsWith('--fail-on=')) {
      let value;
      if (arg === '--fail-on') {
        value = args[++i];
        if (value === undefined) usageError('--fail-on requires a comma-separated list of kinds');
      } else {
        value = arg.slice('--fail-on='.length);
      }
      if (value.startsWith('-')) {
        usageError('--fail-on requires a comma-separated list of kinds before "' + value + '"');
      }
      const kinds = value.split(',').map((kind) => kind.trim());
      if (kinds.some((kind) => kind === '')) {
        usageError('--fail-on needs comma-separated kinds without empty entries');
      }
      for (const kind of kinds) {
        if (!Object.prototype.hasOwnProperty.call(CATEGORY, kind)) {
          usageError('unknown --fail-on kind: ' + kind);
        }
        failOn.add(kind);
      }
      continue;
    }
    if (arg === '--baseline' || arg.startsWith('--baseline=')) {
      let value;
      if (arg === '--baseline') {
        value = args[++i];
        if (value === undefined) usageError('--baseline requires a file path');
      } else {
        value = arg.slice('--baseline='.length);
      }
      if (!value || value.startsWith('-')) usageError('--baseline requires a file path');
      baselinePath = value;
      continue;
    }
    if (arg === '--write-baseline' || arg.startsWith('--write-baseline=')) {
      let value;
      if (arg === '--write-baseline') {
        value = args[++i];
        if (value === undefined) usageError('--write-baseline requires a file path');
      } else {
        value = arg.slice('--write-baseline='.length);
      }
      if (!value || value.startsWith('-')) usageError('--write-baseline requires a file path');
      writeBaselinePath = value;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') usageError('unknown option: ' + arg);
    positional.push(arg);
  }
  if (positional.length > 1) {
    usageError('expected at most one target directory (multiple kinds need --fail-on kind1,kind2)');
  }
  if (writeBaselinePath !== null) {
    if (failOn.size > 0) usageError('--write-baseline cannot be combined with --fail-on');
    if (baselinePath !== null) usageError('--write-baseline cannot be combined with --baseline');
  }
  if (baselinePath !== null && failOn.size === 0) {
    usageError('--baseline requires --fail-on');
  }
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
  const baselineKeys = baselinePath !== null ? readBaseline(baselinePath) : null;

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

  if (writeBaselinePath !== null) {
    const count = writeBaseline(writeBaselinePath, result);
    if (textMode) {
      process.stdout.write(renderText(result));
    } else {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
    process.stderr.write('pre-scan: wrote ' + count + ' candidate(s) to baseline ' +
      toPosix(resolve(writeBaselinePath)) + '\n');
    process.exitCode = 0;
  } else {
    if (textMode) {
      process.stdout.write(renderText(result));
    } else {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
    process.exitCode = evaluateGate(result, failOn, includeFixtures, baselineKeys);
  }
}

main();
