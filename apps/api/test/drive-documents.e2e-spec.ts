import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import request from 'supertest';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createTestApp, expectContract, TestApp } from './support/app';

const SECRET = 'chat04-isolated-test-secret';
function jwt(payload: unknown) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // Document Server ký callback kèm exp (outbox mặc định 5 phút).
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...(payload as object) })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('Soạn thảo văn bản VCworkspace', () => {
  let t: TestApp; let editor: Server; let origin: string; let edited: Buffer;
  beforeAll(async () => {
    edited = createDocumentTemplate('Nội dung đã sửa trong ONLYOFFICE');
    editor = createServer((req, res) => {
      if (req.url === '/saved.docx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.end(edited); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(editor.address() as any).port}`;
    t = await createTestApp({ documentEditor: { enabled: true, publicOrigin: origin, internalOrigin: origin,
      apiOriginForEditor: 'http://host.docker.internal:4000', jwtSecret: SECRET } });
  });
  afterAll(async () => { await t.close(); await new Promise<void>((resolve) => editor.close(() => resolve())); });

  it('tạo từ mẫu, reader chỉ xem, callback lưu version bất biến và retry không nhân bản', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/documents', { spaceId: space.id, name: 'Biên bản chat04' }, { idem: 'chat04-create-document' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Biên bản chat04.docx', versionNumber: 1,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const docxExport = await manager.get(`/drive/files/${created.body.id}/export?format=docx`);
    expect(docxExport.status).toBe(200);
    expect(Number(docxExport.headers['content-length'])).toBeGreaterThan(500);
    const initialHash = created.body.contentSha256;
    const managerConfig = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    expect(managerConfig.body.mode).toBe('edit');
    expect(managerConfig.body.config.document.permissions.edit).toBe(true);
    expect(managerConfig.body.config.document.key).toContain('-v1');

    const reader = await t.login('nv.mkt');
    await reader.get('/spaces');
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    expect(readerConfig.body).toMatchObject({ mode: 'view' });
    expect(readerConfig.body.config.document.permissions.edit).toBe(false);
    const ticket = new URL(managerConfig.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const contentTicket = new URL(managerConfig.body.config.document.url).searchParams.get('ticket')!;
    const editorContent = await request(t.app.getHttpServer()).get(`/api/v1/drive/editor/content?ticket=${encodeURIComponent(contentTicket)}`);
    expect(editorContent.status).toBe(200);
    expect(Number(editorContent.headers['content-length'])).toBeGreaterThan(500);
    expectContract('GET', `/api/v1/drive/editor/content?ticket=${encodeURIComponent(contentTicket)}`, editorContent);

    const callbackBody = { key: managerConfig.body.config.document.key, status: 2, url: `${origin}/saved.docx` };
    const save = await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(callbackBody)}`).send(callbackBody);
    expect(save.body).toEqual({ error: 0 });
    expectContract('POST', `/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`, save);
    const reopened = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    expect(reopened.body.config.document.key).toContain('-v2');
    const meta = await manager.get(`/drive/files/${created.body.id}`);
    expect(meta.body.versionNumber).toBe(2);
    expect(meta.body.contentSha256).not.toBe(initialHash);
    const versions = await manager.get(`/drive/files/${created.body.id}/versions`);
    expect(versions.body.items).toHaveLength(2);

    const retry = await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(callbackBody)}`).send(callbackBody);
    expect(retry.body).toEqual({ error: 0 });
    expect((await manager.get(`/drive/files/${created.body.id}/versions`)).body.items).toHaveLength(2);

    const staleBody = { ...callbackBody, url: `${origin}/saved.docx?second-session=1` };
    const stale = await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(staleBody)}`).send(staleBody);
    expect(stale.body).toEqual({ error: 1 });
    expect((await manager.get(`/drive/files/${created.body.id}/versions`)).body.items).toHaveLength(2);
  });

  it('không success giả khi reader callback, JWT sai hoặc URL SSRF', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/documents', { spaceId: space.id, name: 'An toàn callback' }, { idem: 'chat04-security-document' });
    const reader = await t.login('nv.mkt');
    await reader.get('/spaces');
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    const readerTicket = new URL(readerConfig.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const body = { key: readerConfig.body.config.document.key, status: 2, url: `${origin}/saved.docx` };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(readerTicket)}`)
      .set('Authorization', `Bearer ${jwt(body)}`).send(body)).body).toEqual({ error: 1 });
    const managerConfig = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    const ticket = new URL(managerConfig.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', 'Bearer invalid').send(body)).body).toEqual({ error: 1 });
    const ssrf = { key: managerConfig.body.config.document.key, status: 2, url: 'http://169.254.169.254/latest/meta-data/' };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(ssrf)}`).send(ssrf)).body).toEqual({ error: 1 });
    expect((await manager.get(`/drive/files/${created.body.id}`)).body.versionNumber).toBe(1);
  });
});
