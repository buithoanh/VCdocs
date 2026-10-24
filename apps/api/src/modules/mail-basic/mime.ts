import { randomBytes } from 'crypto';
import { MailAttachment } from './mail.port';

const cleanHeader = (v: string) => {
  if (/\r|\n/.test(v)) throw new Error('HEADER_INJECTION');
  return v.trim();
};
const b64Header = (v: string) => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function sanitizeHtml(html: string) {
  return html.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*("|')\s*javascript:[\s\S]*?\2/gi, '');
}
export function buildMime(input: { from: string; to: string[]; subject: string; text: string; html?: string; messageId: string; inReplyTo?: string; references?: string[]; attachments?: MailAttachment[] }) {
  const boundary = `vcworkspace-${randomBytes(12).toString('hex')}`;
  const headers = [`From: ${cleanHeader(input.from)}`, `To: ${input.to.map(cleanHeader).join(', ')}`, `Subject: ${b64Header(cleanHeader(input.subject))}`,
    `Message-ID: <${cleanHeader(input.messageId)}>`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0'];
  if (input.inReplyTo) headers.push(`In-Reply-To: <${cleanHeader(input.inReplyTo.replace(/[<>]/g, ''))}>`);
  if (input.references?.length) headers.push(`References: ${input.references.map((x) => `<${cleanHeader(x.replace(/[<>]/g, ''))}>`).join(' ')}`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
  const parts = [`--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(input.text).toString('base64')];
  if (input.html) parts.push(`--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(sanitizeHtml(input.html)).toString('base64'));
  for (const a of input.attachments ?? []) {
    const name = b64Header(cleanHeader(a.filename));
    parts.push(`--${boundary}`, `Content-Type: ${cleanHeader(a.contentType)}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '', a.bytes.toString('base64'));
  }
  parts.push(`--${boundary}--`, '');
  return Buffer.from([...headers, ...parts].join('\r\n'));
}
export function safePreview(text: string) { return esc(text).slice(0, 240); }
