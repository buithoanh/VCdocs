import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { loadConfig } from '../src/config/config';
import { HandoversService } from '../src/modules/m10-handovers/handovers.service';
import { MAIL_PORT, MailPort } from '../src/modules/mail-basic/mail.port';
import { FakeIdentityLifecyclePort, IDENTITY_LIFECYCLE_PORT } from '../src/modules/m01-auth/identity-lifecycle.port';
import { addDaysToDateStr, dateVN } from '../src/common/util';

/**
 * M10 Bàn giao nối với VCworkspace: hộp thư nhóm và không gian cá nhân chuyển khi chuyển quyền;
 * hộp thư, danh tính IdP/Nextcloud bị thu hồi khi tài khoản bị khoá; nhật ký gắn phòng.
 */
describe('M10 Bàn giao × VCworkspace (hộp thư, Drive cá nhân, danh tính, nhật ký)', () => {
  let t: TestApp;
  let r3: Client, nv: Client, tp: Client, it9: Client;
  let svc: HandoversService;
  let mail: MailPort;
  let idp: FakeIdentityLifecyclePort;
  const today = dateVN();
  const tomorrow = addDaysToDateStr(today, 1);
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const oid = (s: string) => new Types.ObjectId(s);
  const u = (k: string) => t.ids.users[k];
  const NV = 'nv.mkt@vcworkspace.test';
  const TP = 'tp.mkt@vcworkspace.test';
  let sharedId: string, personalSpaceId: string, personalFileId: string;
  const shared = () => t.db.m.WorkspaceSharedMailbox.findOne({ companyId: cid(), _id: oid(sharedId) }).lean<any>();
  const audits = (action: string, objectId?: string) =>
    t.db.m.AuditLog.find({ companyId: cid(), action, ...(objectId ? { objectId } : {}) }).lean<any[]>();
  const bind = (key: string, subject: string) =>
    t.db.m.OidcIdentity.create({ companyId: t.ids.companyId, issuer: 'https://id.vcworkspace.test/application/o/app', subject, userId: u(key), email: t.ids.emails[key], groups: [], active: true, lastSeenAt: new Date() });

  beforeAll(async () => {
    t = await createTestApp();
    svc = t.app.get(HandoversService);
    svc.transferPollMs = 0;
    mail = t.app.get(MAIL_PORT);
    idp = t.app.get(IDENTITY_LIFECYCLE_PORT);
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

    // Tệp trong không gian cá nhân của người sắp nghỉ
    const personal = (await nv.get('/spaces')).body.items.find((s: any) => s.kind === 'personal');
    personalSpaceId = personal.id;
    const file = await nv.upload('/drive/files', { spaceId: personalSpaceId }, { name: 'ghi-chu-seo.txt', type: 'text/plain', content: Buffer.from('ghi chú SEO') }, { idem: 'personal-m10' });
    expect(file.status).toBe(201);
    personalFileId = file.body.id;
    // Người sắp nghỉ đăng nhập qua IdP: có binding OIDC
    await bind('nv.mkt', 'handover-nv-subject');
  });
  afterAll(async () => t.close());

  it('liệt kê: không gian cá nhân còn tệp là một dòng bàn giao, mặc định người nhận được đọc', async () => {
    const made = await r3.post('/handovers', { userId: u('nv.mkt'), lastWorkingDay: today });
    expect(made.status).toBe(202);
    await t.drain();
    const h = (await tp.get(`/handovers/${made.body.handoverId}`)).body;
    const item = h.items.find((i: any) => i.kind === 'workspace_space');
    expect(item).toMatchObject({ objectType: 'workspace_space', objectId: personalSpaceId, action: 'reassign', status: 'pending', detail: '1 mục · người nhận được quyền chỉ đọc' });
    // Trước khi chuyển quyền, trưởng phòng chưa thấy không gian và chưa đọc được tệp
    expect((await tp.get('/spaces')).body.items.map((s: any) => s.id)).not.toContain(personalSpaceId);
    expect((await tp.get(`/drive/files/${personalFileId}/content`)).status).toBe(404);
  });

  it('chuyển quyền: người nhận quản lý hộp thư nhóm và đọc được không gian cá nhân, không sửa được', async () => {
    const h0 = await t.db.m.Handover.findOne({ companyId: cid(), userId: oid(u('nv.mkt')) }).lean<any>();
    const hid = String(h0._id);
    expect((await tp.post(`/handovers/${hid}/confirm-receiver`, {})).status).toBe(200);
    expect((await r3.post(`/handovers/${hid}/verify`, {})).status).toBe(200);
    const run = await it9.post(`/handovers/${hid}/execute`);
    expect(run.status).toBe(202);
    await t.drain();
    const job = (await it9.get(`/jobs/${run.body.jobId}`)).body;
    expect(job.status).toBe('done');
    expect(job.steps.map((s: any) => s.name)).toContain('Chuyển quyền quản lý hộp thư nhóm');
    const done = (await it9.get(`/handovers/${hid}`)).body;
    expect(done.status).toBe('done');
    expect(done.items.find((i: any) => i.kind === 'workspace_space').status).toBe('done');

    const row = await shared();
    expect(row.members.find((m: any) => m.email === TP).roles.sort()).toEqual(['manage', 'read']);
    expect(row.members.find((m: any) => m.email === NV).roles).toContain('manage');
    const log = await audits('workspace_mail.shared.handover', sharedId);
    expect(log).toHaveLength(1);
    expect(log[0].after).toMatchObject({ address: 'mkt-ban-giao@vcworkspace.test', from: NV, to: TP });
    // Trưởng phòng quản lý được ngay: tự cấp quyền gửi cho mình
    expect((await tp.patch(`/mail/shared-mailboxes/${sharedId}/members`, { email: TP, roles: ['read', 'send', 'manage'] })).status).toBe(200);

    const space = (await tp.get('/spaces')).body.items.find((s: any) => s.id === personalSpaceId);
    expect(space).toMatchObject({ kind: 'personal', role: 'reader' });
    expect(space.handoverReaderIds).toBeUndefined();
    const content = await tp.get(`/drive/files/${personalFileId}/content`);
    expect(content.status).toBe(200);
    expect(content.text).toBe('ghi chú SEO');
    expect((await tp.post('/drive/folders', { spaceId: personalSpaceId, name: 'không được tạo' })).status).toBe(403);
    // Người ngoài vẫn không thấy
    expect((await it9.get(`/drive/files/${personalFileId}/content`)).status).toBe(404);
  });

  it('00:30 sau ngày làm việc cuối: khoá tài khoản rồi thu hồi hộp thư, alias, quyền hộp nhóm và danh tính IdP/Nextcloud', async () => {
    const offboard = jest.spyOn(mail, 'offboardUser');
    await svc.markLeft(tomorrow);
    expect((await t.db.m.User.findOne({ companyId: cid(), _id: oid(u('nv.mkt')) }).lean<any>()).status).toBe('left');
    expect(offboard).toHaveBeenCalledWith(NV);
    expect((await shared()).members.map((m: any) => m.email)).toEqual([TP]);
    expect(await t.db.m.WorkspaceMailAlias.countDocuments({ companyId: cid(), ownerEmail: NV, active: true })).toBe(0);
    const log = await audits('workspace_mail.user.offboard', u('nv.mkt'));
    expect(log).toHaveLength(1);
    expect(log[0].after).toMatchObject({ address: NV, status: 'left', source: 'handover.markLeft' });
    expect((await nv.get('/me')).status).toBe(401);
    offboard.mockRestore();

    // Danh tính: IdP và Nextcloud nhận active=false, binding ở app bị khoá; người chịu trách nhiệm là R9 đã chuyển quyền
    expect(idp.authentik.get('handover-nv-subject')).toMatchObject({ active: false });
    expect(idp.nextcloud.get('handover-nv-subject')).toMatchObject({ active: false });
    expect((await t.db.m.OidcIdentity.findOne({ companyId: cid(), subject: 'handover-nv-subject' }).lean<any>()).active).toBe(false);
    const idLog = await audits('identity.lifecycle.offboard', u('nv.mkt'));
    expect(idLog).toHaveLength(1);
    expect(idLog[0].after).toMatchObject({ status: 'done', source: 'handover.markLeft' });
    expect(String(idLog[0].actorId)).toBe(u('it'));
    // Người nhận vẫn đọc được không gian cá nhân sau khi người nghỉ bị khoá
    expect((await tp.get(`/drive/files/${personalFileId}/content`)).status).toBe(200);
  });

  it('IdP lỗi lúc khoá: tài khoản vẫn bị khoá, ghi nhật ký lỗi; R9 reconcile đúng operation đó thì xong', async () => {
    await bind('nv.kd', 'handover-kd-subject');
    await t.db.m.User.updateOne({ companyId: cid(), _id: oid(u('nv.kd')) }, { $set: { status: 'leaving', lastWorkingDay: today } });
    idp.failNext = 'authentik';
    await svc.markLeft(tomorrow);
    expect((await t.db.m.User.findOne({ companyId: cid(), _id: oid(u('nv.kd')) }).lean<any>()).status).toBe('left');
    expect(await audits('identity.lifecycle.offboard_failed', u('nv.kd'))).toHaveLength(1);
    const op = await t.db.m.IdentityLifecycleOperation.findOne({ companyId: cid(), idempotencyKey: `handover-left-${u('nv.kd')}` }).lean<any>();
    expect(op.status).toBe('partial');
    const retry = await it9.post(`/identity/lifecycle-operations/${op._id}/reconcile`, {});
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('done');
    expect(idp.authentik.get('handover-kd-subject')).toMatchObject({ active: false });
  });

  it('chưa chuyển quyền mà đã tới ngày khoá: vẫn khoá tài khoản, hộp thư nhóm giữ nguyên, ghi nhật ký lỗi để chạy lại', async () => {
    const XEM = 'xem.mkt@vcworkspace.test';
    const made = await it9.post('/mail/shared-mailboxes', { address: 'mkt-mo-coi@vcworkspace.test', name: 'MKT mồ côi' }, { idem: 'shared-m10-orphan' });
    expect((await it9.patch(`/mail/shared-mailboxes/${made.body.id}/members`, { email: XEM, roles: ['read', 'manage'] })).status).toBe(200);
    const xem = await t.login('xem.mkt');
    expect((await xem.patch(`/mail/shared-mailboxes/${made.body.id}/members`, { email: 'it@vcworkspace.test', roles: [] })).status).toBe(200);
    await t.db.m.User.updateOne({ companyId: cid(), _id: oid(u('xem.mkt')) }, { $set: { status: 'leaving', lastWorkingDay: today } });

    await svc.markLeft(tomorrow);
    expect((await t.db.m.User.findOne({ companyId: cid(), _id: oid(u('xem.mkt')) }).lean<any>()).status).toBe('left');
    const row = await t.db.m.WorkspaceSharedMailbox.findOne({ companyId: cid(), _id: oid(made.body.id) }).lean<any>();
    expect(row.members.map((m: any) => m.email)).toEqual([XEM]);
    const failed = await audits('workspace_mail.user.offboard_failed', u('xem.mkt'));
    expect(failed).toHaveLength(1);
    expect(failed[0].after.error).toContain('người quản lý kế nhiệm');
    expect(await audits('workspace_mail.user.offboard', u('xem.mkt'))).toHaveLength(0);
    // Không có binding OIDC thì không tạo thao tác lifecycle
    expect(await audits('identity.lifecycle.offboard', u('xem.mkt'))).toHaveLength(0);
  });

  it('nhật ký: Drive phòng ban và quản trị mail gắn phòng; Drive cá nhân và nội dung thư thì không', async () => {
    const spaces = (await tp.get('/spaces')).body.items;
    const dept = spaces.find((s: any) => s.kind === 'department');
    const own = spaces.find((s: any) => s.kind === 'personal' && s.role === 'manager');
    const a = await tp.post('/drive/folders', { spaceId: dept.id, name: 'Nhật ký phòng' });
    expect(a.status).toBe(201);
    const inDept = await t.db.m.AuditLog.findOne({ companyId: cid(), objectType: 'workspace_drive_item', objectId: a.body.id }).lean<any>();
    expect(String(inDept.departmentId)).toBe(t.ids.depts.MKT.id);
    const b = await tp.post('/drive/folders', { spaceId: own.id, name: 'Nhật ký riêng' });
    expect(b.status).toBe(201);
    const inOwn = await t.db.m.AuditLog.findOne({ companyId: cid(), objectType: 'workspace_drive_item', objectId: b.body.id }).lean<any>();
    expect(inOwn.departmentId).toBeUndefined();

    // Bí danh do nhân viên MKT tạo: trưởng phòng MKT thấy trong /audit-logs
    const alias = (await audits('workspace_mail.alias.create'))[0];
    expect(String(alias.departmentId)).toBe(t.ids.depts.MKT.id);
    const seen = await tp.get(`/audit-logs?action=workspace_mail.alias.create`);
    expect(seen.status).toBe(200);
    expect(seen.body.items.map((i: any) => i.id)).toContain(String(alias._id));
    // Gửi thư: dòng nhật ký không gắn phòng, trưởng phòng không thấy
    const sent = await tp.post('/mail/send', { to: [TP], subject: 'Thử nhật ký', text: 'nội dung' }, { idem: 'm10-audit-send' });
    expect(sent.status).toBeLessThan(300);
    const sendLog = (await audits('workspace_mail.send')).pop();
    expect(sendLog.departmentId).toBeUndefined();
    expect((await tp.get(`/audit-logs?action=workspace_mail.send`)).body.items).toHaveLength(0);
  });
});

