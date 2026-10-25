import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { api, root, secret } from './authentik-api.mjs';

const base = 'http://nextcloud.localtest.me:18120/ocs/v1.php/cloud';
const adminPassword = await secret('nc_admin_password');
const provisioning = JSON.parse(await readFile(join(root, 'evidence', 'provisioning.json'), 'utf8'));
const provider = provisioning.applications.find((item) => item.applicationSlug === 'nextcloud-33-test');
const correlationId = process.env.IDENTITY12_CORRELATION_ID || randomUUID();
const journalPath = join(root, 'evidence', 'lifecycle-journal.json');
const lockPath = join(root, 'evidence', 'lifecycle.lock');
await mkdir(join(root, 'evidence'), { recursive: true });
try { await mkdir(lockPath); } catch (error) {
  if (error.code === 'EEXIST') throw new Error('LIFECYCLE_RECONCILE_ALREADY_RUNNING');
  throw error;
}
const releaseLock = () => rmSync(lockPath, { recursive: true, force: true });
process.once('exit', releaseLock);
if (process.env.IDENTITY12_HOLD_LOCK_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.IDENTITY12_HOLD_LOCK_MS)));
let journal = { commands: [] };
try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch {}
async function persistJournal() {
  await mkdir(join(root, 'evidence'), { recursive: true });
  const temporary = `${journalPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, journalPath);
}
async function record(subject, operation, action) {
  const key = `${correlationId}:${subject}:${operation}`;
  let entry = journal.commands.find((item) => item.key === key);
  if (entry?.status === 'done') return;
  if (!entry) {
    entry = { key, correlationId, subject, operation, status: 'pending', attempts: 0 };
    journal.commands.push(entry);
  }
  entry.attempts += 1;
  await persistJournal();
  await action();
  if (process.env.IDENTITY12_FAIL_AFTER_OPERATION === operation) throw new Error(`INJECTED_FAILURE_AFTER:${operation}`);
  entry.status = 'done';
  entry.completedAt = new Date().toISOString();
  await persistJournal();
}

async function ocs(path, { method = 'GET', form, expected = [100, 200] } = {}) {
  const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}format=json`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`admin12:${adminPassword}`).toString('base64')}`,
      'OCS-APIRequest': 'true',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  const status = payload?.ocs?.meta?.statuscode;
  if (!expected.includes(status)) throw new Error(`${method} ${path} OCS ${status}: ${payload?.ocs?.meta?.message}`);
  return payload.ocs.data;
}

const passwordByUsername = {
  admin12: 'persona_admin_password',
  'manager-a': 'persona_manager_password',
  'member-a': 'persona_member_password',
  'outsider-b': 'persona_outsider_password',
};
const oidcGroupId = (group) => createHash('sha256').update(`1_0_${group}`).digest('hex');
const bindings = [];
for (const persona of provisioning.personas) {
  const authentikUser = await api(`/core/users/${persona.pk}/`);
  const claimResponse = await api(`/providers/oauth2/${provider.providerId}/preview_user/?for_user=${persona.pk}`);
  const claims = claimResponse.preview;
  const userPath = `/${encodeURIComponent(claims.sub)}`;
  let exists = true;
  try { await ocs(`/users${userPath}`); } catch (error) {
    if (!/OCS (404|998)/.test(String(error.message))) throw error;
    exists = false;
  }
  if (!exists) {
    const localPassword = await secret(passwordByUsername[persona.username]);
    await record(claims.sub, 'create-user', () => ocs('/users', { method: 'POST', form: {
      userid: claims.sub,
      password: localPassword,
      displayName: claims.name,
      email: claims.email,
    } }));
  }
  await record(claims.sub, `email:${claims.email}`, () => ocs(`/users${userPath}`, { method: 'PUT', form: { key: 'email', value: claims.email } }));
  const beforeGroups = await ocs(`/users${userPath}/groups`);
  const desiredGroups = new Set(claims.groups ?? []);
  const desiredOidcGroups = new Set([...(claims.groups ?? [])].map(oidcGroupId));
  for (const entry of journal.commands.filter((item) => item.correlationId === correlationId && item.subject === claims.sub && item.status === 'pending')) {
    const removedGroup = entry.operation.startsWith('remove-group:') ? entry.operation.slice('remove-group:'.length) : null;
    const addedGroup = entry.operation.startsWith('add-group:') ? entry.operation.slice('add-group:'.length) : null;
    const alreadySatisfied = (removedGroup && !desiredGroups.has(removedGroup) && !beforeGroups.groups.includes(removedGroup))
      || (addedGroup && desiredGroups.has(addedGroup) && beforeGroups.groups.includes(addedGroup));
    if (alreadySatisfied) await record(claims.sub, entry.operation, async () => {});
  }
  for (const group of beforeGroups.groups.filter((item) => (item.startsWith('vcw-') && !desiredGroups.has(item)) || (/^[0-9a-f]{64}$/.test(item) && !desiredOidcGroups.has(item)))) {
    await record(claims.sub, `remove-group:${group}`, () => ocs(`/users${userPath}/groups`, { method: 'DELETE', form: { groupid: group } }));
  }
  for (const group of claims.groups ?? []) {
    await record(claims.sub, `add-group:${group}`, () => ocs(`/users${userPath}/groups`, { method: 'POST', form: { groupid: group }, expected: [100, 102] }));
    const federatedGroup = oidcGroupId(group);
    await record(claims.sub, `add-group:${federatedGroup}`, () => ocs(`/users${userPath}/groups`, { method: 'POST', form: { groupid: federatedGroup }, expected: [100, 102] }));
  }
  await record(claims.sub, authentikUser.is_active ? 'enable-user' : 'disable-user', () =>
    ocs(`/users${userPath}/${authentikUser.is_active ? 'enable' : 'disable'}`, { method: 'PUT' }));
  const readback = await ocs(`/users${userPath}`);
  const actualGroups = await ocs(`/users${userPath}/groups`);
  if (readback.id !== claims.sub || readback.email !== claims.email || readback.enabled !== authentikUser.is_active || !(claims.groups ?? []).every((group) => actualGroups.groups.includes(group) && actualGroups.groups.includes(oidcGroupId(group)))) {
    throw new Error(`READBACK_MISMATCH:${persona.username}`);
  }
  bindings.push({ authentikPk: persona.pk, username: persona.username, subject: claims.sub, nextcloudUserId: readback.id, email: readback.email, enabled: readback.enabled, groups: actualGroups.groups });
}
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'identity-bindings.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), bindings, secretsIncluded: false }, null, 2)}\n`);
await rm(lockPath, { recursive: true, force: true });
console.log(`Reconciled and read back ${bindings.length} immutable subject bindings through OCS with correlation ${correlationId}; no Nextcloud DB access.`);
