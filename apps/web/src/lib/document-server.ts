/**
 * Danh sách origin ONLYOFFICE Document Server mà trang soạn thảo được nạp `api.js`.
 *
 * Đặt lúc build bằng NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS (các origin cách nhau dấu phẩy,
 * phải khớp DOCUMENT_EDITOR_PUBLIC_ORIGIN của API). Không đặt: ngoài production dùng PoC
 * local 127.0.0.1:18082; production không cho origin nào, trang soạn thảo báo lỗi.
 * next.config.ts đọc cùng biến để dựng Content-Security-Policy.
 */
const DEV_ORIGINS = ['http://127.0.0.1:18082', 'http://localhost:18082'];

export function documentServerOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS;
  if (raw === undefined) return process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Trả base URL đã chuẩn hoá (bỏ `/` cuối) nếu origin nằm trong danh sách, ngược lại `null`. */
export function allowedDocumentServer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) return null;
  if (!documentServerOrigins().includes(url.origin)) return null;
  return `${url.origin}${url.pathname}`.replace(/\/$/, '');
}

/** fileId Drive là ObjectId 24 ký tự hex. */
export const isObjectId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
