import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(fileURLToPath(import.meta.url));
export const baseUrl = process.env.AUTHENTIK_BASE_URL || 'http://authentik.localtest.me:18121/api/v3';

export async function secret(name) {
  return (await readFile(join(root, 'secrets', name), 'utf8')).trim();
}

export async function api(path, { method = 'GET', body, expected = [200, 201, 204] } = {}) {
  const token = await secret('ak_bootstrap_token');
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

export function results(payload) {
  return Array.isArray(payload) ? payload : (payload?.results ?? []);
}
