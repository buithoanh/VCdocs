import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDENTITY_LIFECYCLE_PORT, IdentityLifecyclePort } from '../src/modules/m01-auth/identity-lifecycle.port';
import { createTestApp, TestApp } from './support/app';

const enabled = process.env.RUN_IDENTITY_LIFECYCLE_LOCAL === '1';
(enabled ? describe : describe.skip)('Identity lifecycle product service với Authentik + Nextcloud local', () => {
  let t: TestApp;
  const root = resolve(__dirname, '../../../poc/identity-admin');
  const secret = (name: string) => readFileSync(resolve(root, 'secrets', name), 'utf8').trim();
  const bindings = JSON.parse(readFileSync(resolve(root, 'evidence/identity-bindings.json'), 'utf8')).bindings;
  const member = bindings.find((item: any) => item.username === 'member-a');
  const outsider = bindings.find((item: any) => item.username === 'outsider-b');

  beforeAll(async () => {
    t = await createTestApp({
      authMode: 'oidc',
      oidc: { issuer: 'http://authentik.localtest.me:18121/application/o/vcworkspace-application-test/', clientId: 'vcworkspace-application-test', clientSecret: secret('oidc_app_client_secret'), companyDomain: 'vcprosperous.com', projectionMaxAgeSeconds: 900, groupRoleMap: { 'vcw-admins': ['R9'], 'vcw-team-a': ['R4'], 'vcw-outsiders-b': [] } },
      identityLifecycle: { mode: 'local', authentikBaseUrl: 'http://authentik.localtest.me:18121/api/v3', authentikToken: secret('ak_bootstrap_token'), nextcloudBaseUrl: 'http://nextcloud.localtest.me:18120/ocs/v1.php/cloud', nextcloudAdminUser: 'admin12', nextcloudAdminPassword: secret('nc_admin_password'), nextcloudControlUrl: 'http://127.0.0.1:18127', nextcloudControlToken: secret('portal_control_token'), timeoutMs: 15_000 },
    });
    await t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer: t.cfg.oidc.issuer, subject: member.subject, userId: t.ids.users['nv.mkt'], email: member.email, groups: ['vcw-team-a'], active: true, lastSeenAt: new Date() });
    await t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer: t.cfg.oidc.issuer, subject: outsider.subject, userId: t.ids.users['nv.kd'], email: outsider.email, groups: ['vcw-outsiders-b'], active: true, lastSeenAt: new Date() });
  }, 60_000);
  afterAll(async () => t?.close());

  it('mover, rename, disable/re-enable và restore đều qua API sản phẩm + readback', async () => {
    const admin = await t.login('it');
    const apply = async (key: string, email: string, groups: string[], active: boolean, globalRevoke = false) => {
      const response = await admin.post('/identity/lifecycle-operations', { subject: member.subject, email, groups, active, globalRevoke }, { idem: key });
      if (response.status !== 201) {
        const operation = await t.db.m.IdentityLifecycleOperation.findOne({ companyId: t.ids.companyId, idempotencyKey: key }).lean<any>();
        throw new Error(`LOCAL_LIFECYCLE_${key}_${response.status}_${operation?.lastError || 'UNKNOWN'}`);
      }
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('done');
      return response.body;
    };
    const renamed = 'member.renamed@tenant-a.test';
    const basic = (password: string) => `Basic ${Buffer.from(`${member.subject}:${password}`).toString('base64')}`;
    await apply('local-mover-12b', member.email, [], true);
    await apply('local-rename-12b', renamed, [], true);
    const password = secret('persona_member_password');
    const tokenPayload = await fetch('http://nextcloud.localtest.me:18120/ocs/v2.php/core/getapppassword?format=json', { headers: { Authorization: basic(password), 'OCS-APIRequest': 'true' } }).then((response) => response.json()) as any;
    const appPassword = tokenPayload?.ocs?.data?.apppassword;
    expect(appPassword).toBeTruthy();
    const dav = (credential: string) => fetch(`http://nextcloud.localtest.me:18120/remote.php/dav/files/${member.subject}/`, { method: 'PROPFIND', headers: { Authorization: basic(credential), Depth: '0' }, redirect: 'manual' });
    expect((await dav(appPassword)).status).toBe(207);
    await apply('local-global-revoke-active-12b', renamed, [], true, true);
    expect((await dav(appPassword)).status).toBe(401);
    expect(await (t.app.get(IDENTITY_LIFECYCLE_PORT) as IdentityLifecyclePort).readNextcloud(member.subject)).toMatchObject({ active: true });
    await apply('local-disable-12b', renamed, [], false);
    await apply('local-enable-12b', renamed, [], true);
    await apply('local-restore-12b', member.email, ['vcw-team-a'], true);
    const port = t.app.get(IDENTITY_LIFECYCLE_PORT) as IdentityLifecyclePort;
    expect(await port.readAuthentik(member.subject)).toMatchObject({ email: member.email, groups: ['vcw-team-a'], active: true });
    expect(await port.readNextcloud(member.subject)).toMatchObject({ email: member.email, groups: ['vcw-team-a'], active: true });
    if (process.env.BROWSER_REVOKE_HOLD_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.BROWSER_REVOKE_HOLD_MS)));
    const browserRevoke = await admin.post('/identity/lifecycle-operations', { subject: outsider.subject, email: outsider.email, groups: ['vcw-outsiders-b'], active: true, globalRevoke: true }, { idem: 'local-outsider-browser-revoke-12b' });
    expect(browserRevoke).toMatchObject({ status: 201, body: expect.objectContaining({ status: 'done' }) });
    expect(await port.readNextcloud(outsider.subject)).toMatchObject({ email: outsider.email, groups: ['vcw-outsiders-b'], active: true });
  }, 120_000);
});
