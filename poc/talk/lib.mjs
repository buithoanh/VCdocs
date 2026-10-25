// Chat17 Talk (spreed) PoC helpers on the running work13 stack (Nextcloud
// 33.0.10 + Authentik, chat13; Calendar/Contacts chat16). Reuses the generic
// helpers of chat16 (occ, docker, personas, team group ids, brute-force reset)
// but keeps its own git-ignored secrets/ (app passwords "talk17-api", minted by
// occ) and its own evidence/. Never prints secret values; never reads .env or
// the secrets of earlier chats.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  assert, docker, execFileAsync, ncContainer, occ, occJson, personas, relayContainer, relayNetwork,
  resetBruteforce, sleep, stats, teamGroups, calPath, enc, parseMultistatus, unxml,
} from '../calendar-contacts/lib.mjs';
import { personas } from '../calendar-contacts/lib.mjs';

export const talkRoot = dirname(fileURLToPath(import.meta.url));
export const secretsDir = join(talkRoot, 'secrets');
export const ncBase = process.env.TALK17_NC_BASE || 'http://localhost:18130';
export const actorNames = ['successor-a', 'member-a', 'manager-b', 'member-b', 'outsider'];
export const tokenName = 'talk17-api';

export async function secret(name) {
  return (await readFile(join(secretsDir, name), 'utf8')).trim();
}
export async function writeEvidence(name, value) {
  await mkdir(join(talkRoot, 'evidence'), { recursive: true });
  await writeFile(join(talkRoot, 'evidence', name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...value, secretsIncluded: false }, null, 2)}\n`);
}
export async function readEvidence(name) {
  return JSON.parse(await readFile(join(talkRoot, 'evidence', name), 'utf8'));
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

export async function uidOf(username) {
  if (username === 'admin13') return 'admin13';
  const binding = (await personas())[username];
  if (!binding) throw new Error(`PERSONA_NOT_BOUND:${username}`);
  return binding.nextcloudUserId;
}

/** HTTP client as one persona (immutable uid + talk17 app password). */
export async function client(username, { base = ncBase, password } = {}) {
  const uid = await uidOf(username);
  const authorization = basic(uid, password ?? await secret(`app_password_${username}`));
  return makeClient({ username, uid, authorization, base });
}
export function anonymous(base = ncBase, { jar = false } = {}) {
  return makeClient({ username: 'anonymous', uid: null, authorization: null, base, jar });
}
/** Persona client that keeps cookies (PHP session) like a browser/app does:
 * needed for Talk room sessions and internal signaling. */
export async function sessionClient(username, opts = {}) {
  const c = await client(username, opts);
  return makeClient({ username: c.username, uid: c.uid, authorization: c.authorization, base: c.base, jar: true });
}

function makeClient({ username, uid, authorization, base, jar = false }) {
  const cookies = new Map();
  const request = async (method, path, { json, body, headers = {}, timeoutMs = 30000, cookie } = {}) => {
    const jarCookie = jar && cookies.size ? [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') : null;
    const response = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie || jarCookie ? { Cookie: cookie ?? jarCookie } : {}),
        // Nextcloud CSRF check for cookie sessions is satisfied by OCS-APIRequest.
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (jar) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (v === 'deleted' || /expires=Thu, 01 Jan 1970/i.test(line)) cookies.delete(k); else cookies.set(k, v);
      }
    }
    const text = await response.text();
    let data = text;
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      try { data = JSON.parse(text); } catch { /* keep text */ }
    }
    return { status: response.status, data, text, headers: response.headers };
  };
  return { username, uid, request, base, authorization, cookies };
}

// Talk OCS API (spreed): conversations api/v4, chat api/v1, call api/v4, signaling api/v3.
export const talk = {
  room: (path = '') => `/ocs/v2.php/apps/spreed/api/v4/room${path}`,
  chat: (token, path = '') => `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(token)}${path}`,
  call: (token) => `/ocs/v2.php/apps/spreed/api/v4/call/${encodeURIComponent(token)}`,
  signaling: (path) => `/ocs/v2.php/apps/spreed/api/v3/signaling${path}`,
};
export const ocsData = (res) => res.data?.ocs?.data;
