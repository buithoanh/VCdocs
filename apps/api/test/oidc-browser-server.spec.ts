import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Types } from 'mongoose';
import { createTestApp, TestApp } from './support/app';
import { OidcService } from '../src/modules/m01-auth/oidc.service';

const enabled = process.env.RUN_OIDC_BROWSER_SERVER === '1';
(enabled ? describe : describe.skip)('OIDC browser server 12B', () => {
  let t: TestApp;
  const hold = Number(process.env.BROWSER_SMOKE_HOLD_MS || 900_000);
  beforeAll(async () => {
    const root = resolve(__dirname, '../../../poc/identity-admin');
    const bindings = JSON.parse(readFileSync(resolve(root, 'evidence/identity-bindings.json'), 'utf8')).bindings;
    const secret = readFileSync(resolve(root, 'secrets/oidc_app_client_secret'), 'utf8').trim();
    t = await createTestApp({
      port: 18125,
      publicApiOrigin: 'http://app.localtest.me:18126',
      webOrigin: 'http://app.localtest.me:18126',
      authMode: 'oidc',
      oidc: {
        issuer: 'http://authentik.localtest.me:18121/application/o/vcworkspace-application-test/',
        clientId: 'vcworkspace-application-test', clientSecret: secret,
        companyDomain: 'vcprosperous.com', projectionMaxAgeSeconds: 900,
        groupRoleMap: { 'vcw-admins': ['R9'], 'vcw-team-a': ['R4'], 'vcw-outsiders-b': [] },
      },
    });
    await t.app.get(OidcService).discovery();
    const cid = new Types.ObjectId(t.ids.companyId);
    for (const [username, userKey] of [['manager-a', 'tp.mkt'], ['member-a', 'nv.mkt'], ['outsider-b', 'nv.kd']] as const) {
      const upstream = bindings.find((item: any) => item.username === username);
      const userId = new Types.ObjectId(t.ids.users[userKey]);
      await t.db.m.OidcIdentity.create({ companyId: cid, issuer: 'http://authentik.localtest.me:18121/application/o/vcworkspace-application-test/', subject: upstream.subject, userId, email: upstream.email, groups: upstream.groups, active: true, lastSeenAt: new Date() });
    }
    await t.app.listen(18125, '127.0.0.1');
    console.log('OIDC_BROWSER_SERVER_READY api=http://api.localtest.me:18125');
  }, 120_000);
  afterAll(async () => { if (t) await t.close(); });
  it('holds isolated TEST bootstrap for browser verification', async () => { await new Promise((resolve) => setTimeout(resolve, hold)); }, hold + 10_000);
});
