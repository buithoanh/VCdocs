import { generateKeyPairSync, sign } from 'node:crypto';
import { loadConfig } from '../src/config/config';
import { createTestApp, TestApp } from './support/app';

// Audit 8/12 (`m01-auth/identity-lifecycle/fake-port-allowed-in-production`).
const issuer = 'https://id.vcworkspace.test/application/o/vcworkspace';
const clientId = 'vcworkspace-web-test';
const oidc = { issuer, clientId, clientSecret: 'test-only-secret', companyDomain: 'vcprosperous.com', groupRoleMap: { 'vcw-admin': ['R9'] } as Record<string, any>, projectionMaxAgeSeconds: 300 };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
Object.assign(publicJwk, { kid: 'test-key', use: 'sig', alg: 'RS256' });

function jwt(claims: Record<string, unknown>) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

describe('Audit 8/12: cấu hình production không chạy lifecycle giả', () => {
  const production = {
    NODE_ENV: 'production', GOOGLE_MODE: 'real', AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://id.example.com/application/o/vcworkspace',
    OIDC_CLIENT_ID: 'app', OIDC_CLIENT_SECRET: 'secret', OIDC_COMPANY_DOMAIN: 'example.com',
    PUBLIC_API_ORIGIN: 'https://api.example.com', WEB_ORIGIN: 'https://app.example.com', COOKIE_SECURE: 'true',
    WORKSPACE_STORAGE_MODE: 'nextcloud', MAIL_ENGINE_MODE: 'stalwart', DOCUMENT_EDITOR_ENABLED: 'true', DOCUMENT_EDITOR_JWT_SECRET: 'x'.repeat(40),
  };

  it('production OIDC không đặt IDENTITY_LIFECYCLE_MODE thì không rơi về cổng giả', () => {
    expect(loadConfig(production as any).identityLifecycle.mode).toBe('disabled');
  });

  it('production đặt tường minh IDENTITY_LIFECYCLE_MODE=fake bị chặn khi khởi động', () => {
    expect(() => loadConfig({ ...production, IDENTITY_LIFECYCLE_MODE: 'fake' } as any)).toThrow('IDENTITY_LIFECYCLE_MODE=fake');
    expect(() => loadConfig({ ...production, AUTH_MODE: 'google', IDENTITY_LIFECYCLE_MODE: 'fake' } as any)).toThrow('IDENTITY_LIFECYCLE_MODE=fake');
  });

  it('production Google hiện tại vẫn khởi động được, lifecycle tắt', () => {
    const { AUTH_MODE, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_COMPANY_DOMAIN, ...google } = production;
    expect(loadConfig(google as any).identityLifecycle.mode).toBe('disabled');
  });
});

describe('Audit 8/12: lifecycle không báo done khi không có cổng thật', () => {
  let t: TestApp;
  const subject = 'disabled-lifecycle-subject';
  beforeAll(async () => {
    t = await createTestApp({ authMode: 'oidc', oidc, identityLifecycle: { mode: 'disabled', timeoutMs: 5_000 } as any });
    await t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer, subject, userId: t.ids.users['nv.mkt'], email: t.ids.emails['nv.mkt'], groups: [], active: true, lastSeenAt: new Date() });
  });
  afterAll(async () => t?.close());

  it('POST trả 503, không tạo operation, không khoá hay đổi user ở app', async () => {
    const r9 = await t.login('it');
    const res = await r9.post('/identity/lifecycle-operations', { subject, email: 'renamed@vcprosperous.com', groups: ['vcw-admin'], active: false }, { idem: 'disabled-lifecycle-08' });
    expect(res.status).toBe(503);
    expect(await t.db.m.IdentityLifecycleOperation.countDocuments({ companyId: t.ids.companyId })).toBe(0);
    const binding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    expect(binding).toMatchObject({ active: true, email: t.ids.emails['nv.mkt'] });
    expect(binding.projectionPendingRevision).toBeUndefined();
    const user = await t.db.m.User.findOne({ _id: t.ids.users['nv.mkt'], companyId: t.ids.companyId }).lean<any>();
    expect(user).toMatchObject({ email: t.ids.emails['nv.mkt'], isSuspended: false });
  });
});

