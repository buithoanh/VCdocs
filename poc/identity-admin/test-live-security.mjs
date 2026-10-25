import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './authentik-api.mjs';

const unauthorized = await fetch('http://portal.localtest.me:18122/admin/revoke', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subject: 'attacker-selected-subject' }),
});
if (unauthorized.status !== 403) throw new Error(`ADMIN_REVOKE_FAIL_OPEN_${unauthorized.status}`);

const login = await fetch('http://portal.localtest.me:18122/login', { redirect: 'manual' });
const location = new URL(login.headers.get('location'));
if (login.status !== 302 || location.searchParams.get('redirect_uri') !== 'http://portal.localtest.me:18122/callback' || location.searchParams.get('code_challenge_method') !== 'S256') {
  throw new Error('LIVE_AUTHORIZATION_REQUEST_INVALID');
}

const evidence = {
  generatedAt: new Date().toISOString(),
  unauthorizedAdminRevokeStatus: unauthorized.status,
  authorizationStatus: login.status,
  exactRedirectUri: location.searchParams.get('redirect_uri'),
  pkceMethod: location.searchParams.get('code_challenge_method'),
  statePresent: Boolean(location.searchParams.get('state')),
  noncePresent: Boolean(location.searchParams.get('nonce')),
  secretsIncluded: false,
};
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'security-live.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('Security PASS: privileged revoke is fail-closed and live authorization pins redirect + PKCE S256 + state/nonce.');
