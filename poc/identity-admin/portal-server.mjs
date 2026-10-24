import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authorizationUrl, consumeTransaction, createAuthorizationTransaction, discover, validateIdToken } from './oidc-client.mjs';
import { root } from './authentik-api.mjs';

const host = '127.0.0.1';
const port = 18122;
const clientId = 'vcworkspace-portal-test';
const redirectUri = 'http://portal.localtest.me:18122/callback';
const discoveryUri = 'http://authentik.localtest.me:18121/application/o/vcworkspace-portal-test/.well-known/openid-configuration';
const clientSecret = (await readFile(join(root, 'secrets', 'oidc_portal_client_secret'), 'utf8')).trim();
const controlToken = (await readFile(join(root, 'secrets', 'portal_control_token'), 'utf8')).trim();
const transactions = new Map();
const sessions = new Map();

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').filter(Boolean).map((part) => part.trim().split('=').map(decodeURIComponent)));
}
function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}
function cookie(name, value, maxAge = 900) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/health') return send(response, 200, { ok: true });
    if (url.pathname === '/logged-out') return send(response, 200, { logout: 'idp', globalRevocation: false });
    if (url.pathname === '/login') {
      const discovery = await discover(discoveryUri);
      const transaction = createAuthorizationTransaction();
      const handle = randomBytes(24).toString('base64url');
      transactions.set(handle, transaction);
      response.writeHead(302, { Location: authorizationUrl({ endpoint: discovery.authorization_endpoint, clientId, redirectUri, transaction }), 'Set-Cookie': cookie('vcw_oidc_tx', handle, 180) });
      return response.end();
    }
    if (url.pathname === '/callback') {
      const handle = cookies(request).vcw_oidc_tx;
      const transaction = consumeTransaction(transactions.get(handle), url.searchParams.get('state'));
      if (url.searchParams.get('error')) throw new Error('OIDC_AUTHORIZATION_DENIED');
      const discovery = await discover(discoveryUri);
      const form = new URLSearchParams({
        grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', redirect_uri: redirectUri,
        client_id: clientId, client_secret: clientSecret, code_verifier: transaction.verifier,
      });
      const tokenResponse = await fetch(discovery.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(3000) });
      if (!tokenResponse.ok) throw new Error('OIDC_CODE_EXCHANGE_FAILED');
      const tokens = await tokenResponse.json();
      const jwksResponse = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(3000) });
      if (!jwksResponse.ok) throw new Error('OIDC_JWKS_UNAVAILABLE');
      const claims = await validateIdToken({ token: tokens.id_token, jwks: await jwksResponse.json(), issuer: discovery.issuer, audience: clientId, nonce: transaction.nonce });
      transactions.delete(handle);
      const oldSession = cookies(request).vcw_sid;
      if (oldSession) sessions.delete(oldSession);
      const sessionId = randomBytes(32).toString('base64url');
      sessions.set(sessionId, { sub: claims.sub, email: claims.email, groups: claims.groups ?? [], idToken: tokens.id_token, createdAt: Date.now() });
      response.writeHead(302, { Location: '/', 'Set-Cookie': [cookie('vcw_sid', sessionId), cookie('vcw_oidc_tx', '', 0)] });
      return response.end();
    }
    if (url.pathname === '/logout' && request.method === 'POST') {
      const sessionId = cookies(request).vcw_sid;
      sessions.delete(sessionId);
      return send(response, 200, { logout: 'local', globalRevocation: false }, { 'Set-Cookie': cookie('vcw_sid', '', 0) });
    }
    if (url.pathname === '/logout/idp') {
      const sessionId = cookies(request).vcw_sid;
      const currentSession = sessions.get(sessionId);
      sessions.delete(sessionId);
      const discovery = await discover(discoveryUri);
      const endpoint = new URL(discovery.end_session_endpoint);
      if (currentSession?.idToken) endpoint.searchParams.set('id_token_hint', currentSession.idToken);
      endpoint.searchParams.set('post_logout_redirect_uri', 'http://portal.localtest.me:18122/logged-out');
      response.writeHead(302, { Location: endpoint.toString(), 'Set-Cookie': cookie('vcw_sid', '', 0) });
      return response.end();
    }
    if (url.pathname === '/admin/revoke' && request.method === 'POST') {
      if (request.headers.authorization !== `Bearer ${controlToken}`) return send(response, 403, { code: 'FORBIDDEN' });
      const { subject } = await jsonBody(request);
      let revokedSessions = 0;
      for (const [sessionId, session] of sessions) {
        if (session.sub === subject) { sessions.delete(sessionId); revokedSessions += 1; }
      }
      return send(response, 200, { globalRevocation: true, subject, revokedSessions });
    }
    const session = sessions.get(cookies(request).vcw_sid);
    if (!session) return send(response, 401, { code: 'UNAUTHENTICATED' });
    if (url.pathname === '/' || url.pathname === '/me') return send(response, 200, { subject: session.sub, email: session.email, groups: session.groups });
    return send(response, 404, { code: 'NOT_FOUND' });
  } catch (error) {
    const code = String(error.message || 'OIDC_FAILED');
    return send(response, 401, { code });
  }
});

server.listen(port, host, () => console.log(`Portal OIDC test adapter listening on http://${host}:${port}; secrets are not logged.`));
