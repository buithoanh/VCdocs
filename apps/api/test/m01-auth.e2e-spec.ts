import { anon, createTestApp, expectContract, TestApp } from './support/app';

describe('M01 Đăng nhập, người dùng', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('GET /auth/google chuyển sang Google kèm hd và state', async () => {
    const res = await anon(t, 'get', '/auth/google?returnTo=/tai-lieu');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.searchParams.get('hd')).toBe('vcprosperous.com');
    expect(loc.searchParams.get('state')).toBeTruthy();
  });

  it('callback đúng tên miền → đặt cookie vcdocs_sid HttpOnly, SameSite=Lax và về returnTo', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    const start = await agent.get('/api/v1/auth/google?returnTo=/ho-so');
    const loc = new URL(start.headers.location);
    const url = `/api/v1/auth/google/callback?state=${loc.searchParams.get('state')}&code=${encodeURIComponent(`fake|${t.ids.emails['nv.mkt']}|${loc.searchParams.get('nonce')}`)}`;
    const cb = await agent.get(url);
    expectContract('GET', url, cb);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:3000/ho-so');
    const cookie = (cb.headers['set-cookie'] as string[]).find((c) => c.startsWith('vcdocs_sid='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  it('callback tài khoản ngoài tên miền → 403', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    const start = await agent.get('/api/v1/auth/google');
    const loc = new URL(start.headers.location);
    const url = `/api/v1/auth/google/callback?state=${loc.searchParams.get('state')}&code=${encodeURIComponent(`fake|nguoila@gmail.com|${loc.searchParams.get('nonce')}`)}`;
    const cb = await agent.get(url);
    expectContract('GET', url, cb);
    expect(cb.status).toBe(403);
    expect(cb.body.error.code).toBe('FORBIDDEN');
  });

  it('callback tên miền giả mạo hd (email khác đuôi) → 403', async () => {
    const agent = require('supertest').agent(t.app.getHttpServer());
    const start = await agent.get('/api/v1/auth/google');
    const loc = new URL(start.headers.location);
    const url = `/api/v1/auth/google/callback?state=${loc.searchParams.get('state')}&code=${encodeURIComponent(`fake|ai@vcpart.vn|${loc.searchParams.get('nonce')}`)}`;
    const cb = await agent.get(url);
    expect(cb.status).toBe(403);
  });

  it('callback thiếu cookie state (login CSRF) → 403', async () => {
    const start = await t.http().get('/api/v1/auth/google');
    const loc = new URL(start.headers.location);
    const url = `/api/v1/auth/google/callback?state=${loc.searchParams.get('state')}&code=${encodeURIComponent(`fake|${t.ids.emails.tgd}|${loc.searchParams.get('nonce')}`)}`;
    const cb = await t.http().get(url);
    expectContract('GET', url, cb);
    expect(cb.status).toBe(403);
  });

  it('tài khoản bị khoá trên Google không vào được', async () => {
    t.fake.addUser({ email: 'bikhoa@vcprosperous.com', name: 'Bị khoá', suspended: true });
    await expect(t.loginEmail('bikhoa@vcprosperous.com')).rejects.toThrow(/403/);
  });

  it('GET /me trả vai trò theo nhóm Google, drive và csrfToken', async () => {
    const c = await t.login('tp.mkt');
    const me = await c.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.systemRoles).toEqual(['R4']);
    expect(me.body.departmentId).toBe(t.ids.depts.MKT.id);
    const mkt = me.body.drives.find((d: any) => d.driveId === t.ids.depts.MKT.driveId);
    expect(mkt.role).toBe('organizer');
    expect(me.body.drives.find((d: any) => d.name === '00 VCPV').role).toBe('reader');
    expect(me.body.csrfToken).toBeTruthy();
  });

  it('chưa đăng nhập → 401 đúng schema Error, có X-Request-Id', async () => {
    const res = await t.http().get('/api/v1/me').set('X-Request-Id', 'abc-123');
    expectContract('GET', '/api/v1/me', res);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', requestId: 'abc-123' });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('POST /auth/logout cần CSRF; xong thì phiên hết', async () => {
    const c = await t.login('nv.mkt');
    const noCsrf = await c.post('/auth/logout', undefined, { noCsrf: true });
    expect(noCsrf.status).toBe(403);
    const ok = await c.post('/auth/logout');
    expect(ok.status).toBe(204);
    const me = await c.agent.get('/api/v1/me');
    expect(me.status).toBe(401);
    const again = await c.post('/auth/logout');
    expect(again.status).toBe(401);
  });

  describe('/users', () => {
    it('R3 xem tất cả, lọc theo phòng, tìm theo tên', async () => {
      const c = await t.login('hcns');
      const all = await c.get('/users?limit=200');
      expect(all.status).toBe(200);
      expect(all.body.total).toBeGreaterThanOrEqual(12);
      await t.login('nv.mkt');
      const mkt = await c.get(`/users?departmentId=${t.ids.depts.MKT.id}&sort=name`);
      expect(mkt.body.items.every((u: any) => u.departmentId === t.ids.depts.MKT.id)).toBe(true);
      const q = await c.get('/users?q=k%E1%BA%BF%20to%C3%A1n');
      expect(q.body.items.map((u: any) => u.email)).toContain(t.ids.emails.ktt);
    });

    it('R4 chỉ thấy phòng mình; xem phòng khác → 403', async () => {
      await t.login('nv.kd');
      const c = await t.login('tp.mkt');
      const mine = await c.get('/users');
      expect(mine.status).toBe(200);
      expect(mine.body.items.every((u: any) => u.departmentId === t.ids.depts.MKT.id)).toBe(true);
      const other = await c.get(`/users?departmentId=${t.ids.depts.KD.id}`);
      expect(other.status).toBe(403);
      const otherUser = await c.get(`/users/${t.ids.users['nv.kd']}`);
      expect(otherUser.status).toBe(403);
    });

    it('nhân viên không xem được danh sách → 403; id sai dạng → 400; không có → 404', async () => {
      const c = await t.login('nv.mkt');
      expect((await c.get('/users')).status).toBe(403);
      const r9 = await t.login('it');
      expect((await r9.get('/users/abc')).status).toBe(400);
      expect((await r9.get('/users/6712f0c2a1b2c3d4e5f60718')).status).toBe(404);
      const ok = await r9.get(`/users/${t.ids.users['nv.mkt']}`);
      expect(ok.status).toBe(200);
      expect(ok.body.email).toBe(t.ids.emails['nv.mkt']);
    });

    it('PATCH: R9 đổi vai trò (ghi nhật ký); không tự sửa mình; không gỡ vai trò cấp qua nhóm (BR-15)', async () => {
      const r9 = await t.login('it');
      await t.login('nv.mkt');
      const id = t.ids.users['nv.mkt'];
      const ok = await r9.patch(`/users/${id}`, { systemRoles: ['R6', 'R8'] });
      expect(ok.status).toBe(200);
      expect(ok.body.systemRoles).toEqual(['R6', 'R8']);
      const audit = await t.db.m.AuditLog.findOne({ companyId: t.ids.companyId, _id: ok.headers['x-audit-id'] }).lean<any>();
      expect(audit.before.systemRoles).toEqual(['R6']);
      expect(audit.after.systemRoles).toEqual(['R6', 'R8']);
      const self = await r9.patch(`/users/${t.ids.users.it}`, { systemRoles: ['R9'] });
      expect(self.status).toBe(403);
      const br15 = await r9.patch(`/users/${id}`, { systemRoles: ['R8'] });
      expect(br15.status).toBe(422);
      expect(br15.body.error.rule).toBe('BR-15');
      const bad = await r9.patch(`/users/${id}`, { systemRoles: ['R10'] });
      expect(bad.status).toBe(400);
      // R9 không ghi ngày nghỉ (việc của R3)
      expect((await r9.patch(`/users/${id}`, { lastWorkingDay: '2026-11-30' })).status).toBe(403);
    });

    it('PATCH: R3 ghi ngày nghỉ việc → leaving, nhắc HCNS lập bàn giao', async () => {
      const r3 = await t.login('hcns');
      await t.login('xem.mkt');
      const res = await r3.patch(`/users/${t.ids.users['xem.mkt']}`, { lastWorkingDay: '2026-11-30' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'leaving', lastWorkingDay: '2026-11-30' });
      const noti = await r3.get('/notifications');
      expect(noti.body.items.some((n: any) => n.type === 'handover_needed')).toBe(true);
      const roles = await r3.patch(`/users/${t.ids.users['xem.mkt']}`, { systemRoles: ['R7'] });
      expect(roles.status).toBe(403);
      const notFound = await r3.patch('/users/6712f0c2a1b2c3d4e5f60718', { lastWorkingDay: '2026-11-30' });
      expect(notFound.status).toBe(404);
    });
  });

  it('POST /sync/google (R9) → 202 job, đồng bộ người mới từ Google', async () => {
    t.fake.addUser({ email: 'moi@vcprosperous.com', name: 'Nhân viên mới', suspended: false });
    t.fake.addGroupMember('11-mkt-dong-gop@vcprosperous.com', 'moi@vcprosperous.com');
    const nv = await t.login('nv.mkt');
    expect((await nv.post('/sync/google')).status).toBe(403);
    const r9 = await t.login('it');
    const res = await r9.post('/sync/google');
    expect(res.status).toBe(202);
    await t.drain();
    const job = await r9.get(`/jobs/${res.body.jobId}`);
    expect(job.body.status).toBe('done');
    expect(job.body.progress).toBe(100);
    const u = await t.db.m.User.findOne({ companyId: t.ids.companyId, email: 'moi@vcprosperous.com' }).lean<any>();
    expect(u.systemRoles).toEqual(['R6']);
    expect(String(u.departmentId)).toBe(t.ids.depts.MKT.id);
  });

  describe('/drives', () => {
    it('11 drive và vai trò của tôi', async () => {
      const c = await t.login('nv.mkt');
      const res = await c.get('/drives');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(11);
      expect(res.body.items.find((d: any) => d.name === '11 MKT').myRole).toBe('writer');
      expect(res.body.items.find((d: any) => d.name === '22 HCNS').myRole).toBeUndefined();
    });

    it('thành viên drive: R4 drive mình; anomalies chỉ thành viên lẻ, ngoài tên miền', async () => {
      const driveId = t.ids.depts.MKT.driveId;
      t.fake.addDrivePermission(driveId, { type: 'user', emailAddress: 'doitac@gmail.com', role: 'reader' });
      t.fake.addDrivePermission(driveId, { type: 'user', emailAddress: t.ids.emails['nv.kd'], role: 'writer' });
      const tp = await t.login('tp.mkt');
      const all = await tp.get(`/drives/${driveId}/members`);
      expect(all.status).toBe(200);
      expect(all.body.items.some((m: any) => m.viaGroup === '11-mkt-dong-gop@vcprosperous.com')).toBe(true);
      const an = await tp.get(`/drives/${driveId}/members?anomalies=true`);
      expect(an.body.items.map((m: any) => m.anomaly).sort()).toEqual(['direct_member', 'foreign_member']);
      const other = await tp.get(`/drives/${t.ids.depts.KD.driveId}/members`);
      expect(other.status).toBe(403);
      const r3 = await t.login('hcns');
      expect((await r3.get(`/drives/${t.ids.depts.KD.driveId}/members`)).status).toBe(200);
      expect((await r3.get('/drives/khong-co/members')).status).toBe(404);
    });
  });
});
