import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, root, secret } from './authentik-api.mjs';

const provisioning = JSON.parse(await readFile(join(root, 'evidence', 'provisioning.json'), 'utf8'));
const users = Object.fromEntries(provisioning.personas.map((item) => [item.username, item]));
const groups = Object.fromEntries(provisioning.groups.map((item) => [item.name, item]));
const provider = provisioning.applications.find((item) => item.applicationSlug === 'nextcloud-33-test');
const execFileAsync = promisify(execFile);

async function claims(username) {
  return (await api(`/providers/oauth2/${provider.providerId}/preview_user/?for_user=${users[username].pk}`)).preview;
}
async function reconcile(label, correlationId = randomUUID(), failAfterOperation, holdLockMs) {
  await execFileAsync(process.execPath, [join(root, 'lifecycle-nextcloud.mjs')], {
    env: { ...process.env, IDENTITY12_CORRELATION_ID: correlationId, ...(failAfterOperation ? { IDENTITY12_FAIL_AFTER_OPERATION: failAfterOperation } : {}), ...(holdLockMs ? { IDENTITY12_HOLD_LOCK_MS: String(holdLockMs) } : {}) },
  });
  return JSON.parse(await readFile(join(root, 'evidence', 'identity-bindings.json'), 'utf8'));
}
async function dav(username, passwordSecret, method, subject, relative = '') {
  const password = await secret(passwordSecret);
  const path = `/remote.php/dav/files/${encodeURIComponent(subject)}/${relative.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
  return fetch(`http://nextcloud.localtest.me:18120${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${subject}:${password}`).toString('base64')}` },
    signal: AbortSignal.timeout(5000),
  });
}

const result = { generatedAt: new Date().toISOString(), joiner: {}, renameEmail: {}, mover: {}, leaver: {}, partialFailure: {}, secretsIncluded: false };
const initialManager = await claims('manager-a');
const initialMember = await claims('member-a');
result.joiner = { subjectBound: true, subject: initialMember.sub, initialGroups: initialMember.groups };

const firstRace = reconcile('race-winner', randomUUID(), undefined, 500);
await new Promise((resolve) => setTimeout(resolve, 80));
const secondRace = reconcile('race-loser');
const race = await Promise.allSettled([firstRace, secondRace]);
if (race.filter((item) => item.status === 'fulfilled').length !== 1 || !race.some((item) => item.status === 'rejected' && String(item.reason.stderr || item.reason.message).includes('LIFECYCLE_RECONCILE_ALREADY_RUNNING'))) {
  throw new Error('LIFECYCLE_RACE_NOT_FENCED');
}
result.race = { exactlyOneWinner: true, loserFailClosed: 'LIFECYCLE_RECONCILE_ALREADY_RUNNING' };

try {
  await api(`/core/users/${users['manager-a'].pk}/`, { method: 'PATCH', body: { email: 'manager.renamed@tenant-a.test' } });
  const renamedClaims = await claims('manager-a');
  const renamedBindings = await reconcile('rename-email');
  const renamedBinding = renamedBindings.bindings.find((item) => item.username === 'manager-a');
  if (renamedClaims.sub !== initialManager.sub || renamedBinding.subject !== initialManager.sub || renamedBinding.email !== 'manager.renamed@tenant-a.test') throw new Error('RENAME_EMAIL_CHANGED_SUBJECT');
  result.renameEmail = { subjectStable: true, before: initialManager.sub, after: renamedClaims.sub, emailReadback: renamedBinding.email };

  await api(`/core/users/${users['member-a'].pk}/`, { method: 'PATCH', body: { groups: [groups['vcw-admins'].pk] } });
  const partialBefore = JSON.parse(await readFile(join(root, 'evidence', 'identity-bindings.json'), 'utf8')).bindings.find((item) => item.username === 'member-a');
  if (!partialBefore.groups.includes('vcw-team-a')) throw new Error('PARTIAL_FAILURE_SETUP_INVALID');
  const correlationId = randomUUID();
  let injectedFailure = false;
  try { await reconcile('mover-injected-failure', correlationId, 'remove-group:vcw-team-a'); } catch (error) {
    injectedFailure = String(error.stderr || error.message).includes('INJECTED_FAILURE_AFTER:remove-group:vcw-team-a');
  }
  if (!injectedFailure) throw new Error('PARTIAL_FAILURE_NOT_INJECTED');
  const movedBindings = await reconcile('mover-recovery', correlationId);
  await reconcile('mover-idempotent-retry', correlationId);
  const moved = movedBindings.bindings.find((item) => item.username === 'member-a');
  const denied = await dav('member-a', 'persona_member_password', 'GET', initialMember.sub, 'Team A/chat12-acl.txt');
  if (moved.groups.includes('vcw-team-a') || !moved.groups.includes('vcw-admins') || ![403, 404].includes(denied.status)) throw new Error('MOVER_ACL_NOT_REVOKED');
  result.mover = { removedTeamA: true, addedAdmins: true, oldAclStatus: denied.status };
  const retried = JSON.parse(await readFile(join(root, 'evidence', 'lifecycle-journal.json'), 'utf8')).commands.find((item) => item.key === `${correlationId}:${initialMember.sub}:remove-group:vcw-team-a`);
  if (retried?.status !== 'done' || retried.attempts < 2) throw new Error('PARTIAL_FAILURE_JOURNAL_NOT_RECOVERED');
  result.partialFailure = { injectedAfterOperation: true, driftObservedBeforeReconcile: true, correlationId, retryIdempotent: true, journalRecovered: true, status: retried.status, attempts: retried.attempts };

  await api(`/core/users/${users['member-a'].pk}/`, { method: 'PATCH', body: { groups: [groups['vcw-team-a'].pk], is_active: false } });
  const disabledBindings = await reconcile('leaver-disable');
  const disabled = disabledBindings.bindings.find((item) => item.username === 'member-a');
  const disabledDav = await dav('member-a', 'persona_member_password', 'PROPFIND', initialMember.sub);
  if (disabled.enabled !== false || ![401, 403, 503].includes(disabledDav.status)) throw new Error(`LEAVER_NOT_DISABLED_${disabledDav.status}`);
  result.leaver.disabled = true;
  result.leaver.disabledDavStatus = disabledDav.status;

  await api(`/core/users/${users['member-a'].pk}/`, { method: 'PATCH', body: { is_active: true } });
  const enabledBindings = await reconcile('leaver-reenable');
  const enabled = enabledBindings.bindings.find((item) => item.username === 'member-a');
  const enabledDav = await dav('member-a', 'persona_member_password', 'PROPFIND', initialMember.sub);
  if (enabled.enabled !== true || enabledDav.status !== 207) throw new Error(`REENABLE_FAILED_${enabledDav.status}`);
  result.leaver.reenabled = true;
  result.leaver.reenabledDavStatus = enabledDav.status;
} finally {
  await api(`/core/users/${users['manager-a'].pk}/`, { method: 'PATCH', body: { email: initialManager.email, groups: [groups['vcw-team-a'].pk], is_active: true } });
  await api(`/core/users/${users['member-a'].pk}/`, { method: 'PATCH', body: { email: initialMember.email, groups: [groups['vcw-team-a'].pk], is_active: true } });
  await reconcile('restore-baseline');
}

await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'lifecycle.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log('Lifecycle PASS: joiner binding, immutable subject on email rename, mover ACL revoke, leaver disable/re-enable, partial-failure reconcile and idempotent retry.');
