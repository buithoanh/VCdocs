import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { api, results, root, secret } from './authentik-api.mjs';
import { connectCdp } from './cdp-client.mjs';

const execFileAsync = promisify(execFile);
const nextcloudContainer = 'vcworkspace-identity12-nextcloud-1';
const nextcloudBase = 'http://nextcloud.localtest.me:18120';
const portalBase = 'http://portal.localtest.me:18122';
const ncAdminPassword = await secret('nc_admin_password');
const bindings = JSON.parse(await readFile(join(root, 'evidence', 'identity-bindings.json'), 'utf8')).bindings;
const personas = [
  { username: 'manager-a', passwordSecret: 'persona_manager_password', expectedFileStatus: 200 },
  { username: 'member-a', passwordSecret: 'persona_member_password', expectedFileStatus: 200 },
  { username: 'outsider-b', passwordSecret: 'persona_outsider_password', expectedFileStatus: 404 },
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function waitFor(cdp, predicate, label, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await cdp.evaluate(predicate);
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`BROWSER_TIMEOUT:${label}`);
}

const deepAction = (name, value) => `(() => {
  const all = [];
  const walk = (root) => { for (const element of root.querySelectorAll('*')) { all.push(element); if (element.shadowRoot) walk(element.shadowRoot); } };
  walk(document);
  const input = all.find((element) => element.matches?.('input[name="${name}"]') && element.offsetParent !== null);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  const button = all.find((element) => element.matches?.('button[type="submit"]') && element.offsetParent !== null);
  if (!button) return false;
  button.click();
  return true;
})()`;

async function clearBrowser(cdp) {
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Storage.clearDataForOrigin', { origin: portalBase, storageTypes: 'all' });
  await cdp.send('Storage.clearDataForOrigin', { origin: nextcloudBase, storageTypes: 'all' });
  await cdp.send('Storage.clearDataForOrigin', { origin: 'http://authentik.localtest.me:18121', storageTypes: 'all' });
}

async function loginPortal(cdp, username, password) {
  await cdp.send('Page.navigate', { url: `${portalBase}/login` });
  await waitFor(cdp, `(() => { const all=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){all.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document);return all.some(e=>e.matches?.('input[name="uidField"]') && e.offsetParent !== null) })()`, `${username}-identifier`);
  if (!await cdp.evaluate(deepAction('uidField', username))) throw new Error(`IDENTIFIER_NOT_FILLED:${username}`);
  await waitFor(cdp, `(() => { const all=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){all.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document);return all.some(e=>e.matches?.('input[name="password"]') && e.offsetParent !== null) })()`, `${username}-password`);
  if (!await cdp.evaluate(deepAction('password', password))) throw new Error(`PASSWORD_NOT_FILLED:${username}`);
  await waitFor(cdp, `location.hostname === 'portal.localtest.me' && location.pathname === '/'`, `${username}-portal-callback`);
  return JSON.parse(await cdp.evaluate('document.body.innerText'));
}

async function openNextcloudViaExistingSso(cdp, username) {
  const requestedUrls = [];
  const unsubscribe = cdp.subscribe('Network.requestWillBeSent', ({ request }) => requestedUrls.push(request.url));
  await cdp.send('Page.navigate', { url: `${nextcloudBase}/apps/user_oidc/login/1` });
  await waitFor(cdp, `location.hostname === 'nextcloud.localtest.me' && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/apps/user_oidc/login')`, `${username}-nextcloud-callback`, 30000);
  const current = await cdp.evaluate(`fetch('/ocs/v2.php/cloud/user?format=json', {headers:{'OCS-APIRequest':'true'}, signal:AbortSignal.timeout(10000)}).then(async r => ({status:r.status, body:await r.json()}))`);
  const id = current?.body?.ocs?.data?.id;
  const file = await cdp.evaluate(`fetch('/remote.php/dav/files/${encodeURIComponent(id)}/Team%20A/chat12-acl.txt?proof=' + Date.now(), {credentials:'same-origin', cache:'no-store', headers:{requesttoken:(window.OC?.requestToken || document.head.dataset.requesttoken || ''), 'Cache-Control':'no-cache'}, signal:AbortSignal.timeout(10000)}).then(async r => ({status:r.status, body:await r.text()}))`);
  unsubscribe();
  return {
    finalUrl: await cdp.evaluate('location.href'),
    currentStatus: current.status,
    id,
    email: current?.body?.ocs?.data?.email,
    groups: current?.body?.ocs?.data?.groups ?? [],
    fileStatus: file.status,
    fileBody: file.status === 200 ? file.body : null,
    credentialReentryPerformed: false,
    authentikFlowSeen: requestedUrls.some((url) => url.includes('/if/flow/default-authentication-flow/')),
    authentikAuthorizeSeen: requestedUrls.some((url) => url.includes('/application/o/authorize/')),
    callbackSeen: requestedUrls.some((url) => url.includes('/apps/user_oidc/code')),
  };
}

