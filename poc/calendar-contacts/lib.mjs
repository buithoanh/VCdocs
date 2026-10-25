// Chat16 Groupware Calendar/Contacts PoC helpers. Reuses the work13 stack
// (Nextcloud 33.0.10 + Authentik, chat13) and its persona bindings
// (poc/work-management/evidence/identity-bindings.json). Chat16 mints its own
// app passwords (token name cal16-dav) with occ into secrets/ (0600, git-ignored);
// it never reads the chat13 secrets folder and never prints secret values.
// All DAV/OCS calls go to http://localhost:18130 (trusted domain "localhost" of
// the work13 Nextcloud through its loopback relay).
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const calRoot = dirname(fileURLToPath(import.meta.url));
export const work13Root = join(calRoot, '..', 'work-management');
export const execFileAsync = promisify(execFile);
export const ncContainer = process.env.CAL16_NC_CONTAINER || 'vcworkspace-work13-nextcloud-1';
export const relayContainer = process.env.CAL16_RELAY_CONTAINER || 'vcworkspace-work13-nextcloud-loopback-relay-1';
export const relayNetwork = process.env.CAL16_RELAY_NETWORK || 'vcworkspace-work13_work13';
export const ncBase = process.env.CAL16_NC_BASE || 'http://localhost:18130';
export const secretsDir = join(calRoot, 'secrets');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const docker = (...args) => execFileAsync('docker', args, { maxBuffer: 64 * 1024 * 1024 });

export const teamGroups = {
  a: '35e05c4d98ac9ec0bd7ae534b5e461d7ecbc9a7e254d0c12a96bffef0a499b74',
  b: '3e54c1d9f7d6edb3e6e1a4f065288afa0fcdc69840a13d3385a4838d724e33cf',
  outsiders: '1711d9beb2ebb106567e858205df4e2630fd27a73f0c399bb1d67fe6f30f0f44',
};
// Personas used by chat16 (manager-a stays offboarded from chat13).
export const actorNames = ['successor-a', 'member-a', 'manager-b', 'member-b', 'outsider'];

export async function occ(...args) {
  return execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-ansi', '--no-interaction', ...args], { maxBuffer: 20 * 1024 * 1024 });
}
export async function occJson(...args) {
  return JSON.parse((await occ(...args, '--output=json')).stdout);
}

export async function secret(name) {
  return (await readFile(join(secretsDir, name), 'utf8')).trim();
}

