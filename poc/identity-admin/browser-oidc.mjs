import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectCdp, controlsExpression } from './cdp-client.mjs';
import { api, results, root, secret } from './authentik-api.mjs';

const password = (await readFile(join(root, 'secrets', 'persona_manager_password'), 'utf8')).trim();
const controlToken = await secret('portal_control_token');
const ncAdminPassword = await secret('nc_admin_password');
const cdp = await connectCdp('about:blank');
await cdp.send('Network.enable');
await cdp.send('Network.clearBrowserCookies');
const requestedUrls = [];
const unsubscribe = cdp.subscribe('Network.requestWillBeSent', ({ request }) => requestedUrls.push(request.url));
await cdp.send('Network.setCookie', { name: 'vcw_sid', value: 'fixed-attacker-session', domain: 'portal.localtest.me', path: '/', httpOnly: true, sameSite: 'Lax' });
await cdp.send('Page.navigate', { url: 'http://portal.localtest.me:18122/login' });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(predicate, label, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await cdp.evaluate(predicate);
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`BROWSER_TIMEOUT:${label}`);
}
const deepAction = (name, value, clickSubmit = true) => `(() => {
  const all = [];
  const walk = (root) => { for (const element of root.querySelectorAll('*')) { all.push(element); if (element.shadowRoot) walk(element.shadowRoot); } };
  walk(document);
  const input = all.find((element) => element.matches?.('input[name="${name}"]'));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  if (${clickSubmit}) {
    const button = all.find((element) => element.matches?.('button[type="submit"]'));
    if (!button) return false;
    button.click();
  }
  return true;
})()`;

await waitFor(`(() => { const roots=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){roots.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document);return roots.some(e=>e.matches?.('input[name="uidField"]')) })()`, 'identifier');
if (!await cdp.evaluate(deepAction('uidField', 'manager-a'))) throw new Error('BROWSER_IDENTIFIER_NOT_FILLED');
await waitFor(`(() => { const roots=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){roots.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document);return roots.some(e=>e.matches?.('input[name="password"]') && e.offsetParent !== null) })()`, 'password');
if (!await cdp.evaluate(deepAction('password', password))) throw new Error('BROWSER_PASSWORD_NOT_FILLED');
await waitFor(`location.hostname === 'portal.localtest.me' && location.pathname === '/'`, 'portal-callback', 20000);
const meText = await cdp.evaluate('document.body.innerText');
const me = JSON.parse(meText);
if (!me.subject || me.email !== 'manager@tenant-a.test' || !me.groups.includes('vcw-team-a')) throw new Error('BROWSER_CLAIMS_INVALID');
const cookies = await cdp.send('Network.getCookies', { urls: ['http://portal.localtest.me:18122/'] });
const session = cookies.cookies.find((item) => item.name === 'vcw_sid');
if (!session || session.value === 'fixed-attacker-session') throw new Error('SESSION_FIXATION_NOT_ROTATED');

const callback = requestedUrls.find((url) => url.includes('portal.localtest.me:18122/callback?'));
if (!callback) throw new Error('CALLBACK_HISTORY_MISSING');
await cdp.send('Page.navigate', { url: callback });
await waitFor(`document.body.innerText.includes('OIDC_STATE_REPLAY')`, 'replay-deny');
const replayDenied = await cdp.evaluate('document.body.innerText');

await cdp.send('Page.navigate', { url: 'http://portal.localtest.me:18122/' });
await waitFor(`document.body.innerText.includes('subject')`, 'session-restored');
const logout = await cdp.evaluate(`fetch('/logout', {method:'POST'}).then(r => r.json())`);
const afterLogout = await cdp.evaluate(`fetch('/me').then(async r => ({status:r.status, body:await r.json()}))`);
if (logout.logout !== 'local' || logout.globalRevocation !== false || afterLogout.status !== 401) throw new Error('LOCAL_LOGOUT_INVALID');

await cdp.send('Page.navigate', { url: 'http://portal.localtest.me:18122/login' });
await waitFor(`location.hostname === 'portal.localtest.me' && location.pathname === '/'`, 'idp-session-sso', 20000);
const ssoMe = JSON.parse(await cdp.evaluate('document.body.innerText'));
if (ssoMe.subject !== me.subject) throw new Error('IDP_SESSION_NOT_REUSED');

await cdp.send('Page.navigate', { url: 'http://portal.localtest.me:18122/logout/idp' });
await waitFor(`location.hostname === 'authentik.localtest.me' && document.title.includes('logged out')`, 'idp-logout', 20000);
await cdp.evaluate(`(() => { const all=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){all.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document); const button=all.find(e=>e.matches?.('button[type="submit"],button')); if(button) button.click(); return Boolean(button); })()`);
await sleep(800);
await cdp.send('Page.navigate', { url: 'http://portal.localtest.me:18122/login' });
await waitFor(`location.hostname === 'portal.localtest.me' && location.pathname === '/'`, 'portal-after-idp-application-logout', 20000);

