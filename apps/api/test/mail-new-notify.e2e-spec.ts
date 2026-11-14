import { Types } from 'mongoose';
import { createTestApp, TestApp } from './support/app';
import { MAIL_PORT } from '../src/modules/mail-basic/mail.port';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service';
import { loadConfig } from '../src/config/config';

const D = '@vcworkspace.test';
const mime = (to: string, subject: string, id: string, extra: string[] = [], from = 'doi.tac@ngoai.test') =>
  Buffer.from([`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${id}@ngoai.test>`, ...extra, '', 'nội dung', ''].join('\r\n'));

/**
 * Việc nền `mail.syncInbox`: báo thư mới mà không ai mở hộp thư. Chạy qua SchedulerService.runAll()
 * như lúc chạy thật; service lấy theo tên để bản mã cũ (chưa có việc nền) hỏng ở assertion.
 */
describe('Email: việc nền báo thư mới', () => {
  let t: TestApp; let fake: any; let scheduler: SchedulerService;
  beforeAll(async () => { t = await createTestApp(); fake = t.app.get(MAIL_PORT); scheduler = t.app.get(SchedulerService); });
  afterAll(() => t.close());

  const userId = async (key: string) => new Types.ObjectId(String((t.ids.users as any)[key]));
  const notes = async (key: string, filter: Record<string, unknown> = {}) =>
    t.db.m.Notification.find({ companyId: t.ids.companyId, userId: await userId(key), type: 'mail.new', ...filter }).sort({ createdAt: 1 }).lean<any[]>();
  const unread = async (client: any) => { const res = await client.get('/mail/unread-count'); expect(res.status).toBe(200); return res.body.count as number; };

  it('đăng ký vào scheduler; nhịp cấu hình được và tắt được', () => {
    expect(scheduler.list()).toContain('mail.syncInbox');
    expect(loadConfig({ MAIL_SYNC_INTERVAL_MS: '15000' } as any).mailEngine.syncIntervalMs).toBe(15000);
    expect(loadConfig({ MAIL_SYNC_INTERVAL_MS: '0' } as any).mailEngine.syncIntervalMs).toBe(0);
  });

  it('thư từ ngoài vào hộp cá nhân: báo đúng chủ hộp dù chưa ai mở hộp thư, chạy lại không báo lặp', async () => {
    fake.inject(`nv.kd${D}`, 'inbox', mime(`nv.kd${D}`, 'Báo giá tháng 11', 'notify-1'), 'notify-1-engine');
    await scheduler.runAll();
    const mine = await notes('nv.kd');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Thư mới từ doi.tac@ngoai.test', body: 'Báo giá tháng 11', link: '/email', isRead: false, objectType: 'workspace_mail_message', emailState: 'none' });
    const row = await t.db.m.WorkspaceMailMessage.findOne({ companyId: t.ids.companyId, mailboxOwner: `nv.kd${D}`, engineId: 'notify-1-engine' }).lean<any>();
    expect(String(mine[0].objectId)).toBe(String(row._id));
    expect(await notes('tp.mkt')).toHaveLength(0);
    expect(await notes('nv.mkt')).toHaveLength(0);
    // Không gửi Gmail báo về thư.
    expect((t.fake as any).world.outbox.filter((m: any) => String(m.subject).includes('Thư mới'))).toHaveLength(0);

    await scheduler.runAll(); await scheduler.runAll();
    expect(await notes('nv.kd')).toHaveLength(1);
  });

  it('số chưa đọc và cờ unread theo người; mở nội dung thư thì hết chưa đọc', async () => {
    const c = await t.login('nv.kd'), other = await t.login('nv.mkt');
    expect(await unread(c)).toBe(1);
    expect(await unread(other)).toBe(0);
    const list = await c.get('/mail/messages?folder=inbox');
    const item = list.body.items.find((x: any) => x.subject === 'Báo giá tháng 11');
    expect(item.unread).toBe(true);
    expect(item.notifiedAt).toBeUndefined();
    expect((await c.get(`/mail/messages/${item.id}/body`)).status).toBe(200);
    expect(await unread(c)).toBe(0);
    expect((await c.get('/mail/messages?folder=inbox')).body.items.find((x: any) => x.id === item.id).unread).toBe(false);
    await scheduler.runAll();
    expect(await unread(c)).toBe(0);
  });

  it('thư nội bộ gửi từ ứng dụng: người nhận To/Cc được báo, người gửi không', async () => {
    const a = await t.login('tp.mkt');
    const sent = await a.post('/mail/send', { to: [`nv.kd${D}`], cc: [`nv.mkt${D}`, `tp.mkt${D}`], subject: 'Họp giao ban', text: 'x' }, { idem: 'notify-internal-1' });
    expect(sent.status).toBe(201);
    await scheduler.runAll(); await scheduler.runAll();
    expect((await notes('nv.kd', { body: 'Họp giao ban' }))).toHaveLength(1);
    expect((await notes('nv.mkt', { body: 'Họp giao ban' }))).toHaveLength(1);
    expect(await notes('tp.mkt')).toHaveLength(0);
    expect((await notes('nv.kd', { body: 'Họp giao ban' }))[0].title).toBe(`Thư mới từ tp.mkt${D}`);
  });

  it('thư tự gửi cho mình từ client ngoài (From là alias/chính mình) không báo', async () => {
    fake.inject(`nv.kd${D}`, 'inbox', mime(`nv.kd${D}`, 'Tự nhắc việc', 'notify-self', [], `nv.kd${D}`), 'notify-self-engine');
    await scheduler.runAll();
    expect(await notes('nv.kd', { body: 'Tự nhắc việc' })).toHaveLength(0);
    expect(await t.db.m.WorkspaceMailMessage.countDocuments({ companyId: t.ids.companyId, mailboxOwner: `nv.kd${D}`, subject: 'Tự nhắc việc' })).toBe(1);
  });

  it('thư có ngày gửi cũ hơn 24 giờ vẫn vào chỉ mục nhưng không báo', async () => {
    fake.inject(`nv.kd${D}`, 'inbox', mime(`nv.kd${D}`, 'Thư tồn năm ngoái', 'notify-old', ['Date: Mon, 03 Nov 2025 08:00:00 +0700']), 'notify-old-engine');
    await scheduler.runAll();
    expect(await notes('nv.kd', { body: 'Thư tồn năm ngoái' })).toHaveLength(0);
    expect(await t.db.m.WorkspaceMailMessage.countDocuments({ companyId: t.ids.companyId, mailboxOwner: `nv.kd${D}`, subject: 'Thư tồn năm ngoái' })).toBe(1);
  });

  it('hộp thư nhóm: chỉ thành viên có quyền đọc được báo; thành viên gửi vào hộp không tự nhận báo', async () => {
    const hr = await t.login('hcns'), member = await t.login('nv.mkt');
    const shared = await hr.post('/mail/shared-mailboxes', { address: `cskh${D}`, name: 'Chăm sóc khách hàng' }, { idem: 'notify-shared-create' });
    expect(shared.status).toBe(201);
    expect((await hr.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: `nv.mkt${D}`, roles: ['read'] })).status).toBe(200);
    // tp.kd chỉ có quyền manage, không có read: không được báo.
    expect((await hr.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: `tp.kd${D}`, roles: ['manage'] })).status).toBe(200);

    fake.inject(`cskh${D}`, 'inbox', mime(`cskh${D}`, 'Khách hỏi bảo hành', 'notify-shared-1'), 'notify-shared-1-engine');
    await scheduler.runAll(); await scheduler.runAll();
    expect(await notes('nv.mkt', { body: 'Khách hỏi bảo hành' })).toHaveLength(1);
    expect(await t.db.m.Notification.countDocuments({ companyId: t.ids.companyId, type: 'mail.new', body: 'Khách hỏi bảo hành' })).toBe(2);
    expect(await notes('tp.kd', { body: 'Khách hỏi bảo hành' })).toHaveLength(0);
    expect(await notes('nv.kd', { body: 'Khách hỏi bảo hành' })).toHaveLength(0);

    // Thành viên đọc được hộp nhóm gửi thư vào chính hộp đó: người còn lại được báo, người gửi không.
    expect((await member.post('/mail/send', { to: [`cskh${D}`], subject: 'Chuyển khách cho nhóm', text: 'x' }, { idem: 'notify-shared-send' })).status).toBe(201);
    await scheduler.runAll();
    expect(await notes('nv.mkt', { body: 'Chuyển khách cho nhóm' })).toHaveLength(0);
    const hrNotes = await t.db.m.Notification.find({ companyId: t.ids.companyId, type: 'mail.new', body: 'Chuyển khách cho nhóm' }).lean<any[]>();
    expect(hrNotes.map((n) => String(n.userId))).toEqual([String(await userId('hcns'))]);

    // Số chưa đọc của thành viên tính cả hộp nhóm; đọc thư hộp nhóm chỉ tắt thông báo của chính người đọc.
    const list = await member.get(`/mail/messages?mailbox=${encodeURIComponent(`cskh${D}`)}&folder=inbox`);
    const item = list.body.items.find((x: any) => x.subject === 'Khách hỏi bảo hành');
    expect(item.unread).toBe(true);
    const before = await unread(member);
    expect((await member.get(`/mail/messages/${item.id}/body?mailbox=${encodeURIComponent(`cskh${D}`)}`)).status).toBe(200);
    expect(await unread(member)).toBe(before - 1);
    expect(await t.db.m.Notification.countDocuments({ companyId: t.ids.companyId, type: 'mail.new', body: 'Khách hỏi bảo hành', isRead: false })).toBe(1);
  });

  it('người đã nghỉ hoặc bị khoá không được đồng bộ và không được báo', async () => {
    await t.db.m.User.updateOne({ companyId: t.ids.companyId, _id: await userId('nv.kd') }, { $set: { isSuspended: true } });
    fake.inject(`nv.kd${D}`, 'inbox', mime(`nv.kd${D}`, 'Sau khi khoá', 'notify-suspended'), 'notify-suspended-engine');
    await scheduler.runAll();
    expect(await notes('nv.kd', { body: 'Sau khi khoá' })).toHaveLength(0);
    expect(await t.db.m.WorkspaceMailMessage.countDocuments({ companyId: t.ids.companyId, mailboxOwner: `nv.kd${D}`, subject: 'Sau khi khoá' })).toBe(0);
    await t.db.m.User.updateOne({ companyId: t.ids.companyId, _id: await userId('nv.kd') }, { $set: { isSuspended: false } });
  });

  it('đa công ty: chỉ mục, con trỏ và thông báo mang đúng companyId của hộp thư', async () => {
    const other = await t.db.m.Company.create({ name: 'Công ty B', domain: 'cty-b.test', settings: {} });
    const guest = await t.db.m.User.create({ companyId: other._id, email: 'khach.b@cty-b.test', name: 'Khách B', status: 'active' });
    fake.inject(`khach.b${D}`, 'inbox', mime(`khach.b${D}`, 'Thư của công ty B', 'notify-tenant'), 'notify-tenant-engine');
    await scheduler.runAll();
    const rows = await t.db.m.WorkspaceMailMessage.find({ subject: 'Thư của công ty B' }, undefined, { skipTenant: true }).lean<any[]>();
    expect(rows.map((r) => String(r.companyId))).toEqual([String(other._id)]);
    const all = await t.db.m.Notification.find({ type: 'mail.new', body: 'Thư của công ty B' }, undefined, { skipTenant: true }).lean<any[]>();
    expect(all.map((n) => [String(n.companyId), String(n.userId)])).toEqual([[String(other._id), String(guest._id)]]);
    expect(await (t.db.m as any).WorkspaceMailSyncCursor.countDocuments({ companyId: new Types.ObjectId(String(other._id)), mailboxOwner: `khach.b${D}` })).toBe(1);
    expect(await (t.db.m as any).WorkspaceMailSyncCursor.countDocuments({ companyId: t.ids.companyId, mailboxOwner: `khach.b${D}` })).toBe(0);
  });

  it('một hộp thư lỗi engine không chặn hộp khác', async () => {
    const list = fake.listFolder.bind(fake);
    jest.spyOn(fake, 'listFolder').mockImplementation(async (...args: any[]) => { if (args[0] === `nv.kd${D}`) throw new Error('MAIL_CREDENTIAL_MISSING'); return list(...args); });
    fake.inject(`nv.mkt${D}`, 'inbox', mime(`nv.mkt${D}`, 'Hộp khác vẫn chạy', 'notify-isolated'), 'notify-isolated-engine');
    await scheduler.runAll();
    jest.restoreAllMocks();
    expect(await notes('nv.mkt', { body: 'Hộp khác vẫn chạy' })).toHaveLength(1);
  });
});
