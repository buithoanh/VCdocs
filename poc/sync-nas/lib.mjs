// Chat15 Sync + NAS PoC helpers. Reuses the chat13 work13 stack and the chat14
// Flow helpers (personas, app-password clients, occ). WORK13_SECRETS_DIR must
// point at the chat13 stack's git-ignored secrets/ folder (local PoC values,
// never copied into this repo, never printed).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileAsync, occ, sleep } from '../flow/lib.mjs';

export { client, occ, sleep, execFileAsync, personas, resetBruteforce, adminRequest, ocsData, expectStatus } from '../flow/lib.mjs';
export { stats } from '../flow/flow-helpers.mjs';

export const syncRoot = dirname(fileURLToPath(import.meta.url));
export const nasContainer = 'vcworkspace-sync15-nas15-1';
export const smbClientContainer = 'vcworkspace-sync15-smb-client-1';
export const notifyContainer = 'vcworkspace-sync15-files-notify-1';
export const nasAccounts = ['svc-nc-team-a', 'svc-nc-team-b', 'nas-member-a', 'nas-manager-b', 'nas-outsider'];
export const teamGroups = {
  a: '35e05c4d98ac9ec0bd7ae534b5e461d7ecbc9a7e254d0c12a96bffef0a499b74',
  b: '3e54c1d9f7d6edb3e6e1a4f065288afa0fcdc69840a13d3385a4838d724e33cf',
  outsiders: '1711d9beb2ebb106567e858205df4e2630fd27a73f0c399bb1d67fe6f30f0f44',
};

export const docker = (...args) => execFileAsync('docker', args, { maxBuffer: 64 * 1024 * 1024 });

export async function nasSecret(account) {
  return (await readFile(join(syncRoot, 'secrets', 'nas', account), 'utf8')).trim();
}

/** Lệnh chạy trực tiếp trên NAS (như job/ứng dụng chạy trên chính NAS), không qua Nextcloud */
export const nasExec = (...args) => docker('exec', nasContainer, ...args);

/**
 * smbclient từ container client với tài khoản NAS (auth file, không có mật khẩu trên argv).
 * account=null → thử ẩn danh (-N). Trả { ok, code, out } (không ném khi bị từ chối).
 */
export async function smb(account, share, commands, { timeoutMs = 60_000 } = {}) {
  const auth = account ? ['-A', `/auth/${account}`] : ['-N'];
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['exec', smbClientContainer, 'smbclient', `//nas15/${share}`, ...auth, '-m', 'SMB3', '-c', commands], { maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs });
    const out = `${stdout}${stderr}`;
    return { ok: !/NT_STATUS_[A-Z_]+/.test(out) || /NT_STATUS_OK/.test(out), code: 0, out, status: /NT_STATUS_[A-Z_]+/.exec(out)?.[0] ?? 'OK' };
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return { ok: false, code: error.code, out, status: /NT_STATUS_[A-Z_]+/.exec(out)?.[0] ?? `EXIT_${error.code}` };
  }
}

export async function writeEvidence(name, value) {
  await mkdir(join(syncRoot, 'evidence'), { recursive: true });
  await writeFile(join(syncRoot, 'evidence', name), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...value, secretsIncluded: false }, null, 2)}\n`);
}
export async function readEvidence(name) {
  return JSON.parse(await readFile(join(syncRoot, 'evidence', name), 'utf8'));
}

export const davPath = (actor, path = '') => `/remote.php/dav/files/${encodeURIComponent(actor.uid)}/${path.split('/').map(encodeURIComponent).join('/')}`;

const PROPS = '<d:getetag/><oc:fileid/><oc:id/><oc:permissions/><oc:size/><d:getlastmodified/><d:resourcetype/><oc:checksums/><d:getcontentlength/>';
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

/** PROPFIND → [{ href, path(decoded), etag, fileId, permissions, size, isDir, lastModified, checksums }] */
export async function propfind(actor, path, depth = '1', extraHeaders = {}) {
  const response = await actor.request('PROPFIND', davPath(actor, path), {
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>${PROPS}</d:prop></d:propfind>`,
    headers: { Depth: depth, 'Content-Type': 'application/xml', ...extraHeaders },
  });
  const entries = [];
  if (response.status === 207) {
    for (const m of String(response.data).matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
      const block = m[1];
      const get = (tag) => { const r = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block); return r ? unxml(r[1]) : null; };
      const href = get('d:href');
      entries.push({
        href,
        path: href ? decodeURIComponent(href) : null,
        etag: get('d:getetag')?.replace(/"/g, '') ?? null,
        fileId: Number(get('oc:fileid')) || null,
        permissions: get('oc:permissions'),
        size: Number(get('oc:size') ?? get('d:getcontentlength')) || 0,
        isDir: /<d:collection\s*\/>/.test(block),
        lastModified: get('d:getlastmodified'),
        checksums: get('oc:checksum'),
      });
    }
  }
  return { status: response.status, entries };
}

export async function fileId(actor, path) {
  const { entries } = await propfind(actor, path, '0');
  return entries[0]?.fileId ?? null;
}

export async function waitUntil(label, fn, { timeoutMs = 60_000, intervalMs = 200 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return { value, ms: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { value: null, ms: null, timeout: true, label };
    await sleep(intervalMs);
  }
}

/** files_external:list → mount theo mount point (không in mật khẩu) */
export async function mounts() {
  const { stdout } = await occ('files_external:list', '--output=json');
  return JSON.parse(stdout);
}
