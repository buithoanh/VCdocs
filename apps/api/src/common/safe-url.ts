/**
 * Tải url do người dùng đưa (tài liệu bên ngoài) mà không chạm mạng nội bộ (audit 4/12).
 * - Chỉ https, mỗi bước redirect kiểm lại scheme, tên máy và địa chỉ đã phân giải.
 * - Kết nối gắn vào đúng địa chỉ đã kiểm (không phân giải lại → chặn DNS rebinding).
 * - Giới hạn kích thước ngay khi đọc luồng.
 */
import { promises as dns } from 'dns';
import * as https from 'https';
import { BlockList, isIP } from 'net';
import { GoogleError } from './errors';

const V4_BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "mạng này"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, metadata đám mây
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // dự trữ + broadcast
] as const) V4_BLOCKED.addSubnet(net, prefix, 'ipv4');

/** IPv6 chỉ nhận unicast toàn cầu 2000::/3, trừ các dải dưới đây */
const V6_GLOBAL = new BlockList();
V6_GLOBAL.addSubnet('2000::', 3, 'ipv6');
const V6_BLOCKED = new BlockList();
V6_BLOCKED.addSubnet('2001::', 32, 'ipv6'); // Teredo (nhúng IPv4)
V6_BLOCKED.addSubnet('2001:db8::', 32, 'ipv6'); // tài liệu
V6_BLOCKED.addSubnet('2002::', 16, 'ipv6'); // 6to4 (nhúng IPv4)

/** Tách IPv6 thành 8 nhóm 16 bit (nhận cả đuôi IPv4 dạng chấm) */
function v6Groups(ip: string): number[] | null {
  let s = ip;
  const dotted = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [b0, b1, b2, b3] = dotted.slice(2).map(Number);
    s = `${dotted[1]}${((b0 << 8) | b1).toString(16)}:${((b2 << 8) | b3).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (parts.length === 1 && fill !== 0)) return null;
  return [...head, ...Array(fill).fill('0'), ...tail].map((h) => parseInt(h, 16));
}

/** Địa chỉ không được phép tải: loopback, private, link-local, CGNAT, multicast, dự trữ và IPv6 tương đương */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const kind = isIP(ip);
  if (kind === 4) return V4_BLOCKED.check(ip, 'ipv4');
  if (kind !== 6 || ip.includes('%')) return true;
  const g = v6Groups(ip.toLowerCase());
  if (!g || g.length !== 8) return true;
  // IPv4-mapped ::ffff:a.b.c.d và IPv4-compatible ::a.b.c.d → xét như IPv4
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return V4_BLOCKED.check(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, 'ipv4');
  }
  return !V6_GLOBAL.check(ip, 'ipv6') || V6_BLOCKED.check(ip, 'ipv6');
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal', '.intranet', '.lan', '.home.arpa'];

/** Kiểm hình thức url (không phân giải DNS). Trả lý do từ chối, hoặc null nếu hợp lệ. */
export function urlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Đường dẫn không hợp lệ';
  }
  if (u.protocol !== 'https:') return 'Chỉ nhận đường dẫn https';
  if (u.username || u.password) return 'Đường dẫn không hợp lệ';
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host)) return isBlockedAddress(host) ? 'Không tải từ địa chỉ nội bộ' : null;
  if (!host.includes('.') || host === 'localhost' || INTERNAL_SUFFIXES.some((x) => host.endsWith(x))) return 'Không tải từ địa chỉ nội bộ';
  return null;
}

export type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;

export interface SafeFetchOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  /** Thay DNS (test) */
  lookup?: LookupAll;
  /** CA bổ sung (test dùng chứng chỉ tự ký) */
  ca?: string | Buffer;
  /** Thay chính sách địa chỉ (chỉ test, để fixture loopback đóng vai máy chủ ngoài) */
  isBlocked?: (address: string) => boolean;
}

const defaultLookup: LookupAll = (host) => dns.lookup(host, { all: true, verbatim: true });

/** Phân giải và chọn địa chỉ; chỉ một địa chỉ nội bộ cũng từ chối cả tên */
async function resolvePublic(u: URL, o: SafeFetchOptions): Promise<{ address: string; family: number }> {
  const blocked = o.isBlocked ?? isBlockedAddress;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const kind = isIP(host);
  if (kind) {
    if (blocked(host)) throw new GoogleError('Không tải từ địa chỉ nội bộ');
    return { address: host, family: kind };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await (o.lookup ?? defaultLookup)(host.replace(/\.$/, ''));
  } catch {
    throw new GoogleError('Không phân giải được tên miền');
  }
  if (!addrs.length || addrs.some((a) => blocked(a.address))) throw new GoogleError('Không tải từ địa chỉ nội bộ');
  return addrs[0];
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function fileNameOf(u: URL) {
  const last = u.pathname.split('/').pop() || '';
  try {
    return decodeURIComponent(last) || 'tai-lieu';
  } catch {
    return last || 'tai-lieu';
  }
}

/** GET một bước, kết nối thẳng vào `pin`; trả redirect hoặc nội dung (đã giới hạn kích thước) */
function getOnce(u: URL, pin: { address: string; family: number }, o: Required<Pick<SafeFetchOptions, 'maxBytes'>> & SafeFetchOptions, signal: AbortSignal) {
  return new Promise<{ location: string } | { content: Buffer; mimeType: string }>((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: { accept: '*/*', 'accept-encoding': 'identity', 'user-agent': 'VCdocs-external-import' },
        agent: false,
        ca: o.ca,
        rejectUnauthorized: true,
        signal,
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: any[]) => void) =>
          opts?.all ? cb(null, [{ address: pin.address, family: pin.family }]) : cb(null, pin.address, pin.family)) as any,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECTS.has(status) && res.headers.location) {
          res.resume();
          return resolve({ location: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new GoogleError(`Tải về lỗi HTTP ${status}`));
        }
        const tooBig = () => new GoogleError(`File quá ${Math.round(o.maxBytes / 1024 / 1024)} MB`);
        // reject trước rồi mới huỷ: huỷ sẽ phát lỗi 'aborted' của chính luồng
        const fail = (e: Error) => {
          reject(e);
          req.destroy();
        };
        if (Number(res.headers['content-length'] || 0) > o.maxBytes) return fail(tooBig());
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) return fail(tooBig());
          chunks.push(c);
        });
        res.on('end', () => resolve({ content: Buffer.concat(chunks), mimeType: String(res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim() }));
        res.on('error', () => reject(new GoogleError('Không tải được đường dẫn')));
      },
    );
    req.on('error', (e) => reject(e instanceof GoogleError ? e : new GoogleError(signal.aborted ? 'Tải về quá thời gian' : 'Không tải được đường dẫn')));
    req.end();
  });
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<{ content: Buffer; mimeType: string; fileName: string }> {
  const o = { maxBytes: 100 * 1024 * 1024, maxRedirects: 5, timeoutMs: 30_000, ...opts };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      const problem = urlProblem(current);
      if (problem) throw new GoogleError(problem);
      const u = new URL(current);
      const pin = await resolvePublic(u, o);
      const r = await getOnce(u, pin, o, ctrl.signal);
      if ('content' in r) return { ...r, fileName: fileNameOf(u) };
      if (hop >= o.maxRedirects) throw new GoogleError('Chuyển hướng quá nhiều lần');
      current = new URL(r.location, u).toString();
    }
  } finally {
    clearTimeout(timer);
  }
}