async function loginBoth(cdp, persona) {
  console.log(`Browser proof: ${persona.username} portal login`);
  await clearBrowser(cdp);
  const password = (await readFile(join(root, 'secrets', persona.passwordSecret), 'utf8')).trim();
  const portal = await loginPortal(cdp, persona.username, password);
  console.log(`Browser proof: ${persona.username} Nextcloud SSO`);
  const nextcloud = await openNextcloudViaExistingSso(cdp, persona.username);
  const binding = bindings.find((item) => item.username === persona.username);
  if (!binding || portal.subject !== binding.subject || nextcloud.id !== binding.subject) throw new Error(`IMMUTABLE_SUB_MISMATCH:${persona.username}`);
  if (nextcloud.currentStatus !== 200 || nextcloud.fileStatus !== persona.expectedFileStatus) throw new Error(`NEXTCLOUD_SESSION_ACL_INVALID:${persona.username}:${nextcloud.currentStatus}:${nextcloud.fileStatus}:${JSON.stringify(nextcloud.groups)}`);
  if (nextcloud.authentikFlowSeen || !nextcloud.authentikAuthorizeSeen || !nextcloud.callbackSeen) throw new Error(`NEXTCLOUD_SSO_REENTRY_OR_CALLBACK_INVALID:${persona.username}`);
  return { username: persona.username, portal, nextcloud };
}

async function ncUserEnabled(subject, enabled) {
  const response = await fetch(`${nextcloudBase}/ocs/v1.php/cloud/users/${encodeURIComponent(subject)}/${enabled ? 'enable' : 'disable'}?format=json`, {
    method: 'PUT', headers: { Authorization: basic('admin12', ncAdminPassword), 'OCS-APIRequest': 'true' },
  });
  const payload = await response.json();
  if (!response.ok || ![100, 200].includes(payload?.ocs?.meta?.statuscode)) throw new Error(`NEXTCLOUD_${enabled ? 'ENABLE' : 'DISABLE'}_${response.status}_${payload?.ocs?.meta?.statuscode}`);
}

async function authTokens(subject) {
  const { stdout } = await execFileAsync('docker', ['exec', '-u', 'www-data', nextcloudContainer, 'php', 'occ', '--no-ansi', '--no-interaction', 'user:auth-tokens:list', '--output=json', subject]);
  return JSON.parse(stdout);
}

async function deleteAuthToken(subject, tokenId) {
  await execFileAsync('docker', ['exec', '-u', 'www-data', nextcloudContainer, 'php', 'occ', '--no-ansi', '--no-interaction', 'user:auth-tokens:delete', subject, `${tokenId}`]);
}

