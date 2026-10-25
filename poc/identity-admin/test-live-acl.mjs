import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, secret } from './authentik-api.mjs';

const evidence = JSON.parse(await readFile(join(root, 'evidence', 'identity-bindings.json'), 'utf8'));
const nextcloudBaseUrl = process.env.NEXTCLOUD_BASE_URL || 'http://nextcloud.localtest.me:18120';
const byName = Object.fromEntries(evidence.bindings.map((item) => [item.username, item]));
const passwordSecret = { 'manager-a': 'persona_manager_password', 'member-a': 'persona_member_password', 'outsider-b': 'persona_outsider_password' };
const marker = `chat12-acl-${Date.now()}`;
const correlationId = randomUUID();
const bytes = Buffer.from(marker);
const hash = createHash('sha256').update(bytes).digest('hex');

async function dav(username, method, relativePath, body) {
  const user = byName[username];
  const password = await secret(passwordSecret[username]);
  const path = `/remote.php/dav/files/${encodeURIComponent(user.subject)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(`${nextcloudBaseUrl}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${user.subject}:${password}`).toString('base64')}`, 'X-Request-Id': correlationId },
    body,
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
}

const put = await dav('manager-a', 'PUT', 'Team A/chat12-acl.txt', bytes);
if (![201, 204].includes(put.status)) throw new Error(`MANAGER_PUT_${put.status}`);
const member = await dav('member-a', 'GET', 'Team A/chat12-acl.txt');
if (member.status !== 200 || createHash('sha256').update(member.bytes).digest('hex') !== hash) throw new Error(`MEMBER_READ_${member.status}`);
const outsiderRead = await dav('outsider-b', 'GET', 'Team A/chat12-acl.txt');
if (![403, 404].includes(outsiderRead.status)) throw new Error(`OUTSIDER_READ_LEAK_${outsiderRead.status}`);
const outsiderWrite = await dav('outsider-b', 'PUT', 'Team A/outsider.txt', Buffer.from('deny'));
if (![403, 404, 409].includes(outsiderWrite.status)) throw new Error(`OUTSIDER_WRITE_LEAK_${outsiderWrite.status}`);

const result = {
  generatedAt: new Date().toISOString(), marker, correlationId, sha256: hash,
  managerPut: put.status, memberRead: member.status,
  outsiderRead: outsiderRead.status, outsiderWrite: outsiderWrite.status,
  tenantCrossDenied: true, secretsIncluded: false,
};
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', process.env.ACL_EVIDENCE_FILE || 'acl-webdav.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`WebDAV ACL PASS: manager ${put.status}, member ${member.status}, outsider read/write ${outsiderRead.status}/${outsiderWrite.status}, hash ${hash.slice(0, 12)}…`);
