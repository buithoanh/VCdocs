/**
 * Tiện ích HTML cho trình soạn thư. Cùng allowlist với bộ lọc phía server
 * (apps/api/src/modules/mail-basic/html-sanitizer.ts); server vẫn lọc lại.
 */
const ALLOWED = new Set(['p', 'br', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'code', 'pre', 'a']);
const ALIASES: Record<string, string> = { strike: 's', del: 's' };
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'select', 'title', 'head']);
const BLOCKS = new Set(['p', 'div', 'li', 'blockquote', 'h2', 'h3', 'pre', 'ul', 'ol']);
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** URL link được phép: chỉ http(s) có host và mailto; trả URL đã chuẩn hoá hoặc null. */
export function safeLinkUrl(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (!LINK_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol !== 'mailto:' && !url.hostname) return null;
  if (url.username || url.password) return null;
  return url.href;
}

export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Văn bản thuần → HTML soạn thảo: mỗi dòng một <div>, dòng trống thành <div><br></div>. */
export function textToHtml(text: string) {
  return text.split(/\r?\n/).map((line) => `<div>${line ? escapeHtml(line) : '<br>'}</div>`).join('');
}

function walk(node: Node, out: string[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { out.push(escapeHtml(child.textContent ?? '')); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element, lower = element.tagName.toLowerCase();
    if (DROP_CONTENT.has(lower)) continue;
    const name = ALIASES[lower] ?? lower;
    if (!ALLOWED.has(name)) { walk(element, out); continue; }
    if (name === 'br') { out.push('<br>'); continue; }
    if (name === 'a') {
      const href = safeLinkUrl(element.getAttribute('href'));
      if (!href) { walk(element, out); continue; }
      out.push(`<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">`); walk(element, out); out.push('</a>');
      continue;
    }
    out.push(`<${name}>`); walk(element, out); out.push(`</${name}>`);
  }
}

/** Lọc HTML theo allowlist bằng DOMParser (không chạy script, không tải tài nguyên). */
export function cleanHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out: string[] = [];
  walk(doc.body, out);
  return out.join('');
}

/** Văn bản thuần từ cùng nội dung HTML: khối và <br> thành xuống dòng, mục danh sách có gạch đầu dòng, link kèm URL. */
export function htmlToPlainText(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const lines: string[] = [];
  let current = '';
  const flush = () => { lines.push(current); current = ''; };
  const visit = (node: Node, listPrefix: string[]) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) { current += (child.textContent ?? '').replace(/[\r\n]+/g, ' '); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element, name = element.tagName.toLowerCase();
      if (DROP_CONTENT.has(name)) continue;
      if (name === 'br') { flush(); continue; }
      const block = BLOCKS.has(name);
      if (block && current) flush();
      if (name === 'ul' || name === 'ol') {
        let index = 0;
        for (const item of Array.from(element.children)) {
          index++;
          if (current) flush();
          current = `${'  '.repeat(listPrefix.length)}${name === 'ol' ? `${index}.` : '-'} `;
          visit(item, [...listPrefix, name]);
          flush();
        }
        continue;
      }
      if (name === 'blockquote') {
        const inner = htmlToPlainText(element.innerHTML).split('\n').map((line) => `> ${line}`);
        lines.push(...inner);
        continue;
      }
      visit(element, listPrefix);
      if (name === 'a') {
        const href = safeLinkUrl(element.getAttribute('href'));
        const label = element.textContent ?? '';
        if (href && href !== label && `mailto:${label}` !== href) current += ` <${href}>`;
      }
      if (block && current) flush();
    }
  };
  visit(doc.body, []);
  if (current) flush();
  return lines.join('\n').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Tách ô địa chỉ kiểu Gmail/Outlook: phẩy, chấm phẩy hoặc xuống dòng; bỏ trùng không phân biệt hoa thường. */
export function parseAddressList(value: string) {
  const seen = new Set<string>(), out: string[] = [];
  for (const part of value.split(/[,;\n]+/)) {
    const address = part.trim();
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase()); out.push(address);
  }
  return out;
}