export async function writeEvidence(name, value) {
  await mkdir(join(calRoot, 'evidence'), { recursive: true });
  await writeFile(join(calRoot, 'evidence', name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...value, secretsIncluded: false }, null, 2)}\n`);
}
export async function readEvidence(name) {
  return JSON.parse(await readFile(join(calRoot, 'evidence', name), 'utf8'));
}

export async function personas() {
  const { bindings } = JSON.parse(await readFile(join(work13Root, 'evidence', 'identity-bindings.json'), 'utf8'));
  return Object.fromEntries(bindings.map((binding) => [binding.username, binding]));
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/** HTTP client acting as one persona (immutable uid + chat16 app password). */
export async function client(username, { base = ncBase, password } = {}) {
  let uid;
  if (username === 'admin13') uid = 'admin13';
  else {
    const binding = (await personas())[username];
    if (!binding) throw new Error(`PERSONA_NOT_BOUND:${username}`);
    uid = binding.nextcloudUserId;
  }
  const authorization = basic(uid, password ?? await secret(`app_password_${username}`));
  return makeClient({ username, uid, authorization, base });
}

/** Client without credentials (anonymous) — for public endpoints and deny probes. */
export function anonymous(base = ncBase) {
  return makeClient({ username: 'anonymous', uid: null, authorization: null, base });
}

function makeClient({ username, uid, authorization, base }) {
  const request = async (method, path, { json, body, headers = {}, timeoutMs = 30000 } = {}) => {
    const response = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        'OCS-APIRequest': 'true',
        ...(json !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data = text;
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      try { data = JSON.parse(text); } catch { /* keep text */ }
    }
    return { status: response.status, data, text, headers: response.headers };
  };
  const dav = (method, path, body, headers = {}) => request(method, path, {
    body,
    headers: { ...(body && !headers['Content-Type'] ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}), ...headers },
  });
  return { username, uid, request, dav, base };
}

export const enc = encodeURIComponent;
export const calHome = (uid) => `/remote.php/dav/calendars/${enc(uid)}/`;
export const calPath = (uid, uri) => `/remote.php/dav/calendars/${enc(uid)}/${enc(uri)}/`;
export const abHome = (uid) => `/remote.php/dav/addressbooks/users/${enc(uid)}/`;
export const abPath = (uid, uri) => `/remote.php/dav/addressbooks/users/${enc(uid)}/${enc(uri)}/`;
export const principal = (uid) => `/remote.php/dav/principals/users/${enc(uid)}/`;

export const NS = 'xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.com/ns"';

export const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#13;/g, '\r').replace(/&amp;/g, '&');

/** Minimal multistatus parser: [{ href, status, props: {localName: innerXml} }]. */
export function parseMultistatus(xml) {
  const out = [];
  for (const block of xml.split(/<d:response>/).slice(1)) {
    const href = unxml((/<d:href>([^<]*)<\/d:href>/.exec(block) ?? [])[1] ?? '');
    const props = {};
    let status = null;
    for (const propstat of block.split(/<d:propstat>/).slice(1)) {
      const st = (/<d:status>HTTP\/1\.1 (\d+)/.exec(propstat) ?? [])[1];
      if (st !== '200') continue;
      const prop = (/<d:prop>([\s\S]*?)<\/d:prop>/.exec(propstat) ?? [])[1] ?? '';
      for (const m of prop.matchAll(/<([a-z0-9-]+):([A-Za-z0-9-]+)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1:\2>)/g)) props[m[2]] = m[3] ?? '';
    }
    const top = /<\/d:propstat>\s*<d:status>HTTP\/1\.1 (\d+)/.exec(block) ?? /^[\s\S]*?<d:status>HTTP\/1\.1 (\d+)/.exec(block.replace(/<d:propstat>[\s\S]*<\/d:propstat>/g, ''));
    if (top) status = Number(top[1]);
    out.push({ href, status, props });
  }
  return out;
}

export function syncTokenOf(xml) {
  return unxml((/<d:sync-token>([^<]*)<\/d:sync-token>/.exec(xml) ?? [])[1] ?? '');
}

/** iCalendar unfolding + property lookup helpers. */
export const unfold = (ics) => ics.replace(/\r?\n[ \t]/g, '');
export function icsProps(ics, name) {
  return unfold(ics).split(/\r?\n/).filter((line) => line.toUpperCase().startsWith(`${name.toUpperCase()}`) && /^[A-Z-]+[;:]/i.test(line) && line.split(/[;:]/)[0].toUpperCase() === name.toUpperCase());
}
export const crlf = (lines) => `${lines.join('\r\n')}\r\n`;

// Deny probes produce many 401/403 from the single relay IP, which triggers
// Nextcloud brute force protection (fail-closed, but masks real statuses).
// Reset the counter for the relay IP before each matrix; protection stays on.
export async function resetBruteforce() {
  const { stdout } = await docker('inspect', relayContainer, '--format', `{{(index .NetworkSettings.Networks "${relayNetwork}").IPAddress}}`);
  await occ('security:bruteforce:reset', stdout.trim());
}

export function assert(condition, label, detail) {
  if (!condition) throw new Error(`ASSERT_FAILED:${label}${detail === undefined ? '' : `:${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 4000)}`}`);
}

export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: sorted.length, p50: pick(0.5), p95: pick(0.95), max: sorted.at(-1) };
}
