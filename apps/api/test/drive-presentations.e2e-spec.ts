import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import request from 'supertest';
import { createPresentationTemplate } from '../src/modules/drive-basic/pptx-template';
import { createTestApp, expectContract, TestApp } from './support/app';

const SECRET = 'chat06-isolated-test-secret';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
function jwt(payload: unknown) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // Document Server ký callback kèm exp (outbox mặc định 5 phút).
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...(payload as object) })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => done(null, Buffer.concat(chunks)));
  res.on('error', done);
}

describe('Trình chiếu VCworkspace', () => {
  let t: TestApp; let editor: Server; let origin: string; let edited: Buffer;
  beforeAll(async () => {
    edited = createPresentationTemplate('NOI DUNG CHAT06 V2');
    editor = createServer((req, res) => {
      if (req.url?.startsWith('/saved.pptx')) { res.setHeader('Content-Type', PPTX); res.end(edited); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(editor.address() as any).port}`;
    t = await createTestApp({ documentEditor: { enabled: true, publicOrigin: origin, internalOrigin: origin,
      apiOriginForEditor: 'http://host.docker.internal:4000', jwtSecret: SECRET } });
  });
  afterAll(async () => { await t.close(); await new Promise<void>((resolve) => editor.close(() => resolve())); });

  it('tạo ba slide, manager sửa V2, mở lại cùng file và reader chỉ xem', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/presentations', { spaceId: space.id, name: 'Kế hoạch chat06' }, { idem: 'chat06-create' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Kế hoạch chat06.pptx', mimeType: PPTX, versionNumber: 1 });
    const native = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=pptx`).buffer(true).parse(binary as any);
    expect(native.status).toBe(200);
    expectContract('GET', `/api/v1/drive/files/${created.body.id}/export?format=pptx`, native);
    const raw = native.body as Buffer;
    expect(raw.toString('latin1')).toContain('ppt/slides/slide3.xml');
    expect(raw.toString('utf8')).toContain('Bảng kiểm nghiệm thu');

    const config = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    expect(config.body).toMatchObject({ mode: 'edit', config: { documentType: 'slide', document: { fileType: 'pptx' } } });
    const reader = await t.login('nv.mkt'); await reader.get('/spaces');
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    expect(readerConfig.body.mode).toBe('view');
    expect(readerConfig.body.config.document.permissions.edit).toBe(false);
    const ticket = new URL(config.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const callbackBody = { key: config.body.config.document.key, status: 2, url: `${origin}/saved.pptx` };
    const save = await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(callbackBody)}`).send(callbackBody);
    expect(save.body).toEqual({ error: 0 });
    expectContract('POST', `/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`, save);
    const reopened = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    expect(reopened.body.config.document.key).toContain('-v2');
    expect((await manager.get(`/drive/files/${created.body.id}`)).body.versionNumber).toBe(2);
    expect((await manager.get(`/drive/files/${created.body.id}/versions`)).body.items).toHaveLength(2);

    const retry = await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(callbackBody)}`).send(callbackBody);
    expect(retry.body).toEqual({ error: 0 });
    const stale = { ...callbackBody, url: `${origin}/saved.pptx?stale=1` };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(stale)}`).send(stale)).body).toEqual({ error: 1 });
    expect((await manager.get(`/drive/files/${created.body.id}/versions`)).body.items).toHaveLength(2);
  });

  it('không nhận package giả magic PK hoặc callback reader', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/presentations', { spaceId: space.id, name: 'An toàn slide' }, { idem: 'chat06-security' });
    const reader = await t.login('nv.mkt'); await reader.get('/spaces');
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    const readerTicket = new URL(readerConfig.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const body = { key: readerConfig.body.config.document.key, status: 2, url: `${origin}/saved.pptx` };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(readerTicket)}`)
      .set('Authorization', `Bearer ${jwt(body)}`).send(body)).body).toEqual({ error: 1 });
    expect((await manager.get(`/drive/files/${created.body.id}`)).body.versionNumber).toBe(1);
  });
});
