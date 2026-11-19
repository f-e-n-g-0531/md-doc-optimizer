#!/usr/bin/env node
// md-doc-optimizer 预扫描（pre-scan）：只读扫描目标目录下的 Markdown，输出确定性候选清单。
// 用法：node scripts/pre-scan.mjs [target-dir] [--text] [--fail-on kind1,kind2] [--include-fixtures]
//                              [--baseline file] [--write-baseline file] [--report-out file]
//                              [--exact-near-duplicates]
// 默认扫描当前目录；退出码 0 成功、1 --fail-on 命中、2 用法或文件读写错误
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync, realpathSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, relative, dirname, parse, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const TOOL = 'md-doc-optimizer-pre-scan';
const SCHEMA_VERSION = 1;
const BASELINE_TOOL = 'md-doc-optimizer-pre-scan-baseline';
const BASELINE_SCHEMA_VERSION = 1;
// near-duplicate：精确前缀过滤生成候选对，再做精确 Jaccard；--exact-near-duplicates 退回全量两两比较
const NEAR_DUP_THRESHOLD = 0.8;
// 同一本地链接目标在单个文件出现 >= 3 次视为冗余候选
const DUPLICATE_LINK_THRESHOLD = 3;
// --report-out 的候选严重度映射（action 固定 annotate，等待人工 triage）
const REPORT_SEVERITY = {
  'broken-local-link': 'High', 'broken-local-image': 'High', 'broken-anchor': 'High', 'link-outside-root': 'High',
  'empty-link-target': 'High', 'case-mismatch-link': 'Medium', 'undefined-reference-label': 'Medium',
  'default-branch-master-link': 'Medium', 'stale-time-phrase': 'Medium',
  'trailing-fullwidth-after-url': 'Low', 'placeholder-marker': 'Low',
  'duplicate-heading': 'Low', 'duplicate-paragraph': 'Low', 'multiple-h1': 'Low',
  'near-duplicate-files': 'Medium', 'unused-reference-definition': 'Low',
  'duplicate-reference-definition': 'Low', 'duplicate-link-target': 'Low',
};
// 行内抑制标记（HTML 注释，不渲染）：只影响候选上报，不影响解析。
// 允许在标记后写 ": 原因"；按注释边界解析，外层 HTML 注释里的标记字面量不生效。
const MARKER_DISABLE_BODY_RE = /^pre-scan-disable(?:\s*:[\s\S]*)?$/i;
const MARKER_ENABLE_BODY_RE = /^pre-scan-enable(?:\s*:[\s\S]*)?$/i;
const MARKER_IGNORE_LINE_BODY_RE = /^pre-scan-ignore(?:\s*:[\s\S]*)?$/i;
const MARKER_IGNORE_NEXT_BODY_RE = /^pre-scan-ignore-next-line(?:\s*:[\s\S]*)?$/i;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.venv', 'venv']);
const FIXTURE_SEGMENTS = new Set(['test', 'tests', 'fixtures', '__fixtures__', '__snapshots__']);
const MD_EXT = /\.(?:md|markdown)$/i;
const FULLWIDTH_CHARS = new Set(['）', '】', '」', '》']);

// 每个候选 kind 固定归入 A（冗余）/ B（过期失效）/ C（事实不符）三类
export const CATEGORY = Object.freeze({
  'broken-local-link': 'B', 'broken-local-image': 'B', 'case-mismatch-link': 'B', 'broken-anchor': 'B',
  'default-branch-master-link': 'B', 'empty-link-target': 'B', 'undefined-reference-label': 'B',
  'trailing-fullwidth-after-url': 'C', 'stale-time-phrase': 'B', 'placeholder-marker': 'B',
  'duplicate-heading': 'A', 'duplicate-paragraph': 'A', 'multiple-h1': 'A', 'near-duplicate-files': 'A',
  'unused-reference-definition': 'A', 'duplicate-reference-definition': 'A', 'duplicate-link-target': 'A',
  'link-outside-root': 'B',
});

