/**
 * Danh sách origin ONLYOFFICE Document Server mà trang soạn thảo được nạp `api.js`.
 *
 * Đặt lúc build bằng NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS (các origin cách nhau dấu phẩy,
 * phải khớp DOCUMENT_EDITOR_PUBLIC_ORIGIN của API). Không đặt: ngoài production dùng PoC
 * local 127.0.0.1:18082; production không cho origin nào, trang soạn thảo báo lỗi.
 * next.config.ts đọc cùng biến để dựng Content-Security-Policy.
 */
const DEV_ORIGINS = ['http://127.0.0.1:18082', 'http://localhost:18082'];
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

function declaredOrigins(): string[] {
  return (process.env.NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Bản build production chỉ nhận https (trang chạy https; http lộ JWT cấu hình), trừ http loopback cho QA local. */
function secureForProduction(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.includes(url.hostname));
  } catch {
    return false;
  }
}

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Origin khai báo nhưng bị bỏ ở production; next.config.ts dừng build nếu danh sách không rỗng.
 * next.config.ts truyền `production` theo phase vì lúc nạp config NODE_ENV có thể chưa được đặt.
 */
export function insecureDocumentServerOrigins(production = isProduction()): string[] {
  return production ? declaredOrigins().filter((o) => !secureForProduction(o)) : [];
}

export function documentServerOrigins(production = isProduction()): string[] {
  if (process.env.NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS === undefined) return production ? [] : DEV_ORIGINS;
  const insecure = insecureDocumentServerOrigins(production);
  return declaredOrigins().filter((o) => !insecure.includes(o));
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
