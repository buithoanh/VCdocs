import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { IDENTITY_LIFECYCLE_PORT, FakeIdentityLifecyclePort } from '../src/modules/m01-auth/identity-lifecycle.port';
import { IdentityLifecycleService } from '../src/modules/m01-auth/identity-lifecycle.service';
import type { Ctx } from '../src/common/context';
import { SessionService } from '../src/session/session.service';
import { createTestApp, expectContract, TestApp } from './support/app';

describe('Identity lifecycle coordinator sản phẩm', () => {
  let t: TestApp;
  const subject = 'lifecycle-member-subject';
  beforeAll(async () => {
    t = await createTestApp({
      authMode: 'oidc',
      oidc: { issuer: 'https://id.vcworkspace.test/application/o/app', clientId: 'app', clientSecret: 'test', companyDomain: 'vcprosperous.com', groupRoleMap: { 'vcw-team-a': ['R4'] }, projectionMaxAgeSeconds: 300 },
    });
    await t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer: t.cfg.oidc.issuer, subject, userId: t.ids.users['nv.mkt'], email: t.ids.emails['nv.mkt'], groups: [], active: true, lastSeenAt: new Date() });
    await t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer: t.cfg.oidc.issuer, subject: 'lifecycle-manager-subject', userId: t.ids.users['tp.mkt'], email: t.ids.emails['tp.mkt'], groups: ['vcw-team-a'], active: true, lastSeenAt: new Date() });
    await t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer: t.cfg.oidc.issuer, subject: 'lifecycle-outsider-subject', userId: t.ids.users['nv.kd'], email: t.ids.emails['nv.kd'], groups: [], active: true, lastSeenAt: new Date() });
  });
  afterAll(async () => t.close());

  async function serviceCtx(): Promise<Ctx> {
    const user = await t.db.m.User.findOne({ _id: t.ids.users.it, companyId: t.ids.companyId }).lean<any>();
    return { requestId: 'lifecycle-direct-test', ip: 'test', device: 'jest', companyId: String(t.ids.companyId), user: { id: String(user._id), email: user.email, name: user.name, systemRoles: user.systemRoles }, driveRoles: new Map(), visibleDriveIds: [], query: {}, auditIds: [] };
  }

  it('R9 reconcile rename+mover qua journal, bind idempotency và chặn người không phải R9', async () => {
    const r9 = await t.login('it'), member = await t.login('nv.mkt');
    expect((await member.post('/identity/lifecycle-operations', { subject, email: 'renamed@vcprosperous.com', groups: ['vcw-team-a'], active: true }, { idem: 'deny-member-12b' })).status).toBe(403);
    const body = { subject, email: 'renamed@vcprosperous.com', groups: ['vcw-team-a'], active: true };
    const created = await r9.post('/identity/lifecycle-operations', body, { idem: 'lifecycle-rename-12b' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ subject, status: 'done', version: 1 });
    expect(created.body.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app-deny', status: 'done', attempts: 1 }),
      expect.objectContaining({ name: 'authentik', status: 'done', attempts: 1 }),
      expect.objectContaining({ name: 'nextcloud', status: 'done', attempts: 1 }),
      expect.objectContaining({ name: 'app-commit', status: 'done', attempts: 1 }),
    ]));
    expect((await r9.get(`/identity/lifecycle-operations/${created.body.id}`)).body.status).toBe('done');
    const replay = await r9.post('/identity/lifecycle-operations', body, { idem: 'lifecycle-rename-12b' });
    expect(replay.body.id).toBe(created.body.id);
    expect((await r9.post('/identity/lifecycle-operations', { ...body, active: false }, { idem: 'lifecycle-rename-12b' })).status).toBe(409);
    const user = await t.db.m.User.findOne({ _id: t.ids.users['nv.mkt'], companyId: t.ids.companyId }).lean<any>();
    expect(user).toMatchObject({ email: 'renamed@vcprosperous.com', systemRoles: ['R4'], isSuspended: false });
  });

  it('partial fail-closed, restart instance đọc journal và retry idempotent đến done', async () => {
    const r9 = await t.login('it'), port = t.app.get(IDENTITY_LIFECYCLE_PORT) as FakeIdentityLifecyclePort;
    port.failNext = 'nextcloud';
    const body = { subject, email: 'renamed@vcprosperous.com', groups: [], active: true };
    const failed = await r9.post('/identity/lifecycle-operations', body, { idem: 'lifecycle-partial-12b' });
    expect(failed.status).toBe(503);
    const persisted = await t.db.m.IdentityLifecycleOperation.findOne({ companyId: t.ids.companyId, idempotencyKey: 'lifecycle-partial-12b' }).lean<any>();
    expect(persisted).toMatchObject({ status: 'partial' });
    expect(persisted.steps.find((step: any) => step.name === 'nextcloud')).toMatchObject({ status: 'failed', attempts: 1 });
    const deniedBinding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    const deniedUser = await t.db.m.User.findOne({ companyId: t.ids.companyId, _id: deniedBinding.userId }).lean<any>();
    expect(deniedBinding).toMatchObject({ active: false, projectionPendingRevision: persisted.subjectRevision });
    expect(deniedUser.isSuspended).toBe(true);

    const app2 = await createApp(t.cfg, { logger: false });
    try {
      const session = await app2.get(SessionService).create({ userId: t.ids.users.it, companyId: t.ids.companyId, ip: 'test', device: 'restart' });
      const me = await request(app2.getHttpServer()).get('/api/v1/me').set('Cookie', `vcdocs_sid=${session.sid}`);
      const retried = await request(app2.getHttpServer()).post(`/api/v1/identity/lifecycle-operations/${persisted._id}/reconcile`).set('Cookie', `vcdocs_sid=${session.sid}`).set('X-CSRF-Token', me.body.csrfToken);
      expectContract('POST', `/identity/lifecycle-operations/${persisted._id}/reconcile`, retried);
      expect(retried.status).toBe(200);
      expect(retried.body.status).toBe('done');
      expect(retried.body.version).toBe(2);
      expect(retried.body.steps.every((step: any) => step.status === 'done')).toBe(true);
      const committed = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
      expect(committed.active).toBe(true);
      expect(committed.projectionPendingRevision).toBeUndefined();
    } finally { await app2.close(); }
  });

  it('global revoke xóa current app sessions trong khi giữ immutable subject', async () => {
    const target = await t.db.m.User.findOne({ _id: t.ids.users['nv.mkt'], companyId: t.ids.companyId }).lean<any>();
    const identity = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    const issued = await t.app.get(SessionService).create({ userId: String(target._id), companyId: t.ids.companyId, ip: 'test', device: 'target', authProvider: 'oidc', identityId: String(identity._id) });
    expect((await request(t.app.getHttpServer()).get('/api/v1/me').set('Cookie', `vcdocs_sid=${issued.sid}`)).status).toBe(200);
    const r9 = await t.login('it');
    const revoked = await r9.post('/identity/lifecycle-operations', { subject, email: target.email, groups: [], active: true, globalRevoke: true }, { idem: 'lifecycle-global-revoke-12b' });
    expect(revoked.status).toBe(201);
    expect((await request(t.app.getHttpServer()).get('/api/v1/me').set('Cookie', `vcdocs_sid=${issued.sid}`)).status).toBe(401);
    expect(await t.db.m.OidcIdentity.countDocuments({ companyId: t.ids.companyId, subject })).toBe(1);
  });

  it('CAS lease chỉ cho một process reconcile operation partial', async () => {
    const r9 = await t.login('it'), port = t.app.get(IDENTITY_LIFECYCLE_PORT) as FakeIdentityLifecyclePort;
    port.failNext = 'authentik';
    const failed = await r9.post('/identity/lifecycle-operations', { subject, email: 'renamed@vcprosperous.com', groups: [], active: true }, { idem: 'lifecycle-race-12b' });
    expect(failed.status).toBe(503);
    const operation = await t.db.m.IdentityLifecycleOperation.findOne({ companyId: t.ids.companyId, idempotencyKey: 'lifecycle-race-12b' }).lean<any>();
    port.holdNextMs = 75;
    const results = await Promise.all([r9.post(`/identity/lifecycle-operations/${operation._id}/reconcile`), r9.post(`/identity/lifecycle-operations/${operation._id}/reconcile`)]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    expect((await r9.get(`/identity/lifecycle-operations/${operation._id}`)).body.status).toBe('done');
  });

  it('hai create cùng Idempotency-Key chỉ tạo một operation và một subject revision', async () => {
    const service = t.app.get(IdentityLifecycleService), ctx = await serviceCtx();
    const model: any = t.db.m.IdentityLifecycleOperation;
    const originalFindOne = model.findOne.bind(model);
    let initialMisses = 0, release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = jest.spyOn(model, 'findOne').mockImplementation((filter: any, ...rest: any[]) => {
      if (filter?.idempotencyKey === 'same-key-barrier-12b' && initialMisses < 2) {
        initialMisses += 1;
        if (initialMisses === 2) release();
        return { lean: async () => { await barrier; return null; } } as any;
      }
      return originalFindOne(filter, ...rest);
    });
    const body = { subject, email: 'barrier@vcprosperous.com', groups: [], active: true };
    try {
      const results = await Promise.allSettled([
        service.create(ctx, body, 'same-key-barrier-12b'),
        service.create(ctx, body, 'same-key-barrier-12b'),
      ]);
      const operation = await originalFindOne({ companyId: t.ids.companyId, idempotencyKey: 'same-key-barrier-12b' }).lean();
      expect(operation).toBeTruthy();
      expect(await model.countDocuments({ companyId: t.ids.companyId, idempotencyKey: 'same-key-barrier-12b' })).toBe(1);
      for (const result of results) if (result.status === 'fulfilled') expect(result.value.id).toBe(String(operation._id));
      const state = await t.db.m.IdentityLifecycleSubject.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
      expect(state.revision).toBe(operation.subjectRevision);
      expect(state.reservedOperationId).toBeUndefined();
      expect(state.reservedRevision).toBeUndefined();
      expect(operation.subjectRevision).toBeGreaterThan(0);
    } finally { spy.mockRestore(); }
  });

  it('retry cùng key khôi phục reservation nếu lỗi sau cấp revision nhưng trước cập nhật operation', async () => {
    const service = t.app.get(IdentityLifecycleService), ctx = await serviceCtx();
    const model: any = t.db.m.IdentityLifecycleOperation;
    const original = model.findOneAndUpdate.bind(model);
    let injected = false;
    const spy = jest.spyOn(model, 'findOneAndUpdate').mockImplementation((filter: any, update: any, options: any) => {
      if (!injected && filter?.subjectRevision === 0) {
        injected = true;
        return { lean: async () => { throw new Error('INJECT_AFTER_REVISION_ALLOCATION'); } } as any;
      }
      return original(filter, update, options);
    });
    const body = { subject, email: 'reservation@vcprosperous.com', groups: [], active: true };
    await expect(service.create(ctx, body, 'reservation-recovery-12b')).rejects.toThrow('INJECT_AFTER_REVISION_ALLOCATION');
    const stranded = await model.findOne({ companyId: t.ids.companyId, idempotencyKey: 'reservation-recovery-12b' }).lean();
    const reserved = await t.db.m.IdentityLifecycleSubject.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    expect(stranded.subjectRevision).toBe(0);
    expect(String(reserved.reservedOperationId)).toBe(String(stranded._id));
    expect(reserved.reservedRevision).toBeGreaterThan(0);
    spy.mockRestore();
    const recovered = await service.create(ctx, body, 'reservation-recovery-12b');
    expect(recovered).toMatchObject({ id: String(stranded._id), status: 'done', subjectRevision: reserved.reservedRevision });
    const state = await t.db.m.IdentityLifecycleSubject.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    expect(state.revision).toBe(recovered.subjectRevision);
    expect(state.reservedOperationId).toBeUndefined();
    expect(state.reservedRevision).toBeUndefined();
  });

  it('mất fence giữa hai ghi app-commit giữ binding pending-deny', async () => {
    const r9 = await t.login('it');
    const userModel: any = t.db.m.User, original = userModel.updateOne.bind(userModel);
    let injected = false;
    const spy = jest.spyOn(userModel, 'updateOne').mockImplementation(async (filter: any, update: any, ...rest: any[]) => {
      const result = await original(filter, update, ...rest);
      if (!injected && update?.$set?.email === 'fenced-commit@vcprosperous.com') {
        injected = true;
        await t.db.m.IdentityLifecycleSubject.updateOne({ companyId: t.ids.companyId, subject }, { $set: { leaseToken: 'stolen-between-app-writes', leaseUntil: new Date(Date.now() - 1_000) } });
      }
      return result;
    });
    try {
      const fenced = await r9.post('/identity/lifecycle-operations', { subject, email: 'fenced-commit@vcprosperous.com', groups: [], active: true }, { idem: 'commit-fence-12b' });
      expect(fenced).toMatchObject({ status: 201, body: expect.objectContaining({ status: 'superseded' }) });
      const binding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
      expect(binding).toMatchObject({ active: false, projectionPendingRevision: fenced.body.subjectRevision });
    } finally { spy.mockRestore(); }
    const restored = await r9.post('/identity/lifecycle-operations', { subject, email: 'fenced-commit@vcprosperous.com', groups: [], active: true }, { idem: 'commit-fence-recovery-12b' });
    expect(restored).toMatchObject({ status: 201, body: expect.objectContaining({ status: 'done' }) });
  });

  it('subject revision fence chặn operation cũ ghi đè operation mới khác key sau upstream delay', async () => {
    const r9 = await t.login('it'), port = t.app.get(IDENTITY_LIFECYCLE_PORT) as FakeIdentityLifecyclePort;
    port.holdNextMs = 100;
    const oldPromise = r9.post('/identity/lifecycle-operations', { subject, email: 'old@vcprosperous.com', groups: ['vcw-team-a'], active: true }, { idem: 'subject-old-12b' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = await r9.post('/identity/lifecycle-operations', { subject, email: 'new@vcprosperous.com', groups: [], active: false }, { idem: 'subject-new-12b' });
    expect(newer.status).toBe(409);
    const old = await oldPromise;
    expect(old.body.status).toBe('superseded');
    const newerRow = await t.db.m.IdentityLifecycleOperation.findOne({ companyId: t.ids.companyId, idempotencyKey: 'subject-new-12b' }).lean<any>();
    const fenced = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    expect(fenced).toMatchObject({ active: false, projectionPendingRevision: newerRow.subjectRevision });
    const applied = await r9.post(`/identity/lifecycle-operations/${newerRow._id}/reconcile`);
    expect(applied).toMatchObject({ status: 200, body: expect.objectContaining({ status: 'done', subjectRevision: newerRow.subjectRevision }) });
    const binding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject }).lean<any>();
    expect(binding).toMatchObject({ email: 'new@vcprosperous.com', groups: [], active: false });
  });

  it('lease hết hạn được process mới chiếm lại và reconcile', async () => {
    const r9 = await t.login('it'), port = t.app.get(IDENTITY_LIFECYCLE_PORT) as FakeIdentityLifecyclePort;
    port.failNext = 'authentik';
    const failed = await r9.post('/identity/lifecycle-operations', { subject, email: 'recovered@vcprosperous.com', groups: [], active: true }, { idem: 'lease-expired-12b' });
    expect(failed.status).toBe(503);
    const operation = await t.db.m.IdentityLifecycleOperation.findOne({ companyId: t.ids.companyId, idempotencyKey: 'lease-expired-12b' }).lean<any>();
    const expired = new Date(Date.now() - 1_000);
    await t.db.m.IdentityLifecycleOperation.updateOne({ _id: operation._id, companyId: t.ids.companyId }, { $set: { status: 'running', leaseToken: 'dead-worker', leaseUntil: expired } });
    await t.db.m.IdentityLifecycleSubject.updateOne({ companyId: t.ids.companyId, subject, revision: operation.subjectRevision }, { $set: { status: 'running', leaseToken: 'dead-worker', leaseUntil: expired } });
    const recovered = await r9.post(`/identity/lifecycle-operations/${operation._id}/reconcile`);
    expect(recovered).toMatchObject({ status: 200, body: expect.objectContaining({ status: 'done' }) });
  });

  it('direct API dùng OIDC session vẫn chặn outsider đọc/ghi không gian phòng khác', async () => {
    // Seed Google giả chỉ dùng để chiếu department ban đầu; các request cần kiểm bên dưới đều dùng OIDC session.
    await t.login('tp.mkt');
    await t.login('nv.kd');
    const session = t.app.get(SessionService);
    const managerBinding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject: 'lifecycle-manager-subject' }).lean<any>();
    const outsiderBinding = await t.db.m.OidcIdentity.findOne({ companyId: t.ids.companyId, subject: 'lifecycle-outsider-subject' }).lean<any>();
    const managerSid = await session.create({ userId: t.ids.users['tp.mkt'], companyId: t.ids.companyId, ip: 'test', device: 'manager', authProvider: 'oidc', identityId: String(managerBinding._id) });
    const outsiderSid = await session.create({ userId: t.ids.users['nv.kd'], companyId: t.ids.companyId, ip: 'test', device: 'outsider', authProvider: 'oidc', identityId: String(outsiderBinding._id) });
    const manager = request(t.app.getHttpServer()), outsider = request(t.app.getHttpServer());
    const spaces = await manager.get('/api/v1/spaces').set('Cookie', `vcdocs_sid=${managerSid.sid}`);
    expect(spaces.status).toBe(200);
    expect(spaces.body.items).toEqual(expect.any(Array));
    const department = spaces.body.items.find((item: any) => item.kind === 'department');
    expect(department).toBeTruthy();
    const folder = await manager.post('/api/v1/drive/folders').set('Cookie', `vcdocs_sid=${managerSid.sid}`).set('X-CSRF-Token', managerSid.csrfToken).set('Idempotency-Key', 'oidc-manager-folder-12b').send({ spaceId: department.id, name: 'OIDC direct deny' });
    expect(folder.status).toBe(201);
    const outsiderList = await outsider.get(`/api/v1/drive/items?spaceId=${department.id}`).set('Cookie', `vcdocs_sid=${outsiderSid.sid}`);
    expect([403, 404]).toContain(outsiderList.status);
    const outsiderWrite = await outsider.patch(`/api/v1/drive/items/${folder.body.id}`).set('Cookie', `vcdocs_sid=${outsiderSid.sid}`).set('X-CSRF-Token', outsiderSid.csrfToken).send({ name: 'leak.txt' });
    expect([403, 404]).toContain(outsiderWrite.status);
  });
});