const cdp = await connectCdp('about:blank');
await cdp.send('Network.enable');
const evidence = { generatedAt: new Date().toISOString(), browser: 'Google Chrome headless', portalRole: 'standalone OIDC test harness; not apps/web or apps/api', personas: [], mover: null, renameEmail: null, nextcloudCurrentSessionRevoke: null, secretsIncluded: false };
let managerUser;
let managerOriginalEmail;
let memberUser;
let teamAGroup;
try {
  for (const persona of personas) evidence.personas.push(await loginBoth(cdp, persona));

  const authentikGroups = results(await api('/core/groups/?page_size=100'));
  teamAGroup = authentikGroups.find((item) => item.name === 'vcw-team-a');
  const outsidersGroup = authentikGroups.find((item) => item.name === 'vcw-outsiders-b');
  memberUser = results(await api('/core/users/?page_size=100')).find((item) => item.username === 'member-a');
  if (!teamAGroup || !outsidersGroup || !memberUser) throw new Error('MOVER_IDENTITIES_MISSING');
  await api(`/core/users/${memberUser.pk}/`, { method: 'PATCH', body: { groups: [outsidersGroup.pk] } });
  const moved = await loginBoth(cdp, { ...personas[1], expectedFileStatus: 404 });
  if (moved.portal.groups.includes('vcw-team-a') || !moved.portal.groups.includes('vcw-outsiders-b')) throw new Error('MOVER_UPSTREAM_CLAIMS_INVALID');
  await api(`/core/users/${memberUser.pk}/`, { method: 'PATCH', body: { groups: [teamAGroup.pk] } });
  const moverRestored = await loginBoth(cdp, personas[1]);
  evidence.mover = { subject: moved.portal.subject, upstreamGroupAfterMove: moved.portal.groups, nextcloudGroupsAfterMove: moved.nextcloud.groups, oldTeamAFileAfterRelogin: moved.nextcloud.fileStatus, restoredTeamAFileAfterRelogin: moverRestored.nextcloud.fileStatus };

  const managerBinding = bindings.find((item) => item.username === 'manager-a');
  managerUser = results(await api('/core/users/?page_size=100')).find((item) => item.username === 'manager-a');
  if (!managerUser || !managerBinding) throw new Error('MANAGER_MISSING');
  managerOriginalEmail = managerUser.email;
  const renamedEmail = 'manager.renamed@tenant-a.test';
  await api(`/core/users/${managerUser.pk}/`, { method: 'PATCH', body: { email: renamedEmail } });
  const renamed = await loginBoth(cdp, personas[0]);
  if (renamed.portal.subject !== managerBinding.subject || renamed.nextcloud.id !== managerBinding.subject || renamed.portal.email !== renamedEmail || renamed.nextcloud.email !== renamedEmail) throw new Error('RENAME_EMAIL_SUB_OR_SYNC_INVALID');
  evidence.renameEmail = { before: managerOriginalEmail, after: renamedEmail, portalSubjectUnchanged: true, nextcloudIdUnchanged: true, nextcloudEmailReadback: renamed.nextcloud.email };

  await api(`/core/users/${managerUser.pk}/`, { method: 'PATCH', body: { email: managerOriginalEmail } });
  const active = await loginBoth(cdp, personas[0]);
  const beforeTokens = await authTokens(managerBinding.subject);
  const authenticatedSessions = results(await api('/core/authenticated_sessions/?page_size=100')).filter((item) => item.user === managerUser.pk);
  for (const session of authenticatedSessions) await api(`/core/authenticated_sessions/${session.uuid}/`, { method: 'DELETE' });
  await api(`/core/users/${managerUser.pk}/`, { method: 'PATCH', body: { is_active: false } });
  await ncUserEnabled(managerBinding.subject, false);
  for (const token of beforeTokens) await deleteAuthToken(managerBinding.subject, token.id);
  const after = await cdp.evaluate(`fetch('/ocs/v2.php/cloud/user?format=json', {headers:{'OCS-APIRequest':'true'}}).then(async r => ({status:r.status, redirected:r.redirected, url:r.url, text:await r.text()}))`);
  const afterTokens = await authTokens(managerBinding.subject);
  if (after.status === 200 || afterTokens.length !== 0) throw new Error(`NEXTCLOUD_BROWSER_SESSION_NOT_REVOKED:${after.status}:${afterTokens.length}`);
  evidence.nextcloudCurrentSessionRevoke = { subject: managerBinding.subject, beforeStatus: active.nextcloud.currentStatus, browserTokensBefore: beforeTokens.map((token) => token.id), browserTokensAfter: afterTokens.map((token) => token.id), afterStatus: after.status, afterUrl: after.url, identityDisabled: true, nextcloudDisabled: true, idpSessionsDeleted: authenticatedSessions.length };
} finally {
  if (memberUser && teamAGroup) await api(`/core/users/${memberUser.pk}/`, { method: 'PATCH', body: { groups: [teamAGroup.pk] } });
  if (managerUser) {
    await api(`/core/users/${managerUser.pk}/`, { method: 'PATCH', body: { is_active: true, email: managerOriginalEmail } });
    const managerBinding = bindings.find((item) => item.username === 'manager-a');
    if (managerBinding) await ncUserEnabled(managerBinding.subject, true);
  }
}

const restored = await loginBoth(cdp, personas[0]);
evidence.baselineRestored = restored.portal.email === managerOriginalEmail && restored.nextcloud.email === managerOriginalEmail;
const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'browser-nextcloud-sso.png'), Buffer.from(screenshot.data, 'base64'));
await writeFile(join(root, 'evidence', 'browser-nextcloud-sso.json'), `${JSON.stringify(evidence, null, 2)}\n`);
cdp.socket.close();
console.log('Browser Nextcloud SSO PASS: portal-to-Nextcloud SSO without credential re-entry, immutable sub/email rename, session ACL and current-session revoke.');
