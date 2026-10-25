import { generateKeyPairSync, sign } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/config';
import { SessionService } from '../src/session/session.service';
import { createTestApp, expectContract, TestApp } from './support/app';

const issuer = 'https://id.vcworkspace.test/application/o/vcworkspace';
const clientId = 'vcworkspace-web-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
Object.assign(publicJwk, { kid: 'test-key', use: 'sig', alg: 'RS256' });

it('chặn cấu hình OIDC production không có HTTPS/cookie Secure', () => {
  expect(() => loadConfig({
    NODE_ENV: 'production', GOOGLE_MODE: 'real', AUTH_MODE: 'oidc', OIDC_ISSUER: 'http://id.example.test',
    OIDC_CLIENT_ID: 'app', OIDC_CLIENT_SECRET: 'secret', OIDC_COMPANY_DOMAIN: 'example.test',
    PUBLIC_API_ORIGIN: 'http://api.example.test', WEB_ORIGIN: 'http://app.example.test', COOKIE_SECURE: 'false',
  } as any)).toThrow('OIDC production bắt buộc HTTPS');
});

function jwt(claims: Record<string, unknown>) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

describe('OIDC ứng dụng thật', () => {
  let t: TestApp;
  let tokenClaims: Record<string, unknown>;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    t = await createTestApp({
      authMode: 'oidc',
      oidc: { issuer, clientId, clientSecret: 'test-only-secret', companyDomain: 'vcprosperous.com', groupRoleMap: { 'vcw-manager': ['R4'], 'vcw-admin': ['R9'] }, projectionMaxAgeSeconds: 300 },
    });
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return new Response(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize/`, token_endpoint: `${issuer}/token/`, jwks_uri: `${issuer}/jwks/`, end_session_endpoint: `${issuer}/end-session/` }), { status: 200 });
      if (url.endsWith('/token/')) return new Response(JSON.stringify({ id_token: jwt(tokenClaims) }), { status: 200 });
      if (url.endsWith('/jwks/')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    }) as any;
  });
  afterAll(async () => { global.fetch = originalFetch; await t.close(); });

  async function begin(agent: any) {
    const start = await agent.get('/api/v1/auth/oidc?returnTo=/bo-nho');
    expectContract('GET', '/auth/oidc?returnTo=/bo-nho', start);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.location);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('nonce')).toBeTruthy();
    return location;
  }

  it('đăng nhập browser, bind issuer+sub, map role server và chống callback replay', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    const location = await begin(agent);
    const now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-manager', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'oidc.manager@vcprosperous.com', email_verified: true, name: 'OIDC Manager', groups: ['vcw-manager', 'untrusted-R9'] };
    const path = `/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=one-time-code`;
    const callback = await agent.get(path);
    expectContract('GET', path.replace('/api/v1', ''), callback);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:3000/bo-nho');
    expect(callback.headers['set-cookie'].join(';')).toMatch(/vcdocs_sid=.*HttpOnly.*SameSite=Lax/);
    const binding = await t.db.m.OidcIdentity.findOne({ issuer, subject: 'subject-manager' }, undefined, { skipTenant: true }).lean<any>();
    const user = await t.db.m.User.findOne({ _id: binding.userId, companyId: t.ids.companyId }).lean<any>();
    expect(user.systemRoles).toEqual(['R4']);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
    const replay = await agent.get(path);
    expect(replay.headers.location).toBe('http://localhost:3000/dang-nhap?loi=state');
  });

  it('không auto-link cùng email cho subject khác; cùng subject đổi email vẫn giữ user', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    let location = await begin(agent);
    let now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'evil-other-subject', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'oidc.manager@vcprosperous.com', email_verified: true, groups: ['vcw-admin'] };
    let callback = await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=other`);
    expect(callback.headers.location).toBe('http://localhost:3000/dang-nhap?loi=identity');
    expect(await t.db.m.OidcIdentity.exists({ companyId: t.ids.companyId, subject: 'evil-other-subject' })).toBeNull();

    location = await begin(agent); now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-manager', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'oidc.manager.renamed@vcprosperous.com', email_verified: true, groups: ['vcw-manager'] };
    callback = await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=rename`);
    expect(callback.headers.location).toBe('http://localhost:3000/bo-nho');
    expect(await t.db.m.User.countDocuments({ companyId: t.ids.companyId, email: /oidc\.manager/ })).toBe(1);
    const binding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, issuer, subject: 'subject-manager' }).lean<any>();
    await t.db.m.OidcIdentity.updateOne({ _id: binding._id, companyId: t.ids.companyId }, { $set: { projectionPendingRevision: 99 } });
    location = await begin(agent); now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-manager', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'stale-claim@vcprosperous.com', email_verified: true, groups: ['vcw-admin'] };
    callback = await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=pending`);
    expect(callback.headers.location).toBe('http://localhost:3000/dang-nhap?loi=locked');
    expect((await t.db.m.User.findOne({ _id: binding.userId, companyId: t.ids.companyId }).lean<any>()).email).toBe('oidc.manager.renamed@vcprosperous.com');
    await t.db.m.OidcIdentity.updateOne({ _id: binding._id, companyId: t.ids.companyId }, { $unset: { projectionPendingRevision: 1 } });
    await t.db.m.OidcIdentity.updateOne({ companyId: t.ids.companyId, issuer, subject: 'subject-manager' }, { $set: { active: false } });
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });

  it('lần đầu đăng nhập với email verified ngoài tên miền công ty bị chặn, không tạo user hay binding', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    const location = await begin(agent);
    const now = Math.floor(Date.now() / 1000);
    const usersBefore = await t.db.m.User.countDocuments({ companyId: t.ids.companyId });
    tokenClaims = { iss: issuer, sub: 'outsider', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'nv.mkt@other.example', email_verified: true, name: 'Outsider', groups: [] };
    const callback = await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=outsider`);
    expect(callback.headers.location).toBe('http://localhost:3000/dang-nhap?loi=identity');
    expect(callback.headers['set-cookie']?.join(';') ?? '').not.toMatch(/vcdocs_sid=[^;]/);
    expect(await t.db.m.User.exists({ companyId: t.ids.companyId, email: 'nv.mkt@other.example' })).toBeNull();
    expect(await t.db.m.User.countDocuments({ companyId: t.ids.companyId })).toBe(usersBefore);
    expect(await t.db.m.OidcIdentity.findOne({ issuer, subject: 'outsider' }, undefined, { skipTenant: true }).lean()).toBeNull();
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });

  it('binding đã có nhưng token mang email ngoài tên miền công ty bị chặn, không ghi đè email', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    let location = await begin(agent);
    let now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-domain-bound', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'oidc.domain@vcprosperous.com', email_verified: true, groups: [] };
    let callback = await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=bound`);
    expect(callback.headers.location).toBe('http://localhost:3000/bo-nho');
    const binding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, issuer, subject: 'subject-domain-bound' }).lean<any>();

    const other = require('supertest').agent(t.app.getHttpServer());
    location = await begin(other); now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-domain-bound', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'tp.mkt@other.example', email_verified: true, groups: ['vcw-admin'] };
    callback = await other.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=foreign`);
    expect(callback.headers.location).toBe('http://localhost:3000/dang-nhap?loi=identity');
    const user = await t.db.m.User.findOne({ _id: binding.userId, companyId: t.ids.companyId }).lean<any>();
    expect(user.email).toBe('oidc.domain@vcprosperous.com');
    expect(user.systemRoles).toEqual([]);
    expect((await t.db.m.OidcIdentity.findOne({ _id: binding._id, companyId: t.ids.companyId }).lean<any>()).email).toBe('oidc.domain@vcprosperous.com');
    expect((await other.get('/api/v1/me')).status).toBe(401);
  });

  it('provider outage fail-closed, không tạo state hoặc session', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(async () => { throw new Error('offline'); });
    const agent = require('supertest').agent(t.app.getHttpServer());
    const before = await t.db.m.OAuthState.countDocuments({ provider: 'oidc' });
    const response = await agent.get('/api/v1/auth/oidc');
    expect(response.headers.location).toBe('http://localhost:3000/dang-nhap?loi=provider');
    expect(await t.db.m.OAuthState.countDocuments({ provider: 'oidc' })).toBe(before);
  });

  it('đọc lại binding và session OIDC từ DB ở instance mới, rồi chặn ngay binding bị vô hiệu hóa', async () => {
    const user = await t.db.m.User.findOne({ companyId: t.ids.companyId, email: t.ids.emails['nv.mkt'] }).lean<any>();
    const binding = await t.db.m.OidcIdentity.create({
      companyId: t.ids.companyId,
      issuer,
      subject: 'subject-restart-member',
      userId: user._id,
      email: user.email,
      groups: [],
      active: true,
      lastSeenAt: new Date(),
    });
    const issued = await t.app.get(SessionService).create({
      userId: String(user._id),
      companyId: String(t.ids.companyId),
      ip: '127.0.0.1',
      device: 'oidc-restart-test',
      authProvider: 'oidc',
      identityId: String(binding._id),
    });

    const app2 = await createApp(t.cfg, { logger: false });
    try {
      const me = await request(app2.getHttpServer()).get('/api/v1/me').set('Cookie', `vcdocs_sid=${issued.sid}`);
      expectContract('GET', '/api/v1/me', me);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(user.email);

      await t.db.m.OidcIdentity.updateOne({ _id: binding._id, companyId: t.ids.companyId }, { $set: { active: false } });
      const denied = await request(app2.getHttpServer()).get('/api/v1/me').set('Cookie', `vcdocs_sid=${issued.sid}`);
      expectContract('GET', '/api/v1/me', denied);
      expect(denied.status).toBe(401);
    } finally {
      await app2.close();
    }
  });

  it('audit 7/12: user OIDC mới và email đổi lấy lại địa chỉ mail đang bị alias giữ', async () => {
    const cid = t.ids.companyId;
    await t.db.m.WorkspaceMailAlias.create({ companyId: cid, ownerEmail: 'tp.mkt@vcworkspace.test', address: 'oidc.hire@vcworkspace.test', active: true });
    await t.db.m.WorkspaceMailAlias.create({ companyId: cid, ownerEmail: 'tp.mkt@vcworkspace.test', address: 'oidc.hire.moi@vcworkspace.test', active: true });
    const agent = require('supertest').agent(t.app.getHttpServer());
    let location = await begin(agent);
    let now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-hire', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'oidc.hire@vcprosperous.com', email_verified: true, groups: [] };
    expect((await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=hire`)).headers.location).toBe('http://localhost:3000/bo-nho');
    expect((await t.db.m.WorkspaceMailAlias.findOne({ companyId: cid, address: 'oidc.hire@vcworkspace.test' }).lean<any>()).active).toBe(false);
    expect((await t.db.m.WorkspaceMailAlias.findOne({ companyId: cid, address: 'oidc.hire.moi@vcworkspace.test' }).lean<any>()).active).toBe(true);
    location = await begin(agent); now = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: issuer, sub: 'subject-hire', aud: clientId, exp: now + 300, iat: now, nonce: location.searchParams.get('nonce'), email: 'oidc.hire.moi@vcprosperous.com', email_verified: true, groups: [] };
    expect((await agent.get(`/api/v1/auth/oidc/callback?state=${location.searchParams.get('state')}&code=hire-rename`)).headers.location).toBe('http://localhost:3000/bo-nho');
    expect((await t.db.m.WorkspaceMailAlias.findOne({ companyId: cid, address: 'oidc.hire.moi@vcworkspace.test' }).lean<any>()).active).toBe(false);
  });
});
