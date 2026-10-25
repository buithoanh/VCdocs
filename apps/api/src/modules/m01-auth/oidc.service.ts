import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';

const b64url = (value: Buffer) => value.toString('base64url');

@Injectable()
export class OidcService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  transaction() {
    const verifier = b64url(randomBytes(48));
    return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
  }

  private async getJson(url: string): Promise<any> {
    let response: Response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(3_000) }); }
    catch { throw new Error('OIDC_PROVIDER_UNAVAILABLE'); }
    if (!response.ok) throw new Error('OIDC_PROVIDER_UNAVAILABLE');
    return response.json() as Promise<any>;
  }

  async discovery() {
    const issuer = this.cfg.oidc.issuer!;
    const doc = await this.getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    if (doc.issuer !== issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) throw new Error('OIDC_DISCOVERY_INVALID');
    const origin = new URL(issuer).origin;
    if ([doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri].some((endpoint) => new URL(String(endpoint)).origin !== origin)) {
      throw new Error('OIDC_ENDPOINT_ORIGIN_INVALID');
    }
    return doc;
  }

  authorizationUrl(doc: any, p: { state: string; nonce: string; challenge: string; redirectUri: string }) {
    const url = new URL(doc.authorization_endpoint);
    const values = { response_type: 'code', client_id: this.cfg.oidc.clientId!, redirect_uri: p.redirectUri, scope: 'openid email profile groups', state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: 'S256' };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    return url.toString();
  }

  async exchange(doc: any, p: { code: string; verifier: string; nonce: string; redirectUri: string }) {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: this.cfg.oidc.clientId!, client_secret: this.cfg.oidc.clientSecret!, code_verifier: p.verifier });
    let response: Response;
    try { response = await fetch(doc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(3_000) }); }
    catch { throw new Error('OIDC_CODE_EXCHANGE_FAILED'); }
    if (!response.ok) throw new Error('OIDC_CODE_EXCHANGE_FAILED');
    const tokens = await response.json() as any;
    const jwks = await this.getJson(doc.jwks_uri);
    return this.validateIdToken(tokens.id_token, jwks, p.nonce);
  }

  validateIdToken(token: string, jwks: any, nonce: string, now = Date.now()) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('OIDC_TOKEN_MALFORMED');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256' || !header.kid) throw new Error('OIDC_ALG_DENIED');
    const jwk = jwks.keys?.find((key: any) => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
    if (!jwk) throw new Error('OIDC_SIGNING_KEY_NOT_FOUND');
    if (!verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('OIDC_SIGNATURE_INVALID');
    if (claims.iss !== this.cfg.oidc.issuer) throw new Error('OIDC_ISSUER_INVALID');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.cfg.oidc.clientId)) throw new Error('OIDC_AUDIENCE_INVALID');
    if (audiences.length > 1 && claims.azp !== this.cfg.oidc.clientId) throw new Error('OIDC_AUTHORIZED_PARTY_INVALID');
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) throw new Error('OIDC_TOKEN_EXPIRED');
    if (!Number.isFinite(claims.iat) || claims.iat * 1000 > now + 30_000) throw new Error('OIDC_IAT_INVALID');
    const left = Buffer.from(String(claims.nonce || '')); const right = Buffer.from(nonce);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('OIDC_NONCE_INVALID');
    if (!claims.sub || !claims.email) throw new Error('OIDC_IDENTITY_INVALID');
    return claims as { iss: string; sub: string; email: string; email_verified?: boolean; name?: string; groups?: string[] };
  }

  roles(groups: unknown): string[] {
    if (!Array.isArray(groups)) return [];
    return [...new Set(groups.flatMap((group) => this.cfg.oidc.groupRoleMap[String(group)] || []))].sort();
  }
}