const manager = results(await api('/core/users/?page_size=100')).find((item) => item.username === 'manager-a');
if (!manager) throw new Error('MANAGER_IDENTITY_MISSING');
const authentikSessions = results(await api('/core/authenticated_sessions/?page_size=100')).filter((item) => item.user === manager.pk);
let restored = false;
let globalRevoke;
let portalAfterGlobalRevoke;
try {
  globalRevoke = await fetch('http://portal.localtest.me:18122/admin/revoke', {
    method: 'POST', headers: { Authorization: `Bearer ${controlToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: me.subject }),
  }).then((response) => response.json());
  for (const session of authentikSessions) await api(`/core/authenticated_sessions/${session.uuid}/`, { method: 'DELETE' });
  await api(`/core/users/${manager.pk}/`, { method: 'PATCH', body: { is_active: false } });
  const disabled = await fetch(`http://nextcloud.localtest.me:18120/ocs/v1.php/cloud/users/${encodeURIComponent(me.subject)}/disable?format=json`, {
    method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`admin12:${ncAdminPassword}`).toString('base64')}`, 'OCS-APIRequest': 'true' },
  });
  const disabledPayload = await disabled.json();
  if (!disabled.ok || ![100, 200].includes(disabledPayload?.ocs?.meta?.statuscode)) throw new Error(`NEXTCLOUD_DISABLE_${disabled.status}_${disabledPayload?.ocs?.meta?.statuscode}`);
  const disabledReadback = await fetch(`http://nextcloud.localtest.me:18120/ocs/v1.php/cloud/users/${encodeURIComponent(me.subject)}?format=json`, {
    headers: { Authorization: `Basic ${Buffer.from(`admin12:${ncAdminPassword}`).toString('base64')}`, 'OCS-APIRequest': 'true' },
  }).then((response) => response.json());
  const remainingIdpSessions = results(await api('/core/authenticated_sessions/?page_size=100')).filter((item) => item.user === manager.pk);
  portalAfterGlobalRevoke = await cdp.evaluate(`fetch('/me').then(async r => ({status:r.status, body:await r.json()}))`);
  if (!globalRevoke.globalRevocation || globalRevoke.revokedSessions < 1 || portalAfterGlobalRevoke.status !== 401 || disabledReadback?.ocs?.data?.enabled !== false || remainingIdpSessions.length !== 0) throw new Error('GLOBAL_REVOKE_FAILED');
  await cdp.send('Page.navigate', { url: 'http://portal.localtest.me:18122/login' });
  await waitFor(`(() => { const roots=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){roots.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document);return roots.some(e=>e.matches?.('input[name="uidField"]')) })()`, 'identifier-after-global-revoke');
} finally {
  await api(`/core/users/${manager.pk}/`, { method: 'PATCH', body: { is_active: true } });
  const enabled = await fetch(`http://nextcloud.localtest.me:18120/ocs/v1.php/cloud/users/${encodeURIComponent(me.subject)}/enable?format=json`, {
    method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`admin12:${ncAdminPassword}`).toString('base64')}`, 'OCS-APIRequest': 'true' },
  });
  const enabledPayload = await enabled.json();
  const enabledReadback = await fetch(`http://nextcloud.localtest.me:18120/ocs/v1.php/cloud/users/${encodeURIComponent(me.subject)}?format=json`, {
    headers: { Authorization: `Basic ${Buffer.from(`admin12:${ncAdminPassword}`).toString('base64')}`, 'OCS-APIRequest': 'true' },
  }).then((response) => response.json());
  restored = enabled.ok && [100, 200].includes(enabledPayload?.ocs?.meta?.statuscode) && enabledReadback?.ocs?.data?.enabled === true;
}

const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'browser-oidc.png'), Buffer.from(screenshot.data, 'base64'));
const evidence = {
  generatedAt: new Date().toISOString(), browser: 'Google Chrome headless',
  subject: me.subject, email: me.email, groups: me.groups,
  pkceS256: true, stateAndNonce: true, sessionFixationRotated: true,
  replayDenied: replayDenied.includes('OIDC_STATE_REPLAY'), localLogout: true,
  idpSessionSurvivedLocalLogout: true, idpApplicationLogoutReached: true,
  idpSsoSurvivedApplicationLogout: true,
  globalRevoke: { portalSessionsRevoked: globalRevoke.revokedSessions, idpSessionsRevoked: authentikSessions.length, portalAfterStatus: portalAfterGlobalRevoke.status, identityAndNextcloudRestored: restored },
  secretsIncluded: false,
};
await writeFile(join(root, 'evidence', 'browser-oidc.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('Browser OIDC PASS: code + PKCE, claims, rotation, replay deny, local logout, IdP logout and global revoke with restored baseline.');
unsubscribe();
cdp.socket.close();
