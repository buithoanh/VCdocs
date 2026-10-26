import { randomBytes } from 'crypto';
import { MailAttachment } from './mail.port';
import { sanitizeHtml } from './html-sanitizer';
export { sanitizeHtml } from './html-sanitizer';

const cleanHeader = (v: string) => {
  if (/\r|\n/.test(v)) throw new Error('HEADER_INJECTION');
  return v.trim();
};
const b64Header = (v: string) => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/**
 * MIME gửi đi. `cc` thành header Cc; người nhận Bcc chỉ nằm ở SMTP envelope,
 * hàm này cố ý không nhận Bcc nên không bản giao nào có header Bcc.
 */
export function buildMime(input: { from: string; to: string[]; cc?: string[]; subject: string; text: string; html?: string; messageId: string; inReplyTo?: string; references?: string[]; attachments?: MailAttachment[] }) {
  const boundary = `vcworkspace-${randomBytes(12).toString('hex')}`;
  const headers = [`From: ${cleanHeader(input.from)}`, `To: ${input.to.map(cleanHeader).join(', ')}`, ...(input.cc?.length ? [`Cc: ${input.cc.map(cleanHeader).join(', ')}`] : []), `Subject: ${b64Header(cleanHeader(input.subject))}`,
    `Message-ID: <${cleanHeader(input.messageId)}>`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0'];
  if (input.inReplyTo) headers.push(`In-Reply-To: <${cleanHeader(input.inReplyTo.replace(/[<>]/g, ''))}>`);
  if (input.references?.length) headers.push(`References: ${input.references.map((x) => `<${cleanHeader(x.replace(/[<>]/g, ''))}>`).join(' ')}`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
  const textPart = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(input.text).toString('base64')];
  // text và html là hai cách hiển thị cùng một nội dung: phải nằm trong multipart/alternative,
  // nếu đặt ngang hàng trong multipart/mixed thì client mail hiện cả hai (nội dung bị lặp).
  const alternative = `${boundary}-alt`;
  const parts = input.html
    ? [`--${boundary}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, '', `--${alternative}`, ...textPart,
      `--${alternative}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(sanitizeHtml(input.html)).toString('base64'),
      `--${alternative}--`]
    : [`--${boundary}`, ...textPart];
  for (const a of input.attachments ?? []) {
    const name = b64Header(cleanHeader(a.filename));
    parts.push(`--${boundary}`, `Content-Type: ${cleanHeader(a.contentType)}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '', a.bytes.toString('base64'));
  }
  parts.push(`--${boundary}--`, '');
  return Buffer.from([...headers, ...parts].join('\r\n'));
}
export function safePreview(text: string) { return esc(text).slice(0, 240); }
