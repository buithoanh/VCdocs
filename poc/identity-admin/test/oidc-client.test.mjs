import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { authorizationUrl, consumeTransaction, createAuthorizationTransaction, discover, validateIdToken } from '../oidc-client.mjs';

function token(privateKey, jwk, claims, header = { alg: 'RS256', kid: 'test-key' }) {
  const encoded = [header, claims].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'));
  return `${encoded.join('.')}.${sign('RSA-SHA256', Buffer.from(encoded.join('.')), privateKey).toString('base64url')}`;
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const now = Date.now();
const baseClaims = { iss: 'http://issuer.test/', aud: 'portal', sub: 'immutable-1', nonce: 'nonce-1', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 60 };

test('validates RS256 issuer audience expiry and nonce', async () => {
  const claims = await validateIdToken({ token: token(privateKey, jwk, baseClaims), jwks: { keys: [jwk] }, issuer: baseClaims.iss, audience: 'portal', nonce: 'nonce-1', now });
  assert.equal(claims.sub, 'immutable-1');
});

for (const [name, claims, expected] of [
  ['issuer', { ...baseClaims, iss: 'http://evil.test/' }, 'OIDC_ISSUER_INVALID'],
  ['audience', { ...baseClaims, aud: 'other' }, 'OIDC_AUDIENCE_INVALID'],
  ['expiry', { ...baseClaims, exp: Math.floor(now / 1000) - 1 }, 'OIDC_TOKEN_EXPIRED'],
  ['nonce', { ...baseClaims, nonce: 'wrong' }, 'OIDC_NONCE_INVALID'],
]) test(`rejects invalid ${name}`, async () => {
  await assert.rejects(validateIdToken({ token: token(privateKey, jwk, claims), jwks: { keys: [jwk] }, issuer: baseClaims.iss, audience: 'portal', nonce: 'nonce-1', now }), new RegExp(expected));
});

test('rejects tampered signature', async () => {
  const value = token(privateKey, jwk, baseClaims);
  await assert.rejects(validateIdToken({ token: `${value.slice(0, -2)}aa`, jwks: { keys: [jwk] }, issuer: baseClaims.iss, audience: 'portal', nonce: 'nonce-1', now }), /OIDC_SIGNATURE_INVALID/);
});

test('requires matching azp for a multi-audience token', async () => {
  const claims = { ...baseClaims, aud: ['portal', 'other'], azp: 'other' };
  await assert.rejects(validateIdToken({ token: token(privateKey, jwk, claims), jwks: { keys: [jwk] }, issuer: baseClaims.iss, audience: 'portal', nonce: 'nonce-1', now }), /OIDC_AUTHORIZED_PARTY_INVALID/);
  const valid = { ...claims, azp: 'portal' };
  assert.equal((await validateIdToken({ token: token(privateKey, jwk, valid), jwks: { keys: [jwk] }, issuer: baseClaims.iss, audience: 'portal', nonce: 'nonce-1', now })).sub, 'immutable-1');
});

test('state is exact, expires and is one-time', () => {
  const transaction = createAuthorizationTransaction();
  assert.equal(consumeTransaction(transaction, transaction.state), transaction);
  assert.throws(() => consumeTransaction(transaction, transaction.state), /OIDC_STATE_REPLAY/);
  const wrong = createAuthorizationTransaction();
  assert.throws(() => consumeTransaction(wrong, 'wrong'), /OIDC_STATE_INVALID/);
  const expired = createAuthorizationTransaction();
  expired.createdAt = Date.now() - 121_000;
  assert.throws(() => consumeTransaction(expired, expired.state), /OIDC_STATE_EXPIRED/);
});

test('a concurrent callback race has exactly one winner', async () => {
  const transaction = createAuthorizationTransaction();
  const attempts = await Promise.allSettled([
    Promise.resolve().then(() => consumeTransaction(transaction, transaction.state)),
    Promise.resolve().then(() => consumeTransaction(transaction, transaction.state)),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.match(attempts.find((attempt) => attempt.status === 'rejected').reason.message, /OIDC_STATE_REPLAY/);
});

test('authorization request pins redirect URI and PKCE S256', () => {
  const transaction = createAuthorizationTransaction();
  const value = new URL(authorizationUrl({ endpoint: 'http://issuer.test/authorize', clientId: 'portal', redirectUri: 'http://portal.test/callback', transaction }));
  assert.equal(value.searchParams.get('redirect_uri'), 'http://portal.test/callback');
  assert.equal(value.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(value.searchParams.get('state'));
  assert.ok(value.searchParams.get('nonce'));
});

test('discovery outage and malformed metadata fail closed', async () => {
  await assert.rejects(discover('http://issuer.test', async () => { throw new Error('offline'); }), /OIDC_DISCOVERY_UNAVAILABLE/);
  await assert.rejects(discover('http://issuer.test', async () => ({ ok: true, json: async () => ({ issuer: 'http://issuer.test/' }) })), /OIDC_DISCOVERY_INVALID/);
});
