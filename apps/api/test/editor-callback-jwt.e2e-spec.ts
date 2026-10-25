import { createHash, createHmac } from 'crypto';
import { createServer, Server } from 'http';
import request from 'supertest';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createTestApp, TestApp } from './support/app';

const SECRET = 'audit06-isolated-test-secret';
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(payload: unknown, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }, secret = SECRET) {
  const head = b64(header); const body = b64(payload);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
const exp = (seconds = 300) => Math.floor(Date.now() / 1000) + seconds;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Audit 6/12 (drive-basic/editor-callback/jwt-signature-only-unbound-payload):
// callback chỉ tin token do Document Server ký (HS256, có exp) và lấy key/status/url từ payload đã ký.
describe('Callback ONLYOFFICE ràng buộc JWT với payload', () => {
  let t: TestApp; let editor: Server; let origin: string; let saved: Buffer; let other: Buffer; const hits: string[] = [];
  beforeAll(async () => {
    saved = createDocumentTemplate('Bản do Document Server lưu');
    other = createDocumentTemplate('Bản của tài liệu khác trong cache');
    editor = createServer((req, res) => {
      hits.push(String(req.url));
      const bytes = req.url?.startsWith('/saved') ? saved : req.url?.startsWith('/cache/other') ? other : undefined;
      if (!bytes) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.end(bytes);
    });
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(editor.address() as any).port}`;
    t = await createTestApp({ documentEditor: { enabled: true, publicOrigin: origin, internalOrigin: origin,
      apiOriginForEditor: 'http://host.docker.internal:4000', jwtSecret: SECRET } });
  });
  afterAll(async () => { await t.close(); await new Promise<void>((resolve) => editor.close(() => resolve())); });
  afterEach(() => jest.restoreAllMocks());

  async function open(name: string) {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const doc = await manager.post('/drive/documents', { spaceId: space.id, name }, { idem: `audit06-${name}` });
    expect(doc.status).toBe(201);
    const config = (await manager.get(`/drive/files/${doc.body.id}/editor-config`)).body;
    expect(config.mode).toBe('edit');
    const ticket = new URL(config.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const contentTicket = new URL(config.config.document.url).searchParams.get('ticket')!;
    return { manager, fileId: doc.body.id as string, config: config.config, key: config.config.document.key as string, ticket, contentTicket };
  }
  const callback = (ticket: string) => request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`);

  it('token cấu hình trình duyệt không dùng được làm token callback', async () => {
    const { manager, fileId, config, key, ticket } = await open('Audit06-token-trinh-duyet');
    const body = { key, status: 2, url: `${origin}/cache/other/output.docx` };
    hits.length = 0;
    expect((await callback(ticket).set('Authorization', `Bearer ${config.token}`).send(body)).body).toEqual({ error: 1 });
    expect((await callback(ticket).send({ ...body, token: config.token })).body).toEqual({ error: 1 });
    expect(hits).toEqual([]);
    expect((await manager.get(`/drive/files/${fileId}`)).body.versionNumber).toBe(1);
  });

  it('key/status/url lấy từ payload đã ký, không lấy từ body', async () => {
    const { manager, fileId, key, ticket } = await open('Audit06-body-khong-ky');
    const signed = { key, status: 2, url: `${origin}/saved.docx`, exp: exp() };
    hits.length = 0;
    const res = await callback(ticket).set('Authorization', `Bearer ${jwt(signed)}`)
      .send({ key, status: 2, url: `${origin}/cache/other/output.docx` });
    expect(res.body).toEqual({ error: 0 });
    expect(hits).toEqual(['/saved.docx']);
    const meta = (await manager.get(`/drive/files/${fileId}`)).body;
    expect(meta.versionNumber).toBe(2);
    expect(meta.contentSha256).toBe(sha(saved));

    // Payload đã ký không có status lưu thì body status 2 không làm gì.
    const { manager: m2, fileId: f2, key: k2, ticket: t2 } = await open('Audit06-status-khong-ky');
    hits.length = 0;
    expect((await callback(t2).set('Authorization', `Bearer ${jwt({ key: k2, status: 1, exp: exp() })}`)
      .send({ key: k2, status: 2, url: `${origin}/saved.docx` })).body).toEqual({ error: 0 });
    expect(hits).toEqual([]);
    expect((await m2.get(`/drive/files/${f2}`)).body.versionNumber).toBe(1);
  });

  it('bắt buộc HS256 và exp còn hạn', async () => {
    const { manager, fileId, key, ticket } = await open('Audit06-thieu-exp');
    const body = { key, status: 2, url: `${origin}/saved.docx` };
    hits.length = 0;
    for (const token of [
      jwt(body),
      jwt({ ...body, exp: exp(-60) }),
      jwt({ ...body, exp: exp() }, { alg: 'none', typ: 'JWT' }),
      jwt({ ...body, exp: exp() }, { alg: 'HS512', typ: 'JWT' }),
      jwt({ ...body, exp: exp() }, { alg: 'HS256', typ: 'JWT' }, 'audit06-other-secret'),
    ]) expect((await callback(ticket).set('Authorization', `Bearer ${token}`).send(body)).body).toEqual({ error: 1 });
    expect(hits).toEqual([]);
    expect((await manager.get(`/drive/files/${fileId}`)).body.versionNumber).toBe(1);
  });

  it('nhận đúng hai dạng token của ONLYOFFICE: header bọc payload và token trong body', async () => {
    const header = await open('Audit06-token-header');
    const body = { key: header.key, status: 2, url: `${origin}/saved.docx?header=1`, users: ['u1'] };
    const now = Math.floor(Date.now() / 1000);
    expect((await callback(header.ticket).set('Authorization', `Bearer ${jwt({ payload: body, iat: now, exp: now + 300 })}`).send(body)).body)
      .toEqual({ error: 0 });
    expect((await header.manager.get(`/drive/files/${header.fileId}`)).body.versionNumber).toBe(2);

    const inBody = await open('Audit06-token-body');
    const fields = { key: inBody.key, status: 2, url: `${origin}/saved.docx?body=1`, users: ['u1'] };
    expect((await callback(inBody.ticket).send({ ...fields, token: jwt({ ...fields, iat: now, exp: now + 300 }) })).body)
      .toEqual({ error: 0 });
    expect((await inBody.manager.get(`/drive/files/${inBody.fileId}`)).body.versionNumber).toBe(2);
  });

  it('O1: callback sau 15 phút vẫn lưu, còn vé callback không dùng để tải nội dung', async () => {
    const { manager, fileId, key, ticket, contentTicket } = await open('Audit06-phien-dai');
    expect((await request(t.app.getHttpServer()).get(`/api/v1/drive/editor/content?ticket=${encodeURIComponent(ticket)}`)).status)
      .toBeGreaterThanOrEqual(400);
    const real = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => real() + 40 * 60_000);
    expect((await request(t.app.getHttpServer()).get(`/api/v1/drive/editor/content?ticket=${encodeURIComponent(contentTicket)}`)).status)
      .toBe(403);
    const body = { key, status: 2, url: `${origin}/saved.docx?late=1`, exp: exp() };
    expect((await callback(ticket).set('Authorization', `Bearer ${jwt(body)}`).send(body)).body).toEqual({ error: 0 });
    jest.restoreAllMocks();
    expect((await manager.get(`/drive/files/${fileId}`)).body.versionNumber).toBe(2);
  });
});
