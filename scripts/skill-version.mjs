// Repository release metadata uses a top-level YAML block and a double-quoted version.
// This is deliberately a format check, not a general-purpose YAML parser.
import { visibleMarkdownLines } from './pre-scan.mjs';
export function skillFrontmatter(text) {
  return text.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/)?.[1];
}

export function metadataVersion(frontmatter) {
  const lines = frontmatter?.split(/\r?\n/) ?? [];
  const metadataKey = /^(?:metadata|"metadata"|'metadata')[ \t]*:/;
  const start = lines.findIndex((line) => metadataKey.test(line));
  if (start < 0 || !/^metadata:[ \t]*(?:#.*)?$/.test(lines[start]) ||
      lines.slice(start + 1).some((line) => metadataKey.test(line))) return undefined;
  let childIndent = null;
  let version;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]*(?:#.*)?$/.test(line)) continue;
    const indent = line.match(/^ */)[0].length;
    if (!indent) break;
    childIndent ??= indent;
    if (indent < childIndent) break;
    if (indent !== childIndent) continue;
    const child = line.slice(indent);
    if (!/^(?:version|"version"|'version')[ \t]*:/.test(child)) continue;
    if (version !== undefined) return undefined;
    version = child.match(/^version[ \t]*:[ \t]*"([^"\r\n]+)"(?:[ \t]+#.*|[ \t]*)$/)?.[1];
    if (version === undefined) return undefined;
  }
  return version;
}

export function latestChangelogVersion(text) {
  let htmlBlock = false;
  for (const line of visibleMarkdownLines(text)) {
    if (!line.trim()) htmlBlock = false;
    if (/^ {0,3}<\/?(?:address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|main|nav|ol|p|section|summary|table|ul)(?=[\s/>]|$)/i.test(line)) htmlBlock = true;
    if (htmlBlock) continue;
    const version = line.match(/^ {0,3}##[ \t]+(\d+\.\d+\.\d+\S*)/)?.[1];
    if (version !== undefined) return version;
  }
  return undefined;
}
