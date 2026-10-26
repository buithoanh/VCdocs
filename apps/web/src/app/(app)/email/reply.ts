/**
 * Tiện ích Trả lời / Trả lời tất cả: người nhận, tiêu đề, header luồng thư và khối trích dẫn.
 * Hàm thuần để test riêng; trang Email gọi khi bấm nút trên khung đọc.
 */
import { cleanHtml, escapeHtml, textToHtml } from './rich-text';

export type ReplySource = { from: string; to: string[]; cc?: string[]; subject: string; sentAt: string };

const lower = (value: string) => value.trim().toLowerCase();

/** Bỏ trùng không phân biệt hoa thường và loại địa chỉ của chính người dùng; giữ thứ tự xuất hiện. */
function distinct(addresses: string[], exclude: Set<string>, seen = new Set<string>()) {
  const out: string[] = [];
  for (const address of addresses) {
    const key = lower(address);
    if (!key || exclude.has(key) || seen.has(key)) continue;
    seen.add(key); out.push(address.trim());
  }
  return out;
}

/**
 * Người nhận khi trả lời. Thư trong "Đã gửi" trả lời tới người nhận gốc (To), thư khác tới người gửi.
 * Trả lời tất cả thêm To gốc vào To và giữ Cc gốc; không bao giờ chép Bcc; loại địa chỉ của mình.
 */
export function replyRecipients(message: ReplySource, options: { all: boolean; sentFolder: boolean; own: string[] }) {
  const own = new Set(options.own.map(lower).filter(Boolean));
  const seen = new Set<string>();
  const primary = options.sentFolder ? message.to : [message.from];
  let to = distinct(options.all ? [...primary, ...message.to] : primary, own, seen);
  const cc = options.all ? distinct(message.cc ?? [], own, seen) : [];
  // Thư tự gửi cho chính mình: vẫn trả lời về đúng địa chỉ đó thay vì để trống ô Đến.
  if (!to.length && !cc.length) to = distinct(primary, new Set());
  return { to, cc };
}

/** Một tiền tố "Re: " duy nhất: bỏ mọi "Re:"/"RE:"/"Re[2]:"/"Re :" đầu tiêu đề, giữ "Fwd:" phía sau (kiểu Gmail). */
export function replySubject(subject: string) {
  const base = subject.trim().replace(/^(?:re(?:\[\d+\])?\s*:\s*)+/i, '');
  return `Re: ${base}`.trimEnd();
}

/** Message-ID và References từ phần header của MIME gốc (bỏ dấu < >, gộp dòng gấp theo RFC 5322). */
export function threadHeaders(raw: string) {
  const end = raw.search(/\r?\n\r?\n/);
  const head = (end < 0 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ');
  const field = (name: string) => head.split(/\r?\n/).find((line) => line.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? '';
  const ids = (value: string) => {
    const bracketed = [...value.matchAll(/<([^<>\s]+)>/g)].map((match) => match[1]);
    return bracketed.length ? bracketed : value.split(/\s+/).filter(Boolean);
  };
  const messageId = ids(field('message-id'))[0] ?? '';
  const references = ids(field('references'));
  return { messageId, references: messageId ? [...references.filter((id) => id !== messageId), messageId] : references };
}

/**
 * Nội dung soạn sẵn: đoạn trống đầu để gõ, rồi "Vào <ngày giờ>, <người gửi> đã viết:" và nội dung gốc
 * trong <blockquote>. HTML gốc là bản server đã lọc; vẫn lọc lại bằng allowlist của trình soạn thảo.
 */
export function quotedReplyHtml(message: ReplySource, body: { html?: string; text: string }) {
  const when = new Date(message.sentAt).toLocaleString('vi-VN');
  const original = body.html ? cleanHtml(body.html) : textToHtml(body.text);
  return `<p><br></p><p>${escapeHtml(`Vào ${when}, ${message.from} đã viết:`)}</p><blockquote>${original}</blockquote>`;
}
