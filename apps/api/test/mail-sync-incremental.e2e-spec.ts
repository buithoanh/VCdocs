import { createTestApp, TestApp } from './support/app';
import { MAIL_PORT } from '../src/modules/mail-basic/mail.port';

const D = '@vcworkspace.test', BOX = `nv.kd${D}`;
const mime = (subject: string, id: string, from = `tp.mkt${D}`, to = BOX) =>
  Buffer.from([`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${id}${D}>`, '', 'x', ''].join('\r\n'));

/**
 * Đồng bộ gia tăng: con trỏ UIDVALIDITY + UID lớn nhất lưu trong MongoDB theo hộp thư + thư mục.
 * `fake` để kiểu any: bản mã cũ (chưa có bodyFetches/resetUidValidity/con trỏ) vẫn biên dịch và hỏng ở assertion.
 */
describe('Email: đồng bộ gia tăng theo UIDVALIDITY + UID', () => {
  let t: TestApp; let fake: any;
  beforeAll(async () => { t = await createTestApp(); fake = t.app.get(MAIL_PORT); });
  afterAll(() => t.close());
  afterEach(() => jest.restoreAllMocks());

  const rows = () => t.db.m.WorkspaceMailMessage.find({ companyId: t.ids.companyId, mailboxOwner: BOX }).lean<any[]>();
  const cursor = () => (t.db.m as any).WorkspaceMailSyncCursor.findOne({ companyId: t.ids.companyId, mailboxOwner: BOX, folder: 'inbox' }).lean();
  const subjects = async () => (await rows()).map((x) => x.subject).sort();

  it('lần mở sau chỉ đọc UID mới: không tải lại, không quét lại thư cũ', async () => {
    const c = await t.login('nv.kd');
    fake.inject(BOX, 'inbox', mime('Gia tăng A', 'inc-a'), 'inc-a-engine');
    fake.inject(BOX, 'inbox', mime('Gia tăng B', 'inc-b'), 'inc-b-engine');
    expect((await c.get('/mail/messages?folder=inbox')).status).toBe(200);
    expect(await subjects()).toEqual(['Gia tăng A', 'Gia tăng B']);
    expect([...fake.bodyFetches].sort()).toEqual(['inc-a-engine', 'inc-b-engine']);
    const first = await cursor();
    expect(first).toMatchObject({ uidValidity: '1' });
    expect(first.lastUid).toBeGreaterThan(0);

    // Xoá dòng chỉ mục của thư A: nếu lượt sau còn quét từ đầu thì A sẽ bị tải và ghi lại.
    await t.db.m.WorkspaceMailMessage.deleteOne({ companyId: t.ids.companyId, mailboxOwner: BOX, engineId: 'inc-a-engine' });
    fake.inject(BOX, 'inbox', mime('Gia tăng C', 'inc-c'), 'inc-c-engine');
    fake.bodyFetches.length = 0;
    const cursors: any[] = []; const list = fake.listFolder.bind(fake);
    jest.spyOn(fake, 'listFolder').mockImplementation(async (...args: any[]) => { cursors.push(args[4]?.cursor); return list(...args); });
    expect((await c.get('/mail/messages?folder=inbox')).status).toBe(200);
    expect(cursors).toEqual([{ uidValidity: '1', lastUid: first.lastUid }]);
    expect(fake.bodyFetches).toEqual(['inc-c-engine']);
    expect(await subjects()).toEqual(['Gia tăng B', 'Gia tăng C']);
    expect((await cursor()).lastUid).toBeGreaterThan(first.lastUid);

    // Không có thư mới: không tải nội dung nào, con trỏ đứng yên.
    const before = await cursor(); fake.bodyFetches.length = 0;
    expect((await c.get('/mail/messages?folder=inbox')).status).toBe(200);
    expect(fake.bodyFetches).toEqual([]);
    expect((await cursor()).lastUid).toBe(before.lastUid);
  });

  it('UIDVALIDITY đổi: đồng bộ lại từ đầu, không sinh dòng trùng, không tải lại thư đã có', async () => {
    const c = await t.login('nv.kd');
    fake.resetUidValidity(BOX, 'inbox');
    fake.inject(BOX, 'inbox', mime('Gia tăng D', 'inc-d'), 'inc-d-engine');
    fake.bodyFetches.length = 0;
    expect((await c.get('/mail/messages?folder=inbox')).status).toBe(200);
    // A (dòng chỉ mục đã xoá ở test trước) và D là thư chưa có; B, C đã có nên chỉ được nhận ra, không tải lại.
    expect([...fake.bodyFetches].sort()).toEqual(['inc-a-engine', 'inc-d-engine']);
    expect(await subjects()).toEqual(['Gia tăng A', 'Gia tăng B', 'Gia tăng C', 'Gia tăng D']);
    const ids = (await rows()).map((x) => x.internetMessageId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(await cursor()).toMatchObject({ uidValidity: '2' });
    expect(await (t.db.m as any).WorkspaceMailSyncCursor.countDocuments({ companyId: t.ids.companyId, mailboxOwner: BOX, folder: 'inbox' })).toBe(1);

    fake.bodyFetches.length = 0;
    expect((await c.get('/mail/messages?folder=inbox')).status).toBe(200);
    expect(fake.bodyFetches).toEqual([]);
    expect(await rows()).toHaveLength(4);
  });

  it('lỗi mail server giữa lượt không đẩy con trỏ: lượt sau vẫn nhận thư', async () => {
    const c = await t.login('nv.kd');
    const before = await cursor();
    fake.inject(BOX, 'inbox', mime('Gia tăng E', 'inc-e'), 'inc-e-engine');
    jest.spyOn(fake, 'listFolder').mockRejectedValueOnce(new Error('MAIL_PROTOCOL_TIMEOUT'));
    expect((await c.get('/mail/messages?folder=inbox')).status).toBe(503);
    expect((await cursor()).lastUid).toBe(before.lastUid);
    expect((await c.get('/mail/messages?folder=inbox&q=Gia%20t%C4%83ng%20E&scope=subject')).body.items.map((x: any) => x.subject)).toEqual(['Gia tăng E']);
  });

  it('gửi thư: đối soát "Đã gửi" chỉ đọc header, không tải nội dung thư mục', async () => {
    const a = await t.login('tp.mkt');
    fake.inject(`tp.mkt${D}`, 'sent', mime('Đã gửi cũ', 'inc-sent-old', `tp.mkt${D}`, `nv.mkt${D}`), 'inc-sent-old-engine');
    fake.bodyFetches.length = 0;
    const sent = await a.post('/mail/send', { to: [`nv.mkt${D}`], subject: 'Gia tăng gửi', text: 'x' }, { idem: 'inc-send-1' });
    expect(sent.status).toBe(201);
    expect(fake.bodyFetches).toEqual([]);
  });
});
