// Chat14: shared helpers for the acceptance scripts (journal polling, stats).
import { sleep } from './lib.mjs';

export function stats(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { n: sorted.length, min: sorted[0], p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], mean: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length) };
}

/** Chờ journal của tài nguyên tới trạng thái cuối (done/skipped/failed) */
export async function waitEvent(api, resourceKey, { timeoutMs = 30_000, count = 1, statuses = ['done', 'skipped', 'failed'] } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = await api(`/flow/events?resourceKey=${encodeURIComponent(resourceKey)}&limit=50&sort=receivedAt`);
    const items = page.data?.items ?? [];
    const final = items.filter((item) => statuses.includes(item.status));
    if (final.length >= count) return items;
    if (Date.now() > deadline) throw new Error(`EVENT_TIMEOUT:${resourceKey}:${JSON.stringify(items.map((item) => item.status))}`);
    await sleep(100);
  }
}

export async function waitFor(label, fn, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`TIMEOUT:${label}`);
    await sleep(intervalMs);
  }
}

export const deckApi = '/index.php/apps/deck/api/v1.0';
export const formsApi = '/ocs/v2.php/apps/forms/api/v3';
export const tablesApi = '/index.php/apps/tables/api/1';
