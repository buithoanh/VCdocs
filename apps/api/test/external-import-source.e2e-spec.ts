import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { dateVN } from '../src/common/util';

/**
 * Audit 3/12: fileId/templateId do người gọi đưa vào được service account chép
 * mà không gắn với đối tượng người gọi được xem, không kiểm quyền drive đích.
 */
describe('Nhập tài liệu ngoài và biểu mẫu hồ sơ chỉ chép file người gọi được xem', () => {
  let t: TestApp;
  let nv: Client, tp: Client;
  let secretFileId: string;
  const SECRET = 'Nội dung mật của Ban Điều hành';
  const extBody = (departmentId: string, fileId: string) => ({ source: 'Bộ Tài chính', number: '01/2026/TT-BTC', issuedAt: '2026-01-15', title: 'Thông tư thử', departmentId, fileId });

  beforeAll(async () => {
    t = await createTestApp();
    nv = await t.login('nv.mkt');
    tp = await t.login('tp.mkt');
    // File F nằm trên drive Mật 01 BĐH; nv.mkt và tp.mkt không là thành viên
    const f = await t.fake.drive.createEmptyDoc({ parentGoogleId: t.ids.depts.BDH.driveId, name: 'Biên bản họp BĐH' });
    t.fake.world.files[f.fileId].text = SECRET;
    secretFileId = f.fileId;
  });
  afterAll(async () => t.close());

  const extDocsOnDrive = (driveId: string) => t.db.m.Document.find({ companyId: new Types.ObjectId(t.ids.companyId), type: 'EXT', driveId }).lean<any[]>();

  it('R6 writer phòng MKT không chép được file của drive Mật vào phòng mình', async () => {
    const r = await nv.post('/external-documents', extBody(t.ids.depts.MKT.id, secretFileId));
    expect(r.status).toBe(400);
    expect(r.body.error.details).toEqual([{ field: 'fileId', issue: 'not_found' }]);
    await t.drain();
    expect(await extDocsOnDrive(t.ids.depts.MKT.driveId)).toHaveLength(0);
  });

  it('R6 không phải thành viên drive Mật không ghi được tài liệu ngoài vào phòng đó', async () => {
    const r = await nv.post('/external-documents', extBody(t.ids.depts.BDH.id, secretFileId));
    expect(r.status).toBe(403);
    await t.drain();
    expect(await extDocsOnDrive(t.ids.depts.BDH.driveId)).toHaveLength(0);
  });

  it('vẫn nhập được file trên drive người gọi xem được vào phòng mình có quyền Đóng góp', async () => {
    const f = await t.fake.drive.createEmptyDoc({ parentGoogleId: t.ids.depts.MKT.driveId, name: 'Thông tư tải về' });
    t.fake.world.files[f.fileId].text = 'Thông tư công khai';
    const r = await nv.post('/external-documents', extBody(t.ids.depts.MKT.id, f.fileId));
    expect(r.status).toBe(202);
    await t.drain();
    const job = await nv.get(`/jobs/${r.body.jobId}`);
    expect(job.body.status).toBe('done');
    const d = await t.db.m.Document.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(job.body.result.objectId) }).lean<any>();
    expect(d).toMatchObject({ type: 'EXT', driveId: t.ids.depts.MKT.driveId });
    expect(t.fake.fileState(d.fileId).text).toBe('Thông tư công khai');
  });

  it('Audit 4/12: url trỏ vào địa chỉ nội bộ bị từ chối ngay khi nhận, không tạo job', async () => {
    const { fileId: _f, ...base } = extBody(t.ids.depts.MKT.id, '');
    for (const url of ['https://127.0.0.1/a.pdf', 'https://api:4000/v1/me', 'https://169.254.169.254/latest/meta-data/', 'https://[::ffff:10.0.0.1]/a.pdf']) {
      const r = await nv.post('/external-documents', { ...base, url });
      expect(r.status).toBe(400);
      expect(r.body.error.details).toEqual([{ field: 'url', issue: 'internal_address' }]);
    }
    expect(await t.db.m.Job.countDocuments({ companyId: new Types.ObjectId(t.ids.companyId), type: 'external_document.import', 'payload.url': /127\.0\.0\.1|api:4000|169\.254|ffff/ })).toBe(0);
  });

  it('trưởng phòng MKT không đặt được templateId là file của drive Mật', async () => {
    const rtId = t.ids.recordTypes.seoPlan;
    const p = await tp.patch(`/record-types/${rtId}`, { templateId: secretFileId });
    expect(p.status).toBe(400);
    expect(p.body.error.details).toEqual([{ field: 'templateId', issue: 'not_found' }]);
    const c = await tp.post('/record-types', { departmentId: t.ids.depts.MKT.id, name: 'Loại hồ sơ thử biểu mẫu', kind: 'KH', retentionYears: 1, templateId: secretFileId });
    expect(c.status).toBe(400);
    // Không có loại hồ sơ nào trỏ tới F nên lập hồ sơ không chép được nội dung mật
    const rt = await t.db.m.RecordType.findOne({ companyId: new Types.ObjectId(t.ids.companyId), templateId: secretFileId }).lean();
    expect(rt).toBeNull();
    const r = await (await t.login('nv.mkt')).post('/records', { recordTypeId: rtId, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch thử biểu mẫu', workMonth: dateVN().slice(0, 7) });
    expect(r.status).toBe(202);
    await t.drain();
    const job = await nv.get(`/jobs/${r.body.jobId}`);
    expect(job.body.status).toBe('done');
    const rec = await t.db.m.Record.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(job.body.result.objectId) }).lean<any>();
    expect(t.fake.fileState(rec.fileId).text ?? '').not.toContain(SECRET);
  });

  it('templateId là bản hiệu lực của BM đã đăng ký trên drive xem được thì lưu được', async () => {
    const bm = await t.db.m.Document.findOne({ companyId: new Types.ObjectId(t.ids.companyId), code: 'BM-VCPV-04' }).lean<any>();
    const p = await tp.patch(`/record-types/${t.ids.recordTypes.seoReport}`, { templateId: bm.current.fileId });
    expect(p.status).toBe(200);
    expect(p.body.templateId).toBe(bm.current.fileId);
  });
});