// 长短语在前，命中区间重叠时只保留第一个（避免 coming soon 再报一次 soon）
const STALE_RE = /by the end of \d{4}|\bin the near future\b|\bcoming soon\b|\bnext quarter\b|\bcurrently\b|\brecently\b|\bthis year\b|\bsoon\b|目前|最近|近期|即将|不久后/gi;
const PLACEHOLDER_RE = /\bTODO\b|\bFIXME\b|\bTBD\b|待补充|待完善|\bcoming soon\b|\bstay tuned\b/gi;
// 链接文字允许一层嵌套方括号：![alt [x]](img)、[see [inner][label]](url)
// 链接目标允许尖括号包裹或平衡圆括号（CommonMark），如 ./faq(1).md，避免在 ) 处截断误报；括号按一层嵌套识别，更深的嵌套目标保守跳过不报
const INLINE_TARGET = String.raw`(<[^>\n]*>|(?:\\[()\\]|\\(?![()\\])|[^()\s>\\]|\((?:\\[()\\]|\\(?![()\\])|[^()\s>\\])*\))*)(?:\s+(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\((?:\\.|[^()\\])*\)))?\s*\)`;
const LINK_RE = new RegExp(String.raw`(!?)\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\((\s*)${INLINE_TARGET}`, 'g');
// 图片作为链接文字（常见徽章写法）：[![alt](img)](link)
const NESTED_IMAGE_LINK_RE = new RegExp(String.raw`\[(!\[[^\]\n]*\]\((?:\\[()\\]|\\(?![()\\])|[^()\n\\]|\((?:\\[()\\]|\\(?![()\\])|[^()\n\\])*\))*\))\]\(\s*${INLINE_TARGET}`, 'g');
const BADGE_IMAGE_RE = new RegExp(String.raw`^(!?)\[([^\]\n]*)\]\(\s*${INLINE_TARGET}$`);
// 捕获容器前缀，跨行目标必须留在同一个引语或列表项中；脚注仍另行排除。
const REF_DEF_RE = /^(\s{0,3}(?:(?:>\s{0,3})|(?:[-*+]|\d+[.)])\s+)*)\[([^\]]+)\]:\s*(.*)$/;
const REF_TARGET_RE = /^[ \t]*(<(?:\\[<>]|[^<>])*>|[^\s<>]+)(?:[ \t]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))?[ \t]*$/;
const REF_CONTINUATION_BLOCK_RE = /^(?:-+|=+|\*{3,}|_{3,}|[*+]|#{1,6}|\d+[.)])$/;
// 引用式使用：完整 [text][label]、折叠 [label][]、快捷 [label]；快捷形式歧义大，只用于「定义是否被使用」
const REF_USAGE_RE = /(!?)\[([^\]]*)\](?:\[([^\]]*)\])?/g;
// 空目标：[]()、[]( "title")、[](<>) 等；]("title") 的引号是 destination 的一部分，不算空
const EMPTY_TARGET_RE = /(!?)\[[^\]]*\]\(\s*(?:\)|<>\s*(?:"[^"]*"|'[^']*'|\((?:\\.|[^()\\])*\))?\s*\)|\s+(?:"[^"]*"|'[^']*'|\((?:\\.|[^()\\])*\))\s*\))/g;
// 只遮掉奇数个反斜杠末尾的转义；保留前面的字面反斜杠对。
const ESCAPED_BRACKET_RE = /(?<!\\)((?:\\\\)*)\\[\[\]]/g;
const ESCAPED_OPEN_BRACKET_RE = /(?<!\\)((?:\\\\)*)\\\[/g;
const maskEscapedBracket = (_match, pairs) => pairs + '  ';
const MASTER_RE = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:tree|blob)\/master(?=[/?#)\s]|$)/gi;
// 顶层与容器（blockquote/列表）内的围栏
const CONTAINER_FENCE_RE = /^\s{0,3}(?:(?:>\s{0,3})|(?:[-*+]|\d+[.)])\s+)*(`{3,}|~{3,})(.*)$/;
// 原始 HTML 块：<pre>/<script>/<style>/<textarea>，块内不是 Markdown
const HTML_RAW_BLOCK_RE = /^\s{0,3}(?:(?:>\s{0,3})|(?:[-*+]|\d+[.)])\s+)*<(pre|script|style|textarea)\b/i;
// 完整匹配任意开始标签，避免把引号内的 > 或 <a ...> 当成独立标签边界。
const HTML_TAG_START_RE = /<[a-z][a-z0-9-]*(?=[\s/>]|$)/gi;
const HTML_TAG_RE = /^<([a-z][a-z0-9-]*)(?=[\s/>]|$)((?:\s+[^\s<>=/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>="'\x60]+))?)*)\s*\/?>/i;
const HTML_INLINE_TAG_RE = new RegExp(HTML_TAG_RE.source.slice(1) + String.raw`|</[a-z][a-z0-9-]*[ \t]*>`, 'gi');
const HTML_ATTR_RE = /([^\s=>/]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// 解析 srcset（HTML 规范风格）：跳过空白/逗号，URL 收集到空白为止（允许 URL 内含逗号，如 data URI），
// 再跳过描述符到下一个逗号；末尾逗号表示该候选无描述符。
function parseSrcset(value) {
  const urls = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) index++;
    if (index >= value.length) break;
    const start = index;
    while (index < value.length && !/\s/.test(value[index])) index++;
    let url = value.slice(start, index);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      if (url) urls.push(url);
      continue;
    }
    while (index < value.length && value[index] !== ',') index++;
    if (index < value.length) index++;
    if (url) urls.push(url);
  }
  return urls;
}
const LINK_TARGET_URL_RE = /\]\(\s*<?(https?:\/\/[^\s()<>）】」》]+)/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"'`()）】」》]+/g;

function usageError(message) {
  process.stderr.write('pre-scan: ' + message + '\n');
  process.exit(2);
}

const toPosix = (p) => sep === '/' ? p : p.split(sep).join('/');

// 输出文件必须互不覆盖，也不能覆盖 Markdown、脚本或输入基线。
function canonicalPath(file) {
  const abs = resolve(file);
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  return parent === abs ? abs : join(canonicalPath(parent), basename(abs));
}
function sameFile(a, b) {
  if (canonicalPath(a) === canonicalPath(b)) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const left = statSync(a);
  const right = statSync(b);
  return left.dev === right.dev && left.ino === right.ino;
}
function validateOutputs(reportPath, baselineOutPath, baselineInputPath) {
  const outputs = [reportPath, baselineOutPath].filter((file) => file !== null);
  for (const file of outputs) {
    if (MD_EXT.test(file) || MD_EXT.test(canonicalPath(file))) {
      usageError('output must not overwrite Markdown: ' + file);
    }
    if (sameFile(file, fileURLToPath(import.meta.url))) {
      usageError('output must not overwrite scanner: ' + file);
    }
    if (baselineInputPath !== null && sameFile(file, baselineInputPath)) {
      usageError('output must not overwrite input baseline: ' + file);
    }
  }
  if (outputs.length === 2 && sameFile(outputs[0], outputs[1])) {
    usageError('--report-out and --write-baseline must use different files');
  }
}

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
      usageError('cannot read directory: ' + dir + ' (' + err.message + ')');
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

// 计算同行反引号段的闭合位置；注释与代码按起点顺序消费这些位置。
function inlineCodeRuns(line) {
  const runs = [...line.matchAll(/`+/g)];
  // 从右向左记录最近的等长闭合段，避免不匹配时回溯或拆分反引号段。
  const nextByLength = new Map();
  const closing = new Array(runs.length);
  const openingStarts = new Array(runs.length);
  for (let i = runs.length - 1; i >= 0; i--) {
    const { index, 0: delimiters } = runs[i];
    let backslashes = 0;
    while (line[index - backslashes - 1] === '\\') backslashes++;
    // 仅在代码外，反斜杠可以转义这段的第一个反引号。
    const escaped = backslashes % 2;
    openingStarts[i] = index + escaped;
    const openerLength = delimiters.length - escaped;
    if (openerLength > 0) closing[i] = nextByLength.get(openerLength);
    nextByLength.set(delimiters.length, i);
  }
  return { runs, closing, openingStarts };
}

// 注释内部只识别真实的 -->；代码 span 内的注释定界符视为字面文本。
function scanInline(line, commentOpen, onComment) {
  const { runs, closing, openingStarts } = inlineCodeRuns(line);
  const prose = [];
  const links = [];
  let cursor = 0;
  let run = 0;
  let openAt = commentOpen ? -1 : line.indexOf('<!--');
  const starts = new RegExp(HTML_TAG_START_RE);
  let nextTag = starts.exec(line);
  while (cursor < line.length) {
    if (commentOpen || openAt === cursor) {
      const end = line.indexOf('-->', commentOpen ? cursor : cursor + 4);
      if (end < 0) {
        const rest = line.slice(cursor).replace(/[^\n]/g, ' ');
        return { commentOpen: true, prose: prose.join('') + rest, links: links.join('') + rest };
      }
      if (!commentOpen) onComment?.(line.slice(cursor + 4, end), cursor);
      const blank = line.slice(cursor, end + 3).replace(/[^\n]/g, ' ');
      prose.push(blank);
      links.push(blank);
      cursor = end + 3;
      commentOpen = false;
      openAt = line.indexOf('<!--', cursor);
      continue;
    }
    while (run < runs.length && (runs[run].index < cursor || closing[run] === undefined)) run++;
    const codeStart = openingStarts[run] ?? Infinity;
    while (nextTag && nextTag.index < cursor) nextTag = starts.exec(line);
    const tagStart = nextTag?.index ?? Infinity;
    const commentStart = openAt < 0 ? Infinity : openAt;
    if (tagStart < codeStart && tagStart < commentStart && tagStart === cursor) {
      const tag = line.slice(cursor).match(HTML_TAG_RE);
      if (tag) {
        prose.push(tag[0]);
        links.push(tag[0]);
        cursor += tag[0].length;
        if (openAt >= 0 && openAt < cursor) openAt = line.indexOf('<!--', cursor);
        continue;
      }
      nextTag = starts.exec(line);
      continue;
    }
    if (codeStart < commentStart && codeStart < tagStart) {
      const last = runs[closing[run]];
      const end = last.index + last[0].length;
      prose.push(line.slice(cursor, end));
      links.push(line.slice(cursor, codeStart), line.slice(codeStart, end).replace(/[^\n]/g, ' '));
      cursor = end;
      if (openAt >= 0 && openAt < cursor) openAt = line.indexOf('<!--', cursor);
      continue;
    }
    const end = Math.min(line.length, commentStart, tagStart);
    const visible = line.slice(cursor, end);
    prose.push(visible);
    links.push(visible);
    cursor = end;
  }
  return { commentOpen, prose: prose.join(''), links: links.join('') };
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
const NAMED_ENTITIES = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ['AMP', '&'], ['LT', '<'], ['GT', '>'], ['QUOT', '"'],
]);
function decodeEntities(text, markdown = false) {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec || hex) {
      const digits = dec ?? hex;
      if (markdown && digits.length > (dec ? 7 : 6)) return match;
      const code = parseInt(digits, dec ? 10 : 16);
      // CommonMark 将 NUL、代理区间和 Unicode 范围外的值替换为 U+FFFD。
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES.get(name) ?? match;
  });
}
// Markdown destination：先去语法尖括号，再单次处理原始转义与实体；生成字符不再参与转义解析。
// 百分号解码仍由 checkLink 在拆分路径后执行，HTML 属性不经过这里，防止二次实体解码。
function markdownTarget(raw) {
  return String(raw || '').trim().replace(/^<|>$/g, '')
    .replace(/\\[!-/:-@\[-\x60{-~]|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi,
      (token) => token.startsWith('\\') ? token.slice(1) : decodeEntities(token, true));
}

// 提取围栏标记：返回 {char, len, info}；顶层、blockquote、列表内的围栏都识别
function fenceTokenOf(line) {
  const m = line.match(CONTAINER_FENCE_RE);
  if (!m) return null;
  return { char: m[1][0], len: m[1].length, info: m[2] };
}

function blockquotePrefix(line) {
  return line.match(/^(?: {0,3}> ?)+/)?.[0] ?? '';
}

function blockquoteDepth(prefix) {
  return (prefix.match(/>/g) || []).length;
}

// 剥离 blockquote / 列表标记，便于识别容器内的 setext 标题
function stripContainerPrefix(line) {
  let text = line.slice(blockquotePrefix(line).length);
  const list = text.match(/^\s*(?:[-*+]|\d+[.)])\s+/);
  if (list) text = text.slice(list[0].length);
  return text;
}

function referenceContinuation(prefix, next) {
  if (!next || REF_DEF_RE.test(next)) return '';
  const quote = blockquotePrefix(prefix);
  const nextQuote = blockquotePrefix(next);
  if (blockquoteDepth(quote) !== blockquoteDepth(nextQuote)) return '';
  const content = next.slice(nextQuote.length);
  const listPrefix = prefix.slice(quote.length);
  const indent = content.match(/^[ \t]*/)[0].length;
  const listIndent = listPrefix.trim() ? listPrefix.length : 0;
  if (indent < listIndent || indent > listIndent + 3) return '';
  if (REF_CONTINUATION_BLOCK_RE.test(content.trim())) return '';
  return content;
}

// 标题先取渲染文本（去 HTML 标签、链接语法、行内代码标记），再解码实体，最后算 slug
function headingPlainText(raw) {
  const rendered = raw.replace(LINK_RE, (_match, _image, label) => label)
    .replace(HTML_INLINE_TAG_RE, '').replace(/`/g, '').trim();
  return decodeEntities(rendered, true).trim();
}

// 向上查找最近的 .git，用于判断相对链接是否逃出仓库根
const repoRootCache = new Map();
function findRepoRoot(startDir) {
  let dir = resolve(startDir);
  const visited = [];
  for (;;) {
    if (repoRootCache.has(dir)) {
      const root = repoRootCache.get(dir);
      for (const visitedDir of visited) repoRootCache.set(visitedDir, root);
      return root;
    }
    visited.push(dir);
    if (existsSync(join(dir, '.git'))) {
      for (const visitedDir of visited) repoRootCache.set(visitedDir, dir);
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const visitedDir of visited) repoRootCache.set(visitedDir, null);
      return null;
    }
    dir = parent;
  }
}

// 统一标记 Markdown 正文与可检查的链接位置，不读取文件或决定候选处置。
function isPlainParagraphLine(line) {
  return Boolean(line.trim()) && !/^[ \t]{4}|^\t|^ {0,3}(?:>|#{1,6}(?:\s|$)|[-*+]\s|\d+[.)]\s|<|~~~|`{3,}|(?:[-*_][ \t]*){3,}$|(?:-+|=+)\s*$)/.test(line) &&
    !REF_DEF_RE.test(line);
}

function maskMarkdown(content, fences, listLines) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/); // 兼容 BOM / CRLF / CR
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

  // 围栏代码块：顶层与容器（blockquote/列表）内围栏都识别，内容整体忽略。
  // 同时忽略 <pre>/<script>/<style>/<textarea> 原始 HTML 块，并跟踪 HTML 注释：
  // 注释里的围栏标记不算围栏，避免把注释之后的正文一起吞掉。
  let fence = null;
  let commentOpen = false;
  const linkMasked = new Array(lines.length).fill('');
  const commentMasked = new Array(lines.length).fill('');
  const suppressed = new Set();
  let markersDisabled = false;
  const scanRows = (start, end) => {
    const comments = new Map();
    let row = start;
    let offset = 0;
    const scan = scanInline(lines.slice(start, end).join('\n'), commentOpen, (body, position) => {
      while (row + 1 < end && offset + lines[row].length < position) offset += lines[row++].length + 1;
      if (!body.includes('\n')) {
        if (!comments.has(row)) comments.set(row, []);
        comments.get(row).push(body.trim());
      }
    });
    commentOpen = scan.commentOpen;
    const prose = scan.prose.split('\n');
    const links = scan.links.split('\n');
    for (let i = start; i < end; i++) {
      if (markersDisabled) suppressed.add(i);
      for (const body of comments.get(i) ?? []) {
        if (MARKER_DISABLE_BODY_RE.test(body)) {
          markersDisabled = true;
          suppressed.add(i);
        } else if (MARKER_ENABLE_BODY_RE.test(body)) {
          if (markersDisabled) suppressed.add(i);
          markersDisabled = false;
        } else if (MARKER_IGNORE_NEXT_BODY_RE.test(body)) {
          if (i + 1 < lines.length) suppressed.add(i + 1);
        } else if (MARKER_IGNORE_LINE_BODY_RE.test(body)) {
          suppressed.add(i);
        }
      }
      commentMasked[i] = prose[i - start];
      linkMasked[i] = links[i - start].replace(ESCAPED_OPEN_BRACKET_RE, maskEscapedBracket);
    }
  };
  let htmlRawBlock = null;
  let indentedCode = false;
  let listContentIndent = 0;
  let listQuoteDepth = 0;
  let canStartIndentedCode = true; // 文件开头、空行、围栏/HTML 块/标题之后允许缩进代码
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const line = lines[i];
    const quotePrefix = blockquotePrefix(line);
    const quoteDepth = blockquoteDepth(quotePrefix);
    const contentLine = line.slice(quotePrefix.length);
    let fenceLine = line;
    let quoteRemaining = fence?.quoteDepth ?? 0;
    while (quoteRemaining > 0) {
      const prefix = fenceLine.match(/^ {0,3}> ?/)?.[0];
      if (!prefix) break;
      fenceLine = fenceLine.slice(prefix.length);
      quoteRemaining--;
    }
    const leadingSpace = fenceLine.match(/^ */)[0].length;
    if (fence && (quoteRemaining > 0 ||
        (fence.listIndent && fenceLine.trim() && leadingSpace < fence.listIndent))) {
      fence = null; // 容器结束，当前行按正文继续解析。
      canStartIndentedCode = true;
    }
    if (fence) {
      ignored[i] = true;
      const close = fenceLine.slice(fence.listIndent).match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
      if (close && close[0] === fence.char && close.length >= fence.len) {
        if (fences && !fence.listIndent) fences.push({ start: fence.start, end: i });
        fence = null;
        canStartIndentedCode = true;
      }
      continue;
    }
    if (htmlRawBlock && (quoteDepth < htmlRawBlock.quoteDepth ||
        (htmlRawBlock.listIndent && contentLine.trim() && contentLine.match(/^ */)[0].length < htmlRawBlock.listIndent))) {
      htmlRawBlock = null;
      canStartIndentedCode = true;
    }
    if (htmlRawBlock) {
      ignored[i] = true;
      if (new RegExp('</' + htmlRawBlock.tag + '\\s*>', 'i').test(line)) {
        htmlRawBlock = null;
        canStartIndentedCode = true;
      }
      continue;
    }
    if (commentOpen) {
      scanRows(i, i + 1);
      if (!commentOpen) canStartIndentedCode = true;
      continue; // 注释内容不是 Markdown，不参与围栏判断
    }
    // 缩进代码块（近似块上下文）：4 空格/tab 缩进、前一行为空/文件开头，且不在列表续行内。
    // blockquote 前缀先剥掉再算缩进；保留 fence/raw HTML/注释的优先级。
    if (quoteDepth !== listQuoteDepth) {
      listContentIndent = 0;
      listQuoteDepth = quoteDepth;
    }
    if (indentedCode) {
      if (!contentLine.trim()) {
        ignored[i] = true;
        continue;
      }
      const codeIndent = contentLine.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      if (codeIndent >= listContentIndent + 4) {
        ignored[i] = true;
        continue;
      }
      indentedCode = false;
    }
    const contentTrimmed = contentLine.trim();
    const contentIndent = contentLine.match(/^\s*/)[0].replace(/\t/g, '    ').length;
    const listMarker = contentLine.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (contentTrimmed) {
      if (listMarker) {
        if (!listLines || !listContentIndent || contentIndent < listContentIndent) {
          listContentIndent = listMarker[0].length;
        }
        listQuoteDepth = quoteDepth;
      } else if (contentIndent < listContentIndent) {
        listContentIndent = 0;
      }
      if (listLines && listContentIndent > 0) listLines.add(i);
      if (!listMarker && canStartIndentedCode && contentIndent >= listContentIndent + 4 &&
        !fenceTokenOf(contentLine) && !HTML_RAW_BLOCK_RE.test(contentLine)) {
        indentedCode = true;
        ignored[i] = true;
        canStartIndentedCode = false;
        continue;
      }
    }
    if (!contentTrimmed) {
      canStartIndentedCode = true;
    } else {
      // 标题 / 分隔线 / setext 下划线之后，缩进代码可以不带空行直接开始
      canStartIndentedCode = /^\s{0,3}#{1,6}(?:\s|$)/.test(contentLine) ||
        /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(contentLine) ||
        /^\s{0,3}(?:=+|-+)\s*$/.test(contentLine);
    }
    const token = listContentIndent > 0 && !listMarker
      ? fenceTokenOf(contentLine.slice(listContentIndent)) : fenceTokenOf(line);
    if (token) {
      if (!(token.char === '`' && token.info.includes('`'))) {
        fence = { char: token.char, len: token.len, quoteDepth, listIndent: listContentIndent, start: i };
        ignored[i] = true;
      }
      continue;
    }
    const rawOpen = line.match(HTML_RAW_BLOCK_RE);
    if (rawOpen) {
      const tag = rawOpen[1].toLowerCase();
      ignored[i] = true;
      if (!new RegExp('</' + tag + '\\s*>', 'i').test(line)) htmlRawBlock = { tag, quoteDepth, listIndent: listContentIndent };
      continue;
    }
    let end = i + 1;
    if (!listContentIndent && !quoteDepth && isPlainParagraphLine(line)) {
      while (end < lines.length && !ignored[end] && isPlainParagraphLine(lines[end])) end++;
    }
    scanRows(i, end);
    i = end - 1;
  }



  return { lines, ignored, linkMasked, commentMasked, suppressed };
}

