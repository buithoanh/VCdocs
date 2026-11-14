import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { HandoversService } from '../src/modules/m10-handovers/handovers.service';
import { MAIL_PORT, MailPort } from '../src/modules/mail-basic/mail.port';
import { addDaysToDateStr, dateVN } from '../src/common/util';

/**
 * M10 Bàn giao nối với VCworkspace: hộp thư nhóm chuyển người quản lý khi chuyển quyền,
 * hộp thư cá nhân bị thu hồi khi tài khoản bị khoá, nhật ký Drive phòng ban gắn phòng.
 */
describe('M10 Bàn giao × VCworkspace (hộp thư, nhật ký Drive)', () => {
  let t: TestApp;
  let r3: Client, nv: Client, tp: Client, it9: Client;
  let svc: HandoversService;
  let mail: MailPort;
  const today = dateVN();
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const oid = (s: string) => new Types.ObjectId(s);
  const u = (k: string) => t.ids.users[k];
  const NV = 'nv.mkt@vcworkspace.test';
  const TP = 'tp.mkt@vcworkspace.test';
  let sharedId: string;
  const shared = () => t.db.m.WorkspaceSharedMailbox.findOne({ companyId: cid(), _id: oid(sharedId) }).lean<any>();
  const audits = (action: string, objectId?: string) =>
    t.db.m.AuditLog.find({ companyId: cid(), action, ...(objectId ? { objectId } : {}) }).lean<any[]>();

  beforeAll(async () => {
    t = await createTestApp();
    svc = t.app.get(HandoversService);
    svc.transferPollMs = 0;
    mail = t.app.get(MAIL_PORT);
    r3 = await t.login('hcns');
    nv = await t.login('nv.mkt');
    tp = await t.login('tp.mkt');
    it9 = await t.login('it');

    // Hộp thư nhóm chỉ còn nhân viên sắp nghỉ quản lý; trưởng phòng mới có quyền đọc
    const created = await it9.post('/mail/shared-mailboxes', { address: 'mkt-ban-giao@vcworkspace.test', name: 'MKT bàn giao' }, { idem: 'shared-m10-create' });
    expect(created.status).toBe(201);
    sharedId = created.body.id;
    expect((await it9.patch(`/mail/shared-mailboxes/${sharedId}/members`, { email: NV, roles: ['read', 'send', 'manage'] })).status).toBe(200);
    expect((await it9.patch(`/mail/shared-mailboxes/${sharedId}/members`, { email: TP, roles: ['read'] })).status).toBe(200);
    expect((await nv.patch(`/mail/shared-mailboxes/${sharedId}/members`, { email: 'it@vcworkspace.test', roles: [] })).status).toBe(200);
    expect((await nv.post('/mail/aliases', { address: 'nv.mkt+seo@vcworkspace.test', displayName: 'SEO' }, { idem: 'alias-m10' })).status).toBe(201);
  });
  afterAll(async () => t.close());

  it('chuyển quyền: người nhận thành người quản lý hộp thư nhóm, giữ quyền cũ; người nghỉ chưa bị gỡ', async () => {
    const made = await r3.post('/handovers', { userId: u('nv.mkt'), lastWorkingDay: today });
    expect(made.status).toBe(202);
    const hid = made.body.handoverId;
    await t.drain();
    expect((await tp.post(`/handovers/${hid}/confirm-receiver`, {})).status).toBe(200);
    expect((await r3.post(`/handovers/${hid}/verify`, {})).status).toBe(200);
    const run = await it9.post(`/handovers/${hid}/execute`);
    expect(run.status).toBe(202);
    await t.drain();
    const job = (await it9.get(`/jobs/${run.body.jobId}`)).body;
    expect(job.status).toBe('done');
    expect(job.steps.map((s: any) => s.name)).toContain('Chuyển quyền quản lý hộp thư nhóm');
    expect((await it9.get(`/handovers/${hid}`)).body.status).toBe('done');

    const row = await shared();
    expect(row.members.find((m: any) => m.email === TP).roles.sort()).toEqual(['manage', 'read']);
    expect(row.members.find((m: any) => m.email === NV).roles).toContain('manage');
    const log = await audits('workspace_mail.shared.handover', sharedId);
    expect(log).toHaveLength(1);
    expect(log[0].after).toMatchObject({ address: 'mkt-ban-giao@vcworkspace.test', from: NV, to: TP });
    // Trưởng phòng quản lý được ngay: tự cấp quyền gửi cho mình
    expect((await tp.patch(`/mail/shared-mailboxes/${sharedId}/members`, { email: TP, roles: ['read', 'send', 'manage'] })).status).toBe(200);
  });

  it('00:30 sau ngày làm việc cuối: khoá tài khoản rồi thu hồi hộp thư, alias và quyền hộp nhóm', async () => {
    const offboard = jest.spyOn(mail, 'offboardUser');
    await svc.markLeft(addDaysToDateStr(today, 1));
    expect((await t.db.m.User.findOne({ companyId: cid(), _id: oid(u('nv.mkt')) }).lean<any>()).status).toBe('left');
    expect(offboard).toHaveBeenCalledWith(NV);
    expect((await shared()).members.map((m: any) => m.email)).toEqual([TP]);
    expect(await t.db.m.WorkspaceMailAlias.countDocuments({ companyId: cid(), ownerEmail: NV, active: true })).toBe(0);
    const log = await audits('workspace_mail.user.offboard', u('nv.mkt'));
    expect(log).toHaveLength(1);
    expect(log[0].after).toMatchObject({ address: NV, status: 'left', source: 'handover.markLeft' });
    expect((await nv.get('/me')).status).toBe(401);
    offboard.mockRestore();
  });

  it('chưa chuyển quyền mà đã tới ngày khoá: vẫn khoá tài khoản, hộp thư nhóm giữ nguyên, ghi nhật ký lỗi để chạy lại', async () => {
    const XEM = 'xem.mkt@vcworkspace.test';
    const made = await it9.post('/mail/shared-mailboxes', { address: 'mkt-mo-coi@vcworkspace.test', name: 'MKT mồ côi' }, { idem: 'shared-m10-orphan' });
    expect((await it9.patch(`/mail/shared-mailboxes/${made.body.id}/members`, { email: XEM, roles: ['read', 'manage'] })).status).toBe(200);
    const xem = await t.login('xem.mkt');
    expect((await xem.patch(`/mail/shared-mailboxes/${made.body.id}/members`, { email: 'it@vcworkspace.test', roles: [] })).status).toBe(200);
    await t.db.m.User.updateOne({ companyId: cid(), _id: oid(u('xem.mkt')) }, { $set: { status: 'leaving', lastWorkingDay: today } });

    await svc.markLeft(addDaysToDateStr(today, 1));
    expect((await t.db.m.User.findOne({ companyId: cid(), _id: oid(u('xem.mkt')) }).lean<any>()).status).toBe('left');
    const row = await t.db.m.WorkspaceSharedMailbox.findOne({ companyId: cid(), _id: oid(made.body.id) }).lean<any>();
    expect(row.members.map((m: any) => m.email)).toEqual([XEM]);
    const failed = await audits('workspace_mail.user.offboard_failed', u('xem.mkt'));
    expect(failed).toHaveLength(1);
    expect(failed[0].after.error).toContain('người quản lý kế nhiệm');
    expect(await audits('workspace_mail.user.offboard', u('xem.mkt'))).toHaveLength(0);
  });

  it('nhật ký Drive phòng ban gắn phòng (trưởng phòng xem được); không gian cá nhân thì không', async () => {
    const spaces = (await tp.get('/spaces')).body.items;
    const dept = spaces.find((s: any) => s.kind === 'department');
    const personal = spaces.find((s: any) => s.kind === 'personal');
    const a = await tp.post('/drive/folders', { spaceId: dept.id, name: 'Nhật ký phòng' });
    expect(a.status).toBe(201);
    const inDept = await t.db.m.AuditLog.findOne({ companyId: cid(), objectType: 'workspace_drive_item', objectId: a.body.id }).lean<any>();
    expect(String(inDept.departmentId)).toBe(t.ids.depts.MKT.id);
    if (personal) {
      const b = await tp.post('/drive/folders', { spaceId: personal.id, name: 'Nhật ký riêng' });
      expect(b.status).toBe(201);
      const own = await t.db.m.AuditLog.findOne({ companyId: cid(), objectType: 'workspace_drive_item', objectId: b.body.id }).lean<any>();
      expect(own.departmentId).toBeUndefined();
    }
  });
});
