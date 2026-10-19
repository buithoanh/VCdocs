import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service';
import { M03Module } from '../src/modules/m03-folders/m03.module';
import { dateVN } from '../src/common/util';

describe('M08 Tra cứu, M09 Chia sẻ ngoài, M14 Thông báo', () => {
  let t: TestApp;
  let nv: Client, tp: Client, r3: Client, ktt: Client, nvKd: Client, xem: Client, tgd: Client;
  let recId: string;
  let recFile: string;
  let secretRecFile: string;
  const month = dateVN().slice(0, 7);
  const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    nv = await t.login('nv.mkt');
    tp = await t.login('tp.mkt');
    r3 = await t.login('hcns');
    ktt = await t.login('ktt');
    nvKd = await t.login('nv.kd');
    xem = await t.login('xem.mkt');
    tgd = await t.login('tgd');
    const r = await nv.post('/records', { recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch backlink quý 4', workMonth: month });
    await t.drain();
    recId = (await nv.get(`/jobs/${r.body.jobId}`)).body.result.objectId;
    recFile = (await nv.get(`/records/${recId}`)).body.fileId;
    // hồ sơ ở drive Mật (TC – KT)
    const f = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['TCKT:01']) }).lean<any>();
    const rt = await t.db.m.RecordType.create({ companyId: new Types.ObjectId(t.ids.companyId), departmentId: new Types.ObjectId(t.ids.depts.TCKT.id), name: 'Chứng từ chi backlink', kind: 'DX', folderId: f._id, retentionYears: 10, retentionStatus: 'approved', securityLevel: 'confidential' });
    const s = await ktt.post('/records', { recordTypeId: String(rt._id), kind: 'DX', functionCode: 'KD', subject: 'Chi backlink bí mật', workMonth: month });
    await t.drain();
    const sid = (await ktt.get(`/jobs/${s.body.jobId}`)).body.result.objectId;
    secretRecFile = (await ktt.get(`/records/${sid}`)).body.fileId;
  });
  afterAll(async () => t.close());

  describe('M08', () => {
    it('tìm theo chữ, theo số hồ sơ, theo mã tài liệu; không trả thứ ở drive Mật', async () => {
      const r = await nv.get('/search?q=backlink');
      expect(r.status).toBe(200);
      expect(r.body.items.map((x: any) => x.id)).toEqual([recId]);
      expect(r.body.total).toBe(1);
      const k = await ktt.get('/search?q=backlink');
      expect(k.body.total).toBe(1);
      expect(k.body.items[0].title).toMatch(/bí mật/);
      const num = (await nv.get(`/records/${recId}`)).body.number;
      const byNum = await nvKd.get(`/search?q=${num}`);
      expect(byNum.body.total).toBe(0);
      expect((await nv.get(`/search?q=${num}`)).body.items[0]).toMatchObject({ objectType: 'record', code: num, workMonth: month });
      const docs = await nvKd.get('/search?q=BM-VCPV&scope=documents');
      expect(docs.body.items.every((x: any) => x.objectType === 'document')).toBe(true);
      expect(docs.body.items.map((x: any) => x.code)).toEqual(expect.arrayContaining(['BM-VCPV-02', 'BM-VCPV-03', 'BM-VCPV-04']));
      expect((await nv.get(`/search?q=backlink&workMonth=${month}&scope=records&status=drafting`)).body.total).toBe(1);
      expect((await nv.get('/search')).status).toBe(400);
      expect((await nv.get('/search?q=a&scope=khac')).status).toBe(400);
    });

    it('gợi ý khi gõ ≤ 10 kết quả, mã khớp lên đầu', async () => {
      const r = await nv.get('/search/suggest?q=bm-vcpv-03');
      expect(r.status).toBe(200);
      expect(r.body.items[0].code).toBe('BM-VCPV-03');
      expect(r.body.items.length).toBeLessThanOrEqual(10);
    });
  });

  describe('M09', () => {
    let shareId: string;
    it('chia sẻ (R5, R6, R8): kiểm email, hạn, file đã đăng ký (BR-17) → active, quyền do tài khoản máy tạo', async () => {
      const body = { fileId: recFile, email: 'doitac@agency.vn', role: 'reader', reason: 'Gửi đối tác SEO đọc kế hoạch', expiresAt: inDays(10) };
      expect((await xem.post('/external-shares', body)).status).toBe(403);
      expect((await nvKd.post('/external-shares', body)).status).toBe(403);
      expect((await nv.post('/external-shares', { ...body, email: 'ban@vcprosperous.com' })).body.error.rule).toBe('BR-17');
      expect((await nv.post('/external-shares', { ...body, expiresAt: inDays(60) })).body.error.rule).toBe('BR-17');
      expect((await nv.post('/external-shares', { ...body, expiresAt: inDays(-1) })).status).toBe(422);
      expect((await nv.post('/external-shares', { ...body, role: 'writer' })).status).toBe(400);
      expect((await nv.post('/external-shares', { ...body, email: 'khong-phai-email' })).status).toBe(400);
      const folder = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['MKT:10']) }).lean<any>();
      expect((await nv.post('/external-shares', { ...body, fileId: folder.googleId })).status).toBe(422);
      const loose = t.fake.createLooseFile({ parentGoogleId: folder.googleId, name: 'chua dang ky' });
      expect((await nv.post('/external-shares', { ...body, fileId: loose.fileId })).status).toBe(422);
      t.fake.failNext = 'drive.createPermission';
      expect((await nv.post('/external-shares', body)).status).toBe(502);
      const r = await nv.post('/external-shares', body);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'active', source: 'vcdocs', recordId: recId, email: 'doitac@agency.vn', allowedActions: ['revoke', 'extend'] });
      shareId = r.body.id;
      const perm = t.fake.fileState(recFile).permissions.find((p) => p.emailAddress === 'doitac@agency.vn')!;
      expect(perm.permissionId).toBe(r.body.permissionId);
      expect(perm.expirationTime).toBeTruthy();
      expect((await nv.post('/external-shares', body)).status).toBe(422);
    });

    it('file ở drive Mật → pending_approval, trưởng phòng duyệt rồi mới tạo quyền', async () => {
      const r = await ktt.post('/external-shares', { fileId: secretRecFile, email: 'kiemtoan@audit.vn', role: 'commenter', reason: 'Kiểm toán', expiresAt: inDays(5) });
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('pending_approval');
      expect(t.fake.fileState(secretRecFile).permissions).toHaveLength(0);
      // người chia sẻ là trưởng phòng TC-KT → GĐ khối duyệt
      const gdk = await t.login('gdk.vhnb');
      const a = (await gdk.get('/approvals?box=inbox&objectType=external_share')).body.items[0];
      expect(a.objectId).toBe(r.body.id);
      await gdk.post(`/approvals/${a.id}/decide`, { result: 'approve' });
      const list = await ktt.get(`/external-shares?fileId=${secretRecFile}`);
      expect(list.body.items[0].status).toBe('active');
      expect(t.fake.fileState(secretRecFile).permissions[0].emailAddress).toBe('kiemtoan@audit.vn');
    });

    it('sổ chia sẻ: R3 tất cả; R4 phòng mình; người chia sẻ thấy của mình', async () => {
      expect((await r3.get('/external-shares')).body.total).toBe(2);
      expect((await tp.get(`/external-shares?departmentId=${t.ids.depts.MKT.id}`)).body.total).toBe(1);
      expect((await tp.get(`/external-shares?departmentId=${t.ids.depts.TCKT.id}`)).status).toBe(403);
      expect((await nv.get('/external-shares?status=active')).body.total).toBe(1);
      expect((await nvKd.get('/external-shares')).body.total).toBe(0);
    });

    it('gia hạn, gỡ (người chia sẻ, R4); người khác → 403', async () => {
      expect((await nvKd.post(`/external-shares/${shareId}/extend`, { expiresAt: inDays(20) })).status).toBe(403);
      expect((await nv.post(`/external-shares/${shareId}/extend`, { expiresAt: inDays(90) })).status).toBe(422);
      const e = await tp.post(`/external-shares/${shareId}/extend`, { expiresAt: inDays(20) });
      expect(e.status).toBe(200);
      expect(new Date(e.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 19 * 86400_000);
      const r = await nv.post(`/external-shares/${shareId}/revoke`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'revoked', revokedBy: t.ids.users['nv.mkt'] });
      expect(t.fake.fileState(recFile).permissions).toHaveLength(0);
      expect((await nv.post(`/external-shares/${shareId}/revoke`)).status).toBe(409);
      expect((await nv.post(`/external-shares/${shareId}/extend`, { expiresAt: inDays(5) })).status).toBe(409);
      expect((await nv.post('/external-shares/6712f0c2a1b2c3d4e5f60718/revoke')).status).toBe(404);
    });

    it('đến hạn tự gỡ, trước 3 ngày nhắc (việc định kỳ)', async () => {
      const r = await nv.post('/external-shares', { fileId: recFile, email: 'ngan-han@agency.vn', role: 'reader', reason: 'Xem nhanh', expiresAt: inDays(2) });
      await t.app.get(SchedulerService).runAll();
      expect((await nv.get('/notifications')).body.items.some((n: any) => n.type === 'share_expiring')).toBe(true);
      await t.db.m.ExternalShare.updateOne({ _id: new Types.ObjectId(r.body.id), companyId: new Types.ObjectId(t.ids.companyId) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(SchedulerService).runAll();
      expect((await nv.get(`/external-shares?fileId=${recFile}&status=expired`)).body.total).toBe(1);
    });

    it('chia sẻ ngoài sổ trong nhật ký Google → anomalies (R4, R3), tự gỡ', async () => {
      t.fake.world.files[recFile].permissions.push({ permissionId: 'pe-lach', type: 'user', emailAddress: 'canhan@gmail.com', role: 'reader' });
      t.fake.simulateExternalShare({ fileId: recFile, fileName: 'KH backlink', email: 'canhan@gmail.com', role: 'reader', actorEmail: t.ids.emails['nv.mkt'] });
      expect((await nv.get('/external-shares/anomalies')).status).toBe(403);
      const a = await tp.get('/external-shares/anomalies');
      expect(a.status).toBe(200);
      expect(a.body.items).toHaveLength(1);
      expect(a.body.items[0]).toMatchObject({ source: 'detected', email: 'canhan@gmail.com', status: 'active' });
      expect((await r3.get('/external-shares/anomalies')).body.items).toHaveLength(1);
      await t.app.get(SchedulerService).runAll();
      expect(t.fake.fileState(recFile).permissions.some((p) => p.emailAddress === 'canhan@gmail.com')).toBe(false);
      expect((await tp.get('/external-shares/anomalies')).body.items).toHaveLength(0);
    });

    it('gỡ hết chia sẻ ngoài của phòng (R4) → 202 job', async () => {
      await nv.post('/external-shares', { fileId: recFile, email: 'a@doitac.vn', role: 'reader', reason: 'x', expiresAt: inDays(5) });
      await nv.post('/external-shares', { fileId: recFile, email: 'b@doitac.vn', role: 'commenter', reason: 'y', expiresAt: inDays(5) });
      expect((await nv.post(`/external-shares/revoke-all?departmentId=${t.ids.depts.MKT.id}`)).status).toBe(403);
      expect((await tp.post(`/external-shares/revoke-all?departmentId=${t.ids.depts.KD.id}`)).status).toBe(403);
      expect((await tp.post('/external-shares/revoke-all')).status).toBe(400);
      const r = await tp.post(`/external-shares/revoke-all?departmentId=${t.ids.depts.MKT.id}`);
      expect(r.status).toBe(202);
      await t.drain();
      expect((await tp.get(`/jobs/${r.body.jobId}`)).body.result.revoked).toBe(2);
      expect((await tp.get(`/external-shares?departmentId=${t.ids.depts.MKT.id}&status=active`)).body.total).toBe(0);
    });
  });

  describe('M14', () => {
    it('thông báo: danh sách, chưa đọc, đánh dấu đọc, đọc hết', async () => {
      const l = await nv.get('/notifications?limit=5');
      expect(l.status).toBe(200);
      expect(l.body.unreadCount).toBeGreaterThan(0);
      const id = l.body.items[0].id;
      const r = await nv.post(`/notifications/${id}/read`);
      expect(r.status).toBe(204);
      expect((await tp.post(`/notifications/${id}/read`)).status).toBe(404);
      const all = await nv.post('/notifications/read-all');
      expect(all.status).toBe(204);
      const u = await nv.get('/notifications?unread=true');
      expect(u.body).toMatchObject({ total: 0, unreadCount: 0 });
    });

    it('kênh nhận: mặc định email + inapp; Zalo chưa dùng được (422); digest daily gửi thư tổng hợp', async () => {
      expect((await xem.get('/notification-settings')).body).toEqual({ channels: ['email', 'inapp'], digest: 'instant' });
      const z = await xem.patch('/notification-settings', { channels: ['zalo'], digest: 'instant' });
      expect(z.status).toBe(422);
      expect((await xem.patch('/notification-settings', { channels: ['fax'], digest: 'instant' })).status).toBe(400);
      expect((await xem.patch('/notification-settings', { channels: ['inapp'] })).status).toBe(400);
      const ok = await xem.patch('/notification-settings', { channels: ['email', 'inapp'], digest: 'daily' });
      expect(ok.status).toBe(200);
      expect(ok.body.digest).toBe('daily');
      const before = t.fake.world.outbox.length;
      const svc = t.app.get(require('../src/notifications/notifications.service').NotificationsService);
      await svc.notify(t.ids.companyId, [t.ids.users['xem.mkt']], { type: 'test', title: 'Thử tổng hợp' });
      expect(t.fake.world.outbox.length).toBe(before);
      await svc.sendDailyDigests();
      expect(t.fake.world.outbox.at(-1)!.to).toEqual([t.ids.emails['xem.mkt']]);
    });
  });

  it('việc định kỳ: ngày 25 tự tạo thư mục tháng sau', async () => {
    await t.app.get(M03Module).ensureNextMonth('2026-11-25');
    await t.drain();
    const job = await t.db.m.Job.findOne({ companyId: new Types.ObjectId(t.ids.companyId), type: 'folder.ensure_periods', 'payload.month': '2026-12' }).lean<any>();
    expect(job.status).toBe('done');
    expect(await t.db.m.Folder.countDocuments({ companyId: new Types.ObjectId(t.ids.companyId), kind: 'month', shortName: '2026-12' })).toBeGreaterThan(0);
    await t.app.get(M03Module).ensureNextMonth('2026-11-26');
    expect(await t.db.m.Job.countDocuments({ companyId: new Types.ObjectId(t.ids.companyId), type: 'folder.ensure_periods', 'payload.month': '2026-12' })).toBe(1);
    void tgd;
  });
});
