import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { dateVN } from '../src/common/util';

// Audit 11/12 (legacy/records-claim:creator-check-uses-lastModifyingUser):
// người sửa cuối không phải người tạo; chuyển file ra drive khác cần trưởng phòng nguồn hoặc Quản lý drive nguồn.
describe('Đăng ký ngược: người tạo file và quyền trên drive nguồn', () => {
  let t: TestApp;
  let nv: Client, leader: Client, hcns: Client;
  let hcnsRt: string;
  const month = dateVN().slice(0, 7);
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const folderOf = async (key: string) => t.db.m.Folder.findOne({ companyId: cid(), _id: new Types.ObjectId(t.ids.folders[key]) }).lean<any>();
  const recordOf = async (fileId: string) => t.db.m.Record.findOne({ companyId: cid(), fileId }).lean<any>();
  const seoBody = (fileId: string) => ({ fileId, recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch SEO đăng ký ngược', workMonth: month });
  /** File tạo thẳng trên Drive: người tạo `creator`, người sửa cuối `editor` */
  const loose = async (folderKey: string, creator: string, editor?: string) => {
    const f = t.fake.createLooseFile({ parentGoogleId: (await folderOf(folderKey)).googleId, name: `file ${creator} ${editor ?? ''}`, createdByEmail: t.ids.emails[creator] });
    if (editor) t.fake.editFile(f.fileId, 'sửa thêm', t.ids.emails[editor]);
    return f;
  };

  beforeAll(async () => {
    t = await createTestApp();
    nv = await t.login('nv.mkt'); // Đóng góp drive MKT, chỉ xem drive VCPV chung
    leader = await t.login('leader.mkt'); // Quản lý nội dung drive MKT
    hcns = await t.login('hcns'); // trưởng phòng VCPV chung, Quản lý drive HCNS
    const f = await folderOf('HCNS:01');
    const rt = await t.db.m.RecordType.create({ companyId: cid(), departmentId: new Types.ObjectId(t.ids.depts.HCNS.id), name: 'Báo cáo nhân sự', kind: 'BC', folderId: f._id, retentionYears: 5, retentionStatus: 'approved', securityLevel: 'confidential' });
    hcnsRt = String(rt._id);
  }, 60000);
  afterAll(async () => t.close());

  it('người sửa cuối không phải người tạo: không chiếm được file của drive chung', async () => {
    const f = await loose('VCPV:01', 'hcns', 'nv.mkt');
    const before = [...t.fake.fileState(f.fileId).parents];
    const r = await nv.post('/records/claim', seoBody(f.fileId));
    expect(r.status).toBe(403);
    await t.drain();
    expect(t.fake.fileState(f.fileId).parents).toEqual(before);
    expect(t.fake.fileState(f.fileId).driveId).toBe(t.ids.depts.VCPV.driveId);
    expect(await recordOf(f.fileId)).toBeNull();
  });

  it('người tạo thật nhưng chỉ xem drive nguồn: không chuyển được file sang drive khác', async () => {
    const f = await loose('VCPV:01', 'nv.mkt');
    const before = [...t.fake.fileState(f.fileId).parents];
    expect((await nv.post('/records/claim', seoBody(f.fileId))).status).toBe(403);
    await t.drain();
    expect(t.fake.fileState(f.fileId).parents).toEqual(before);
    expect(await recordOf(f.fileId)).toBeNull();
  });

  it('trưởng phòng nguồn vẫn chuyển được file sang drive khác', async () => {
    const f = await loose('VCPV:01', 'nv.mkt', 'nv.mkt');
    const r = await hcns.post('/records/claim', { fileId: f.fileId, recordTypeId: hcnsRt, kind: 'BC', functionCode: 'HCNS', subject: 'Báo cáo nhân sự tháng', workMonth: month });
    expect(r.status).toBe(202);
    await t.drain();
    expect((await hcns.get(`/jobs/${r.body.jobId}`)).body.status).toBe('done');
    const rec = await recordOf(f.fileId);
    expect(String(rec.createdBy)).toBe(t.ids.users.hcns);
    expect(rec.driveId).toBe(t.ids.depts.HCNS.driveId);
    expect(t.fake.fileState(f.fileId).parents).not.toContain((await folderOf('VCPV:01')).googleId);
  });

  it('cùng drive: người tạo thật (Đóng góp) đăng ký được dù người khác sửa sau; người sửa cuối thì không', async () => {
    const f = await loose('MKT:10', 'nv.mkt', 'leader.mkt');
    expect((await leader.post('/records/claim', seoBody(f.fileId))).status).toBe(403);
    const r = await nv.post('/records/claim', seoBody(f.fileId));
    expect(r.status).toBe(202);
    await t.drain();
    expect((await nv.get(`/jobs/${r.body.jobId}`)).body.status).toBe('done');
    expect(String((await recordOf(f.fileId)).createdBy)).toBe(t.ids.users['nv.mkt']);
  });
});
