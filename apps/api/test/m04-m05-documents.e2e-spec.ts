import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';

describe('M04 Tài liệu hệ thống + M05 Phê duyệt', () => {
  let t: TestApp;
  let tp: Client, nv: Client, r3: Client, gdkKd: Client, gdkVhnb: Client, tgd: Client, nvKd: Client;
  let docId: string;
  let fileId: string;

  beforeAll(async () => {
    t = await createTestApp();
    tp = await t.login('tp.mkt');
    nv = await t.login('nv.mkt');
    r3 = await t.login('hcns');
    gdkKd = await t.login('gdk.kd');
    gdkVhnb = await t.login('gdk.vhnb');
    tgd = await t.login('tgd');
    nvKd = await t.login('nv.kd');
  });
  afterAll(async () => t.close());

  const doc = async (c: Client, id = docId) => (await c.get(`/documents/${id}`)).body;
  const inboxOf = async (c: Client) => (await c.get('/approvals?box=inbox')).body.items;

  it('đăng ký (R4 phòng mình); QĐ chỉ cấp VCPV (BR-02); sai quyền → 403', async () => {
    const base = { type: 'QT', level: 'DEPT', title: 'Quy trình viết bài SEO', departmentId: t.ids.depts.MKT.id, drafterId: t.ids.users['nv.mkt'], dueDate: '2026-12-31' };
    const qd = await tp.post('/documents', { ...base, type: 'QD' });
    expect(qd.status).toBe(422);
    expect(qd.body.error).toMatchObject({ code: 'RULE_VIOLATION', rule: 'BR-02' });
    expect((await nv.post('/documents', base)).status).toBe(403);
    expect((await (await t.login('tp.kd')).post('/documents', base)).status).toBe(403);
    expect((await tp.post('/documents', { ...base, drafterId: '6712f0c2a1b2c3d4e5f60718' })).status).toBe(400);
    expect((await tp.post('/documents', { ...base, title: '' })).status).toBe(400);
    const r = await tp.post('/documents', base);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'registered', securityLevel: 'department', isRestricted: false, allowedActions: [] });
    docId = r.body.id;
    expect((await doc(r3)).allowedActions).toEqual(['assign-code']);
  });

  it('tài liệu tên gần giống (R4)', async () => {
    const r = await tp.get('/documents/similar?title=quy%20trinh%20viet%20bai%20seo%20moi');
    expect(r.status).toBe(200);
    expect(r.body.items[0].id).toBe(docId);
    expect((await nv.get('/documents/similar?title=seo')).status).toBe(403);
  });

  it('cấp mã (R3) registered → coded: QT-MKT-01; lần hai → 409', async () => {
    expect((await tp.post(`/documents/${docId}/assign-code`)).status).toBe(403);
    const r = await r3.post(`/documents/${docId}/assign-code`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ code: 'QT-MKT-01', status: 'coded' });
    expect((await r3.post(`/documents/${docId}/assign-code`)).status).toBe(409);
    expect((await r3.post('/documents/6712f0c2a1b2c3d4e5f60718/assign-code')).status).toBe(404);
  });

  it('tạo file nháp từ BM khung (người soạn) coded → drafting; điền bảng nhận diện', async () => {
    expect((await tp.post(`/documents/${docId}/create-draft`)).status).toBe(403);
    const r = await nv.post(`/documents/${docId}/create-draft`);
    expect(r.status).toBe(202);
    await t.drain();
    const job = await nv.get(`/jobs/${r.body.jobId}`);
    expect(job.body.status).toBe('done');
    const d = await doc(nv);
    expect(d.status).toBe('drafting');
    fileId = d.fileId;
    const f = t.fake.fileState(fileId);
    expect(f.name).toBe('QT-MKT-01 v1 Quy trình viết bài SEO');
    expect(f.text).toContain('Mã: QT-MKT-01 | Phiên bản: v1 (nháp) | Trạng thái: Nháp – chưa hiệu lực');
    expect(f.text).toContain('Người soạn: Nhân viên MKT (mẫu)');
    expect(d.allowedActions).toEqual(['request-feedback', 'submit']);
    expect((await nv.post(`/documents/${docId}/create-draft`)).status).toBe(409);
  });

  it('lấy góp ý: cấp quyền Nhận xét cho người ngoài drive → feedback', async () => {
    expect((await tp.post(`/documents/${docId}/request-feedback`, { dueDate: '2026-12-01', reviewerIds: [t.ids.users['nv.kd']] })).status).toBe(403);
    expect((await nv.post(`/documents/${docId}/request-feedback`, { dueDate: '2020-01-01', reviewerIds: [t.ids.users['nv.kd']] })).status).toBe(400);
    expect((await nv.post(`/documents/${docId}/request-feedback`, { reviewerIds: [] })).status).toBe(400);
    const r = await nv.post(`/documents/${docId}/request-feedback`, { dueDate: '2099-12-01', reviewerIds: [t.ids.users['nv.kd']], departmentIds: [t.ids.depts.MKT.id] });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('feedback');
    const perms = t.fake.fileState(fileId).permissions;
    expect(perms.map((p) => p.emailAddress)).toEqual([t.ids.emails['nv.kd']]);
    expect((await nvKd.get('/notifications')).body.items[0].type).toBe('feedback_requested');
    expect((await nv.post(`/documents/${docId}/request-feedback`, { dueDate: '2099-12-01', reviewerIds: [t.ids.users['nv.kd']] })).status).toBe(409);
    t.fake.failNext = 'drive.countOpenComments';
    expect((await nv.get(`/documents/${docId}/feedback`)).status).toBe(502);
  });

  it('số nhận xét mở; trình khi còn nhận xét → 422, bỏ qua phải có lý do', async () => {
    t.fake.setOpenComments(fileId, 2);
    const fb = await nv.get(`/documents/${docId}/feedback`);
    expect(fb.body.openComments).toBe(2);
    expect((await nvKd.get(`/documents/${docId}/feedback`)).status).toBe(403);
    // người soạn được trình (D2) nhưng chỉ trưởng phòng được bỏ qua nhận xét mở
    expect((await nvKd.post(`/documents/${docId}/submit`, {})).status).toBe(403);
    expect((await nv.post(`/documents/${docId}/submit`, {})).status).toBe(422);
    expect((await nv.post(`/documents/${docId}/submit`, { overrideOpenComments: true, reason: 'Gấp' })).status).toBe(403);
    expect((await tp.post(`/documents/${docId}/submit`, {})).status).toBe(422);
    expect((await tp.post(`/documents/${docId}/submit`, { overrideOpenComments: true })).status).toBe(400);
    t.fake.setOpenComments(fileId, 0);
  });

  it('trình duyệt → submitted: phiếu cho GĐ khối (BR-03), khoá tạm, chụp phiên bản, thu quyền góp ý', async () => {
    const prev = await tp.get(`/approvals/preview?objectType=document&objectId=${docId}`);
    expect(prev.status).toBe(200);
    expect(prev.body.approver.email).toBe(t.ids.emails['gdk.kd']);
    expect(prev.body.approverRule).toMatch(/QT cấp phòng/);
    const r = await tp.post(`/documents/${docId}/submit`, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'submitted', approverId: t.ids.users['gdk.kd'] });
    expect(t.fake.fileState(fileId).contentRestriction?.readOnly).toBe(true);
    expect(t.fake.fileState(fileId).permissions).toEqual([]);
    expect((await tp.post(`/documents/${docId}/submit`, {})).status).toBe(409);
    const inbox = await inboxOf(gdkKd);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ objectType: 'document', objectId: docId, status: 'pending', allowedActions: ['decide'] });
    expect(inbox[0].snapshot.revisionId).toBeTruthy();
    expect(inbox[0].snapshot.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
    const sent = await tp.get('/approvals?box=sent');
    expect(sent.body.items[0].allowedActions).toEqual(['cancel', 'remind']);
    expect((await (await t.login('xem.mkt')).get(`/approvals/${inbox[0].id}`)).status).toBe(403);
  });

  it('quyết định: yêu cầu sửa phải ghi nội dung; người khác → 403', async () => {
    const a = (await inboxOf(gdkKd))[0];
    expect((await gdkKd.post(`/approvals/${a.id}/decide`, { result: 'changes_requested' })).status).toBe(400);
    expect((await tp.post(`/approvals/${a.id}/decide`, { result: 'approve' })).status).toBe(403);
    expect((await gdkKd.post(`/approvals/${a.id}/check`, {})).status).toBe(403);
    const r = await gdkKd.post(`/approvals/${a.id}/decide`, { result: 'changes_requested', comment: 'Bổ sung bước kiểm tra từ khoá' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('changes_requested');
    expect(r.body.decision).toMatchObject({ result: 'changes_requested', by: t.ids.users['gdk.kd'] });
    expect((await doc(tp)).status).toBe('drafting');
    expect(t.fake.fileState(fileId).contentRestriction?.readOnly).toBe(false);
    expect((await gdkKd.post(`/approvals/${a.id}/decide`, { result: 'approve' })).status).toBe(409);
  });

  it('file đổi sau khi trình → duyệt bị 409, phiếu invalidated (BR-27)', async () => {
    await tp.post(`/documents/${docId}/submit`, {});
    const a = (await inboxOf(gdkKd))[0];
    t.fake.editFile(fileId);
    const r = await gdkKd.post(`/approvals/${a.id}/decide`, { result: 'approve' });
    expect(r.status).toBe(409);
    const after = await gdkKd.get(`/approvals/${a.id}`);
    expect(after.body.status).toBe('invalidated');
    expect(after.body.invalidatedReason).toMatch(/revision đổi/);
    expect((await doc(tp)).status).toBe('drafting');
  });

  it('rút phiếu, nhắc lại (giới hạn tần suất)', async () => {
    await tp.post(`/documents/${docId}/submit`, {});
    const a = (await inboxOf(gdkKd))[0];
    const rm = await tp.post(`/approvals/${a.id}/remind`);
    expect(rm.status).toBe(429);
    await t.db.m.Approval.updateOne({ _id: new Types.ObjectId(a.id), companyId: new Types.ObjectId(t.ids.companyId) }, { $set: { submittedAt: new Date(Date.now() - 2 * 86400_000) } });
    const ok = await r3.post(`/approvals/${a.id}/remind`);
    expect(ok.status).toBe(200);
    expect(ok.body.reminders).toHaveLength(1);
    expect((await nv.post(`/approvals/${a.id}/remind`)).status).toBe(403);
    expect((await gdkKd.post(`/approvals/${a.id}/cancel`)).status).toBe(403);
    const c = await tp.post(`/approvals/${a.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('cancelled');
    expect((await tp.post(`/approvals/${a.id}/cancel`)).status).toBe(409);
    expect((await tp.post(`/approvals/${a.id}/remind`)).status).toBe(409);
    expect((await doc(tp)).status).toBe('drafting');
    expect((await tp.get('/approvals/6712f0c2a1b2c3d4e5f60718')).status).toBe(404);
  });

  it('duyệt → approved; ban hành (R4 cấp phòng) → effective, khoá, PDF, thông báo', async () => {
    await tp.post(`/documents/${docId}/submit`, {});
    const a = (await inboxOf(gdkKd))[0];
    const ok = await gdkKd.post(`/approvals/${a.id}/decide`, { result: 'approve', comment: 'Đồng ý' });
    expect(ok.status).toBe(200);
    expect(ok.body.decision.device).toBeTruthy();
    expect((await doc(tp)).status).toBe('approved');
    expect((await nv.post(`/documents/${docId}/issue`, { effectiveFrom: '2026-11-01' })).status).toBe(403);
    expect((await tp.post(`/documents/${docId}/issue`, {})).status).toBe(400);
    const r = await tp.post(`/documents/${docId}/issue`, { effectiveFrom: '2026-11-01', notifyGroupIds: ['11-mkt-dong-gop@vcprosperous.com'] });
    expect(r.status).toBe(202);
    await t.drain();
    const job = await tp.get(`/jobs/${r.body.jobId}`);
    expect(job.body.status).toBe('done');
    expect(job.body.steps.every((s: any) => s.status === 'done')).toBe(true);
    const d = await doc(tp);
    expect(d).toMatchObject({ status: 'effective', reviewDue: '2027-11-01', lock: { isLocked: true } });
    expect(d.current).toMatchObject({ number: 1, effectiveFrom: '2026-11-01', approvalId: a.id });
    expect(d.versions).toEqual([expect.objectContaining({ number: 1, kind: 'major', effectiveFrom: '2026-11-01' })]);
    const f = t.fake.fileState(fileId);
    expect(f.name).toBe('QT-MKT-01 v1 Quy trình viết bài SEO');
    expect(f.text).toContain('Phiên bản: v1 | Trạng thái: Hiệu lực');
    expect(f.text).toContain('Ngày hiệu lực: 2026-11-01');
    expect(f.contentRestriction?.readOnly).toBe(true);
    expect(t.fake.fileState(d.current.pdfFileId).contentRestriction?.readOnly).toBe(true);
    expect(t.fake.world.outbox.some((m) => m.to.includes('11-mkt-dong-gop@vcprosperous.com'))).toBe(true);
    expect((await nv.get('/notifications')).body.items.some((n: any) => n.type === 'document_issued')).toBe(true);
    expect(d.allowedActions).toEqual(expect.arrayContaining(['revise', 'withdraw', 'review', 'integrity', 'relock']));
    expect((await tp.post(`/documents/${docId}/issue`, { effectiveFrom: '2026-11-01' })).status).toBe(409);
  });

  it('mở theo mã → bản hiệu lực; mã không có → 404', async () => {
    const r = await nvKd.get('/documents/by-code/QT-MKT-01');
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(docId);
    expect((await nv.get('/documents/by-code/QT-MKT-99')).status).toBe(404);
  });

  it('kiểm khoá/phiên bản; sửa nhỏ mở khoá có hạn rồi khoá lại', async () => {
    const i = await tp.get(`/documents/${docId}/integrity`);
    expect(i.status).toBe(200);
    expect(i.body).toMatchObject({ isLocked: true, isRevisionMatching: true, isHashMatching: true });
    expect((await nv.get(`/documents/${docId}/integrity`)).status).toBe(403);
    expect((await tp.post(`/documents/${docId}/revise`, { kind: 'minor' })).status).toBe(400);
    const m = await tp.post(`/documents/${docId}/revise`, { kind: 'minor', reason: 'Sửa lỗi chính tả', unlockDays: 2 });
    expect(m.status).toBe(200);
    expect(m.body.status).toBe('effective');
    expect(m.body.lock.isLocked).toBe(false);
    expect(m.body.current.number).toBe(1);
    expect(m.body.versions.at(-1)).toMatchObject({ number: 1, kind: 'minor', changeNote: 'Sửa lỗi chính tả' });
    expect(t.fake.fileState(fileId).versionRows.at(-1)![2]).toBe('Sửa nhỏ: Sửa lỗi chính tả');
    expect((await tp.get(`/documents/${docId}/integrity`)).body.isLocked).toBe(false);
    expect((await nv.post(`/documents/${docId}/relock`)).status).toBe(403);
    const l = await r3.post(`/documents/${docId}/relock`);
    expect(l.status).toBe(200);
    expect(l.body.lock.isLocked).toBe(true);
    t.fake.failNext = 'drive.setLock';
    expect((await r3.post(`/documents/${docId}/relock`)).status).toBe(502);
  });

  it('rà soát định kỳ ghi kết quả và kỳ mới', async () => {
    expect((await nv.post(`/documents/${docId}/review`, { result: 'keep' })).status).toBe(403);
    expect((await tp.post(`/documents/${docId}/review`, { result: 'drop' })).status).toBe(400);
    const r = await tp.post(`/documents/${docId}/review`, { result: 'keep', note: 'Còn phù hợp' });
    expect(r.status).toBe(200);
    expect(r.body.reviewDue > '2026-11-01').toBe(true);
  });

  it('sửa lớn: bản sao v2 đang soạn, v1 vẫn hiệu lực; ban hành v2 → v1 thành [HẾT HIỆU LỰC]', async () => {
    const r = await tp.post(`/documents/${docId}/revise`, { kind: 'major', reason: 'Thêm kênh TikTok' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('revising');
    expect(r.body.current.number).toBe(1);
    expect(r.body.fileId).not.toBe(fileId);
    const v2 = r.body.fileId;
    expect(t.fake.fileState(v2).text).toContain('Phiên bản: v2 (nháp) | Trạng thái: Nháp – chưa hiệu lực');
    expect((await nvKd.get('/documents/by-code/QT-MKT-01')).body.current.fileId).toBe(fileId);
    expect((await tp.post(`/documents/${docId}/revise`, { kind: 'major', reason: 'x' })).status).toBe(409);
    const s = await tp.post(`/documents/${docId}/submit`, {});
    expect(s.status).toBe(200);
    const a = (await inboxOf(gdkKd))[0];
    await gdkKd.post(`/approvals/${a.id}/decide`, { result: 'approve' });
    await tp.post(`/documents/${docId}/issue`, { effectiveFrom: '2026-12-01' });
    await t.drain();
    const d = await doc(tp);
    expect(d.status).toBe('effective');
    expect(d.current).toMatchObject({ number: 2, fileId: v2, effectiveFrom: '2026-12-01' });
    expect(d.versions.filter((v: any) => v.kind === 'major').map((v: any) => v.number)).toEqual([1, 2]);
    expect(t.fake.fileState(v2).text).toContain('Phiên bản: v2 | Trạng thái: Hiệu lực');
    expect(t.fake.fileState(fileId).name).toBe('[HẾT HIỆU LỰC] QT-MKT-01 v1 Quy trình viết bài SEO');
  });

  it('trình huỷ bỏ → phiếu document_withdrawal; duyệt xong → withdrawn, [HẾT HIỆU LỰC], chuyển 99 (BR-08)', async () => {
    expect((await nv.post(`/documents/${docId}/withdraw`, { reason: 'x' })).status).toBe(403);
    expect((await tp.post(`/documents/${docId}/withdraw`, { reason: 'x', replacedById: '6712f0c2a1b2c3d4e5f60718' })).status).toBe(404);
    const w = await tp.post(`/documents/${docId}/withdraw`, { reason: 'Gộp vào quy trình chung' });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ objectType: 'document_withdrawal', objectId: docId, approverId: t.ids.users['gdk.kd'] });
    expect((await tp.post(`/documents/${docId}/withdraw`, { reason: 'lặp' })).status).toBe(409);
    await gdkKd.post(`/approvals/${w.body.id}/decide`, { result: 'approve' });
    await t.drain();
    const d = await doc(tp);
    expect(d.status).toBe('withdrawn');
    const f = t.fake.fileState(d.current.fileId);
    expect(f.name.startsWith('[HẾT HIỆU LỰC] ')).toBe(true);
    const archive = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['MKT:00/99']) }).lean<any>();
    expect(f.parents).toEqual([archive.googleId]);
    expect((await nv.get('/documents/by-code/QT-MKT-01')).status).toBe(404);
    // mã đã huỷ không cấp lại (BR-01)
    const n = await tp.post('/documents', { type: 'QT', level: 'DEPT', title: 'Quy trình mới', departmentId: t.ids.depts.MKT.id, drafterId: t.ids.users['nv.mkt'] });
    expect((await r3.post(`/documents/${n.body.id}/assign-code`)).body.code).toBe('QT-MKT-02');
  });

  it('QĐ cấp VCPV: người kiểm tra (GĐ khối VHNB) xác nhận trước, TGĐ duyệt (BR-03, BR-04); R3 ban hành', async () => {
    const r = await r3.post('/documents', { type: 'QD', level: 'VCPV', title: 'Quy định quản lý tài liệu', departmentId: t.ids.depts.VCPV.id, drafterId: t.ids.users.hcns });
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect(r.body.securityLevel).toBe('internal');
    expect((await r3.post(`/documents/${id}/assign-code`)).body.code).toBe('QĐ-VCPV-01');
    await r3.post(`/documents/${id}/create-draft`);
    await t.drain();
    // người soạn = người trình = hcns; người duyệt là TGĐ nên không vi phạm BR-05
    const s = await r3.post(`/documents/${id}/submit`, {});
    expect(s.status).toBe(200);
    expect(s.body.checkerId).toBe(t.ids.users['gdk.vhnb']);
    const a = (await inboxOf(gdkVhnb))[0];
    expect(a.allowedActions).toEqual(['check']);
    expect((await inboxOf(tgd)).length).toBe(0);
    const early = await tgd.post(`/approvals/${a.id}/decide`, { result: 'approve' });
    expect(early.status).toBe(422);
    expect(early.body.error.rule).toBe('BR-04');
    const c = await gdkVhnb.post(`/approvals/${a.id}/check`, { comment: 'Đã kiểm tra' });
    expect(c.status).toBe(200);
    expect(c.body.checkedAt).toBeTruthy();
    expect((await gdkVhnb.post(`/approvals/${a.id}/check`, {})).status).toBe(409);
    expect((await inboxOf(tgd))[0].allowedActions).toEqual(['decide']);
    await tgd.post(`/approvals/${a.id}/decide`, { result: 'approve' });
    expect((await tp.post(`/documents/${id}/issue`, { effectiveFrom: '2026-11-01' })).status).toBe(403);
    const iss = await r3.post(`/documents/${id}/issue`, { effectiveFrom: '2026-11-01' });
    expect(iss.status).toBe(202);
    await t.drain();
    expect((await nvKd.get('/documents/by-code/Q%C4%90-VCPV-01')).body.status).toBe('effective');
  });

  it('BR-05: trưởng phòng soạn HD cấp phòng thì không tự duyệt được', async () => {
    const r = await tp.post('/documents', { type: 'HD', level: 'DEPT', title: 'Hướng dẫn đặt tên ảnh', departmentId: t.ids.depts.MKT.id, drafterId: t.ids.users['tp.mkt'] });
    await r3.post(`/documents/${r.body.id}/assign-code`);
    await tp.post(`/documents/${r.body.id}/create-draft`);
    await t.drain();
    const s = await tp.post(`/documents/${r.body.id}/submit`, {});
    expect(s.status).toBe(422);
    expect(s.body.error.rule).toBe('BR-05');
    expect((await tp.get(`/approvals/preview?objectType=document&objectId=${r.body.id}`)).body.approver.email).toBe(t.ids.emails['tp.mkt']);
  });

  it('tài liệu ở drive Mật: danh mục chỉ hiện mã và tên; chi tiết → 404; tìm theo mã → 404', async () => {
    const r = await r3.post('/documents', { type: 'HD', level: 'DEPT', title: 'Hướng dẫn chấm công', departmentId: t.ids.depts.HCNS.id, drafterId: t.ids.users.hcns });
    expect(r.body.securityLevel).toBe('confidential');
    await r3.post(`/documents/${r.body.id}/assign-code`);
    const list = await nv.get('/documents?q=cham%20cong');
    expect(list.body.items).toHaveLength(1);
    const item = list.body.items[0];
    expect(item).toMatchObject({ isRestricted: true, code: 'HD-HCNS-01', title: 'Hướng dẫn chấm công', allowedActions: [] });
    expect(item.drafterId).toBeUndefined();
    expect((await nv.get(`/documents/${r.body.id}`)).status).toBe(404);
    expect((await r3.get(`/documents/${r.body.id}`)).body.isRestricted).toBe(false);
    expect((await gdkVhnb.get(`/documents?departmentId=${t.ids.depts.HCNS.id}`)).body.items[0].isRestricted).toBe(false);
  });

  it('danh mục: lọc, sắp xếp, phân trang; tạo file nháp loại thiếu BM khung → 422', async () => {
    const r = await nv.get('/documents?type=BM&level=VCPV&sort=code&limit=2&page=1');
    expect(r.body).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(r.body.items.map((d: any) => d.code)).toEqual(['BM-VCPV-02', 'BM-VCPV-03']);
    const due = await nv.get('/documents?reviewDueBefore=2027-10-30&status=effective');
    expect(due.body.items.every((d: any) => d.reviewDue <= '2027-10-30')).toBe(true);
    await t.db.m.Document.updateOne({ companyId: new Types.ObjectId(t.ids.companyId), code: 'BM-VCPV-04' }, { $set: { status: 'withdrawn' } });
    const h = await tp.post('/documents', { type: 'HD', level: 'DEPT', title: 'HD thiếu khung', departmentId: t.ids.depts.MKT.id, drafterId: t.ids.users['nv.mkt'] });
    await r3.post(`/documents/${h.body.id}/assign-code`);
    expect((await nv.post(`/documents/${h.body.id}/create-draft`)).status).toBe(422);
  });

  it('xuất Danh mục tài liệu VCPV (R3)', async () => {
    expect((await nv.post('/documents/catalog/export')).status).toBe(403);
    const r = await r3.post('/documents/catalog/export');
    expect(r.status).toBe(202);
    await t.drain();
    const job = await r3.get(`/jobs/${r.body.jobId}`);
    const rows = t.fake.fileState(job.body.result.fileId).rows!;
    expect(rows[0][0]).toBe('Mã');
    expect(rows.some((x) => x[0] === 'QĐ-VCPV-01')).toBe(true);
  });

  it('tài liệu bên ngoài: nhập (R6 trở lên), đánh dấu bị thay thế → trả tài liệu đang dẫn chiếu', async () => {
    const xem = await t.login('xem.mkt');
    const body = { source: 'Quốc hội', number: '91/2025/QH15', issuedAt: '2025-06-26', title: 'Luật Bảo vệ dữ liệu cá nhân', departmentId: t.ids.depts.MKT.id, url: 'https://example.vn/luat.pdf' };
    expect((await xem.post('/external-documents', body)).status).toBe(403);
    expect((await nv.post('/external-documents', { ...body, fileId: 'abc' })).status).toBe(400);
    expect((await nv.post('/external-documents', { ...body, url: 'http://khong-an-toan.vn/a.pdf' })).status).toBe(400);
    const r = await nv.post('/external-documents', body);
    expect(r.status).toBe(202);
    await t.drain();
    const job = await nv.get(`/jobs/${r.body.jobId}`);
    expect(job.body.status).toBe('done');
    const id = job.body.result.objectId;
    const d = await doc(nv, id);
    expect(d).toMatchObject({ type: 'EXT', status: 'effective', external: { source: 'Quốc hội', number: '91/2025/QH15', isSuperseded: false } });
    expect(d.code).toBeUndefined();
    const ref = await t.db.m.Document.findOne({ companyId: new Types.ObjectId(t.ids.companyId), code: 'QĐ-VCPV-01' }).lean<any>();
    await t.db.m.Document.updateOne({ _id: ref._id, companyId: ref.companyId }, { $set: { relatedIds: [new Types.ObjectId(id)] } });
    const p = await nv.patch(`/external-documents/${id}`, { isSuperseded: true });
    expect(p.status).toBe(200);
    expect(p.body.external.isSuperseded).toBe(true);
    expect(p.body.relatedIds).toEqual([String(ref._id)]);
    expect((await xem.patch(`/external-documents/${id}`, { isSuperseded: false })).status).toBe(403);
    expect((await nv.patch(`/external-documents/${docId}`, { isSuperseded: true })).status).toBe(404);
  });

  describe('Bảng uỷ quyền khối (R2)', () => {
    let id: string;
    it('GET/POST/PATCH; vượt hạn mức hoặc giao ra ngoài khối → 422 BR-24', async () => {
      const kd = t.ids.blocks.KD;
      expect((await nv.get('/delegations')).status).toBe(403);
      expect((await gdkVhnb.get(`/delegations?blockId=${kd}`)).status).toBe(403);
      const base = { blockId: kd, recordTypeId: t.ids.recordTypes.seoReport, task: 'Duyệt báo cáo SEO tháng', limitAmount: 50_000_000, delegateId: t.ids.users['tp.mkt'], from: '2026-11-01', to: '2027-10-31' };
      const hcnsType = await t.db.m.RecordType.create({ companyId: new Types.ObjectId(t.ids.companyId), departmentId: new Types.ObjectId(t.ids.depts.HCNS.id), name: 'Hồ sơ tuyển dụng', kind: 'BB', retentionStatus: 'approved' });
      expect((await gdkKd.post('/delegations', { ...base, recordTypeId: String(hcnsType._id) })).body.error.rule).toBe('BR-24');
      expect((await gdkKd.post('/delegations', { ...base, recordTypeId: undefined })).status).toBe(400);
      expect((await gdkKd.post('/delegations', { ...base, limitAmount: 9_000_000_000 })).body.error.rule).toBe('BR-24');
      expect((await gdkKd.post('/delegations', { ...base, delegateId: t.ids.users.hcns })).status).toBe(422);
      expect((await gdkKd.post('/delegations', { ...base, isLegalSignature: true })).body.error.rule).toBe('BR-24');
      expect((await gdkKd.post('/delegations', { ...base, to: '2026-01-01' })).status).toBe(400);
      expect((await gdkVhnb.post('/delegations', base)).status).toBe(403);
      const c = await gdkKd.post('/delegations', base);
      expect(c.status).toBe(201);
      id = c.body.id;
      expect((await gdkKd.get('/delegations')).body.items).toHaveLength(1);
      const u = await gdkKd.patch(`/delegations/${id}`, { ...base, limitAmount: 80_000_000, to: undefined });
      expect(u.status).toBe(200);
      expect(u.body.limitAmount).toBe(80_000_000);
      expect(u.body.to).toBeUndefined();
      expect(u.body).toMatchObject({ recordTypeId: t.ids.recordTypes.seoReport, isLegalSignature: false, allowedActions: ['update'] });
      expect(u.body.people[t.ids.users['tp.mkt']].name).toBe('Trưởng phòng MKT (mẫu)');
      expect((await gdkKd.patch(`/delegations/${id}`, { ...base, limitAmount: 9e12 })).status).toBe(422);
      expect((await gdkKd.patch('/delegations/6712f0c2a1b2c3d4e5f60718', base)).status).toBe(404);
      expect((await gdkKd.patch(`/delegations/${id}`, { task: 'thiếu trường' })).status).toBe(400);
      expect((await gdkKd.patch(`/delegations/${id}`, { ...base, isLegalSignature: true })).status).toBe(422);
    });
  });

  it('GET /approvals: lọc trạng thái, loại; all = phiếu liên quan', async () => {
    const all = await gdkKd.get('/approvals?box=all&objectType=document&status=approved');
    expect(all.status).toBe(200);
    expect(all.body.items.every((a: any) => a.status === 'approved' && a.objectType === 'document')).toBe(true);
    expect((await nvKd.get('/approvals?box=all')).body.total).toBe(0);
    expect((await nv.get('/approvals?box=lung-tung')).status).toBe(400);
    expect((await tp.get('/approvals/preview?objectType=document&objectId=6712f0c2a1b2c3d4e5f60718')).status).toBe(404);
  });
});
