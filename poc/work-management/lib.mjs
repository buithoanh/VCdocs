import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const root = dirname(fileURLToPath(import.meta.url));
export const execFileAsync = promisify(execFile);
export const ncContainer = process.env.WORK13_NC_CONTAINER || 'vcworkspace-work13-nextcloud-1';
export const ncBase = process.env.WORK13_NC_BASE || 'http://nc13.localtest.me:18130';
export const akBase = 'http://ak13.localtest.me:18131';
export const personaNames = ['manager-a', 'member-a', 'successor-a', 'manager-b', 'member-b', 'outsider'];

export async function secret(name) {
  return (await readFile(join(root, 'secrets', name), 'utf8')).trim();
}

export async function occ(...args) {
  return execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-ansi', '--no-interaction', ...args], { maxBuffer: 20 * 1024 * 1024 });
}

export async function writeEvidence(name, value) {
  await mkdir(join(root, 'evidence'), { recursive: true });
  await writeFile(join(root, 'evidence', name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...value, secretsIncluded: false }, null, 2)}\n`);
}

export async function readEvidence(name) {
  return JSON.parse(await readFile(join(root, 'evidence', name), 'utf8'));
}

export async function akApi(path, { method = 'GET', body, expected = [200, 201, 204] } = {}) {
  const response = await fetch(`${akBase}/api/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${await secret('ak_bootstrap_token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!expected.includes(response.status)) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

export const results = (payload) => (Array.isArray(payload) ? payload : (payload?.results ?? []));

// Personas authenticate to Nextcloud APIs with app passwords minted by
// mint-app-passwords.mjs; the user ID is always the immutable OIDC-derived ID,
// never the Authentik username or email local-part.
export async function personas() {
  const { bindings } = await readEvidence('identity-bindings.json');
  return Object.fromEntries(bindings.map((binding) => [binding.username, binding]));
}

export async function client(username) {
  const binding = (await personas())[username];
  if (!binding) throw new Error(`PERSONA_NOT_BOUND:${username}`);
  const password = await secret(`app_password_${username}`);
  const authorization = `Basic ${Buffer.from(`${binding.nextcloudUserId}:${password}`).toString('base64')}`;
  const request = async (method, path, { json, body, headers = {}, raw = false } = {}) => {
    const response = await fetch(`${ncBase}${path}`, {
      method,
      headers: {
        Authorization: authorization,
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (raw) return { status: response.status, bytes, headers: response.headers };
    let data = bytes.toString('utf8');
    try { data = JSON.parse(data); } catch { /* keep text */ }
    return { status: response.status, data };
  };
  return { username, uid: binding.nextcloudUserId, request };
}

export const ocsData = (response) => response.data?.ocs?.data ?? response.data;

export function expectStatus(label, response, allowed) {
  if (!allowed.includes(response.status)) {
    throw new Error(`${label}: status ${response.status} not in ${allowed.join('/')}: ${JSON.stringify(response.data).slice(0, 400)}`);
  }
  return response;
}

// Deny probes produce many 403s from the single relay IP, so Nextcloud brute
// force protection starts throttling (eventually HTTP 500 "Reached maximum
// delay"). That is fail-closed, but it would mask real statuses: tests reset
// the counter for the relay IP before each matrix. Protection stays enabled.
export async function resetBruteforce() {
  const { stdout } = await execFileAsync('docker', ['inspect', 'vcworkspace-work13-nextcloud-loopback-relay-1', '--format', '{{(index .NetworkSettings.Networks "vcworkspace-work13_work13").IPAddress}}']);
  await occ('security:bruteforce:reset', stdout.trim());
}
