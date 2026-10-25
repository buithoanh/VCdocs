import { Types } from 'mongoose';
import { GoogleSyncService } from '../src/modules/m01-auth/google-sync.service';
import { createTestApp, TestApp, Client } from './support/app';

// Audit 7/12 (mail-basic/self-service-address-claim): địa chỉ nội bộ chưa ai dùng không được để người bất kỳ chiếm,
// và khi người dùng thật xuất hiện thì alias/hộp thư nhóm đang giữ địa chỉ đó không hút thư hay gửi thay họ.
describe('Chiếm trước địa chỉ mail nội bộ', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(() => t.close());
  // Hợp đồng chưa khai báo 403 cho hai route tạo (đề nghị R5 trong apps/api/DE_NGHI_SUA_HOP_DONG.md) nên gọi thẳng agent.
  const rawPost = (c: Client, url: string, body: any, idem: string) => c.agent.post(`/api/v1${url}`).set('X-CSRF-Token', c.csrf).set('Idempotency-Key', idem).send(body);
  const inbox = async (c: Client, subject: string, mailbox?: string) => {
    const res = await c.agent.get(`/api/v1/mail/messages?folder=inbox${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}`);
    return { status: res.status, found: res.status === 200 && res.body.items.some((x: any) => x.subject === subject) };
  };
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const hire = (local: string) => { t.fake.addUser({ email: `${local}@vcprosperous.com`, name: `Nhân viên mới ${local}`, title: 'Nhân viên', suspended: false }); };

  it('người dùng thường chỉ tạo alias dạng <tên mình>+<nhãn>, không tạo tên tự do', async () => {
    const a = await t.login('tp.mkt');
    const claimed = await rawPost(a, '/mail/aliases', { address: 'newhire@vcworkspace.test', displayName: 'Chiếm trước' }, 'audit07-claim-newhire');
    expect(claimed.status).toBe(403);
    expect(await t.db.m.WorkspaceMailAlias.exists({ companyId: cid(), address: 'newhire@vcworkspace.test' })).toBeNull();
    expect((await rawPost(a, '/mail/aliases', { address: 'nv.mkt+x@vcworkspace.test', displayName: 'Biến thể người khác' }, 'audit07-claim-other-plus')).status).toBe(403);
    expect((await rawPost(a, '/mail/aliases', { address: 'tp.mkt+@vcworkspace.test', displayName: 'Nhãn rỗng' }, 'audit07-claim-empty-tag')).status).toBe(403);
    const own = await a.post('/mail/aliases', { address: 'tp.mkt+campaign@vcworkspace.test', displayName: 'Chiến dịch' }, { idem: 'audit07-own-plus' });
    expect(own.status).toBe(201);
    expect(own.body).toMatchObject({ ownerEmail: 'tp.mkt@vcworkspace.test', address: 'tp.mkt+campaign@vcworkspace.test', active: true });
  });

  it('chỉ HCNS (R3) hoặc quản trị (R9) tạo hộp thư nhóm như hr@', async () => {
    const member = await t.login('nv.mkt'), head = await t.login('tp.mkt'), hr = await t.login('hcns');
    expect((await rawPost(member, '/mail/shared-mailboxes', { address: 'hr@vcworkspace.test', name: 'HR' }, 'audit07-shared-member')).status).toBe(403);
    expect((await rawPost(head, '/mail/shared-mailboxes', { address: 'hr@vcworkspace.test', name: 'HR' }, 'audit07-shared-head')).status).toBe(403);
    expect(await t.db.m.WorkspaceSharedMailbox.exists({ companyId: cid(), address: 'hr@vcworkspace.test' })).toBeNull();
    const created = await hr.post('/mail/shared-mailboxes', { address: 'hr@vcworkspace.test', name: 'HR' }, { idem: 'audit07-shared-hcns' });
    expect(created.status).toBe(201);
    expect(created.body.currentRoles).toEqual(expect.arrayContaining(['read', 'send', 'manage']));
  });

  it('user mới đăng nhập lần đầu lấy lại địa chỉ từ alias: thư vào hộp của họ, chủ alias không gửi thay được', async () => {
    const admin = await t.login('it'), b = await t.login('nv.mkt');
    // Alias do quản trị tạo trước (hoặc dữ liệu cũ khi ai cũng tạo được) cho địa chỉ người sắp vào.
    expect((await admin.post('/mail/aliases', { address: 'newstaff@vcworkspace.test', displayName: 'Giữ chỗ' }, { idem: 'audit07-admin-alias' })).status).toBe(201);
    hire('newstaff');
    const newhire = await t.loginEmail('newstaff@vcprosperous.com');
    const subject = 'Chào mừng newstaff audit07';
    expect((await b.post('/mail/send', { to: ['newstaff@vcworkspace.test'], subject, text: 'Thư cho người mới' }, { idem: 'audit07-to-newhire' })).status).toBe(201);
    const row = await t.db.m.WorkspaceMailMessage.findOne({ companyId: cid(), subject, folder: 'inbox' }).lean<any>();
    expect(row?.mailboxOwner).toBe('newstaff@vcworkspace.test');
    expect(await inbox(newhire, subject)).toEqual({ status: 200, found: true });
    expect(await inbox(admin, subject)).toEqual({ status: 200, found: false });
    const raw = await newhire.agent.get(`/api/v1/mail/messages/${row._id}/raw`);
    expect(raw.status).toBe(200);
    const spoof = await admin.agent.post('/api/v1/mail/send').set('X-CSRF-Token', admin.csrf).set('Idempotency-Key', 'audit07-send-as-newhire').send({ fromIdentity: 'newstaff@vcworkspace.test', to: ['nv.mkt@vcworkspace.test'], subject: 'Mạo danh', text: 'x' });
    expect(spoof.status).toBe(403);
    expect((await t.db.m.WorkspaceMailAlias.findOne({ companyId: cid(), address: 'newstaff@vcworkspace.test' }).lean<any>()).active).toBe(false);
    expect(await t.db.m.AuditLog.exists({ companyId: cid(), action: 'workspace_mail.alias.release', objectType: 'workspace_mail_alias' })).not.toBeNull();
  });

  it('đồng bộ danh bạ tạo user cũng giải phóng alias đang giữ địa chỉ', async () => {
    const admin = await t.login('it'), b = await t.login('nv.mkt');
    expect((await admin.post('/mail/aliases', { address: 'synchire@vcworkspace.test', displayName: 'Giữ chỗ' }, { idem: 'audit07-admin-alias-sync' })).status).toBe(201);
    hire('synchire');
    await t.app.get(GoogleSyncService).syncAll(t.ids.companyId, (_name, fn) => fn());
    expect(await t.db.m.User.exists({ companyId: cid(), email: 'synchire@vcprosperous.com' })).not.toBeNull();
    expect((await t.db.m.WorkspaceMailAlias.findOne({ companyId: cid(), address: 'synchire@vcworkspace.test' }).lean<any>()).active).toBe(false);
    const subject = 'Thư cho synchire audit07';
    expect((await b.post('/mail/send', { to: ['synchire@vcworkspace.test'], subject, text: 'x' }, { idem: 'audit07-to-synchire' })).status).toBe(201);
    expect(await inbox(admin, subject)).toEqual({ status: 200, found: false });
    const synchire = await t.loginEmail('synchire@vcprosperous.com');
    expect(await inbox(synchire, subject)).toEqual({ status: 200, found: true });
  });

  it('hộp thư nhóm cũ trùng địa chỉ người dùng thật bị gắn cờ và không đọc/gửi thay được hộp thư cá nhân', async () => {
    const holder = await t.login('tp.mkt'), b = await t.login('nv.mkt');
    // Dữ liệu cũ: hộp thư nhóm do người thường tạo khi route chưa giới hạn vai trò.
    await t.db.m.WorkspaceSharedMailbox.create({ companyId: cid(), address: 'ketoan.moi@vcworkspace.test', name: 'Chiếm trước', members: [{ email: 'tp.mkt@vcworkspace.test', roles: ['read', 'send', 'manage'] }] });
    hire('ketoan.moi');
    const owner = await t.loginEmail('ketoan.moi@vcprosperous.com');
    expect(await t.db.m.AuditLog.exists({ companyId: cid(), action: 'workspace_mail.shared.conflict' })).not.toBeNull();
    const subject = 'Lương tháng audit07';
    expect((await b.post('/mail/send', { to: ['ketoan.moi@vcworkspace.test'], subject, text: 'riêng tư' }, { idem: 'audit07-to-ketoan' })).status).toBe(201);
    expect(await inbox(owner, subject)).toEqual({ status: 200, found: true });
    expect((await inbox(holder, subject, 'ketoan.moi@vcworkspace.test')).status).toBe(403);
    const spoof = await holder.agent.post('/api/v1/mail/send').set('X-CSRF-Token', holder.csrf).set('Idempotency-Key', 'audit07-send-as-ketoan').send({ fromIdentity: 'ketoan.moi@vcworkspace.test', to: ['nv.mkt@vcworkspace.test'], subject: 'Mạo danh', text: 'x' });
    expect(spoof.status).toBe(403);
  });
});
