import { createTestApp, TestApp } from './support/app';
import { MAIL_PORT } from '../src/modules/mail-basic/mail.port';
import { MailBasicService } from '../src/modules/mail-basic/mail-basic.service';

const D = '@vcworkspace.test', BOX = `nv.mkt${D}`;
/** Thư không có Message-ID ở header; dòng `Message-ID:` chỉ nằm trong thân thư. */
const bare = (subject: string, body: string) =>
  Buffer.from([`From: tp.mkt${D}`, `To: ${BOX}`, `Subject: ${subject}`, 'Date: Fri, 13 Nov 2026 08:00:00 +0700', '', body, 'Message-ID: <chi-trong-than-thu@vcworkspace.test>', ''].join('\r\n'));

describe('Email: thư thiếu Message-ID vẫn vào chỉ mục bằng khoá ổn định', () => {
  let t: TestApp; let fake: any;
  beforeAll(async () => { t = await createTestApp(); fake = t.app.get(MAIL_PORT); });
  afterAll(() => t.close());
  afterEach(() => jest.restoreAllMocks());

  const rows = () => t.db.m.WorkspaceMailMessage.find({ companyId: t.ids.companyId, mailboxOwner: BOX }).lean<any[]>();
  const list = async (client: any) => (await client.get('/mail/messages?folder=inbox&q=Kh%C3%B4ng%20ID&scope=subject')).body.items as any[];

  it('hiện trong danh sách, đọc được, có threadId, gắn nhãn được', async () => {
    const b = await t.login('nv.mkt');
    fake.inject(BOX, 'inbox', bare('Không ID một', 'nội dung thứ nhất'), 'no-id-engine-1');
    const items = await list(b);
    expect(items.map((x) => x.subject)).toEqual(['Không ID một']);
    const [message] = items;
    expect(message.threadId).toMatch(/^nomid-[0-9a-f]{64}@vcworkspace\.invalid$/);
    // Khoá không lấy từ dòng giống header trong thân thư.
    expect(message.threadId).not.toContain('chi-trong-than-thu');

    const thread = await b.get(`/mail/threads/${encodeURIComponent(message.threadId)}`);
    expect(thread.status).toBe(200);
    expect(thread.body.items.map((x: any) => x.id)).toEqual([message.id]);
    const body = await b.get(`/mail/messages/${message.id}/body`);
    expect(body.status).toBe(200);
    expect(body.body.text).toContain('nội dung thứ nhất');
    expect((await b.get(`/mail/messages/${message.id}/raw`)).status).toBe(200);

    expect((await b.post('/mail/labels', { name: 'Không ID', color: '#112233' }, { idem: 'no-id-label' })).status).toBe(201);
    const labelled = await b.patch(`/mail/messages/${message.id}/labels`, { labels: ['Không ID'] });
    expect(labelled.status).toBe(200);
    expect(labelled.body.labels).toEqual(['Không ID']);
  });

  it('không nhân đôi qua các lần đồng bộ, kể cả khi UIDVALIDITY đổi; nhãn đã gắn được giữ', async () => {
    const b = await t.login('nv.mkt');
    expect(await list(b)).toHaveLength(1);
    fake.resetUidValidity(BOX, 'inbox');
    const again = await list(b);
    expect(again).toHaveLength(1);
    expect(again[0].labels).toEqual(['Không ID']);
    expect((await rows()).filter((x) => x.subject === 'Không ID một')).toHaveLength(1);
  });

  it('hai thư thiếu Message-ID khác nội dung là hai thư, hai hội thoại riêng', async () => {
    const b = await t.login('nv.mkt');
    fake.inject(BOX, 'inbox', bare('Không ID hai', 'nội dung thứ hai'), 'no-id-engine-2');
    const items = await list(b);
    expect(items.map((x) => x.subject).sort()).toEqual(['Không ID hai', 'Không ID một']);
    expect(new Set(items.map((x) => x.threadId)).size).toBe(2);
  });

  it('một thư không đọc được vẫn không làm hỏng cả danh sách', async () => {
    const b = await t.login('nv.mkt');
    const broken = bare('Không ID hỏng', 'thư này làm parser lỗi');
    fake.inject(BOX, 'inbox', broken, 'no-id-engine-broken');
    fake.inject(BOX, 'inbox', bare('Không ID ba', 'nội dung thứ ba'), 'no-id-engine-3');
    const parse = (MailBasicService.prototype as any).parseEngineRaw;
    jest.spyOn(MailBasicService.prototype as any, 'parseEngineRaw').mockImplementation(function (this: any, raw: any) {
      if (Buffer.compare(raw, broken) === 0) throw new Error('MIME_BROKEN');
      return parse.call(this, raw);
    });
    const result = await b.get('/mail/messages?folder=inbox&q=Kh%C3%B4ng%20ID&scope=subject');
    expect(result.status).toBe(200);
    expect(result.body.items.map((x: any) => x.subject).sort()).toEqual(['Không ID ba', 'Không ID hai', 'Không ID một']);
  });
});
