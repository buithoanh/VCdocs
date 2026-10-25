import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import request from 'supertest';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createSpreadsheetTemplate } from '../src/modules/drive-basic/xlsx-template';
import { createTestApp, expectContract, TestApp } from './support/app';

const SECRET = 'chat05-isolated-test-secret';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function jwt(payload: unknown) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // Document Server ký callback kèm exp (outbox mặc định 5 phút).
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...(payload as object) })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
function binaryParser(res: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', callback);
}

describe('Bảng tính VCworkspace', () => {
  let t: TestApp; let editor: Server; let origin: string;
  const edited = createSpreadsheetTemplate(4);
  beforeAll(async () => {
    editor = createServer((req, res) => {
      if (req.url === '/saved.xlsx') { res.setHeader('Content-Type', XLSX); res.end(edited); return; }
      if (req.url === '/wrong.docx') { res.end(createDocumentTemplate('Sai loại')); return; }
      if (req.url === '/result.pdf') { res.setHeader('Content-Type', 'application/pdf'); res.end('%PDF-1.4\nCHAT05 TOTAL 10400000\n%%EOF'); return; }
      if (req.url === '/converter' && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ endConvert: true, fileUrl: `${origin}/result.pdf` })); return;
      }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(editor.address() as any).port}`;
    t = await createTestApp({ documentEditor: { enabled: true, publicOrigin: origin, internalOrigin: origin,
      apiOriginForEditor: 'http://host.docker.internal:4000', jwtSecret: SECRET } });
  });
  afterAll(async () => { await t.close(); await new Promise<void>((resolve) => editor.close(() => resolve())); });

  it('tạo XLSX, công thức/filter/sort có expected độc lập, lưu V2 và xuất current XLSX/PDF', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/spreadsheets', { spaceId: space.id, name: 'Báo cáo chat05' }, { idem: 'chat05-create-sheet' });
    expect(created.status).toBe(201);
    expectContract('POST', '/api/v1/drive/spreadsheets', created);
    expect(created.body).toMatchObject({ name: 'Báo cáo chat05.xlsx', mimeType: XLSX, versionNumber: 1 });
    const v1Hash = created.body.contentSha256;

    const config = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    expect(config.body).toMatchObject({ mode: 'edit', config: { documentType: 'cell', document: { fileType: 'xlsx' } } });
    const reader = await t.login('nv.mkt'); await reader.get('/spaces');
    const view = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    expect(view.body.mode).toBe('view'); expect(view.body.config.document.permissions.edit).toBe(false);

    const initial = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=xlsx`).buffer(true).parse(binaryParser as any);
    expect(initial.status).toBe(200);
    expect(Buffer.from(initial.body).toString('latin1')).toContain('SUM(F2:F4)');
    expect(Buffer.from(initial.body).toString('latin1')).toContain('autoFilter');
    expect(Buffer.from(initial.body).toString('latin1')).toContain('sortState');
    // Expected được tính độc lập với cached result trong fixture.
    expect(2 * 1_500_000 + 3 * 800_000 + 1 * 2_000_000).toBe(7_400_000);

    const ticket = new URL(config.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const body = { key: config.body.config.document.key, status: 2, url: `${origin}/saved.xlsx` };
    const saved = await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(body)}`).send(body);
    expect(saved.body).toEqual({ error: 0 });
    const meta = await manager.get(`/drive/files/${created.body.id}`);
    expect(meta.body).toMatchObject({ id: created.body.id, versionNumber: 2, mimeType: XLSX });
    expect(meta.body.contentSha256).not.toBe(v1Hash);
    const reopened = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    expect(reopened.body.config.document.key).toContain('-v2');

    const current = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=xlsx`).buffer(true).parse(binaryParser as any);
    const currentBinary = Buffer.from(current.body).toString('latin1');
    expect(currentBinary).toContain('<c r="D2"><v>4</v></c>');
    expect(currentBinary).toContain('<f>SUM(F2:F4)</f><v>10400000</v>');
    expect(4 * 1_500_000 + 3 * 800_000 + 1 * 2_000_000).toBe(10_400_000);
    const pdf = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=pdf`).buffer(true).parse(binaryParser as any);
    expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await manager.get(`/drive/files/${created.body.id}/versions`)).body.items).toHaveLength(2);
  });

  it('không nhận DOCX giả làm XLSX, callback lặp/stale không làm mất version và reader không ghi', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/spreadsheets', { spaceId: space.id, name: 'An toàn bảng tính' }, { idem: 'chat05-safe-sheet' });
    const config = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    const ticket = new URL(config.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const wrong = { key: config.body.config.document.key, status: 2, url: `${origin}/wrong.docx` };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(ticket)}`)
      .set('Authorization', `Bearer ${jwt(wrong)}`).send(wrong)).body).toEqual({ error: 1 });
    expect((await manager.get(`/drive/files/${created.body.id}`)).body.versionNumber).toBe(1);

    const reader = await t.login('nv.mkt'); await reader.get('/spaces');
    const view = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    const readerTicket = new URL(view.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const readerBody = { key: view.body.config.document.key, status: 2, url: `${origin}/saved.xlsx` };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(readerTicket)}`)
      .set('Authorization', `Bearer ${jwt(readerBody)}`).send(readerBody)).body).toEqual({ error: 1 });
  });
});