// 版本标题忽略列表内容；保留引语前缀，以便调用方只匹配顶层 ATX。
export function visibleMarkdownLines(content) {
  const listLines = new Set();
  const { commentMasked } = maskMarkdown(content, undefined, listLines);
  return commentMasked.filter((_, i) => !listLines.has(i));
}

// 仓库文档自检：只接受紧跟可见二级标题、明确闭合的顶层围栏。
export function fencedSectionBody(content, heading) {
  const fences = [];
  const { lines, commentMasked, ignored } = maskMarkdown(content, fences);
  for (const { start, end } of fences) {
    if (!/^ {0,3}(?:`{3,}|~{3,})/.test(lines[start])) continue;
    let i = start - 1;
    while (i >= 0 && !ignored[i] && !commentMasked[i].trim()) i--;
    if (i < 0 || ignored[i]) continue;
    const headingText = commentMasked[i].match(/^ {0,3}##[ \t]+(.*)$/)?.[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
    if (headingText === heading && /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(lines[end])) {
      return lines.slice(start + 1, end).join('\n');
    }
  }
  return undefined;
}

// 保留 BOM 给各输入格式自行处理，不用替换字符静默掩盖非法字节。
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function decodeUtf8(bytes) {
  return strictUtf8.decode(bytes);
}
function readUtf8File(absPath, label) {
  let bytes;
  try {
    bytes = readFileSync(absPath);
  } catch (err) {
    usageError('cannot read ' + label + ' file: ' + absPath + ' (' + err.message + ')');
  }
  try {
    return decodeUtf8(bytes);
  } catch (err) {
    usageError('invalid UTF-8 in ' + label + ' file: ' + absPath + ' (' + err.message + ')');
  }
}

// 解析单个 Markdown 文件：标题、引用、规范化行集合及文件上下文。
function analyzeFile(absPath, targetAbs) {
  const content = readUtf8File(absPath, 'Markdown');
  const { lines, ignored, linkMasked, commentMasked, suppressed } = maskMarkdown(content);

  // ATX 与 setext 标题按文档顺序收集；slug 统一生成，复现 GitHub 对重复标题追加 -1/-2 的规则
  const headings = [];
  const setextLines = new Set(); // 标题文本行 + 下划线行，段落去重时跳过
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const m = stripContainerPrefix(commentMasked[i]).match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (m) {
      const text = m[2].replace(/[ \t]+#+\s*$/, '').trim();
      if (text) headings.push({ line: i + 1, level: m[1].length, text: text });
      continue;
    }
    if (i + 1 >= lines.length || ignored[i + 1]) continue;
    const underlineText = stripContainerPrefix(commentMasked[i + 1]).trim();
    const underline = underlineText.match(/^(=+|-+)$/);
    if (!underline) continue;
    const underlineQuoteDepth = blockquoteDepth(blockquotePrefix(commentMasked[i + 1]));
    // 标题文本是下划线前紧邻的段落，不能跨引语边界。
    const collected = [];
    let startLine = i;
    for (let j = i; j >= 0; j--) {
      if (ignored[j] || blockquoteDepth(blockquotePrefix(commentMasked[j])) !== underlineQuoteDepth) break;
      const stripped = stripContainerPrefix(commentMasked[j]).trim();
      if (!stripped) break;
      if (/^#{1,6}(?:\s|$)/.test(stripped) || /^\s{0,3}</.test(stripped) ||
        /^(?:=+|-+)$/.test(stripped) || /^\[[^\]]+\]:/.test(stripped)) break;
      collected.unshift(stripped);
      startLine = j;
    }
    if (collected.length === 0) continue;
    headings.push({
      line: startLine + 1,
      level: underline[1][0] === '=' ? 1 : 2,
      text: collected.join(' '),
    });
    for (let j = startLine; j <= i + 1; j++) setextLines.add(j);
    i += 1;
  }
  const headingSlugs = new Set();
  const nextHeadingSuffix = new Map();
  for (const heading of headings) {
    const base = slugify(headingPlainText(heading.text));
    let slug = base;
    if (headingSlugs.has(slug)) {
      let suffix = nextHeadingSuffix.get(base) ?? 1;
      do { slug = base + '-' + (suffix++); } while (headingSlugs.has(slug));
      // 已跳过的后缀不会释放；其他标题仍可占用尚未分配的后缀。
      nextHeadingSuffix.set(base, suffix);
    }
    if (slug) headingSlugs.add(slug);
    heading.slug = slug;
  }

  // 锚点、链接和 Markdown 正文复用同一组 HTML 标签区间。
  const explicitAnchors = new Set();
  const htmlLinks = [];
  const tags = [...htmlStartTags({ linkMasked, ignored })];
  const referenceText = maskHtmlTagRanges(linkMasked, tags);
  for (const { line, tagName, attrs } of tags) {
    const image = tagName === 'img' || tagName === 'source';
    const seen = new Set();
    for (const [, rawName, quoted, singleQuoted, bare] of attrs.matchAll(HTML_ATTR_RE)) {
      const name = rawName.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name); // 首个值为空或没有值时，也不能用后续同名属性覆盖。
      const value = quoted ?? singleQuoted ?? bare;
      if (!value) continue;
      if (name === 'id' || (tagName === 'a' && name === 'name')) {
        const anchor = decodeEntities(value).trim();
        if (anchor) explicitAnchors.add(anchor);
      } else if ((tagName === 'a' && name === 'href') || (image && name === 'src')) {
        htmlLinks.push({ line, target: decodeEntities(value), image });
      } else if (image && name === 'srcset') {
        for (const target of parseSrcset(decodeEntities(value))) htmlLinks.push({ line, target, image });
      }
    }
  }

  // 引用式链接：定义 [label]: target 与使用 [text][label] / [label][] / [label]
  // 脚注 [^label]: ... 不是链接定义，先排除，避免把脚注正文当成本地路径
  const refDefinitions = [];
  const multiline = collectMultilineTargets(referenceText, lines);
  const labelUsage = new Map(); // 归一标签 -> { link, image }
  const explicitUses = []; // 完整/折叠形式用于未定义诊断。
  const shortcutLinks = []; // 只有匹配到有效定义后才参与重复计数。
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
    const masked = referenceText[i];
    const def = masked.match(REF_DEF_RE);
    if (def && !def[2].startsWith('^')) {
      const [, prefix, label, rest] = def;
      // 只有同一行没写目标才尝试续行；<> 是显式空目标，不借用下一行。
      const source = rest.trim() ? rest : referenceContinuation(prefix, referenceText[i + 1]);
      const target = source.match(REF_TARGET_RE)?.[1];
      refDefinitions.push({
        line: i + 1, label, normalized: normalizeLabel(label),
        target: target === '<>' ? '' : target, invalidTarget: Boolean(source.trim() && target === undefined),
      });
      if (!rest.trim() && target !== undefined) i++; // 已消费的续行也不是引用使用。
      continue; // 定义行本身不算使用
    }
    // 脚注定义行不是链接定义，但其正文里可能还有引用式链接，继续向下扫描使用
    // 先去掉行内链接/图片与转义方括号，避免误判成引用式使用
    const usageText = multiline.remaining[i]
      .replace(NESTED_IMAGE_LINK_RE, (match) => ' '.repeat(match.length))
      .replace(LINK_RE, (match) => ' '.repeat(match.length))
      .replace(ESCAPED_BRACKET_RE, maskEscapedBracket);
    for (const m of usageText.matchAll(REF_USAGE_RE)) {
      const isImage = m[1] === '!';
      if (m[3] !== undefined) {
        const label = m[3] === '' ? m[2] : m[3];
        const normalized = addUsage(label, isImage);
        if (normalized) explicitUses.push({ line: i + 1, label: label, normalized: normalized, image: isImage });
      } else if (m[2]) {
        const normalized = addUsage(m[2], isImage);
        if (normalized && !isImage) shortcutLinks.push({ line: i + 1, normalized });
      }
    }
  }

  // 文件相似度用的规范化非空行集合（代码块与 HTML 注释内容不计入）
  const nonEmptyLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (ignored[i]) continue;
    const normalized = commentMasked[i].replace(/\s+/g, ' ').trim();
    if (normalized) nonEmptyLines.add(normalized);
  }
  const rel = toPosix(relative(targetAbs, absPath));
  return {
    absPath: absPath,
    rel: rel,
    repoRoot: findRepoRoot(dirname(absPath)),
    context: contextOf(rel),
    lines: lines,
    ignored: ignored,
    headings: headings,
    headingSlugs: headingSlugs,
    setextLines: setextLines,
    explicitAnchors: explicitAnchors,
    htmlLinks: htmlLinks,
    multiline,
    linkMasked: linkMasked,
    commentMasked: commentMasked,
    suppressed: suppressed,
    refDefinitions: refDefinitions,
    labelUsage: labelUsage,
    explicitUses: explicitUses,
    shortcutLinks,
    nonEmptyLines: nonEmptyLines,
  };
}

// matchAll 按顺序返回互不重叠的匹配；alternation 的优先级已由正则定义。
function phraseHits(text, re) {
  return Array.from(text.matchAll(re), (match) => match[0]);
}

// 目录名缓存：大小写核对要逐段 readdir，避免同一目录重复读取
const dirEntries = new Map();
function listDir(dir) {
  if (!dirEntries.has(dir)) {
    let names = null;
    try {
      names = readdirSync(dir);
    } catch (err) {
      if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(err.code)) {
        usageError('cannot read link target directory: ' + dir + ' (' + err.message + ')');
      }
    }
    dirEntries.set(dir, names);
  }
  return dirEntries.get(dir);
}
// 逐段核对磁盘上的真实大小写。Windows/macOS 的文件系统不区分大小写，existsSync 会放行
// 在 Linux/CI 上必然 404 的路径；这里按 readdir 的真实文件名比对，跨平台结果一致。
function resolveOnDisk(absTarget) {
  const root = parse(absTarget).root;
  const segments = absTarget.slice(root.length).split(sep).filter(Boolean);
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

function* inlineMarkdownTargets(masked) {
  // 徽章内外目标各处理一次；遮掉整段后再匹配其他链接。
  let remaining = masked;
  for (const nested of masked.matchAll(NESTED_IMAGE_LINK_RE)) {
    const inner = nested[1].match(BADGE_IMAGE_RE);
    if (inner) yield { target: markdownTarget(inner[3]), image: true };
    yield { target: markdownTarget(nested[2]), image: false };
    remaining = remaining.slice(0, nested.index) + ' '.repeat(nested[0].length) +
      remaining.slice(nested.index + nested[0].length);
  }
  for (const m of remaining.matchAll(LINK_RE)) {
    if (/^["']/.test(m[4]) && m[3].length > 0) continue; // 空目标 + 标题，交给 EMPTY_TARGET_RE
    yield { target: markdownTarget(m[4]), image: m[1] === '!' };
  }
}

// 仅在普通正文的连续行内识别基本跨行内联链接。容器、代码标记、
// HTML 块边界和定义仍按各自规则处理，不把全文拼接为一个段落。
const MULTILINE_LINK_RE = new RegExp(String.raw`(?<!!)(?<!\[)\[([^\[\]]+)\]\((\s*)${INLINE_TARGET}`, 'g');
function collectMultilineTargets(linkMasked, lines) {
  const remaining = linkMasked.slice();
  const targets = [];
  const ordinary = (i) => {
    if (!linkMasked[i]?.trim()) return false;
    if (isPlainParagraphLine(lines[i])) return true;
    // 仅把明确的尖括号相对目标当作链接续行，不把 HTML 标签并入正文。
    return /^ {0,3}<(?:\.\.?\/)[^<>\n]+>/.test(linkMasked[i]);
  };
  for (let start = 0; start < lines.length;) {
    if (!ordinary(start)) { start++; continue; }
    let end = start + 1;
    const offsets = [0];
    while (end < lines.length && ordinary(end)) {
      offsets.push(offsets.at(-1) + linkMasked[end - 1].length + 1);
      end++;
    }
    if (end - start > 1) {
      const paragraph = linkMasked.slice(start, end).join('\n');
      let row = 0;
      for (const m of paragraph.matchAll(MULTILINE_LINK_RE)) {
        if (!m[0].includes('\n') || !m[3] || (m[2] && /^["']/.test(m[3]))) continue;
        while (row + 1 < offsets.length && offsets[row + 1] <= m.index) row++;
        targets.push({ line: start + row + 1, target: markdownTarget(m[3]), image: false });
        let part = row;
        const stop = m.index + m[0].length;
        while (part < offsets.length && offsets[part] < stop) {
          const lineIndex = start + part;
          const from = Math.max(0, m.index - offsets[part]);
          const to = Math.min(remaining[lineIndex].length, stop - offsets[part]);
          remaining[lineIndex] = remaining[lineIndex].slice(0, from) + ' '.repeat(to - from) + remaining[lineIndex].slice(to);
          part++;
        }
      }
    }
    start = end;
  }
  return { targets, remaining };
}

// README 自洽检查仅复用内联解析，不套用预扫候选的抑制标记。
export function* inlineMarkdownTargetsIn(content) {
  const { lines, ignored, linkMasked } = maskMarkdown(content);
  const text = maskHtmlTagRanges(linkMasked, htmlStartTags({ linkMasked, ignored }));
  const { targets, remaining } = collectMultilineTargets(text, lines);
  yield* targets;
  for (const line of remaining) yield* inlineMarkdownTargets(line);
}

export function splitLinkTarget(target) {
  const hashAt = target.indexOf('#');
  const beforeHash = hashAt >= 0 ? target.slice(0, hashAt) : target;
  const rawAnchor = hashAt >= 0 ? target.slice(hashAt + 1) : '';
  const pathPart = beforeHash.split('?')[0];
  let decodedPath = pathPart;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch (err) {
    // 无法解码时把路径按字面值检查。
  }
  return { pathPart, rawAnchor, decodedPath };
}

function maskHtmlTagRanges(text, tags) {
  const masked = text.slice();
  for (const { line, startColumn, endLine, endColumn } of tags) {
    for (let row = line - 1; row < endLine; row++) {
      const from = row === line - 1 ? startColumn : 0;
      const to = row === endLine - 1 ? endColumn : masked[row].length;
      masked[row] = masked[row].slice(0, from) + ' '.repeat(to - from) + masked[row].slice(to);
    }
  }
  return masked;
}

// 只在完整识别标签后跳过已消费文本；闭合行同一位置之后的标签仍继续扫描。
function* htmlStartTags(doc) {
  const { linkMasked, ignored } = doc;
  const starts = new RegExp(HTML_TAG_START_RE);
  let i = 0;
  let checkedLine = -1;
  let markdownRanges;
  let rangeIndex;
  while (i < linkMasked.length) {
    const start = starts.exec(linkMasked[i]);
    if (!start) {
      i++; // 全局正则失败时自动重置 lastIndex
      continue;
    }
    if (checkedLine !== i) {
      checkedLine = i;
      markdownRanges = [...linkMasked[i].matchAll(LINK_RE)];
      rangeIndex = 0;
    }
    while (markdownRanges[rangeIndex] && markdownRanges[rangeIndex].index + markdownRanges[rangeIndex][0].length <= start.index) rangeIndex++;
    const range = markdownRanges[rangeIndex];
    if (range && range.index < start.index) {
      starts.lastIndex = range.index + range[0].length;
      continue;
    }
    const line = i + 1;
    let source = linkMasked[i].slice(start.index);
    let tag = source.match(HTML_TAG_RE);
    if (!tag) {
      // 保留最多追加 20 行的原有边界，不跨代码、frontmatter 等忽略区。
      for (let j = i + 1; j < linkMasked.length && j <= i + 20 && !ignored[j]; j++) {
        source += '\n' + linkMasked[j];
      }
      tag = source.match(HTML_TAG_RE);
      if (!tag) continue;
    }
    const consumed = tag[0];
    let lastBreak = -1;
    for (let j = consumed.indexOf('\n'); j !== -1; j = consumed.indexOf('\n', j + 1)) {
      i++;
      lastBreak = j;
    }
    starts.lastIndex = lastBreak < 0 ? start.index + consumed.length : consumed.length - lastBreak - 1;
    yield { line, tagName: tag[1].toLowerCase(), attrs: tag[2],
      startColumn: start.index, endLine: i + 1, endColumn: starts.lastIndex };
  }
}

// 仅在本次扫描共享磁盘元数据；锚点、写法和候选仍逐条检查。
function inspectTarget(actualAbs, cache) {
  if (!cache.has(actualAbs)) {
    let stats;
    try {
      stats = statSync(actualAbs, { throwIfNoEntry: false });
    } catch (err) {
      if (!['ENOTDIR', 'ELOOP'].includes(err.code)) {
        usageError('cannot inspect link target: ' + actualAbs + ' (' + err.message + ')');
      }
    }
    cache.set(actualAbs, stats);
  }
  return cache.get(actualAbs);
}

export function inspectLocalPath(absTarget, decodedPath, isImage, cache) {
  if (decodedPath.includes('\\')) return { error: 'uses backslash separators' };
  const onDisk = resolveOnDisk(absTarget);
  const stats = onDisk.exists ? inspectTarget(onDisk.actualAbs, cache) : undefined;
  if (!stats) return { error: 'not found' };
  const requiresDirectory = /(?:\/|(?:^|\/)\.{1,2})$/.test(decodedPath);
  if (isImage && (requiresDirectory || !stats.isFile())) return { error: 'is not a file' };
  if (!isImage && requiresDirectory && !stats.isDirectory()) return { error: 'is not a directory' };
  return onDisk;
}

function detectLocal(doc, docsByAbs, add, targetStats) {
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
    const destination = targetDoc === doc ? '' : ' in ' + JSON.stringify(targetDoc.rel);
    add(doc, lineNo, 'broken-anchor', 'anchor #' + rawAnchor + destination + ' has no matching heading slug or explicit HTML anchor');
  };

  const checkLink = (lineNo, rawTarget, options) => {
    const isImage = Boolean(options && options.image);
    const target = String(rawTarget || '').trim(); // 调用方已移除 Markdown 语法包装；实体产生的尖括号是路径内容
    if (!target || target === '#') return;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return; // http(s)/mailto/tel/data 等外部协议
    if (target.startsWith('/')) return; // 站点根相对路径，无法确定基准目录
    const { pathPart, rawAnchor, decodedPath } = splitLinkTarget(target);
    if (!pathPart) {
      if (rawAnchor) checkAnchor(lineNo, doc.absPath, rawAnchor); // 同文件锚点
      return;
    }
    // Markdown 原始标点转义已在 markdownTarget 处理；不能把实体或百分号生成的反斜杠再当转义。
    // 非 Markdown 调用保留原有处理，避免本轮改变 HTML 路径语义。
    const unescapedPath = options && options.markdown ? decodedPath : decodedPath.replace(/\\([!-/:-@\[-\`{-~])/g, '$1');
    if (unescapedPath.includes('\\')) {
      // GitHub/Linux 不把 \ 当目录分隔符：本地 Windows 能打开，线上是 %5C 404
      add(doc, lineNo, isImage ? 'broken-local-image' : 'broken-local-link',
        'path uses backslash separators; use "/" instead (GitHub resolves "\\" as %5C); target: ' + JSON.stringify(pathPart));
      return;
    }
    const absTarget = resolve(dirname(doc.absPath), unescapedPath);
    if (doc.repoRoot) {
      const relToRoot = relative(doc.repoRoot, absTarget);
      if (relToRoot === '..' || relToRoot.startsWith('../') || relToRoot.startsWith('..\\') || parse(relToRoot).root) {
        add(doc, lineNo, 'link-outside-root',
          (isImage ? 'relative image' : 'relative link') + ' escapes repository root: ' + pathPart);
        return;
      }
    }
    const onDisk = inspectLocalPath(absTarget, unescapedPath, isImage, targetStats);
    if (onDisk.error) {
      add(doc, lineNo, isImage ? 'broken-local-image' : 'broken-local-link',
        (isImage ? 'relative image' : 'relative link') + ' target ' + onDisk.error + ': ' + pathPart);
      return;
    }
    if (onDisk.mismatch) {
      add(doc, lineNo, 'case-mismatch-link',
        (isImage ? 'image path' : 'path') + ' case differs from on-disk name: ' +
        onDisk.mismatch.linked + ' -> ' + onDisk.mismatch.disk +
        ' (case-sensitive file systems will 404); target: ' + JSON.stringify(pathPart));
    }
    if (rawAnchor && !isImage) checkAnchor(lineNo, onDisk.actualAbs, rawAnchor);
  };

  const duplicateTargets = new Map(); // 本地链接目标 -> { count, firstLine }
  const recordDuplicateTarget = (lineNo, target) => {
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(target)) return;
    if (doc.suppressed && doc.suppressed.has(lineNo - 1)) return;
    // 仅归并前导 ./，不改查询、锚点、大小写或其余路径段。
    const key = duplicateTargetKey(target);
    const entry = duplicateTargets.get(key) || { count: 0, firstLine: lineNo, firstTarget: target };
    entry.count++;
    if (lineNo < entry.firstLine) {
      entry.firstLine = lineNo;
      entry.firstTarget = target;
    }
    duplicateTargets.set(key, entry);
  };

  // 1.0) 原始 HTML 内链/图片（标签可跨行，含 srcset）
  for (const { line, target, image } of doc.htmlLinks) {
    checkLink(line, target, { image });
    if (!image) recordDuplicateTarget(line, target);
  }

  for (const { line, target } of doc.multiline.targets) {
    checkLink(line, target, { markdown: true });
    recordDuplicateTarget(line, target);
  }

  // 1) 链接 / 锚点 / 硬编码 master 分支 / URL 后贴全角标点
  for (let i = 0; i < lines.length; i++) {
    if (doc.ignored[i]) continue;
    const lineNo = i + 1;
    const masked = doc.linkMasked[i] || '';
    for (const { target, image } of inlineMarkdownTargets(doc.multiline.remaining[i])) {
      checkLink(lineNo, target, { image, markdown: true });
      if (!image) recordDuplicateTarget(lineNo, target);
    }
    for (const m of doc.multiline.remaining[i].matchAll(EMPTY_TARGET_RE)) {
      add(doc, lineNo, 'empty-link-target',
        (m[1] === '!' ? 'image' : 'link') + ' target is empty: ' + m[0].trim());
    }
    // 原始 HTML 标签由下方的跨行遍历统一处理
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

  // 1.0.1) 同一本地链接目标在单文件重复出现（内联/HTML/引用式链接合并计数）
  const refTargetByLabel = new Map();
  for (const def of doc.refDefinitions) {
    // 显式 <> 是有效的空目标，仍占据首定义；无法解析的候选则不占位。
    if (def.normalized && def.target !== undefined && !refTargetByLabel.has(def.normalized)) {
      refTargetByLabel.set(def.normalized, markdownTarget(def.target));
    }
  }
  for (const use of [...doc.explicitUses, ...doc.shortcutLinks]) {
    if (use.image) continue;
    const target = refTargetByLabel.get(use.normalized);
    if (target) recordDuplicateTarget(use.line, target);
  }
  for (const entry of duplicateTargets.values()) {
    if (entry.count < DUPLICATE_LINK_THRESHOLD) continue;
    add(doc, entry.firstLine, 'duplicate-link-target',
      'same link target appears ' + entry.count + ' times in this file: ' + entry.firstTarget);
  }

  // 1.1) 引用式定义：目标有效性 / 空目标 / 重复定义 / 未被引用；以及引用了不存在的定义
  const definedLabels = new Set(doc.refDefinitions.map((def) => def.normalized).filter(Boolean));
  const firstDefinitionLine = new Map();
  for (const def of doc.refDefinitions) {
    if (!def.normalized) continue;
    const usage = doc.labelUsage.get(def.normalized);
    if (!def.target) {
      add(doc, def.line, 'empty-link-target', 'reference definition [' + def.label + ']' +
        (def.invalidTarget ? ' has no valid destination' : ' has an empty target'));
    } else {
      const target = markdownTarget(def.target);
      if (!usage?.image || usage.link) checkLink(def.line, target, { image: false, markdown: true });
      if (usage?.image) checkLink(def.line, target, { image: true, markdown: true });
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
    const prose = maskUrls(doc.linkMasked[i]);
    if (!prose.trim()) continue;
    for (const phrase of phraseHits(prose, STALE_RE)) add(doc, i + 1, 'stale-time-phrase', phrase);
    for (const phrase of phraseHits(prose, PLACEHOLDER_RE)) add(doc, i + 1, 'placeholder-marker', phrase);
  }

  // 3) 重复标题（同层级同文本，大小写与空白归一）与多个 H1
  const normalizedHeading = (heading) => heading.text.toLowerCase().replace(/\s+/g, ' ').trim();
  const firstHeadingLine = new Map();
  for (const heading of doc.headings) {
    const key = heading.level + '|' + normalizedHeading(heading);
    if (firstHeadingLine.has(key)) {
      add(doc, heading.line, 'duplicate-heading', 'repeat of heading at line ' + firstHeadingLine.get(key) + ': ' + key);
    } else {
      firstHeadingLine.set(key, heading.line);
    }
  }
  const h1s = doc.headings.filter((heading) => heading.level === 1);
  for (let i = 1; i < h1s.length; i++) {
    add(doc, h1s[i].line, 'multiple-h1', 'additional H1; first H1 at line ' + h1s[0].line + ': ' + normalizedHeading(h1s[i]));
  }
  // 4) 重复段落（空行分隔，空白归一后 >= 80 字符，排除纯标题/纯列表块）
  const firstParagraphLine = new Map();
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    const textLines = current.map((item) => item.text);
    const structuralOnly = textLines.every((text) =>
      /^#{1,6}(?:\s|$)/.test(text) || /^\s*(?:[-*+]|\d+[.)])\s+/.test(text));
    const normalized = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!structuralOnly && normalized.length >= 80) {
      if (firstParagraphLine.has(normalized)) {
        add(doc, current[0].line, 'duplicate-paragraph',
          'repeat of paragraph at line ' + firstParagraphLine.get(normalized) +
          ': sha256=' + createHash('sha256').update(normalized).digest('hex'));
      } else {
        firstParagraphLine.set(normalized, current[0].line);
      }
    }
    current = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (doc.ignored[i] || !doc.commentMasked[i].trim() || (doc.setextLines && doc.setextLines.has(i))) {
      flush();
      continue;
    }
    current.push({ line: i + 1, text: doc.commentMasked[i].trim() });
  }
  flush();
}

// 全局顺序下，假设交集大小为 k，则首个公共 token 在每侧最多排在 |S|-k+1。
// Jaccard >= t 蕴含 k >= ceil(t*|S|)，因此达标对必共享两侧前缀中的 token。
function* prefixCandidatePairs(listed) {
  const docFrequency = new Map();
  for (const doc of listed) {
    for (const line of doc.nonEmptyLines) {
      docFrequency.set(line, (docFrequency.get(line) || 0) + 1);
    }
  }
  const tokenOrder = new Map();
  [...docFrequency.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .forEach(([line], index) => tokenOrder.set(line, index));
  const postings = new Map();
  for (let index = 0; index < listed.length; index++) {
    const sortedLines = [...listed[index].nonEmptyLines]
      .sort((a, b) => tokenOrder.get(a) - tokenOrder.get(b));
    const size = sortedLines.length;
    const prefixLength = size - Math.ceil(NEAR_DUP_THRESHOLD * size) + 1;
    const seen = new Set(); // 只保留当前文档的候选，最终输出仍由 compareCandidates 排序
    for (let token = 0; token < prefixLength; token++) {
      const line = sortedLines[token];
      const bucket = postings.get(line);
      if (!bucket) {
        postings.set(line, [index]);
        continue;
      }
      for (const other of bucket) {
        const otherSize = listed[other].nonEmptyLines.size;
        // Jaccard <= minSize / maxSize。
        if (Math.min(size, otherSize) / Math.max(size, otherSize) < NEAR_DUP_THRESHOLD || seen.has(other)) continue;
        seen.add(other);
        yield [other, index];
      }
      bucket.push(index);
    }
  }
}

// 按原有顺序惰性枚举，不为精确模式预先分配 O(n²) 个文件对。
function* allDocumentPairs(count) {
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) yield [i, j];
  }
}

// 两文件规范化非空行集合的 Jaccard 相似度 >= 0.8 即 near-duplicate，只在字典序较小文件报一条
function detectNearDuplicates(docs, add, exact) {
  const listed = docs.filter((doc) => doc.nonEmptyLines.size >= 10)
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const pairs = exact
    ? allDocumentPairs(listed.length)
    : prefixCandidatePairs(listed);
  for (const [i, j] of pairs) {
    const a = listed[i];
    const b = listed[j];
    let intersection = 0;
    const [smaller, larger] = a.nonEmptyLines.size <= b.nonEmptyLines.size
      ? [a.nonEmptyLines, b.nonEmptyLines] : [b.nonEmptyLines, a.nonEmptyLines];
    for (const line of smaller) {
      if (larger.has(line)) intersection++;
    }
    const union = a.nonEmptyLines.size + b.nonEmptyLines.size - intersection;
    if (union === 0 || intersection / union < NEAR_DUP_THRESHOLD) continue;
    add(a, 1, 'near-duplicate-files',
      'near-duplicate of ' + b.rel + ' (Jaccard ' + (intersection / union).toFixed(2) + ')');
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
const BASELINE_LINE_EVIDENCE = new Map([
  ['duplicate-heading', /^(repeat of heading at line )\d+(?=: )/],
  ['duplicate-paragraph', /^(repeat of paragraph at line )\d+(?=: sha256=)/],
  ['multiple-h1', /^(additional H1; first H1 at line )\d+(?=: )/],
]);
const BASELINE_REFERENCE_EVIDENCE = new Map([
  ['duplicate-reference-definition', /^(definition \[)(.+)(\] already defined at line )\d+$/],
  ['unused-reference-definition', /^(definition \[)(.+)(\] is never referenced)$/],
  ['undefined-reference-label', /^(reference \[)(.+)(\] has no matching definition in this file)$/],
  ['empty-link-target', /^(reference definition \[)(.+)(\] has (?:an empty target|no valid destination))$/],
]);
function duplicateTargetKey(target) {
  return target.replace(/^(?:\.\/)+(?=[^./?#]|\.[^./?#])/, '');
}

function candidateKey({ file, kind, evidence }) {
  if (kind === 'duplicate-link-target') {
    evidence = evidence.replace(/^(same link target appears \d+ times in this file: )([\s\S]+)$/,
      (_match, prefix, target) => prefix + duplicateTargetKey(target));
  }
  const linePattern = BASELINE_LINE_EVIDENCE.get(kind);
  const refPattern = BASELINE_REFERENCE_EVIDENCE.get(kind);
  const comparableEvidence = refPattern
    ? evidence.replace(refPattern, (_match, prefix, label, suffix) => prefix + normalizeLabel(label) + suffix)
    : linePattern ? evidence.replace(linePattern, '$1#') : evidence;
  return [file, kind, comparableEvidence].join('\u0000');
}
// 读取并校验 baseline 文件，按 key 记录实例数，避免旧实例豁免新增实例
function readBaseline(file) {
  const absPath = resolve(file);
  const raw = readUtf8File(absPath, 'baseline');
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
  const keys = new Map();
  for (const entry of data.entries) {
    if (!entry || typeof entry.file !== 'string' || entry.file.trim() === '' ||
      typeof entry.kind !== 'string' || typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
      usageError('baseline entry must contain non-empty string file/kind/evidence: ' + absPath);
    }
    if (!Object.prototype.hasOwnProperty.call(CATEGORY, entry.kind)) {
      usageError('baseline entry has unknown kind: ' + entry.kind);
    }
    const segments = entry.file.split('/');
    if ((sep !== '/' && (/^[A-Za-z]:\//.test(entry.file) || entry.file.includes('\\'))) || entry.file.includes('\u0000') ||
        segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      usageError('baseline entry file must be a canonical scan-root-relative POSIX path: ' + JSON.stringify(entry.file));
    }
    const key = candidateKey(entry);
    keys.set(key, (keys.get(key) || 0) + 1);
  }
  return keys;
}

// 两份输出均暂存成功后才逐个替换；两次替换不是事务。
function publishJsonOutputs(outputs) {
  const staged = [];
  const published = [];
  let failure;
  let current;
  try {
    for (const output of outputs) {
      current = output;
      const destination = canonicalPath(output.absPath);
      const stats = statSync(destination, { throwIfNoEntry: false });
      if (stats && !stats.isFile()) throw new Error('output is not a regular file');
      const parent = dirname(destination);
      mkdirSync(parent, { recursive: true });
      const dir = mkdtempSync(join(parent, '.md-doc-output-'));
      const tempFile = join(dir, 'output.json');
      staged.push({ output, destination, dir, tempFile });
      writeFileSync(tempFile, JSON.stringify(output.payload, null, 2) + '\n');
    }
    for (const { output, destination, tempFile } of staged) {
      current = output;
      renameSync(tempFile, destination);
      published.push(output.absPath);
    }
  } catch (err) {
    failure = 'cannot write ' + current.label + ' file: ' + current.absPath + ' (' + err.message + ')';
  } finally {
    for (const { dir } of staged) {
      try { rmSync(dir, { recursive: true, force: true }); } catch (err) {
        failure = (failure ? failure + '; ' : '') + 'cannot clean temporary output: ' + dir + ' (' + err.message + ')';
      }
    }
  }
  if (failure) usageError(failure + (published.length ? '; already updated: ' + published.join(', ') : ''));
}

// 把当前候选写成 baseline（按 file/kind/evidence 排序，输出稳定可 diff）
function baselineOutput(file, result) {
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
  return { absPath, payload, label: 'baseline', count: entries.length };
}

// JSON Schema maxLength 以 Unicode 码点计数，避免 slice 切断代理对。
function truncateExcerpt(text, maxLength) {
  if (text.length <= maxLength) return text;
  let end = 0;
  for (const char of text) {
    if (maxLength-- === 0) break;
    end += char.length;
  }
  return text.slice(0, end);
}

// 把候选转成 references/report.schema.json 兼容的报告草稿（action=annotate，等待 P3 triage）
function reportOutput(file, result) {
  const absPath = resolve(file);
  const findings = result.candidates.map((candidate) => ({
    file: candidate.file,
    line: candidate.line,
    category: candidate.category,
    severity: REPORT_SEVERITY[candidate.kind] || 'Medium',
    action: 'annotate',
    excerpt: truncateExcerpt(candidate.excerpt, 120),
    evidence: candidate.evidence,
  }));
  const payload = {
    summary: {
      files_audited: result.files_scanned,
      examined: findings.length,
      fixed: 0,
      needs_human: findings.length,
      no_action: 0,
    },
    findings: findings,
  };
  return { absPath, payload, label: 'report', count: findings.length };
}

// --fail-on 命中时把新增（未被 baseline 记录）的匹配项写到 stderr 并返回 1；
// stdout 的 JSON/文本输出保持不变。默认跳过 fixture 上下文（测试夹具里的坏链接是内容本身）。
function evaluateGate(result, failOn, includeFixtures, baselineKeys) {
  if (failOn.size === 0) return 0;
  const matched = result.candidates.filter((candidate) => failOn.has(candidate.kind));
  const relevant = includeFixtures ? matched : matched.filter((candidate) => candidate.context !== 'fixture');
  const skipped = matched.length - relevant.length;
  const remaining = new Map(baselineKeys || []);
  const baselined = [];
  const fresh = [];
  for (const candidate of relevant) {
    const key = candidateKey(candidate);
    const count = remaining.get(key) || 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      baselined.push(candidate);
    } else {
      fresh.push(candidate);
    }
  }
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
    process.stderr.write('  ... and ' + (fresh.length - limit) + ' more (all candidates are on stdout)\n');
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
  let exactNearDuplicates = false;
  let baselinePath = null;
  let writeBaselinePath = null;
  let reportOutPath = null;
  const failOn = new Set();
  const seenPathOptions = new Set();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      for (let j = i + 1; j < args.length; j++) positional.push(args[j]);
      break;
    }
    if (arg === '--text') {
      textMode = true;
      continue;
    }
    if (arg === '--include-fixtures') {
      includeFixtures = true;
      continue;
    }
    if (arg === '--exact-near-duplicates') {
      exactNearDuplicates = true;
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
    const pathOption = ['--baseline', '--write-baseline', '--report-out']
      .find((option) => arg === option || arg.startsWith(option + '='));
    if (pathOption) {
      const value = arg === pathOption ? args[++i] : arg.slice(pathOption.length + 1);
      if (!value || value.startsWith('-')) usageError(pathOption + ' requires a file path');
      if (seenPathOptions.has(pathOption)) usageError(pathOption + ' may only be specified once');
      seenPathOptions.add(pathOption);
      if (pathOption === '--baseline') baselinePath = value;
      else if (pathOption === '--write-baseline') writeBaselinePath = value;
      else reportOutPath = value;
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

  try {
    validateOutputs(reportOutPath, writeBaselinePath, baselinePath);
  } catch (err) {
    usageError('cannot validate output paths: ' + err.message);
  }
  const docs = [];
  for (const absPath of collectFiles(targetAbs)) {
    const doc = analyzeFile(absPath, targetAbs);
    if (doc) docs.push(doc);
  }
  const docsByAbs = new Map();
  for (const doc of docs) docsByAbs.set(doc.absPath, doc);

  const candidates = [];
  const add = (doc, line, kind, evidence, excerptOverride) => {
    if (doc.suppressed && doc.suppressed.has(line - 1)) return;
    const excerpt = truncateExcerpt(excerptOverride ?? (doc.lines[line - 1] || '').trim(), 160);
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
  const targetStats = new Map();
  for (const doc of docs) detectLocal(doc, docsByAbs, add, targetStats);
  detectNearDuplicates(docs, add, exactNearDuplicates);

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

  const report = reportOutPath === null ? null : reportOutput(reportOutPath, result);
  const baseline = writeBaselinePath === null ? null : baselineOutput(writeBaselinePath, result);
  publishJsonOutputs([report, baseline].filter(Boolean));
  if (textMode) {
    process.stdout.write(renderText(result));
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
  if (report) {
    process.stderr.write('pre-scan: wrote ' + report.count + ' finding(s) to report ' +
      toPosix(resolve(reportOutPath)) + '\n');
  }
  if (writeBaselinePath !== null) {
    process.stderr.write('pre-scan: wrote ' + baseline.count + ' candidate(s) to baseline ' +
      toPosix(resolve(writeBaselinePath)) + '\n');
    process.exitCode = 0;
  } else {
    process.exitCode = evaluateGate(result, failOn, includeFixtures, baselineKeys);
  }
}

// 作为模块导入解析函数时不启动 CLI；按真实路径比较以兼容符号链接入口。
if (process.argv[1] && existsSync(process.argv[1]) &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
