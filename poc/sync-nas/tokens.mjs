// Chat15: app passwords ("devices") for the WebDAV sync tests. Each device is a
// named Nextcloud app password minted with occ for an existing persona; values
// go to secrets/devices/<name> (0600) and are never printed or put in evidence.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { occ, syncRoot } from './lib.mjs';

const dir = join(syncRoot, 'secrets', 'devices');

export async function listTokens(uid) {
  return JSON.parse((await occ('user:auth-tokens:list', '--output=json', uid)).stdout);
}

/** Thu hồi mọi token cùng tên rồi cấp mới; trả { name, id } */
export async function mintDevice(uid, name) {
  for (const token of (await listTokens(uid)).filter((t) => t.name === name)) await occ('user:auth-tokens:delete', uid, String(token.id));
  const { stdout } = await occ('user:auth-tokens:add', `--name=${name}`, uid);
  const password = stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean).at(-1);
  if (!password || password.length < 40 || /\s/.test(password)) throw new Error(`APP_PASSWORD_PARSE_FAILED:${name}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, name), `${password}\n`, { mode: 0o600 });
  await chmod(join(dir, name), 0o600);
  const id = (await listTokens(uid)).find((t) => t.name === name)?.id;
  return { name, id };
}

export async function revokeDevice(uid, name) {
  const tokens = (await listTokens(uid)).filter((t) => t.name === name);
  for (const token of tokens) await occ('user:auth-tokens:delete', uid, String(token.id));
  return tokens.length;
}

/** Client WebDAV/OCS cho một thiết bị (uid bất biến + app password của thiết bị) */
export async function deviceClient(uid, name, base = 'http://nc13.localtest.me:18130') {
  const password = (await readFile(join(dir, name), 'utf8')).trim();
  const authorization = `Basic ${Buffer.from(`${uid}:${password}`).toString('base64')}`;
  const request = async (method, path, { body, headers = {}, raw = false } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: authorization, 'OCS-APIRequest': 'true', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    return raw ? { status: response.status, bytes, headers: response.headers } : { status: response.status, data: bytes.toString('utf8'), headers: response.headers };
  };
  return { uid, name, request };
}
