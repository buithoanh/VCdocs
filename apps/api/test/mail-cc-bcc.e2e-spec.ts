import { createTestApp, TestApp, Client } from './support/app';
import { FakeMailPort, MAIL_PORT } from '../src/modules/mail-basic/mail.port';

function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(Buffer.from(c))); res.on('end', () => done(null, Buffer.concat(chunks))); res.on('error', done); }
const D = '@vcworkspace.test';
/** Phần header MIME (trước dòng trống đầu tiên). */
const headerOf = (raw: Buffer) => { const text = raw.toString('utf8'); return text.slice(0, text.search(/\r?\n\r?\n/)); };

describe('Email Cc/Bcc và HTML định dạng', () => {
  let t: TestApp; let fake: FakeMailPort;
  beforeAll(async () => { t = await createTestApp(); fake = t.app.get(MAIL_PORT) as FakeMailPort; });
  afterAll(() => t.close());
  const rawOf = async (c: Client, id: string) => (await c.agent.get(`/api/v1/mail/messages/${id}/raw`).buffer(true).parse(binary as any)).body as Buffer;

  it('gửi To+Cc+Bcc: mọi người nhận đều có thư, MIME có Cc nhưng không có Bcc, chỉ bản Đã gửi thấy Bcc', async () => {
    const a = await t.login('tp.mkt'), to = await t.login('nv.mkt'), cc = await t.login('xem.mkt'), bcc1 = await t.login('nv.kd'), bcc2 = await t.login('tp.kd');
    const before = fake.deliveryCount;
    const sent = await a.post('/mail/send', {
      to: [`nv.mkt${D}`], cc: [`XEM.MKT${D}`, `nv.mkt${D}`], bcc: [`nv.kd${D}`, `tp.kd${D}`, `xem.mkt${D}`],
      subject: 'Họp giao ban', text: 'Nội dung đậm', html: '<p><strong>Nội dung</strong> đậm</p>',
    }, { idem: 'cc-bcc-send-0001' });
    expect(sent.status).toBe(201);
    expect(fake.deliveryCount - before).toBe(1);
    // Bỏ trùng giữa danh sách: To thắng Cc, Cc thắng Bcc.
    expect(sent.body).toMatchObject({ to: [`nv.mkt${D}`], cc: [`xem.mkt${D}`], bcc: [`nv.kd${D}`, `tp.kd${D}`], folder: 'sent' });

    for (const [client, label] of [[to, 'to'], [cc, 'cc'], [bcc1, 'bcc1'], [bcc2, 'bcc2']] as const) {
      const inbox = await client.get('/mail/messages?folder=inbox');
      const row = inbox.body.items.find((x: any) => x.subject === 'Họp giao ban');
      expect({ label, found: !!row }).toEqual({ label, found: true });
      expect(row.to).toEqual([`nv.mkt${D}`]); expect(row.cc).toEqual([`xem.mkt${D}`]);
      expect(row).not.toHaveProperty('bcc');
      const thread = await client.get(`/mail/threads/${row.threadId}`);
      expect(thread.body.items.every((x: any) => !('bcc' in x))).toBe(true);
      const header = headerOf(await rawOf(client, row.id));
      expect(header).toMatch(/^Cc: xem\.mkt@vcworkspace\.test$/m);
      expect(header).toMatch(/^To: nv\.mkt@vcworkspace\.test$/m);
      expect(header).not.toMatch(/^Bcc:/im);
      expect((await rawOf(client, row.id)).toString()).not.toMatch(/nv\.kd@|tp\.kd@/);
    }
    // Người nhận Bcc không tìm ra thư bằng địa chỉ Bcc của người khác.
    expect((await bcc1.get(`/mail/messages?folder=inbox&q=${encodeURIComponent(`tp.kd${D}`)}`)).body.items).toHaveLength(0);

    const sentBox = await a.get('/mail/messages?folder=sent');
    const mine = sentBox.body.items.find((x: any) => x.subject === 'Họp giao ban');
    expect(mine).toMatchObject({ cc: [`xem.mkt${D}`], bcc: [`nv.kd${D}`, `tp.kd${D}`] });
    expect(headerOf(await rawOf(a, mine.id))).not.toMatch(/^Bcc:/im);
    // Mọi bản engine lưu (kể cả bản Đã gửi) đều không có header Bcc.
    const copies = await Promise.all([...[`nv.mkt${D}`, `xem.mkt${D}`, `nv.kd${D}`, `tp.kd${D}`].map((o) => fake.listFolder(o, 'inbox')), fake.listFolder(`tp.mkt${D}`, 'sent')]);
    for (const box of copies) expect(box.length).toBeGreaterThanOrEqual(1);
    for (const m of copies.flat()) expect(headerOf(m.raw)).not.toMatch(/^Bcc:/im);
  });

  it('Idempotency-Key bind cả Cc/Bcc: cùng key khác Cc hoặc Bcc trả 409, cùng nội dung trả lại kết quả cũ', async () => {
    const a = await t.login('tp.mkt');
    const input = { to: [`nv.mkt${D}`], cc: [`xem.mkt${D}`], bcc: [`nv.kd${D}`], subject: 'Idem Cc', text: 'x' };
    const first = await a.post('/mail/send', input, { idem: 'cc-bcc-idem-0001' });
    expect(first.status).toBe(201);
    const replay = await a.post('/mail/send', input, { idem: 'cc-bcc-idem-0001' });
    expect(replay.status).toBe(201); expect(replay.body.id).toBe(first.body.id); expect(replay.body.bcc).toEqual([`nv.kd${D}`]);
    expect((await a.post('/mail/send', { ...input, cc: [`tp.kd${D}`] }, { idem: 'cc-bcc-idem-0001' })).status).toBe(409);
    expect((await a.post('/mail/send', { ...input, bcc: [] }, { idem: 'cc-bcc-idem-0001' })).status).toBe(409);
  });

  it('Cc/Bcc cùng luật địa chỉ nội bộ, giới hạn tổng 50 người nhận và vẫn bắt buộc có To', async () => {
    const a = await t.login('tp.mkt');
    expect((await a.post('/mail/send', { to: [`nv.mkt${D}`], cc: ['person@example.com'], subject: 'x', text: 'x' }, { idem: 'cc-outside-0001' })).status).toBe(400);
    expect((await a.post('/mail/send', { to: [`nv.mkt${D}`], bcc: ['person@example.com'], subject: 'x', text: 'x' }, { idem: 'bcc-outside-0001' })).status).toBe(400);
    expect((await a.post('/mail/send', { to: [], bcc: [`nv.mkt${D}`], subject: 'x', text: 'x' }, { idem: 'bcc-only-0001' })).status).toBe(400);
    const many = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}${D}`);
    expect((await a.post('/mail/send', { to: many('a', 20), cc: many('b', 20), bcc: many('c', 11), subject: 'x', text: 'x' }, { idem: 'cap-0001' })).status).toBe(400);
    expect((await a.post('/mail/drafts', { to: many('a', 20), cc: many('b', 20), bcc: many('c', 11) })).status).toBe(400);
  });

  it('form multipart nhận cc/bcc dạng chuỗi JSON array như to', async () => {
    const a = await t.login('tp.mkt'), cc = await t.login('xem.mkt'), bcc = await t.login('nv.kd');
    const res = await a.upload('/mail/send', { to: JSON.stringify([`nv.mkt${D}`]), cc: JSON.stringify([`xem.mkt${D}`]), bcc: JSON.stringify([`nv.kd${D}`]), subject: 'Multipart Cc', text: 'x' }, undefined, { idem: 'cc-multipart-0001' });
    expect(res.status).toBe(201); expect(res.body).toMatchObject({ cc: [`xem.mkt${D}`], bcc: [`nv.kd${D}`] });
    expect((await cc.get('/mail/messages?folder=inbox')).body.items.some((x: any) => x.subject === 'Multipart Cc')).toBe(true);
    expect((await bcc.get('/mail/messages?folder=inbox')).body.items.some((x: any) => x.subject === 'Multipart Cc')).toBe(true);
    expect((await a.upload('/mail/send', { to: JSON.stringify([`nv.mkt${D}`]), cc: 'not-json', subject: 'x', text: 'x' }, undefined, { idem: 'cc-multipart-0002' })).status).toBe(400);
  });

  it('bản nháp lưu Cc/Bcc, bỏ trùng và lọc HTML', async () => {
    const a = await t.login('tp.mkt');
    const draft = await a.post('/mail/drafts', { to: [`nv.mkt${D}`], cc: [`xem.mkt${D}`, `nv.mkt${D}`], bcc: [`nv.kd${D}`], subject: 'Nháp Cc', text: 'Đậm', html: '<b onclick="x()">Đậm</b><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a>' });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ to: [`nv.mkt${D}`], cc: [`xem.mkt${D}`], bcc: [`nv.kd${D}`], html: '<b>Đậm</b>l' });
    const patched = await a.patch(`/mail/drafts/${draft.body.id}`, { bcc: [`xem.mkt${D}`, `tp.kd${D}`] });
    expect(patched.body).toMatchObject({ cc: [`xem.mkt${D}`], bcc: [`tp.kd${D}`] });
    expect((await a.get(`/mail/drafts/${draft.body.id}`)).body).toMatchObject({ cc: [`xem.mkt${D}`], bcc: [`tp.kd${D}`] });
  });

  it('HTML gửi đi được lọc allowlist trong MIME người nhận', async () => {
    const a = await t.login('tp.mkt'), b = await t.login('nv.mkt');
    const sent = await a.post('/mail/send', { to: [`nv.mkt${D}`], subject: 'HTML lọc', text: 'An toàn', html: '<svg onload=alert(1)><a href=javascript:alert(1)>x</a></svg><p style="color:red"><em>An</em> <a href="https://vcworkspace.test/x">toàn</a></p><style>p{}</style>' }, { idem: 'html-filter-0001' });
    expect(sent.status).toBe(201);
    const row = (await b.get('/mail/messages?folder=inbox')).body.items.find((x: any) => x.subject === 'HTML lọc');
    const raw = (await rawOf(b, row.id)).toString();
    const htmlPart = raw.split(/Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n/)[1].split('\r\n')[0];
    expect(Buffer.from(htmlPart, 'base64').toString('utf8')).toBe('<p><em>An</em> <a href="https://vcworkspace.test/x" rel="noopener noreferrer" target="_blank">toàn</a></p>');
  });
});
