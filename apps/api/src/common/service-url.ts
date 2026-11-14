/**
 * Kiểm URL dịch vụ nội bộ do quản trị cấu hình (Nextcloud, ONLYOFFICE), không phải URL người dùng đưa.
 * - Không chứa user/pass (bí mật lọt log), query hay fragment.
 * - https luôn được nhận. http chỉ nhận cho loopback ngoài production (PoC/dev/test), hoặc khi
 *   `internalHttp` bật: thêm tên dịch vụ một nhãn trong mạng Docker (vd `http://onlyoffice`).
 */
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export interface ServiceUrlRule {
  production: boolean;
  /** Cho http tới tên máy nội bộ một nhãn (không dấu chấm), kể cả production. */
  internalHttp?: boolean;
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.includes(hostname);
}

export function checkServiceUrl(name: string, raw: string | undefined, rule: ServiceUrlRule): URL {
  let url: URL;
  try { url = new URL(raw || ''); } catch { throw new Error(`${name} không phải URL hợp lệ`); }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} không được chứa thông tin đăng nhập, query hay fragment`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol !== 'http:') throw new Error(`${name} chỉ nhận https`);
  const loopback = isLoopbackHost(url.hostname);
  if (!rule.production && loopback) return url;
  if (rule.internalHttp && (loopback || /^[a-z0-9-]+$/i.test(url.hostname))) return url;
  throw new Error(rule.production ? `${name} production bắt buộc https` : `${name} http chỉ được phép tới loopback`);
}
