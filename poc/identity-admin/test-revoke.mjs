import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, secret } from './authentik-api.mjs';

const bindings = JSON.parse(await readFile(join(root, 'evidence', 'identity-bindings.json'), 'utf8')).bindings;
const manager = bindings.find((item) => item.username === 'manager-a');
const userPassword = await secret('persona_manager_password');
const base = 'http://nextcloud.localtest.me:18120';
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function request(url, options = {}) {
  return fetch(`${base}${url}`, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
}
const appPasswordResponse = await request('/ocs/v2.php/core/getapppassword?format=json', {
  method: 'GET', headers: { Authorization: basic(manager.subject, userPassword), 'OCS-APIRequest': 'true' },
});
const appPasswordText = await appPasswordResponse.text();
if (!appPasswordText) throw new Error(`APP_PASSWORD_EMPTY_${appPasswordResponse.status}_${appPasswordResponse.headers.get('location') ?? 'no-location'}`);
const appPasswordPayload = JSON.parse(appPasswordText);
const appPassword = appPasswordPayload?.ocs?.data?.apppassword;
if (!appPassword) throw new Error(`APP_PASSWORD_CREATE_${appPasswordPayload?.ocs?.meta?.statuscode}`);
const beforeRevoke = await request(`/remote.php/dav/files/${encodeURIComponent(manager.subject)}/Team%20A/`, {
  method: 'PROPFIND', headers: { Authorization: basic(manager.subject, appPassword), Depth: '0' },
});
if (beforeRevoke.status !== 207) throw new Error(`APP_PASSWORD_BEFORE_${beforeRevoke.status}`);
const revokeResponse = await request('/ocs/v2.php/core/apppassword?format=json', {
  method: 'DELETE', headers: { Authorization: basic(manager.subject, appPassword), 'OCS-APIRequest': 'true' },
});
if (![200, 204].includes(revokeResponse.status)) throw new Error(`APP_PASSWORD_REVOKE_${revokeResponse.status}`);
const afterRevoke = await request(`/remote.php/dav/files/${encodeURIComponent(manager.subject)}/Team%20A/`, {
  method: 'PROPFIND', headers: { Authorization: basic(manager.subject, appPassword), Depth: '0' },
});
if (afterRevoke.status !== 401) throw new Error(`APP_PASSWORD_STILL_VALID_${afterRevoke.status}`);

const evidence = {
  generatedAt: new Date().toISOString(), appPasswordBefore: beforeRevoke.status,
  appPasswordAfter: afterRevoke.status, secretsIncluded: false,
  browserSessionEvidence: 'browser-oidc.json',
  distinction: { localLogout: 'portal cookie only', idpLogout: 'provider application logout; Authentik SSO can survive', globalRevoke: 'portal sessions + Authentik SSO sessions + identity + Nextcloud account' },
};
await writeFile(join(root, 'evidence', 'revoke.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Revoke PASS: app password ${beforeRevoke.status}->${afterRevoke.status}; browser/global session evidence is recorded separately.`);
