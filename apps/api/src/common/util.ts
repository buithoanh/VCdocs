import * as crypto from 'crypto';
import { Types } from 'mongoose';
import { Errors } from './errors';

export const TZ = 'Asia/Ho_Chi_Minh';

/** Ngày YYYY-MM-DD theo giờ Việt Nam */
export function dateVN(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function monthVN(d: Date = new Date()): string {
  return dateVN(d).slice(0, 7);
}
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400_000);
}
export function addDaysToDateStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + days * 86400_000).toISOString().slice(0, 10);
}
export function addMonthsToDateStr(date: string, months: number): string {
  const [y, m, day] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
/** Ngày cuối của tháng YYYY-MM */
export function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}
/** Số ngày làm việc (thứ 2–6) từ `from` (không tính) tới `to` (tính), cả hai dạng YYYY-MM-DD */
export function workingDaysBetween(from: string, to: string): number {
  let a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  let n = 0;
  while (a < b) {
    a += 86400_000;
    const wd = new Date(a).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** Bỏ dấu tiếng Việt, chữ thường – dùng tìm kiếm, so tên gần giống */
export function normalizeText(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
export function md5(data: Buffer | string): string {
  return crypto.createHash('md5').update(data).digest('hex');
}
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function isObjectId(s: unknown): s is string {
  return typeof s === 'string' && /^[a-f0-9]{24}$/.test(s);
}
export function oid(s: string): Types.ObjectId {
  if (!isObjectId(s)) throw Errors.notFound();
  return new Types.ObjectId(s);
}
export function newId(): string {
  return new Types.ObjectId().toHexString();
}

/**
 * Đổi bản ghi Mongo (lean) thành JSON đúng hợp đồng: _id → id, ObjectId → chuỗi,
 * Date → ISO, bỏ trường null/undefined (hợp đồng không cho null).
 */
export function toApi<T = any>(doc: any, omit: string[] = []): T {
  return clean(doc, new Set(['__v', ...omit]), true);
}
function clean(v: any, omit: Set<string>, top: boolean): any {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Types.ObjectId) return v.toHexString();
  if (Buffer.isBuffer(v)) return undefined;
  if (Array.isArray(v)) return v.map((x) => clean(x, new Set(), false)).filter((x) => x !== undefined);
  if (typeof v === 'object') {
    if (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID') return String(v);
    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (top && omit.has(k)) continue;
      if (k === '__v') continue;
      const key = k === '_id' ? 'id' : k;
      const c = clean(val, new Set(), false);
      if (c !== undefined) out[key] = c;
    }
    return out;
  }
  return v;
}

export function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  const out: any = {};
  for (const k of keys) if ((obj as any)[k] !== undefined) out[k] = (obj as any)[k];
  return out;
}
