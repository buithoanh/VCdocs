import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { dateVN } from '../src/common/util';

// Audit 10/12 (legacy/approvals-load:R3-bypass-confidential-drive):
// R3 không liên quan, không là thành viên drive Mật → phiếu duyệt của drive đó trả 404 như hợp đồng (openapi.yaml dòng 28).
describe('Phiếu duyệt ở drive Mật với R3 ngoài phòng', () => {
  let t: TestApp;
  let r3: Client, ktt: Client, gdk: Client, nvKd: Client;
  let secretId: string;
  const EMAIL = 'kiemtoan-audit10@audit.vn';
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const q = (id: string) => ({ companyId: cid(), _id: new Types.ObjectId(id) });
  const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

  /** Bản sao phiếu mật đặt sang drive khác, để so với cùng nội dung phiếu */
  const cloneOn = async (dept: string) => {
    const src = await t.db.m.Approval.findOne(q(secretId)).lean<any>();
    const { _id, ...rest } = src;
    const row = await t.db.m.Approval.create({ ...rest, driveId: t.ids.depts[dept].driveId, reminders: [], submittedAt: new Date(Date.now() - 48 * 3600_000) });
    return String(row._id);
  };

  beforeAll(async () => {
    t = await createTestApp();
    r3 = await t.login('hcns'); // R3, thành viên HCNS, không thuộc TC – KT
    ktt = await t.login('ktt');
    gdk = await t.login('gdk.vhnb');
    nvKd = await t.login('nv.kd');
    const f = await t.db.m.Folder.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.folders['TCKT:01']) }).lean<any>();
    const rt = await t.db.m.RecordType.create({ companyId: new Types.ObjectId(t.ids.companyId), departmentId: new Types.ObjectId(t.ids.depts.TCKT.id), name: 'Chứng từ kiểm toán', kind: 'DX', folderId: f._id, retentionYears: 10, retentionStatus: 'approved', securityLevel: 'confidential' });
    const s = await ktt.post('/records', { recordTypeId: String(rt._id), kind: 'DX', functionCode: 'KD', subject: 'Chứng từ chi mật', workMonth: dateVN().slice(0, 7) });
    await t.drain();
    const recId = (await ktt.get(`/jobs/${s.body.jobId}`)).body.result.objectId;
    const fileId = (await ktt.get(`/records/${recId}`)).body.fileId;
    const share = await ktt.post('/external-shares', { fileId, email: EMAIL, role: 'commenter', reason: 'Kiểm toán', expiresAt: inDays(5) });
    expect(share.body.status).toBe('pending_approval');
    secretId = String((await t.db.m.Approval.findOne({ companyId: cid(), objectType: 'external_share', objectId: new Types.ObjectId(share.body.id) }).lean<any>())._id);
    // để R3 nhắc được ngay (không vướng giới hạn nhắc lại)
    await t.db.m.Approval.updateOne(q(secretId), { $set: { submittedAt: new Date(Date.now() - 48 * 3600_000) } });
  });
  afterAll(async () => t.close());

  it('GET /approvals/:id → 404, không lộ tên file hay email người nhận', async () => {
    const r = await r3.get(`/approvals/${secretId}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain(EMAIL);
  });

  it('nhắc phiếu (remind) → 404, không trả nội dung, không ghi nhắc', async () => {
    const r = await r3.post(`/approvals/${secretId}/remind`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain(EMAIL);
    expect((await t.db.m.Approval.findOne(q(secretId)).lean<any>()).reminders ?? []).toHaveLength(0);
  });

  it('danh sách phiếu của R3 không có phiếu đó', async () => {
    for (const box of ['', '?box=inbox', '?box=sent', '?status=pending&objectType=external_share']) {
      const r = await r3.get(`/approvals${box}`);
      expect(r.status).toBe(200);
      expect(r.body.items.map((a: any) => a.id)).not.toContain(secretId);
    }
  });

  it('người liên quan vẫn xem được (người trình, người duyệt ngoài drive)', async () => {
    expect((await ktt.get(`/approvals/${secretId}`)).body.objectTitle).toContain(EMAIL);
    expect((await gdk.get(`/approvals/${secretId}`)).status).toBe(200);
    expect((await nvKd.get(`/approvals/${secretId}`)).status).toBe(404);
  });

  it('R3 giữ quyền xem và nhắc phiếu ở drive không Mật, và ở drive Mật mình là thành viên', async () => {
    for (const dept of ['MKT', 'HCNS']) {
      const id = await cloneOn(dept);
      const g = await r3.get(`/approvals/${id}`);
      expect(g.status).toBe(200);
      expect(g.body.allowedActions).toContain('remind');
      expect((await r3.post(`/approvals/${id}/remind`)).status).toBe(200);
    }
  });
});
