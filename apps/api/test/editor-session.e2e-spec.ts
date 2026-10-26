import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import request from 'supertest';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createTestApp, TestApp } from './support/app';

const SECRET = 'review-o2-isolated-test-secret';
function jwt(payload: unknown) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...(payload as object) })).toString('base64url');
  return `${header}.${body}.${createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')}`;
}

// Review O2/O5: phiên soạn ONLYOFFICE và callback lưu.
describe('Phiên soạn ONLYOFFICE', () => {
  let t: TestApp; let editor: Server; let origin: string;
  const bytes: Record<string, Buffer> = {};
  beforeAll(async () => {
    for (const name of ['force-1', 'force-2', 'final', 'late', 'other']) bytes[name] = createDocumentTemplate(`Bản ${name}`);
    editor = createServer((req, res) => {
      const body = bytes[String(req.url).replace(/^\/cache\//, '').replace(/\.docx$/, '')];
      if (!body) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.end(body);
    });
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(editor.address() as any).port}`;
    t = await createTestApp({ documentEditor: { enabled: true, publicOrigin: origin, internalOrigin: origin,
      apiOriginForEditor: 'http://host.docker.internal:4000', jwtSecret: SECRET } });
  });
  afterAll(async () => { await t.close(); await new Promise<void>((resolve) => editor.close(() => resolve())); });

  async function open(name: string) {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const doc = await manager.post('/drive/documents', { spaceId: space.id, name }, { idem: `review-${name}` });
    expect(doc.status).toBe(201);
    return { manager, spaceId: space.id as string, fileId: doc.body.id as string, ...await config(manager, doc.body.id) };
  }
  async function config(manager: any, fileId: string) {
    const body = (await manager.get(`/drive/files/${fileId}/editor-config`)).body;
    return { key: body.config.document.key as string, ticket: new URL(body.config.editorConfig.callbackUrl).searchParams.get('ticket')! };
  }
  const callback = (ticket: string, payload: Record<string, unknown>) => request(t.app.getHttpServer())
    .post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`).set('Authorization', `Bearer ${jwt(payload)}`).send(payload);
  const meta = async (manager: any, fileId: string) => (await manager.get(`/drive/files/${fileId}`)).body;

  it('O2: forcesave giữ phiên, callback sau cùng key vẫn lưu và người mở sau vào chung phiên', async () => {
    const { manager, fileId, key, ticket } = await open('O2-forcesave');
    expect(key).toBe(`vcw-${fileId}-v1`);
    expect((await callback(ticket, { key, status: 6, url: `${origin}/cache/force-1.docx` })).body).toEqual({ error: 0 });
    expect((await meta(manager, fileId)).versionNumber).toBe(2);
    // Người thứ hai mở trong lúc phiên còn mở: cùng key để Document Server ghép vào phiên đang sửa.
    expect((await config(manager, fileId)).key).toBe(key);
    expect((await callback(ticket, { key, status: 6, url: `${origin}/cache/force-2.docx` })).body).toEqual({ error: 0 });
    expect((await callback(ticket, { key, status: 2, url: `${origin}/cache/final.docx` })).body).toEqual({ error: 0 });
    const after = await meta(manager, fileId);
    expect(after.versionNumber).toBe(4);
    const content = await manager.agent.get(`/api/v1/drive/files/${fileId}/content`).buffer(true)
      .parse((res: any, done: any) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); });
    expect(Buffer.compare(content.body, bytes.final)).toBe(0);
    // Status 2 đóng phiên: lần mở sau là phiên mới, callback trễ của phiên cũ bị loại.
    expect((await config(manager, fileId)).key).toBe(`vcw-${fileId}-v4`);
    expect((await callback(ticket, { key, status: 2, url: `${origin}/cache/late.docx` })).body).toEqual({ error: 1 });
    expect((await meta(manager, fileId)).versionNumber).toBe(4);
  });

  it('O2: version tải lên giữa phiên forcesave làm phiên cũ thành cũ', async () => {
    const { manager, fileId, key, ticket } = await open('O2-upload-giua-phien');
    expect((await callback(ticket, { key, status: 6, url: `${origin}/cache/force-1.docx` })).body).toEqual({ error: 0 });
    const uploaded = await manager.upload(`/drive/files/${fileId}/versions`, {},
      { name: 'O2-upload-giua-phien.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: bytes.other });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.versionNumber).toBe(3);
    expect((await callback(ticket, { key, status: 2, url: `${origin}/cache/final.docx` })).body).toEqual({ error: 1 });
    expect((await meta(manager, fileId)).versionNumber).toBe(3);
    expect((await config(manager, fileId)).key).toBe(`vcw-${fileId}-v3`);
  });
});
