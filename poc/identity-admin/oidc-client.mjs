import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');
const sha256 = (value) => createHash('sha256').update(value).digest();

export function createAuthorizationTransaction() {
  const verifier = b64url(randomBytes(48));
  return {
    state: b64url(randomBytes(32)),
    nonce: b64url(randomBytes(32)),
    verifier,
    challenge: b64url(sha256(verifier)),
    createdAt: Date.now(),
    consumed: false,
  };
}

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('OIDC_TOKEN_MALFORMED');
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url')),
    claims: JSON.parse(Buffer.from(parts[1], 'base64url')),
    signed: Buffer.from(`${parts[0]}.${parts[1]}`),
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

export async function validateIdToken({ token, jwks, issuer, audience, nonce, now = Date.now() }) {
  const parsed = parseJwt(token);
  if (parsed.header.alg !== 'RS256' || !parsed.header.kid) throw new Error('OIDC_ALG_DENIED');
  const jwk = jwks.keys?.find((key) => key.kid === parsed.header.kid && key.kty === 'RSA' && key.use === 'sig');
  if (!jwk) throw new Error('OIDC_SIGNING_KEY_NOT_FOUND');
  const valid = verifySignature('RSA-SHA256', parsed.signed, createPublicKey({ key: jwk, format: 'jwk' }), parsed.signature);
  if (!valid) throw new Error('OIDC_SIGNATURE_INVALID');
  if (parsed.claims.iss !== issuer) throw new Error('OIDC_ISSUER_INVALID');
  const audiences = Array.isArray(parsed.claims.aud) ? parsed.claims.aud : [parsed.claims.aud];
  if (!audiences.includes(audience)) throw new Error('OIDC_AUDIENCE_INVALID');
  if (audiences.length > 1 && parsed.claims.azp !== audience) throw new Error('OIDC_AUTHORIZED_PARTY_INVALID');
  if (!Number.isFinite(parsed.claims.exp) || parsed.claims.exp * 1000 <= now) throw new Error('OIDC_TOKEN_EXPIRED');
  if (!Number.isFinite(parsed.claims.iat) || parsed.claims.iat * 1000 > now + 30_000) throw new Error('OIDC_IAT_INVALID');
  if (parsed.claims.nonce !== nonce) throw new Error('OIDC_NONCE_INVALID');
  if (!parsed.claims.sub) throw new Error('OIDC_SUBJECT_MISSING');
  return parsed.claims;
}

export function consumeTransaction(transaction, suppliedState, maxAgeMs = 120_000) {
  if (!transaction || transaction.consumed) throw new Error('OIDC_STATE_REPLAY');
  if (Date.now() - transaction.createdAt > maxAgeMs) throw new Error('OIDC_STATE_EXPIRED');
  const left = Buffer.from(transaction.state);
  const right = Buffer.from(suppliedState ?? '');
  if (left.length !== right.length || !left.equals(right)) throw new Error('OIDC_STATE_INVALID');
  transaction.consumed = true;
  return transaction;
}

export function authorizationUrl({ endpoint, clientId, redirectUri, transaction }) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'openid email profile offline_access', state: transaction.state,
    nonce: transaction.nonce, code_challenge: transaction.challenge, code_challenge_method: 'S256',
  })) url.searchParams.set(key, value);
  return url.toString();
}

export async function discover(discoveryUri, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(discoveryUri, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error('OIDC_DISCOVERY_UNAVAILABLE');
  }
  if (!response.ok) throw new Error('OIDC_DISCOVERY_UNAVAILABLE');
  const document = await response.json();
  if (!document.issuer || !document.authorization_endpoint || !document.token_endpoint || !document.jwks_uri) throw new Error('OIDC_DISCOVERY_INVALID');
  return document;
}