describe('IDENTITY_LIFECYCLE_MODE=remote', () => {
  const base = {
    NODE_ENV: 'production', GOOGLE_MODE: 'real', PUBLIC_API_ORIGIN: 'https://vcdocs.example.com', WEB_ORIGIN: 'https://vcdocs.example.com', COOKIE_SECURE: 'true',
    IDENTITY_LIFECYCLE_MODE: 'remote', IDENTITY_AUTHENTIK_BASE_URL: 'https://sso.example.com', IDENTITY_AUTHENTIK_TOKEN: 't'.repeat(20),
    IDENTITY_NEXTCLOUD_BASE_URL: 'https://cloud.example.com', IDENTITY_NEXTCLOUD_ADMIN_USER: 'svc', IDENTITY_NEXTCLOUD_ADMIN_PASSWORD: 'p'.repeat(20),
    IDENTITY_NEXTCLOUD_CONTROL_URL: 'http://nextcloud-control', IDENTITY_NEXTCLOUD_CONTROL_TOKEN: 'c'.repeat(20),
  };
  it('production nhận https và http tới tên dịch vụ Docker một nhãn', () => {
    expect(loadConfig(base as any).identityLifecycle.mode).toBe('remote');
  });
  it('http tới máy ngoài, URL kèm mật khẩu, hoặc thiếu token bị chặn khi khởi động', () => {
    expect(() => loadConfig({ ...base, IDENTITY_AUTHENTIK_BASE_URL: 'http://sso.example.com' } as any)).toThrow('IDENTITY_AUTHENTIK_BASE_URL production bắt buộc https');
    expect(() => loadConfig({ ...base, IDENTITY_NEXTCLOUD_BASE_URL: 'https://svc:secret@cloud.example.com' } as any)).toThrow('IDENTITY_NEXTCLOUD_BASE_URL không được chứa');
    expect(() => loadConfig({ ...base, IDENTITY_AUTHENTIK_TOKEN: undefined } as any)).toThrow('Identity lifecycle remote cần đủ');
    expect(() => loadConfig({ ...base, IDENTITY_LIFECYCLE_MODE: 'fake' } as any)).toThrow('IDENTITY_LIFECYCLE_MODE=fake');
  });
});
