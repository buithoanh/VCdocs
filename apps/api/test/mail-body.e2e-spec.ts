import { createTestApp, TestApp } from './support/app';
import { FakeMailPort, MAIL_PORT } from '../src/modules/mail-basic/mail.port';

const D = '@vcworkspace.test';
const mime = (lines: string[]) => Buffer.from(lines.join('\r\n'));

describe('Email: nội dung thư cho khung đọc (GET /mail/messages/{id}/body)', () => {
  let t: TestApp; let fake: FakeMailPort;
  beforeAll(async () => { t = await createTestApp(); fake = t.app.get(MAIL_PORT) as FakeMailPort; });
  afterAll(() => t.close());
  const find = async (c: Awaited<ReturnType<TestApp['login']>>, subject: string, query = 'folder=inbox') => (await c.get(`/mail/messages?${query}`)).body.items.find((x: any) => x.subject === subject);

  it('chủ thư đọc text + html đã lọc và danh sách đính kèm; người khác 404', async () => {
    const a = await t.login('tp.mkt'), b = await t.login('nv.mkt'), other = await t.login('nv.kd');
    const sent = await a.post('/mail/send', {
      to: [`nv.mkt${D}`], subject: 'Body có HTML', text: 'Dòng một\nDòng hai', html: '<p><strong>Đậm</strong> và <a href="https://vcworkspace.test/x">link</a></p>',
      attachments: [{ filename: 'bao-cao.txt', contentType: 'text/plain', contentBase64: Buffer.from('noi dung tep').toString('base64') }],
    }, { idem: 'mail-body-send-0001' });
    expect(sent.status).toBe(201);
    const row = await find(b, 'Body có HTML');
    const res = await b.get(`/mail/messages/${row.id}/body`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.text).toContain('Dòng một\nDòng hai');
    expect(res.body.html).toContain('<strong>Đậm</strong>');
    expect(res.body.html).toContain('<a href="https://vcworkspace.test/x" rel="noopener noreferrer" target="_blank">link</a>');
    expect(res.body).toMatchObject({ hasRemoteContent: false, truncated: false });
    expect(res.body.attachments).toEqual([{ part: 0, filename: 'bao-cao.txt', contentType: 'text/plain', size: 12 }]);
    // Người gửi đọc bản Đã gửi của chính mình.
    const mine = await find(a, 'Body có HTML', 'folder=sent');
    expect((await a.get(`/mail/messages/${mine.id}/body`)).body.html).toContain('<strong>Đậm</strong>');
    // Người không thuộc mailbox: 404 như raw, kể cả id của bản Đã gửi.
    expect((await other.get(`/mail/messages/${row.id}/body`)).status).toBe(404);
    expect((await other.get(`/mail/messages/${mine.id}/body`)).status).toBe(404);
    expect((await a.get(`/mail/messages/${row.id}/body`)).status).toBe(404);
    expect((await b.get('/mail/messages/0123456789abcdef01234567/body')).status).toBe(404);
  });

  it('HTML thư đến độc hại bị vô hiệu hoá và báo có tài nguyên từ xa', async () => {
    const hostile = [
      '<html><head><style>body{background:url(https://tracker.evil.test/bg.png)}</style><script>alert("head")</script></head><body>',
      '<p onclick="steal()">Xin chào <b>bạn</b></p>',
      '<img src="https://tracker.evil.test/pixel.gif" onerror="alert(1)"><img src="cid:logo@x">',
      '<a href="javascript:alert(2)">bấm</a> <a href="  JaVaScRiPt:alert(3)">bấm 2</a> <a href="data:text/html,<script>x</script>">dữ liệu</a>',
      '<a href="https://vcworkspace.test/ok" onmouseover="x()">an toàn</a>',
      '<iframe src="https://evil.test/frame"></iframe><svg onload="alert(4)"><script>alert(5)</script></svg>',
      '<div style="background-image:url(//evil.test/a.png)">khối</div><form action="https://evil.test/post"><input name="p"></form>',
      '<script>document.cookie</script></body></html>',
    ].join('');
    fake.inject(`nv.mkt${D}`, 'inbox', mime(['From: la@ngoai.test', `To: nv.mkt${D}`, 'Subject: Thư độc hại', 'Message-ID: <hostile-body-01@ngoai.test>', 'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Xin chào bạn (bản chữ)', '--b1', 'Content-Type: text/html; charset=utf-8', '', hostile, '--b1--', '']), 'hostile-body-engine-01');
    const b = await t.login('nv.mkt');
    const row = await find(b, 'Thư độc hại');
    const res = await b.get(`/mail/messages/${row.id}/body`);
    expect(res.status).toBe(200);
    const html: string = res.body.html;
    expect(html).toContain('<b>bạn</b>');
    expect(html).toContain('<a href="https://vcworkspace.test/ok" rel="noopener noreferrer" target="_blank">an toàn</a>');
    expect(html).toContain('bấm');
    for (const bad of [/<script/i, /<style/i, /<iframe/i, /<svg/i, /<img/i, /<form/i, /<input/i, /\son[a-z]+=/i, /javascript:/i, /data:/i, /cid:/i, /style=/i, /evil\.test/i, /alert\(/i, /document\.cookie/i])
      expect({ bad: String(bad), match: bad.test(html) }).toEqual({ bad: String(bad), match: false });
    expect(res.body.hasRemoteContent).toBe(true);
    expect(res.body.text).toBe('Xin chào bạn (bản chữ)');
  });

  it('thư chỉ có chữ thuần trả text giữ xuống dòng và không có html', async () => {
    fake.inject(`nv.mkt${D}`, 'inbox', mime(['From: tp.mkt@vcworkspace.test', `To: nv.mkt${D}`, 'Subject: Chỉ chữ', 'Message-ID: <text-only-body-01@vcworkspace.test>', 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8', '', 'Dòng 1', '', '<b>không phải html</b>', '']), 'text-only-body-engine-01');
    const b = await t.login('nv.mkt');
    const row = await find(b, 'Chỉ chữ');
    const res = await b.get(`/mail/messages/${row.id}/body`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('html');
    expect(res.body.text).toContain('Dòng 1\n\n<b>không phải html</b>');
    expect(res.body).toMatchObject({ hasRemoteContent: false, truncated: false, attachments: [] });
  });

  it('hộp thư nhóm: chỉ thành viên có quyền read đọc được nội dung', async () => {
    const admin = await t.login('it'), sender = await t.login('tp.kd'), member = await t.login('nv.mkt'), outsider = await t.login('nv.kd');
    const shared = await admin.post('/mail/shared-mailboxes', { address: `body-team${D}`, name: 'Nhóm đọc body' }, { idem: 'mail-body-shared-01' });
    expect(shared.status).toBe(201);
    expect((await admin.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: `nv.mkt${D}`, roles: ['read'] })).status).toBe(200);
    expect((await sender.post('/mail/send', { to: [shared.body.address], subject: 'Thư nhóm body', text: 'nội dung nhóm' }, { idem: 'mail-body-shared-send-01' })).status).toBe(201);
    const q = `mailbox=${encodeURIComponent(shared.body.address)}`;
    const row = (await member.get(`/mail/messages?folder=inbox&${q}`)).body.items.find((x: any) => x.subject === 'Thư nhóm body');
    const ok = await member.get(`/mail/messages/${row.id}/body?${q}`);
    expect(ok.status).toBe(200); expect(ok.body.text).toContain('nội dung nhóm');
    // Không truyền mailbox → tìm trong hộp cá nhân → 404.
    expect((await member.get(`/mail/messages/${row.id}/body`)).status).toBe(404);
    // Người ngoài nhóm không đọc được (403 như raw/list hộp thư nhóm).
    expect((await outsider.get(`/mail/messages/${row.id}/body?${q}`)).status).toBe(403);
    // Chỉ còn quyền manage (không read) → bị từ chối như raw.
    expect((await admin.patch(`/mail/shared-mailboxes/${shared.body.id}/members`, { email: `nv.mkt${D}`, roles: ['manage'] })).status).toBe(200);
    expect((await member.get(`/mail/messages/${row.id}/body?${q}`)).status).toBe(403);
    expect((await member.agent.get(`/api/v1/mail/messages/${row.id}/raw?${q}`)).status).toBe(403);
  });
});
