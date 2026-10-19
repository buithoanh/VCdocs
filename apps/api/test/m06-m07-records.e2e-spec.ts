import { Types } from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import { createTestApp, TestApp, Client } from './support/app';
import { VAULT } from '../src/google/ports';
import { MemoryVault } from '../src/google/vault';
import { addDaysToDateStr, dateVN } from '../src/common/util';

describe('M06 Danh mục hồ sơ + M07 Hồ sơ', () => {
  let t: TestApp;
  let tp: Client, nv: Client, leader: Client, r3: Client, tgd: Client, ktt: Client, xem: Client, nvKd: Client;
  const month = dateVN().slice(0, 7);

  beforeAll(async () => {
    t = await createTestApp();
    tp = await t.login('tp.mkt');
    nv = await t.login('nv.mkt');
    leader = await t.login('leader.mkt');
    r3 = await t.login('hcns');
    tgd = await t.login('tgd');
    ktt = await t.login('ktt');
    xem = await t.login('xem.mkt');
    nvKd = await t.login('nv.kd');
  });
  afterAll(async () => t.close());

  const rtBody = () => ({
    departmentId: t.ids.depts.MKT.id,
    name: 'Biên bản nghiệm thu nội dung',
    kind: 'BB',
    namingRule: '[Mã] BB Nội dung – YYYY-MM-DD',
    folderId: t.ids.folders['MKT:10/01'],
    keeperTitle: 'Leader SEO',
    retentionYears: 3,
    retentionBasis: 'QĐ-VCPV-01',
    disposalMethod: 'Xoá trên Drive',
    securityLevel: 'department',
    requiresApproval: true,
  });

  describe('M06', () => {
    let rtId: string;
    it('khai báo loại hồ sơ (R4 phòng mình) → retentionStatus draft; trùng tên → 409', async () => {
      expect((await nv.post('/record-types', rtBody())).status).toBe(403);
      expect((await (await t.login('tp.kd')).post('/record-types', rtBody())).status).toBe(403);
      expect((await tp.post('/record-types', { ...rtBody(), folderId: t.ids.folders['KD:01'] })).status).toBe(400);
      expect((await tp.post('/record-types', { ...rtBody(), retentionYears: -1 })).status).toBe(400);
      const r = await tp.post('/record-types', rtBody());
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ retentionStatus: 'draft', allowedActions: ['update', 'submit-retention'] });
      rtId = r.body.id;
      expect((await tp.post('/record-types', rtBody())).status).toBe(409);
      const list = await nv.get(`/record-types?departmentId=${t.ids.depts.MKT.id}`);
      expect(list.body.items.map((x: any) => x.name)).toContain('Biên bản nghiệm thu nội dung');
      expect((await nv.get(`/record-types/${rtId}`)).body.allowedActions).toEqual([]);
      expect((await nv.get('/record-types/6712f0c2a1b2c3d4e5f60718')).status).toBe(404);
    });

    it('chưa duyệt thời hạn → chưa lập được hồ sơ (BR-20)', async () => {
      const r = await nv.post('/records', { recordTypeId: rtId, kind: 'BB', functionCode: 'SEO-PTDA', subject: 'Nghiệm thu bài tháng', workMonth: month });
      expect(r.status).toBe(422);
      expect(r.body.error.rule).toBe('BR-20');
    });

    it('trình thời hạn → phiếu retention cho BĐH; duyệt → approved; đổi thời hạn → về draft', async () => {
      expect((await nv.post(`/record-types/${rtId}/submit-retention`)).status).toBe(403);
      const a = await tp.post(`/record-types/${rtId}/submit-retention`);
      expect(a.status).toBe(201);
      expect(a.body).toMatchObject({ objectType: 'retention', approverId: t.ids.users.tgd, status: 'pending' });
      expect((await tp.post(`/record-types/${rtId}/submit-retention`)).status).toBe(409);
      expect((await nv.get(`/record-types/${rtId}`)).body.retentionStatus).toBe('submitted');
      await tgd.post(`/approvals/${a.body.id}/decide`, { result: 'approve' });
      expect((await nv.get(`/record-types/${rtId}`)).body.retentionStatus).toBe('approved');
      const p = await tp.patch(`/record-types/${rtId}`, { retentionYears: 5 });
      expect(p.status).toBe(200);
      expect(p.body.retentionStatus).toBe('draft');
      const p2 = await tp.patch(`/record-types/${rtId}`, { example: 'SEO-PTDA BB Nghiệm thu – 2026-10-19' });
      expect(p2.body.retentionStatus).toBe('draft');
      expect((await nv.patch(`/record-types/${rtId}`, { example: 'x' })).status).toBe(403);
      // trường không có trong RecordTypePatch bị loại (hợp đồng mục 7), loại hồ sơ giữ nguyên
      const k = await tp.patch(`/record-types/${rtId}`, { kind: 'KH' });
      expect(k.status).toBe(200);
      expect(k.body.kind).toBe('BB');
      expect((await tp.patch(`/record-types/${rtId}`, { retentionYears: 'năm' })).status).toBe(400);
      const again = await tp.post(`/record-types/${rtId}/submit-retention`);
      await tgd.post(`/approvals/${again.body.id}/decide`, { result: 'approve' });
    });

    it('thời hạn chứng từ kế toán: kế toán trưởng (R8) xác nhận trước khi BĐH duyệt', async () => {
      const f = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['TCKT:01']) }).lean<any>();
      const r = await ktt.post('/record-types', { ...rtBody(), departmentId: t.ids.depts.TCKT.id, name: 'Chứng từ chi', kind: 'DX', folderId: String(f._id), retentionYears: 10, securityLevel: 'confidential' });
      expect(r.status).toBe(201);
      const a = await ktt.post(`/record-types/${r.body.id}/submit-retention`);
      expect(a.body.checkerId).toBe(t.ids.users.ktt);
      expect((await t.login('tgd')).email).toBeTruthy();
    });

    it('xuất Danh mục hồ sơ VCPV (R3)', async () => {
      expect((await nv.post('/record-types/catalog/export')).status).toBe(403);
      const r = await r3.post('/record-types/catalog/export');
      expect(r.status).toBe(202);
      await t.drain();
      const job = await r3.get(`/jobs/${r.body.jobId}`);
      const rows = t.fake.fileState(job.body.result.fileId).rows!;
      expect(rows[0][1]).toBe('Loại hồ sơ');
      expect(rows.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('M07', () => {
    let recId: string;
    let fileId: string;

    it('lập hồ sơ (R5, R6, R8) → 202 job; tên đúng mẫu, đúng thư mục tháng (BR-09, BR-10)', async () => {
      const body = { recordTypeId: t.ids.recordTypes.seoReport, kind: 'BC', functionCode: 'SEO-PTDA', subject: 'Báo cáo SEO tháng', workMonth: month };
      expect((await xem.post('/records', body)).status).toBe(403);
      expect((await nvKd.post('/records', body)).status).toBe(403);
      expect((await nv.post('/records', { ...body, functionCode: 'SEO-CHUA' })).body.error.rule).toBe('BR-12');
      expect((await nv.post('/records', { ...body, kind: 'KH' })).body.error.rule).toBe('BR-09');
      expect((await nv.post('/records', { ...body, workMonth: '2026-13' })).status).toBe(400);
      expect((await nv.post('/records', { ...body, createdDate: addDaysToDateStr(dateVN(), 2) })).body.error.rule).toBe('BR-28');
      const back = await nv.post('/records', { ...body, createdDate: addDaysToDateStr(dateVN(), -20) });
      expect(back.status).toBe(422);
      expect(back.body.error.rule).toBe('BR-28');
      const r = await nv.post('/records', body);
      expect(r.status).toBe(202);
      await t.drain();
      const job = await nv.get(`/jobs/${r.body.jobId}`);
      expect(job.body.status).toBe('done');
      recId = job.body.result.objectId;
      const rec = (await nv.get(`/records/${recId}`)).body;
      expect(rec).toMatchObject({ status: 'drafting', kind: 'BC', isApproved: false, workMonth: month });
      expect(rec.number).toMatch(/^HS-\d{4}-\d{6}$/);
      expect(rec.fileName).toBe(`SEO-PTDA BC Báo cáo SEO tháng – ${dateVN()}`);
      expect(rec.allowedActions).toEqual(['update', 'submit', 'scan', 'share']);
      expect(rec.people[t.ids.users['nv.mkt']].email).toBe(t.ids.emails['nv.mkt']);
      fileId = rec.fileId;
      const folder = (await nv.get(`/folders/${rec.folderId}`)).body;
      expect(folder).toMatchObject({ kind: 'month', name: month });
      expect(t.fake.fileState(fileId).parents).toEqual([folder.googleId]);
    });

    it('hồ sơ vận hành phải có số định danh, tên bắt đầu bằng số định danh', async () => {
      const ops = await tp.post('/record-types', { ...rtBody(), name: 'Hồ sơ xe', kind: 'OPS', requiresApproval: false });
      const a = await tp.post(`/record-types/${ops.body.id}/submit-retention`);
      await tgd.post(`/approvals/${a.body.id}/decide`, { result: 'approve' });
      const base = { recordTypeId: ops.body.id, kind: 'OPS', functionCode: 'SEO-PTDA', subject: 'Bảo dưỡng', workMonth: month };
      expect((await nv.post('/records', base)).body.error.rule).toBe('BR-09');
      const r = await nv.post('/records', { ...base, identifier: '30A-12345' });
      await t.drain();
      const job = await nv.get(`/jobs/${r.body.jobId}`);
      expect((await nv.get(`/records/${job.body.result.objectId}`)).body.fileName).toBe(`30A-12345 SEO-PTDA Bảo dưỡng – ${dateVN()}`);
      expect((await nv.get('/records?identifier=30a')).body.total).toBe(1);
    });

    it('danh sách theo quyền drive; lọc; nhân viên phòng khác không thấy', async () => {
      const mine = await nv.get(`/records?createdBy=${t.ids.users['nv.mkt']}&kind=BC&workMonth=${month}`);
      expect(mine.body.items.map((x: any) => x.id)).toContain(recId);
      expect(mine.body.items[0].finalized).toBeUndefined();
      expect((await nvKd.get('/records')).body.total).toBe(0);
      expect((await nvKd.get(`/records/${recId}`)).status).toBe(403);
      expect((await nv.get('/records?q=bao%20cao%20seo')).body.total).toBeGreaterThan(0);
      expect((await nv.get('/records?sort=bogus')).status).toBe(400);
    });

    it('sửa khi đang lập: đổi tên file trên Drive; người khác → 403', async () => {
      expect((await tp.patch(`/records/${recId}`, { subject: 'x' })).status).toBe(403);
      const r = await nv.patch(`/records/${recId}`, { subject: 'Báo cáo SEO tháng (bản 2)', paperLocation: 'Tủ A, ngăn 2' });
      expect(r.status).toBe(200);
      expect(r.body.fileName).toBe(`SEO-PTDA BC Báo cáo SEO tháng (bản 2) – ${dateVN()}`);
      expect(t.fake.fileState(fileId).name).toBe(r.body.fileName);
      expect(t.fake.fileState(fileId).description).toBe('Vị trí bản giấy: Tủ A, ngăn 2');
    });

    it('chốt khi loại cần duyệt mà chưa duyệt → 422', async () => {
      expect((await nv.post(`/records/${recId}/finalize`)).status).toBe(422);
    });

    it('trình (người lập) → phiếu cho trưởng phòng; khoá tạm; sửa khi đã trình → 409', async () => {
      expect((await tp.post(`/records/${recId}/submit`)).status).toBe(403);
      const prev = await nv.get(`/approvals/preview?objectType=record&objectId=${recId}`);
      expect(prev.body.approver.email).toBe(t.ids.emails['tp.mkt']);
      const r = await nv.post(`/records/${recId}/submit`);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('submitted');
      expect(t.fake.fileState(fileId).contentRestriction?.readOnly).toBe(true);
      expect((await nv.patch(`/records/${recId}`, { subject: 'y' })).status).toBe(409);
      expect((await nv.post(`/records/${recId}/submit`)).status).toBe(409);
      const a = (await tp.get('/approvals?box=inbox&objectType=record')).body.items[0];
      await tp.post(`/approvals/${a.id}/decide`, { result: 'approve' });
      const after = (await nv.get(`/records/${recId}`)).body;
      expect(after).toMatchObject({ status: 'drafting', isApproved: true });
      expect(after.allowedActions).toContain('finalize');
      expect(after.allowedActions).not.toContain('update');
    });

    it('uỷ quyền khối còn hiệu lực → người được uỷ quyền duyệt hồ sơ', async () => {
      const gdk = await t.login('gdk.kd');
      const d = await gdk.post('/delegations', { blockId: t.ids.blocks.KD, recordTypeId: t.ids.recordTypes.seoReport, task: 'Báo cáo SEO tháng', delegateId: t.ids.users['leader.mkt'], from: '2026-01-01' });
      expect(d.status).toBe(201);
      const r = await nv.post('/records', { recordTypeId: t.ids.recordTypes.seoReport, kind: 'BC', functionCode: 'SEO-VCE', subject: 'Báo cáo VCE', workMonth: month });
      await t.drain();
      const id = (await nv.get(`/jobs/${r.body.jobId}`)).body.result.objectId;
      expect((await nv.get(`/approvals/preview?objectType=record&objectId=${id}`)).body.approver.email).toBe(t.ids.emails['leader.mkt']);
    });

    it('chốt: PDF có dấu, khoá gốc và PDF, mã băm, kho riêng, hạn lưu (BR-13, BR-21, BR-29)', async () => {
      expect((await nvKd.post(`/records/${recId}/finalize`)).status).toBe(403);
      const r = await nv.post(`/records/${recId}/finalize`);
      expect(r.status).toBe(202);
      await t.drain();
      const job = await nv.get(`/jobs/${r.body.jobId}`);
      expect(job.body.status).toBe('done');
      const rec = (await nv.get(`/records/${recId}`)).body;
      expect(rec.status).toBe('finalized');
      expect(rec.finalized).toMatchObject({ by: t.ids.users['nv.mkt'] });
      expect(rec.finalized.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(rec.finalized.verifyCode).toMatch(/^[A-Z2-9]{10}$/);
      expect(rec.retention.years).toBe(5);
      expect(rec.retention.until).toBe(`${Number(month.slice(0, 4)) + 5}-${month.slice(5)}-${rec.retention.until.slice(8)}`);
      expect(rec.lock.isLocked).toBe(true);
      expect(t.fake.fileState(fileId).contentRestriction?.readOnly).toBe(true);
      expect(t.fake.fileState(fileId).downloadRestricted).toBe(true);
      const pdf = t.fake.fileState(rec.finalized.pdfFileId);
      expect(pdf.name).toBe(`${rec.fileName}.pdf`);
      expect(pdf.contentRestriction?.readOnly).toBe(true);
      const vault = t.app.get(VAULT) as MemoryVault;
      const stored = vault.items.get(rec.finalized.vaultKey)!;
      expect(stored).toBeTruthy();
      expect((await PDFDocument.load(stored)).getPageCount()).toBeGreaterThan(0);
      expect(rec.allowedActions).toEqual(expect.arrayContaining(['adjust']));
      expect((await tp.get(`/records/${recId}`)).body.allowedActions).toEqual(expect.arrayContaining(['hold', 'integrity']));
      expect(rec.allowedActions).not.toContain('update');
      expect((await nv.post(`/records/${recId}/finalize`)).status).toBe(409);
      expect((await nv.patch(`/records/${recId}`, { subject: 'sửa sau chốt' })).status).toBe(409);
    });

    it('tra mã QR (không cần quyền drive), kiểm toàn vẹn', async () => {
      const rec = (await nv.get(`/records/${recId}`)).body;
      const v = await nvKd.get(`/verify/${rec.finalized.verifyCode}`);
      expect(v.status).toBe(200);
      expect(v.body).toEqual({ number: rec.number, status: 'finalized', finalizedAt: rec.finalized.at, pdfSha256: rec.finalized.pdfSha256 });
      expect((await nvKd.get('/verify/KHONGCO123')).status).toBe(404);
      const i = await tp.get(`/records/${recId}/integrity`);
      expect(i.body).toMatchObject({ isLocked: true, isRevisionMatching: true, isHashMatching: true });
      expect((await nv.get(`/records/${recId}/integrity`)).status).toBe(403);
      t.fake.editFile(fileId);
      expect((await r3.get(`/records/${recId}/integrity`)).body.isRevisionMatching).toBe(false);
    });

    it('hồ sơ Điều chỉnh: hồ sơ gốc không đổi, hồ sơ mới có adjustsId', async () => {
      expect((await tp.post(`/records/${recId}/adjust`, { reason: 'Sai số liệu' })).status).toBe(403);
      const r = await nv.post(`/records/${recId}/adjust`, { reason: 'Sai số liệu traffic' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ adjustsId: recId, status: 'drafting' });
      expect(r.body.subject).toBe('Điều chỉnh Báo cáo SEO tháng (bản 2)');
      expect((await nv.get(`/records/${recId}`)).body).toMatchObject({ status: 'finalized', adjustedByIds: [r.body.id] });
      expect((await nv.post(`/records/${r.body.id}/adjust`, { reason: 'x' })).status).toBe(409);
    });

    it('giữ lại (BR-22) / bỏ giữ', async () => {
      expect((await nv.post(`/records/${recId}/hold`, { reasonType: 'dispute', reason: 'Tranh chấp' })).status).toBe(403);
      expect((await tp.post(`/records/${recId}/hold`, { reasonType: 'thich-thi-giu', reason: 'x' })).status).toBe(400);
      expect((await tp.post(`/records/${recId}/hold`, { reason: 'thiếu loại' })).status).toBe(400);
      const h = await tp.post(`/records/${recId}/hold`, { reasonType: 'dispute', reason: 'Đang tranh chấp hợp đồng quảng cáo' });
      expect(h.status).toBe(200);
      expect(h.body).toMatchObject({ status: 'held', hold: { isActive: true, reasonType: 'dispute' } });
      expect((await tgd.post(`/records/${recId}/hold`, { reasonType: 'inspection', reason: 'Thanh tra' })).status).toBe(409);
      const rl = await tgd.post(`/records/${recId}/release-hold`);
      expect(rl.status).toBe(200);
      expect(rl.body.status).toBe('finalized');
      expect((await tgd.post(`/records/${recId}/release-hold`)).status).toBe(409);
    });

    it('gắn bản scan: ghi vị trí giấy vào Mô tả file', async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const content = Buffer.from(await pdf.save());
      expect((await tp.upload(`/records/${recId}/scan`, { paperLocation: 'Tủ B' }, { name: 's.pdf', type: 'application/pdf', content })).status).toBe(403);
      expect((await nv.upload(`/records/${recId}/scan`, {}, { name: 's.pdf', type: 'application/pdf', content })).status).toBe(400);
      expect((await nv.upload(`/records/${recId}/scan`, { paperLocation: 'Tủ B' }, { name: 's.txt', type: 'text/plain', content: Buffer.from('x') })).status).toBe(400);
      const r = await nv.upload(`/records/${recId}/scan`, { paperLocation: 'Tủ B, kệ 3' }, { name: 'scan.pdf', type: 'application/pdf', content });
      expect(r.status).toBe(202);
      await t.drain();
      expect((await nv.get(`/jobs/${r.body.jobId}`)).body.status).toBe('done');
      const rec = (await nv.get(`/records/${recId}`)).body;
      expect(rec.paperLocation).toBe('Tủ B, kệ 3');
      expect(t.fake.fileState(fileId).description).toContain('Vị trí bản giấy: Tủ B, kệ 3');
    });

    it('tải file lên: .docx đổi sang Google, PDF giữ nguyên (BR-14)', async () => {
      const fields = { recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch tải lên', workMonth: month };
      const docx = await nv.upload('/records/upload', fields, { name: 'kh.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: Buffer.from('PK...') });
      expect(docx.status).toBe(202);
      const pdf = await nv.upload('/records/upload', { ...fields, subject: 'Hoá đơn' }, { name: 'hd.pdf', type: 'application/pdf', content: Buffer.from('%PDF-1.4 x') });
      expect(pdf.status).toBe(202);
      expect((await nv.upload('/records/upload', fields)).status).toBe(400);
      expect((await nv.upload('/records/upload', { ...fields, workMonth: 'abc' }, { name: 'a.pdf', type: 'application/pdf', content: Buffer.from('x') })).status).toBe(400);
      expect((await xem.upload('/records/upload', fields, { name: 'a.pdf', type: 'application/pdf', content: Buffer.from('x') })).status).toBe(403);
      await t.drain();
      const j1 = (await nv.get(`/jobs/${docx.body.jobId}`)).body;
      const j2 = (await nv.get(`/jobs/${pdf.body.jobId}`)).body;
      expect((await nv.get(`/records/${j1.result.objectId}`)).body.mimeType).toBe('application/vnd.google-apps.document');
      expect((await nv.get(`/records/${j2.result.objectId}`)).body.mimeType).toBe('application/pdf');
      // loại không cần duyệt → chốt luôn
      const f = await nv.post(`/records/${j2.result.objectId}/finalize`);
      expect(f.status).toBe(202);
      expect((await nv.post(`/records/${j1.result.objectId}/submit`)).status).toBe(422);
    });

    it('file tạo thẳng trên Drive: liệt kê chưa đăng ký, đăng ký ngược đổi tên đúng', async () => {
      const folder = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['MKT:10']) }).lean<any>();
      const loose = t.fake.createLooseFile({ parentGoogleId: folder.googleId, name: 'ke hoach seo thang moi', createdByEmail: t.ids.emails['nv.mkt'] });
      expect((await nv.get('/records/unregistered')).status).toBe(403);
      const u = await leader.get(`/records/unregistered?driveId=${t.ids.depts.MKT.driveId}`);
      expect(u.status).toBe(200);
      expect(u.body.items.map((x: any) => x.fileId)).toContain(loose.fileId);
      expect(u.body.items.map((x: any) => x.fileId)).not.toContain(fileId);
      expect((await leader.get(`/records/unregistered?driveId=${t.ids.depts.KD.driveId}`)).status).toBe(403);
      const body = { fileId: loose.fileId, recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch SEO tháng mới', workMonth: month };
      expect((await leader.post('/records/claim', body)).status).toBe(403);
      const c = await nv.post('/records/claim', body);
      expect(c.status).toBe(202);
      await t.drain();
      const job = (await nv.get(`/jobs/${c.body.jobId}`)).body;
      expect(job.status).toBe('done');
      const rec = (await nv.get(`/records/${job.result.objectId}`)).body;
      expect(rec).toMatchObject({ isClaimed: true, fileId: loose.fileId, fileName: `SEO-PTDA KH Kế hoạch SEO tháng mới – ${dateVN()}` });
      expect(t.fake.fileState(loose.fileId).name).toBe(rec.fileName);
      expect((await nv.post('/records/claim', body)).status).toBe(409);
      expect((await nv.post('/records/claim', { ...body, fileId: 'khong-co' })).status).toBe(400);
    });

    it('drive Mật: hồ sơ không lộ (404)', async () => {
      const f = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['TCKT:01']) }).lean<any>();
      const rt = await t.db.m.RecordType.create({ companyId: new Types.ObjectId(t.ids.companyId), departmentId: new Types.ObjectId(t.ids.depts.TCKT.id), name: 'Đề nghị thanh toán', kind: 'DX', folderId: f._id, retentionYears: 10, retentionStatus: 'approved', securityLevel: 'confidential' });
      // Trưởng phòng (R4) được lập hồ sơ (D1)
      expect((await tp.post('/records', { recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch do trưởng phòng lập', workMonth: month })).status).toBe(202);
      await t.drain();
      const c = await ktt.post('/records', { recordTypeId: String(rt._id), kind: 'DX', functionCode: 'KD', subject: 'Đề nghị thanh toán quảng cáo', workMonth: month });
      expect(c.status).toBe(202);
      await t.drain();
      const id = (await ktt.get(`/jobs/${c.body.jobId}`)).body.result.objectId;
      expect((await nv.get(`/records/${id}`)).status).toBe(404);
      expect((await nv.get('/records?q=thanh%20toan')).body.total).toBe(0);
      expect((await ktt.get(`/records/${id}`)).status).toBe(200);
      expect((await r3.get(`/records/${id}/integrity`)).status).toBe(404);
    });
  });
});
