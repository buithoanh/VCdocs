import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { HandoversService } from '../src/modules/m10-handovers/handovers.service';
import { addDaysToDateStr, dateVN } from '../src/common/util';

describe('M10 Bàn giao (giai đoạn 2, E3–E12)', () => {
  let t: TestApp;
  let r3: Client, nv: Client, tp: Client, it9: Client, gdkKd: Client, nvKd: Client, xem: Client, tgd: Client;
  let svc: HandoversService;
  const today = dateVN();
  const month = today.slice(0, 7);
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const oid = (s: string) => new Types.ObjectId(s);
  const u = (k: string) => t.ids.users[k];
  let recId: string, docId: string, shareId: string, decideId: string, submittedId: string, delegationId: string;
  let hid: string;

  const jobResult = async (c: Client, jobId: string) => {
    await t.drain();
    return (await c.get(`/jobs/${jobId}`)).body;
  };
  const notes = (userKey: string, type: string) => t.db.m.Notification.find({ companyId: cid(), userId: oid(u(userKey)), type }).lean<any[]>();

  beforeAll(async () => {
    t = await createTestApp();
    svc = t.app.get(HandoversService);
    svc.transferPollMs = 0;
    r3 = await t.login('hcns');
    nv = await t.login('nv.mkt');
    tp = await t.login('tp.mkt');
    it9 = await t.login('it');
    gdkKd = await t.login('gdk.kd');
    nvKd = await t.login('nv.kd');
    xem = await t.login('xem.mkt');
    tgd = await t.login('tgd');
    await t.login('leader.mkt');
    await t.login('tp.kd');

    // Việc đang dở của nhân viên MKT sắp nghỉ
    const r = await nv.post('/records', { recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch SEO bàn giao', workMonth: month });
    recId = (await jobResult(nv, r.body.jobId)).result.objectId;
    const recFile = (await nv.get(`/records/${recId}`)).body.fileId;
    const d = await tp.post('/documents', { type: 'HD', level: 'DEPT', title: 'Hướng dẫn viết bài SEO', departmentId: t.ids.depts.MKT.id, drafterId: u('nv.mkt') });
    docId = d.body.id;
    const s = await nv.post('/external-shares', { fileId: recFile, email: 'doitac@agency.vn', role: 'reader', reason: 'Đối tác đọc kế hoạch', expiresAt: new Date(Date.now() + 10 * 86400_000).toISOString() });
    shareId = s.body.id;
    const mk = (p: any) =>
      t.db.m.Approval.create({ companyId: cid(), objectType: 'record', objectId: oid(recId), objectTitle: p.title, submittedAt: new Date(), status: 'pending', driveId: t.ids.depts.MKT.driveId, ...p });
    decideId = String((await mk({ title: 'Phiếu nv duyệt', submittedBy: oid(u('leader.mkt')), approverId: oid(u('nv.mkt')), approverRule: 'Thử' }))._id);
    submittedId = String((await mk({ title: 'Phiếu nv trình', submittedBy: oid(u('nv.mkt')), approverId: oid(u('tp.mkt')) }))._id);
    delegationId = String(
      (await t.db.m.Delegation.create({ companyId: cid(), blockId: oid(t.ids.blocks.KD), recordTypeId: oid(t.ids.recordTypes.seoReport), task: 'Duyệt báo cáo SEO', delegateId: oid(u('nv.mkt')), from: '2026-01-01' }))._id,
    );
    t.fake.addMyDriveFile(t.ids.emails['nv.mkt'], 'Ghi chú cá nhân');
  });
  afterAll(async () => t.close());

  describe('lập biên bản (E3, E4)', () => {
    it('POST /handovers: chỉ R3; người nhận sai → 422 BR-25; thiếu ngày → 400; không có người → 404', async () => {
      const body = { userId: u('nv.mkt'), lastWorkingDay: today };
      expect((await tp.post('/handovers', body)).status).toBe(403);
      expect((await r3.post('/handovers', { userId: u('nv.mkt') })).status).toBe(400);
      const self = await r3.post('/handovers', { ...body, receiverId: u('nv.mkt') });
      expect(self.status).toBe(422);
      expect(self.body.error.rule).toBe('BR-25');
      expect((await r3.post('/handovers', { ...body, userId: new Types.ObjectId().toHexString() })).status).toBe(404);
    });

    it('R3 lập → 202 { jobId, handoverId }; người đó leaving; trùng → 409 DUPLICATE', async () => {
      const r = await r3.post('/handovers', { userId: u('nv.mkt'), lastWorkingDay: today, note: 'Nghỉ theo đơn' });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ jobId: expect.any(String), handoverId: expect.any(String) });
      hid = r.body.handoverId;
      const first = await r3.get(`/handovers/${hid}`);
      expect(first.body).toMatchObject({ status: 'listing', isAuto: false, receiverId: u('tp.mkt'), userId: u('nv.mkt'), departmentId: t.ids.depts.MKT.id, items: [] });
      expect(first.body.allowedActions).toEqual(['cancel']);
      expect((await r3.get(`/users/${u('nv.mkt')}`)).body).toMatchObject({ status: 'leaving', lastWorkingDay: today });
      const dup = await r3.post('/handovers', { userId: u('nv.mkt'), lastWorkingDay: today });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('DUPLICATE');
      expect(await notes('tp.mkt', 'handover_assigned')).toHaveLength(1);
    });

    it('việc nền handover.list liệt kê đủ 8 loại, cách xử lý mặc định → open (E5)', async () => {
      await t.drain();
      const h = (await tp.get(`/handovers/${hid}`)).body;
      expect(h.status).toBe('open');
      const by = (kind: string) => h.items.filter((i: any) => i.kind === kind);
      expect(by('document')[0]).toMatchObject({ objectType: 'document', objectId: docId, action: 'reassign', toUserId: u('tp.mkt'), status: 'pending' });
      expect(by('record')[0]).toMatchObject({ objectId: recId, action: 'reassign' });
      expect(by('approval_to_decide')[0]).toMatchObject({ objectType: 'approval', objectId: decideId, action: 'reassign' });
      expect(by('approval_submitted')[0]).toMatchObject({ objectId: submittedId });
      expect(by('external_share')[0]).toMatchObject({ objectId: shareId, action: 'reassign' });
      expect(by('delegation')[0]).toMatchObject({ objectId: delegationId, action: 'end' });
      expect(by('my_drive_file')[0]).toMatchObject({ name: 'Ghi chú cá nhân', action: 'transfer' });
      expect(by('my_drive_file')[0].toUserId).toBeUndefined();
      expect(by('group_membership').map((i: any) => i.groupEmail)).toEqual(expect.arrayContaining([`11-mkt-dong-gop@vcprosperous.com`]));
      expect(h.counts).toMatchObject({ total: h.items.length, pending: h.items.length, done: 0 });
      expect(h.people[u('tp.mkt')].name).toBe('Trưởng phòng MKT (mẫu)');
      expect(h.allowedActions).toEqual(['update-items', 'refresh', 'confirm-receiver']);
      expect((await r3.get(`/handovers/${hid}`)).body.allowedActions).toEqual(['update', 'update-items', 'refresh', 'export', 'cancel']);
    });

    it('xem (E12): R1, R3, R9 tất cả; R2 khối mình; người nghỉ, người nhận; người khác → 403', async () => {
      for (const c of [tgd, r3, it9, gdkKd, nv, tp]) expect((await c.get(`/handovers/${hid}`)).status).toBe(200);
      expect((await nvKd.get(`/handovers/${hid}`)).status).toBe(403);
      expect((await xem.get(`/handovers/${hid}`)).status).toBe(403);
      const all = await r3.get(`/handovers?status=open&userId=${u('nv.mkt')}`);
      expect(all.body).toMatchObject({ total: 1, page: 1 });
      expect(all.body.items[0].items).toBeUndefined();
      expect(all.body.items[0].counts.total).toBeGreaterThan(5);
      expect(all.body.people[u('nv.mkt')]).toBeDefined();
      expect((await gdkKd.get(`/handovers?departmentId=${t.ids.depts.MKT.id}`)).body.total).toBe(1);
      expect((await tp.get(`/handovers?receiverId=${u('tp.mkt')}`)).body.total).toBe(1);
      expect((await nvKd.get('/handovers')).body.total).toBe(0);
      expect((await r3.get('/handovers?sort=-lastWorkingDay&status=done')).body.total).toBe(0);
      expect((await r3.get('/handovers?status=xyz')).status).toBe(400);
    });
  });

  describe('sửa biên bản (E5, E8)', () => {
    const item = async (kind: string) => (await r3.get(`/handovers/${hid}`)).body.items.find((i: any) => i.kind === kind);

    it('PATCH items: action không hợp kind → 400; toUserId chỉ với reassign; người nhận dòng phải đang làm', async () => {
      const doc = await item('document');
      expect((await r3.patch(`/handovers/${hid}/items/${doc.id}`, { action: 'transfer' })).status).toBe(400);
      expect((await r3.patch(`/handovers/${hid}/items/${doc.id}`, { action: 'keep', toUserId: u('leader.mkt') })).status).toBe(400);
      const bad = await r3.patch(`/handovers/${hid}/items/${doc.id}`, { toUserId: u('nv.mkt') });
      expect(bad.status).toBe(422);
      expect(bad.body.error.rule).toBe('BR-25');
      expect((await nvKd.patch(`/handovers/${hid}/items/${doc.id}`, { note: 'x' })).status).toBe(403);
      expect((await nv.patch(`/handovers/${hid}/items/${doc.id}`, { note: 'x' })).status).toBe(403);
      expect((await r3.patch(`/handovers/${hid}/items/${new Types.ObjectId().toHexString()}`, { note: 'x' })).status).toBe(404);
      const ok = await r3.patch(`/handovers/${hid}/items/${doc.id}`, { toUserId: u('leader.mkt'), note: 'Leader SEO tiếp tục soạn' });
      expect(ok.status).toBe(200);
      expect(ok.body.items.find((i: any) => i.id === doc.id)).toMatchObject({ toUserId: u('leader.mkt'), note: 'Leader SEO tiếp tục soạn' });
    });

    it('người nhận đổi cách xử lý: chia sẻ ngoài → revoke, một nhóm → keep', async () => {
      const share = await item('external_share');
      expect((await tp.patch(`/handovers/${hid}/items/${share.id}`, { action: 'revoke' })).body.items.find((i: any) => i.id === share.id).action).toBe('revoke');
      const g = (await r3.get(`/handovers/${hid}`)).body.items.find((i: any) => i.groupEmail === '00-vcpv-xem@vcprosperous.com');
      expect((await tp.patch(`/handovers/${hid}/items/${g.id}`, { action: 'keep' })).status).toBe(200);
    });

    it('PATCH /handovers/{id}: R3 đổi người nhận (phải đang làm, khác người nghỉ), ghi chú', async () => {
      expect((await tp.patch(`/handovers/${hid}`, { note: 'x' })).status).toBe(403);
      expect((await r3.patch(`/handovers/${hid}`, { receiverId: u('nv.mkt') })).body.error.rule).toBe('BR-25');
      expect((await r3.patch(`/handovers/${hid}`, {})).status).toBe(400);
      const r = await r3.patch(`/handovers/${hid}`, { receiverId: u('leader.mkt') });
      expect(r.status).toBe(200);
      expect(r.body.receiverId).toBe(u('leader.mkt'));
      expect(await notes('leader.mkt', 'handover_assigned')).toHaveLength(1);
      const back = await r3.patch(`/handovers/${hid}`, { receiverId: u('tp.mkt'), note: 'Trưởng phòng nhận' });
      expect(back.body).toMatchObject({ receiverId: u('tp.mkt'), note: 'Trưởng phòng nhận' });
    });

    it('liệt kê lại (E6): giữ action đã sửa, thêm dòng mới; người khác → 403', async () => {
      t.fake.addMyDriveFile(t.ids.emails['nv.mkt'], 'Bảng tính riêng');
      expect((await nvKd.post(`/handovers/${hid}/refresh`)).status).toBe(403);
      const r = await tp.post(`/handovers/${hid}/refresh`);
      expect(r.status).toBe(202);
      const job = await jobResult(tp, r.body.jobId);
      expect(job).toMatchObject({ type: 'handover.list', status: 'done', summary: { added: 1 } });
      expect(job.result).toBeUndefined();
      const h = (await r3.get(`/handovers/${hid}`)).body;
      expect(h.listJobId).toBe(r.body.jobId);
      expect(h.items.filter((i: any) => i.kind === 'my_drive_file')).toHaveLength(2);
      expect(h.items.find((i: any) => i.kind === 'external_share').action).toBe('revoke');
      expect(h.items.find((i: any) => i.kind === 'document').toUserId).toBe(u('leader.mkt'));
    });
  });

  describe('xác nhận, kiểm tra, xuất, chuyển quyền (E7–E11)', () => {
    it('kiểm tra khi người nhận chưa xác nhận → 409; chỉ người nhận xác nhận', async () => {
      expect((await r3.post(`/handovers/${hid}/verify`, {})).status).toBe(409);
      expect((await r3.post(`/handovers/${hid}/confirm-receiver`, {})).status).toBe(403);
      const r = await tp.post(`/handovers/${hid}/confirm-receiver`, { note: 'Đã nhận đủ' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'received', receipt: { by: u('tp.mkt'), note: 'Đã nhận đủ' } });
      expect((await tp.post(`/handovers/${hid}/confirm-receiver`)).status).toBe(409);
    });

    it('xuất BM-VCPV-08 (R3) → 202 handover.export → { fileId, url }, điền chỗ giữ, thư mục tháng drive HCNS', async () => {
      expect((await tp.post(`/handovers/${hid}/export`)).status).toBe(403);
      const r = await r3.post(`/handovers/${hid}/export`);
      expect(r.status).toBe(202);
      const job = await jobResult(r3, r.body.jobId);
      expect(job).toMatchObject({ type: 'handover.export', status: 'done', result: { fileId: expect.any(String), url: expect.any(String) } });
      const f = t.fake.fileState(job.result.fileId);
      expect(f.driveId).toBe(t.ids.depts.HCNS.driveId);
      expect(f.text).toContain('Nhân viên MKT (mẫu)');
      expect(f.text).toContain('Trưởng phòng MKT (mẫu)');
      expect(f.text).toContain('[Tài liệu] Hướng dẫn viết bài SEO – Đổi người → Leader SEO (mẫu)');
      expect(f.text).not.toContain('{{');
      expect((await r3.get(`/handovers/${hid}`)).body.exportFileId).toBe(job.result.fileId);
      const folder = await t.db.m.Folder.findOne({ companyId: cid(), googleId: f.parents[0] }).lean<any>();
      expect(folder).toMatchObject({ kind: 'month', shortName: month });
    });

    it('HCNS kiểm tra trong hạn → verified, isLate false; báo R9 handover_ready', async () => {
      expect((await tp.post(`/handovers/${hid}/verify`, {})).status).toBe(403);
      const r = await r3.post(`/handovers/${hid}/verify`, { note: 'Đủ' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'verified', verification: { by: u('hcns'), isLate: false, note: 'Đủ' } });
      expect(r.body.allowedActions).toEqual(['export', 'cancel']);
      expect((await it9.get(`/handovers/${hid}`)).body.allowedActions).toEqual(['execute']);
      expect(await notes('it', 'handover_ready')).toHaveLength(1);
      expect((await r3.patch(`/handovers/${hid}`, { note: 'x' })).status).toBe(409);
    });

    it('R9 chuyển quyền → 202 handover.execute → done: đổi người, gỡ chia sẻ, kết thúc uỷ quyền, Data Transfer, gỡ nhóm (E10)', async () => {
      expect((await r3.post(`/handovers/${hid}/execute`)).status).toBe(403);
      const r = await it9.post(`/handovers/${hid}/execute`);
      expect(r.status).toBe(202);
      expect((await it9.get(`/handovers/${hid}`)).body).toMatchObject({ status: 'executing', execution: { by: u('it'), jobId: r.body.jobId } });
      expect((await r3.post(`/handovers/${hid}/cancel`, { reason: 'x' })).status).toBe(409);
      const job = await jobResult(it9, r.body.jobId);
      expect(job).toMatchObject({ type: 'handover.execute', status: 'done', result: { objectType: 'handover', objectId: hid } });
      const h = (await r3.get(`/handovers/${hid}`)).body;
      expect(h.status).toBe('done');
      expect(h.execution.finishedAt).toBeTruthy();
      expect(h.counts.failed).toBe(0);
      expect(h.items.find((i: any) => i.groupEmail === '00-vcpv-xem@vcprosperous.com').status).toBe('skipped');
      expect(h.items.filter((i: any) => i.status === 'pending')).toHaveLength(0);

      const doc = await t.db.m.Document.findOne({ companyId: cid(), _id: oid(docId) }).lean<any>();
      expect(String(doc.drafterId)).toBe(u('leader.mkt'));
      const rec = await t.db.m.Record.findOne({ companyId: cid(), _id: oid(recId) }).lean<any>();
      expect(String(rec.createdBy)).toBe(u('tp.mkt'));
      const dec = await t.db.m.Approval.findOne({ companyId: cid(), _id: oid(decideId) }).lean<any>();
      expect(String(dec.approverId)).toBe(u('tp.mkt'));
      expect(dec.approverRule).toMatch(/chuyển do bàn giao/);
      // người nhận (tp.mkt) đang là người duyệt phiếu nv trình → đổi người duyệt sang GĐ khối (BR-05)
      const sub = await t.db.m.Approval.findOne({ companyId: cid(), _id: oid(submittedId) }).lean<any>();
      expect(String(sub.submittedBy)).toBe(u('tp.mkt'));
      expect(String(sub.approverId)).toBe(u('gdk.kd'));
      const share = await t.db.m.ExternalShare.findOne({ companyId: cid(), _id: oid(shareId) }).lean<any>();
      expect(share.status).toBe('revoked');
      const del = await t.db.m.Delegation.findOne({ companyId: cid(), _id: oid(delegationId) }).lean<any>();
      expect(del.to).toBe(today);
      expect(t.fake.myDriveOf(t.ids.emails['nv.mkt'])).toHaveLength(0);
      expect(t.fake.myDriveOf(t.ids.emails['tp.mkt']).map((f) => f.name)).toEqual(expect.arrayContaining(['Ghi chú cá nhân', 'Bảng tính riêng']));
      const groups = await t.fake.directory.listUserGroups(t.ids.emails['nv.mkt']);
      expect(groups).toEqual(['00-vcpv-xem@vcprosperous.com']);
      expect(await notes('tp.mkt', 'handover_done')).toHaveLength(1);
      const logs = await t.db.m.AuditLog.find({ companyId: cid(), action: /^handover\.item\./ }).lean<any[]>();
      expect(logs.length).toBeGreaterThanOrEqual(8);
    });

    it('biên bản đã xong: không sửa dòng, không huỷ, vẫn xuất được', async () => {
      const h = (await r3.get(`/handovers/${hid}`)).body;
      expect((await r3.patch(`/handovers/${hid}/items/${h.items[0].id}`, { note: 'x' })).status).toBe(409);
      expect((await r3.post(`/handovers/${hid}/cancel`, { reason: 'x' })).status).toBe(409);
      expect((await r3.post(`/handovers/${hid}/refresh`)).status).toBe(409);
      expect(h.allowedActions).toEqual(['export']);
    });
  });

  describe('PATCH /users lastWorkingDay tự lập biên bản (E4), kiểm tra lại, chuyển quyền sớm, huỷ', () => {
    let kid: string;
    const later = addDaysToDateStr(today, 10);

    it('R3 ghi ngày nghỉ → leaving, biên bản isAuto (người nhận trưởng phòng KD), handover_needed + handover_assigned', async () => {
      const r = await r3.patch(`/users/${u('nv.kd')}`, { lastWorkingDay: later });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('leaving');
      const list = (await r3.get(`/handovers?userId=${u('nv.kd')}`)).body.items;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ isAuto: true, status: 'listing', receiverId: u('tp.kd'), lastWorkingDay: later });
      kid = list[0].id;
      expect(await notes('tp.kd', 'handover_assigned')).toHaveLength(1);
      const needed = await notes('hcns', 'handover_needed');
      expect(needed.at(-1)).toMatchObject({ objectType: 'handover', link: `/ban-giao/${kid}` });
      await t.drain();
      expect((await r3.get(`/handovers/${kid}`)).body.status).toBe('open');
    });

    it('đổi ngày khi biên bản verified → cập nhật, về received (kiểm tra lại)', async () => {
      const tpKd = await t.login('tp.kd');
      await tpKd.post(`/handovers/${kid}/confirm-receiver`);
      expect((await r3.post(`/handovers/${kid}/verify`, {})).body.status).toBe('verified');
      const newer = addDaysToDateStr(today, 12);
      expect((await r3.patch(`/users/${u('nv.kd')}`, { lastWorkingDay: newer })).status).toBe(200);
      const h = (await r3.get(`/handovers/${kid}`)).body;
      expect(h).toMatchObject({ status: 'received', lastWorkingDay: newer });
      expect(h.verification).toBeUndefined();
      expect((await r3.get(`/handovers?userId=${u('nv.kd')}`)).body.total).toBe(1);
    });

    it('chuyển quyền trước ngày làm việc cuối → 422 BR-25 (E9)', async () => {
      await r3.post(`/handovers/${kid}/verify`, {});
      const r = await it9.post(`/handovers/${kid}/execute`);
      expect(r.status).toBe(422);
      expect(r.body.error.rule).toBe('BR-25');
    });

    it('biên bản đang chuyển quyền → PATCH /users lastWorkingDay 409', async () => {
      await t.db.m.Handover.updateOne({ companyId: cid(), _id: oid(kid) }, { $set: { status: 'executing' } });
      expect((await r3.patch(`/users/${u('nv.kd')}`, { lastWorkingDay: later })).status).toBe(409);
      await t.db.m.Handover.updateOne({ companyId: cid(), _id: oid(kid) }, { $set: { status: 'verified' } });
    });

    it('huỷ (R3, cần lý do) → cancelled, xoá lastWorkingDay, người đó về active', async () => {
      expect((await r3.post(`/handovers/${kid}/cancel`, {})).status).toBe(400);
      expect((await it9.post(`/handovers/${kid}/cancel`, { reason: 'x' })).status).toBe(403);
      const r = await r3.post(`/handovers/${kid}/cancel`, { reason: 'Nhân viên ở lại' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'cancelled', cancelledBy: u('hcns'), cancelReason: 'Nhân viên ở lại', allowedActions: [] });
      const user = (await r3.get(`/users/${u('nv.kd')}`)).body;
      expect(user.status).toBe('active');
      expect(user.lastWorkingDay).toBeUndefined();
      expect((await r3.post(`/handovers/${kid}/export`)).status).toBe(409);
    });
  });

  describe('kiểm tra trễ, chuyển quyền lỗi rồi chạy lại, việc 00:30 (E7, E9)', () => {
    let lid: string;
    const yesterday = addDaysToDateStr(today, -1);

    it('kiểm tra sau ngày làm việc cuối: thiếu lý do → 422 BR-25; có lý do → isLate', async () => {
      const r = await r3.post('/handovers', { userId: u('leader.mkt'), lastWorkingDay: yesterday });
      lid = r.body.handoverId;
      await t.drain();
      await tp.post(`/handovers/${lid}/confirm-receiver`);
      const late = await r3.post(`/handovers/${lid}/verify`, { note: 'Trễ' });
      expect(late.status).toBe(422);
      expect(late.body.error.rule).toBe('BR-25');
      const ok = await r3.post(`/handovers/${lid}/verify`, { lateReason: 'Trưởng phòng đi công tác' });
      expect(ok.body.verification).toMatchObject({ isLate: true, lateReason: 'Trưởng phòng đi công tác' });
    });

    it('Google lỗi một dòng → việc failed, biên bản về verified, dòng done giữ nguyên; gọi lại chỉ chạy dòng lỗi', async () => {
      t.fake.failNext = 'directory.removeGroupMember';
      const r = await it9.post(`/handovers/${lid}/execute`);
      const job = await jobResult(it9, r.body.jobId);
      expect(job.status).toBe('failed');
      expect(job.error.error.code).toBe('DRIVE_ERROR');
      const h = (await r3.get(`/handovers/${lid}`)).body;
      expect(h.status).toBe('verified');
      expect(h.counts.failed).toBe(1);
      expect(h.items.find((i: any) => i.status === 'failed').error).toMatch(/Google giả/);
      const again = await it9.post(`/handovers/${lid}/execute`);
      expect((await jobResult(it9, again.body.jobId)).status).toBe('done');
      const done = (await r3.get(`/handovers/${lid}`)).body;
      expect(done).toMatchObject({ status: 'done', counts: { failed: 0 } });
    });

    it('00:30: qua ngày làm việc cuối → left, huỷ phiên; biên bản chưa xong → handover_overdue cho R3, R9', async () => {
      const leader = await t.login('leader.mkt');
      // người thứ hai: biên bản chưa xong, đã qua ngày cuối
      const r = await r3.post('/handovers', { userId: u('xem.mkt'), lastWorkingDay: yesterday });
      await t.drain();
      await svc.markLeft(today);
      expect((await t.db.m.User.findOne({ companyId: cid(), _id: oid(u('leader.mkt')) }).lean<any>()).status).toBe('left');
      expect((await leader.agent.get('/api/v1/me')).status).toBe(401);
      const over = await notes('hcns', 'handover_overdue');
      expect(over.map((n) => String(n.objectId))).toEqual([r.body.handoverId]);
      expect(await notes('it', 'handover_overdue')).toHaveLength(1);
      await svc.markLeft(today);
      expect(await notes('hcns', 'handover_overdue')).toHaveLength(1);
    });

    it('còn ≤ 2 ngày làm việc mà chưa kiểm tra → nhắc R3 handover_verify_due (một lần)', async () => {
      await r3.patch(`/users/${u('nv.kd')}`, { lastWorkingDay: addDaysToDateStr(today, 1) });
      await t.drain();
      await svc.remindVerifyDue(today);
      await svc.remindVerifyDue(today);
      expect(await notes('hcns', 'handover_verify_due')).toHaveLength(1);
    });
  });
});
