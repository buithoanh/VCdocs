import { Parser } from 'htmlparser2';

/**
 * Bộ lọc HTML thư theo allowlist (thay regex cũ, review O14).
 * Không sửa chuỗi gốc: tách token bằng htmlparser2 rồi dựng lại đầu ra chỉ từ
 * thẻ được phép, thuộc tính `href` đã kiểm giao thức và văn bản đã escape.
 */
const ALLOWED = new Set(['p', 'br', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'code', 'pre', 'a']);
/** Tên thẻ cũ do trình soạn thảo trình duyệt sinh ra được quy về thẻ cho phép. */
const ALIASES: Record<string, string> = { strike: 's', del: 's' };
/** Bỏ cả nội dung bên trong, không chỉ bỏ thẻ. */
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'noembed', 'noframes', 'frameset', 'frame', 'textarea', 'select', 'title', 'xmp', 'head', 'applet', 'canvas', 'audio', 'video']);
const VOID = new Set(['br']);
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
export const SANITIZED_HTML_MAX = 256 * 1024;
const MAX_DEPTH = 40;
const MAX_HREF = 2048;

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Giá trị href đã được htmlparser2 giải mã entity. Dùng bộ phân tích URL WHATWG (như trình duyệt):
 * nó bỏ tab/xuống dòng và ký tự điều khiển đầu chuỗi, nên `java\tscript:` hay `&#x0A;javascript:`
 * vẫn ra giao thức `javascript:` và bị loại. URL tương đối, `//host` và giao thức lạ đều bị loại.
 */
export function safeLinkHref(value: string): string | null {
  const trimmed = String(value ?? '').replace(/^[\u0000- \u007f-\u009f]+|[\u0000- \u007f-\u009f]+$/g, '');
  if (!trimmed || trimmed.length > MAX_HREF) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (!LINK_PROTOCOLS.has(url.protocol)) return null;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return null;
  if (url.username || url.password) return null;
  return url.href;
}

export function sanitizeHtml(html: string, maxOutput = SANITIZED_HTML_MAX): string {
  const out: string[] = [];
  let size = 0, full = false, skipDepth = 0;
  // Mỗi thẻ mở (kể cả thẻ bị loại) có một mục để thẻ đóng tương ứng biết có in hay không.
  type Open = { name: string; emitted: string | null; skip: boolean };
  const stack: Open[] = [];
  const open = (name: string, emitted: string | null = null, skip = false) => { stack.push({ name, emitted, skip }); if (skip) skipDepth++; };
  /** Ghi chunk nếu còn đủ chỗ cho chính nó, `closing` của nó và thẻ đóng các phần tử đang mở. */
  const push = (chunk: string, closing = 0) => {
    if (full) return false;
    const reserve = stack.reduce((n, x) => n + (x.emitted ? x.emitted.length + 3 : 0), 0);
    if (size + chunk.length + closing + reserve > maxOutput) { full = true; return false; }
    out.push(chunk); size += chunk.length; return true;
  };
  const parser = new Parser({
    onopentag(rawName, attribs) {
      const lower = rawName.toLowerCase();
      if (skipDepth > 0 || DROP_CONTENT.has(lower)) return open(lower, null, true);
      const name = ALIASES[lower] ?? lower;
      if (!ALLOWED.has(name) || full || stack.filter((x) => x.emitted).length >= MAX_DEPTH) return open(lower);
      if (VOID.has(name)) { push(`<${name}>`); return open(lower); }
      let tag = `<${name}>`;
      if (name === 'a') {
        const href = safeLinkHref(attribs.href ?? '');
        if (!href) return open(lower);
        tag = `<a href="${escapeText(href)}" rel="noopener noreferrer" target="_blank">`;
      }
      open(lower, push(tag, name.length + 3) ? name : null);
    },
    ontext(text) { if (skipDepth === 0) push(escapeText(text)); },
    onclosetag(rawName) {
      const lower = rawName.toLowerCase();
      // htmlparser2 phát sự kiện đóng cân với sự kiện mở; vẫn phòng thủ khi lệch.
      if (!stack.some((x) => x.name === lower)) return;
      while (stack.length) {
        const top = stack.pop()!;
        if (top.skip) skipDepth--;
        if (top.emitted) { out.push(`</${top.emitted}>`); size += top.emitted.length + 3; }
        if (top.name === lower) break;
      }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeCDATA: false, recognizeSelfClosing: false });
  parser.write(String(html ?? ''));
  parser.end();
  while (stack.length) { const top = stack.pop()!; if (top.emitted) out.push(`</${top.emitted}>`); }
  return out.join('');
}

/** Văn bản thuần từ HTML đã lọc, dùng cho chỉ mục tìm kiếm. */
export function htmlToText(html: string) {
  const text: string[] = [];
  let skip = 0;
  const parser = new Parser({
    onopentag(name) { if (skip || DROP_CONTENT.has(name)) skip++; else if (['br', 'p', 'div', 'li', 'h2', 'h3', 'blockquote', 'pre'].includes(name)) text.push(' '); },
    ontext(value) { if (!skip) text.push(value); },
    onclosetag(name) { if (skip) skip--; else if (['p', 'div', 'li'].includes(name)) text.push(' '); },
  }, { decodeEntities: true });
  parser.write(String(html ?? '')); parser.end();
  return text.join('');
}