describe('Audit 8/12: đăng nhập OIDC không đè quyết định lifecycle còn hiệu lực', () => {
  let t: TestApp;
  let tokenClaims: Record<string, unknown>;
  const originalFetch = global.fetch;
  const subject = 'demoted-admin-subject';
  const email = 'demoted.admin@vcprosperous.com';

  beforeAll(async () => {
    t = await createTestApp({ authMode: 'oidc', oidc });
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return new Response(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize/`, token_endpoint: `${issuer}/token/`, jwks_uri: `${issuer}/jwks/`, end_session_endpoint: `${issuer}/end-session/` }), { status: 200 });
      if (url.endsWith('/token/')) return new Response(JSON.stringify({ id_token: jwt(tokenClaims) }), { status: 200 });
      if (url.endsWith('/jwks/')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    }) as any;
  });
  afterAll(async () => { global.fetch = originalFetch; await t.close(); });

  async function oidcLogin(claims: { email: string; groups: string[] }) {
    const agent = require('supertest').agent(t.app.getHttpServer());
    const start = await agent.get('/api/v1/auth/oidc?returnTo=/bo-nho');
    const location = new URL(start.headers.location);
    const now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: subject, aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email_verified: true, name: 'Demoted Admin', ...claims };
    return agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=${Math.random()}`);
  }
  async function user() {
    const binding = await t.db.m.OidcIdentity.findOne({ issuer, subject }, undefined, { skipTenant: true }).lean<any>();
    return t.db.m.User.findOne({ _id: binding.userId, companyId: t.ids.companyId }).lean<any>();
  }

  it('R9 bị hạ quyền không lấy lại R9 khi đăng nhập lại với nhóm IdP cũ', async () => {
    expect((await oidcLogin({ email, groups: ['vcw-admin'] })).headers.location).toBe('http://localhost:3000/bo-nho');
    expect((await user()).systemRoles).toEqual(['R9']);

    const r9 = await t.login('it');
    const demoted = await r9.post('/identity/lifecycle-operations', { subject, email, groups: [], active: true }, { idem: 'demote-admin-08' });
    expect(demoted.status).toBe(201);
    expect(demoted.body.status).toBe('done');
    expect((await user()).systemRoles).toEqual([]);

    const relogin = await oidcLogin({ email, groups: ['vcw-admin'] });
    expect((await user()).systemRoles).toEqual([]);
    expect(relogin.headers.location).toBe('http://localhost:3000/dang-nhap?loi=locked');
    expect(await t.db.m.AuditLog.exists({ companyId: t.ids.companyId, action: 'auth.oidc.projection_mismatch' })).toBeTruthy();

    // IdP đã hội tụ về projection: đăng nhập bình thường, giữ quyền đã hạ.
    expect((await oidcLogin({ email, groups: [] })).headers.location).toBe('http://localhost:3000/bo-nho');
    expect((await user()).systemRoles).toEqual([]);
  });

  it('email đổi qua lifecycle không bị email cũ trong token đè lại', async () => {
    const r9 = await t.login('it');
    const renamed = await r9.post('/identity/lifecycle-operations', { subject, email: 'renamed.admin@vcprosperous.com', groups: [], active: true }, { idem: 'rename-admin-08' });
    expect(renamed.body.status).toBe('done');
    const stale = await oidcLogin({ email, groups: [] });
    expect((await user()).email).toBe('renamed.admin@vcprosperous.com');
    expect(stale.headers.location).toBe('http://localhost:3000/dang-nhap?loi=locked');
    expect((await oidcLogin({ email: 'renamed.admin@vcprosperous.com', groups: [] })).headers.location).toBe('http://localhost:3000/bo-nho');
  });
});
