// Chat14 Flow PoC helpers. Reuses the chat13 work13 stack (Nextcloud 33.0.10 +
// Authentik) and its persona bindings. Secrets are the PoC-generated local
// values of that stack: WORK13_SECRETS_DIR points at the chat13 worktree's
// gitignored secrets/ directory (never copied into this repo, never printed).
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const flowRoot = dirname(fileURLToPath(import.meta.url));
export const work13Root = join(flowRoot, '..', 'work-management');
export const execFileAsync = promisify(execFile);
export const ncContainer = 'vcworkspace-work13-nextcloud-1';
export const ncBase = 'http://nc13.localtest.me:18130';
export const receiverPort = 18140;
export const receiverBase = `http://127.0.0.1:${receiverPort}/api/v1`;
// Inside the internal Docker network Nextcloud reaches the receiver only through this relay.
export const receiverUriForNextcloud = 'http://flow-receiver-relay:8080/api/v1/flow/nextcloud/webhooks';
const secretsDir = process.env.WORK13_SECRETS_DIR || join(work13Root, 'secrets');
export const flowSecretsDir = join(flowRoot, 'secrets');

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

export async function secret(name) {
  return (await readFile(join(secretsDir, name), 'utf8')).trim();
}
export async function flowSecret(name) {
  return (await readFile(join(flowSecretsDir, name), 'utf8')).trim();
}

export async function occ(...args) {
  return execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-ansi', '--no-interaction', ...args], { maxBuffer: 20 * 1024 * 1024 });
}

export async function writeEvidence(name, value) {
  await mkdir(join(flowRoot, 'evidence'), { recursive: true });
  await writeFile(join(flowRoot, 'evidence', name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...value, secretsIncluded: false }, null, 2)}\n`);
}
export async function readEvidence(name) {
  return JSON.parse(await readFile(join(flowRoot, 'evidence', name), 'utf8'));
}
export async function readWork13Evidence(name) {
  return JSON.parse(await readFile(join(work13Root, 'evidence', name), 'utf8'));
}

export async function personas() {
  const { bindings } = await readWork13Evidence('identity-bindings.json');
  return Object.fromEntries(bindings.map((binding) => [binding.username, binding]));
}

export async function client(username) {
  const binding = (await personas())[username];
  if (!binding) throw new Error(`PERSONA_NOT_BOUND:${username}`);
  const authorization = basic(binding.nextcloudUserId, await secret(`app_password_${username}`));
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

export async function adminRequest() {
  const authorization = basic('admin13', await secret('nc_admin_password'));
  return async (method, path, json) => {
    const response = await fetch(`${ncBase}${path}`, {
      method,
      headers: { Authorization: authorization, 'OCS-APIRequest': 'true', Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* keep text */ }
    return { status: response.status, data };
  };
}

export const ocsData = (response) => response.data?.ocs?.data ?? response.data;

export function expectStatus(label, response, allowed) {
  if (!allowed.includes(response.status)) {
    throw new Error(`${label}: status ${response.status} not in ${allowed.join('/')}: ${JSON.stringify(response.data).slice(0, 400)}`);
  }
  return response;
}

// Deny probes trigger Nextcloud brute-force throttling for the single relay IP;
// reset the counter for that IP only (protection stays enabled), as in chat13.
export async function resetBruteforce() {
  const { stdout } = await execFileAsync('docker', ['inspect', 'vcworkspace-work13-nextcloud-loopback-relay-1', '--format', '{{(index .NetworkSettings.Networks "vcworkspace-work13_work13").IPAddress}}']);
  await occ('security:bruteforce:reset', stdout.trim());
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
