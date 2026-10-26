'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spin } from 'antd';
import { API_BASE } from '@/api/client';
import { ErrorBox } from '@/components/ui';
import { cleanHtml } from './rich-text';

export type MailBodyAttachment = { part: number; filename: string; contentType: string; size: number };
export type MailBody = { text: string; html?: string; hasRemoteContent: boolean; truncated: boolean; attachments: MailBodyAttachment[] };

/**
 * Khung đọc HTML: không allow-scripts, không allow-same-origin (iframe là origin rỗng, không đọc
 * được cookie/DOM của app); chỉ cho mở link ra tab mới. CSP trong srcDoc chặn mọi tải tài nguyên.
 */
export const READER_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';
export const READER_CSP = "default-src 'none'; style-src 'unsafe-inline'";
const READER_STYLE = 'html,body{margin:0}body{padding:4px 2px 16px;font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2937;overflow-wrap:anywhere;word-break:break-word}'
  + 'a{color:#0f6cbd}blockquote{margin:.5em 0;padding-left:.8em;border-left:3px solid #cbd5e1;color:#475569}pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}pre{white-space:pre-wrap;background:#f8fafc;padding:.6em;border-radius:4px}h2,h3{margin:.8em 0 .4em;line-height:1.3}p{margin:0 0 .8em}';

/** Tài liệu srcDoc cho iframe; HTML đã lọc ở server và được lọc lại bằng allowlist phía trình duyệt. */
export function readerDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${READER_CSP}"><base target="_blank"><style>${READER_STYLE}</style></head><body>${cleanHtml(html)}</body></html>`;
}

/** Không đo được chiều cao nội dung (iframe khác origin), nên ước lượng theo độ dài chữ, có cuộn bên trong. */
export function readerHeight(text: string) {
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 90)), 0);
  return Math.min(900, Math.max(260, 40 + lines * 23));
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Truy vấn nội dung đã lọc; dùng chung cho khung đọc và khi soạn trả lời (cùng cache). */
export function mailBodyQuery(messageId: string, mailbox: string) {
  const query = mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : '';
  return {
    queryKey: ['mail-body', messageId, mailbox],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/mail/messages/${messageId}/body${query}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Không tải được nội dung thư.');
      return response.json() as Promise<MailBody>;
    },
    retry: false,
  } as const;
}

export function MessageBody({ messageId, mailbox, onSaveAttachment }: { messageId: string; mailbox: string; onSaveAttachment: (attachment: MailBodyAttachment) => void }) {
  const body = useQuery(mailBodyQuery(messageId, mailbox));
  if (body.isLoading) return <div className="mail-state mail-body-state"><Spin size="small" /> Đang tải nội dung thư…</div>;
  if (body.error || !body.data) return <div className="mail-body-state"><ErrorBox error={new Error('Không tải được nội dung thư.')} onRetry={() => void body.refetch()} /></div>;
  const { html, text, hasRemoteContent, truncated, attachments } = body.data;
  return <div className="mail-body">
    {hasRemoteContent && <Alert type="warning" showIcon title="Đã chặn hình ảnh và nội dung tải từ bên ngoài để bảo vệ bạn." />}
    {truncated && <Alert type="warning" showIcon title="Thư quá dài nên chỉ hiển thị một phần. Tải MIME để xem đầy đủ." />}
    {html
      ? <iframe className="mail-body-frame" title="Nội dung thư" sandbox={READER_SANDBOX} referrerPolicy="no-referrer" srcDoc={readerDocument(html)} style={{ height: readerHeight(text) }}/>
      : text.trim() ? <div className="mail-body-text">{text}</div> : <p className="mail-body-empty">(Thư không có nội dung chữ)</p>}
    {attachments.length > 0 && <section className="mail-body-attachments" aria-label="Tệp đính kèm">
      <h3>{attachments.length} tệp đính kèm</h3>
      <ul>{attachments.map((item) => <li key={item.part}>
        <span className="mail-body-file"><strong>{item.filename}</strong><small>{formatSize(item.size)} · {item.contentType}</small></span>
        <Button size="small" onClick={() => onSaveAttachment(item)} aria-label={`Lưu ${item.filename} vào Drive`}>Lưu vào Drive</Button>
      </li>)}</ul>
    </section>}
  </div>;
}
