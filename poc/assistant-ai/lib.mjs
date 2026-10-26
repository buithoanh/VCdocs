// Chat19 Assistant AI (read-only) PoC helpers on the running work13 stack
// (Nextcloud 33.0.10 + Authentik chat13, Calendar/Contacts chat16, Talk chat17).
// Reuses the generic helpers of chat16/chat17 (occ, docker, personas, team
// group ids, HTTP client) but keeps its own git-ignored secrets/ (app passwords
// "ai19-api", minted by occ) and its own evidence/. Never prints secret values;
// never reads .env or the secrets of earlier chats.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  assert, docker, execFileAsync, ncContainer, occ, occJson, personas, resetBruteforce, sleep, stats, teamGroups,
} from '../calendar-contacts/lib.mjs';
export { talk, ocsData } from '../talk/lib.mjs';
import { personas } from '../calendar-contacts/lib.mjs';

export const aiRoot = dirname(fileURLToPath(import.meta.url));
export const secretsDir = join(aiRoot, 'secrets');
export const ncBase = process.env.AI19_NC_BASE || 'http://localhost:18130';
export const ollamaHost = 'http://127.0.0.1:11434';
// Container-side URL of the host Ollama through the single-purpose relay
// (compose.ai19.yaml). Nextcloud itself stays on the internal network only.
export const ollamaRelayUrl = 'http://ollama19.internal:11434/v1';
export const actorNames = ['successor-a', 'member-a', 'manager-b', 'member-b', 'outsider'];
export const tokenName = 'ai19-api';
export const team = { 'successor-a': 'A', 'member-a': 'A', 'manager-b': 'B', 'member-b': 'B', outsider: 'none' };

export async function secret(name) {
  return (await readFile(join(secretsDir, name), 'utf8')).trim();
}
export async function writeEvidence(name, value) {
  await mkdir(join(aiRoot, 'evidence'), { recursive: true });
  await writeFile(join(aiRoot, 'evidence', name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...value, secretsIncluded: false }, null, 2)}\n`);
}
export async function readEvidence(name) {
  return JSON.parse(await readFile(join(aiRoot, 'evidence', name), 'utf8'));
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

export async function uidOf(username) {
  if (username === 'admin13') return 'admin13';
  const binding = (await personas())[username];
  if (!binding) throw new Error(`PERSONA_NOT_BOUND:${username}`);
  return binding.nextcloudUserId;
}

/** HTTP client as one persona (immutable uid + ai19 app password). */
export async function client(username, { base = ncBase } = {}) {
  const uid = await uidOf(username);
  const authorization = basic(uid, await secret(`app_password_${username}`));
  const request = async (method, path, { json, body, headers = {}, timeoutMs = 60000 } = {}) => {
    const response = await fetch(path.startsWith('http') ? path : `${base}${path}`, {
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data = text;
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      try { data = JSON.parse(text); } catch { /* keep text */ }
    }
    return { status: response.status, data, text, headers: response.headers };
  };
  return { username, uid, request, base };
}

export const ocs = (res) => res.data?.ocs?.data;
export const tp = (path = '') => `/ocs/v2.php/taskprocessing${path}`;

/** Schedule a TaskProcessing task as `c` and poll until it finishes. */
export async function runTask(c, type, input, { appId = 'ai19', customId, timeoutMs = 600000 } = {}) {
  const t0 = Date.now();
  const res = await c.request('POST', tp('/schedule'), { json: { input, type, appId, customId: customId ?? `ai19-${Date.now()}` } });
  if (res.status !== 200) return { scheduled: false, status: res.status, message: res.data?.ocs?.meta?.message ?? res.text.slice(0, 300), ms: Date.now() - t0 };
  const task = ocs(res).task;
  let current = task;
  let firstRunning = null;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
    const poll = await c.request('GET', tp(`/task/${task.id}`));
    current = ocs(poll)?.task ?? current;
    if (current.status === 'STATUS_RUNNING' && firstRunning === null) firstRunning = Date.now() - t0;
    if (['STATUS_SUCCESSFUL', 'STATUS_FAILED', 'STATUS_CANCELLED'].includes(current.status)) break;
  }
  return { scheduled: true, id: task.id, status: current.status, output: current.output, error: current.errorMessage ?? null, ms: Date.now() - t0, firstRunningMs: firstRunning };
}
