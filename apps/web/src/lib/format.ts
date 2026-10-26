const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-10-19 → 19/10/2026 */
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m && value.length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Thời điểm → 19/10/2026 21:46 (giờ máy người dùng). */
export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 2026-10 → 10/2026 */
export function formatMonth(value?: string | null): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${m[2]}/${m[1]}` : value;
}

/** Số có dấu "." ngăn nghìn (HD-VCPV-02). */
export function formatNumber(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Hôm nay theo giờ Việt Nam (YYYY-MM-DD) – các mốc ngày làm việc cuối (BR-25) tính theo giờ này. */
export function todayVN(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 1536 → "1,5 KB" */
export function formatBytes(n?: number | null): string {
  if (n === undefined || n === null) return '—';
  if (n < 1024) return `${formatNumber(n)} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1).replace('.', ',')} ${units[i]}`;
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function addDaysISO(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/** Ngày (YYYY-MM-DD) → thời điểm cuối ngày giờ Việt Nam, dùng cho expiresAt. */
export function endOfDayVN(date: string): string {
  return `${date}T23:59:59+07:00`;
}

export function shortId(id?: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}
