import { createTestApp, TestApp } from './support/app';
import { spawnSync } from 'node:child_process';

function binaryParser(response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error) => callback(error));
}

const enabled = process.env.RUN_ONLYOFFICE_NEXTCLOUD_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('ONLYOFFICE + Nextcloud integration', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    const required = ['POC_BASE_URL', 'POC_USER_A_VALUE', 'POC_USER_B_VALUE', 'DOCUMENT_EDITOR_JWT_SECRET'];
    for (const name of required) if (!process.env[name]) throw new Error('Thiếu biến thử ' + name);
    testApp = await createTestApp({
      port: 14001,
      publicApiOrigin: 'http://127.0.0.1:14001',
      webOrigin: 'http://127.0.0.1:13000',
      workspaceStorage: {
        mode: 'nextcloud',
        baseUrl: process.env.POC_BASE_URL,
        timeoutMs: 10_000,
        credentials: {
          'tp.mkt@vcprosperous.com': { username: 'vcw-poc-a', password: process.env.POC_USER_A_VALUE! },
          'nv.mkt@vcprosperous.com': { username: 'vcw-poc-b', password: process.env.POC_USER_B_VALUE! },
        },
      },
      documentEditor: {
        enabled: true,
        publicOrigin: 'http://127.0.0.1:18082',
        internalOrigin: 'http://127.0.0.1:18082',
        apiOriginForEditor: 'http://host.docker.internal:14001',
        jwtSecret: process.env.DOCUMENT_EDITOR_JWT_SECRET!,
      },
    });
    await testApp.app.listen(14001, '127.0.0.1');
  });

  afterAll(async () => { if (testApp) await testApp.close(); });

  it('creates in Nextcloud, assigns edit/view modes, and converts the current DOCX to a real PDF', async () => {
    const marker = 'NOI DUNG CHAT04 DA LUU 2026-10-23';
    const manager = await testApp.login('tp.mkt');
    const reader = await testApp.login('nv.mkt');
    await reader.get('/spaces');
    const spaces = await manager.get('/spaces');
    const space = spaces.body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/documents', {
      spaceId: space.id,
      name: marker,
    }, { idem: 'chat04-real-engine-document' });

    const managerConfig = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    expect(managerConfig.body.mode).toBe('edit');
    expect(readerConfig.body.mode).toBe('view');
    expect(managerConfig.body.config.document.key).toContain('-v1');

    const docx = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=docx`)
      .buffer(true).parse(binaryParser as any);
    expect(docx.status).toBe(200);
    expect(docx.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const docxBytes = Buffer.from(docx.body);
    expect(docxBytes.subarray(0, 2).toString()).toBe('PK');
    // Template ZIP dùng STORE nên XML xuất hiện nguyên văn trong bytes.
    expect(docxBytes.toString('utf8')).toContain(marker);

    const pdf = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=pdf`)
      .buffer(true).parse(binaryParser as any);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const bytes = Buffer.from(pdf.body);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1_000);
    const extracted = spawnSync('pdftotext', ['-', '-'], { input: bytes, encoding: 'utf8' });
    expect(extracted.status).toBe(0);
    expect(extracted.stdout).toContain(marker);
    console.log(`ONLYOFFICE_PDF_OK file=${created.body.id} bytes=${bytes.length} marker=present`);
  }, 120_000);

  it('creates XLSX in Nextcloud and real engine exports formulas and cached results to PDF', async () => {
    const manager = await testApp.login('tp.mkt');
    const reader = await testApp.login('nv.mkt'); await reader.get('/spaces');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/spreadsheets', { spaceId: space.id, name: 'Bao-cao-chat05' },
      { idem: `chat05-real-engine-sheet-${Date.now()}` });
    const managerConfig = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    expect(managerConfig.body).toMatchObject({ mode: 'edit', config: { documentType: 'cell', document: { fileType: 'xlsx' } } });
    expect(readerConfig.body.mode).toBe('view');

    const xlsx = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=xlsx`)
      .buffer(true).parse(binaryParser as any);
    const xlsxBytes = Buffer.from(xlsx.body); const xml = xlsxBytes.toString('utf8');
    expect(xlsx.status).toBe(200); expect(xlsxBytes.subarray(0, 2).toString()).toBe('PK');
    expect(xml).toContain('<f>SUM(F2:F4)</f><v>7400000</v>');
    expect(xml).toContain('SUMIF(B2:B4'); expect(xml).toContain('VLOOKUP');
    expect(xml).toContain('autoFilter'); expect(xml).toContain('sortState');

    const pdf = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=pdf`)
      .buffer(true).parse(binaryParser as any);
    const pdfBytes = Buffer.from(pdf.body);
    expect(pdf.status).toBe(200); expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    const extracted = spawnSync('pdftotext', ['-', '-'], { input: pdfBytes, encoding: 'utf8' });
    expect(extracted.status).toBe(0); expect(extracted.stdout).toMatch(/7400000(?:\.0)?/);
    console.log(`ONLYOFFICE_XLSX_PDF_OK file=${created.body.id} version=1 xlsxSha=${created.body.contentSha256} pdfBytes=${pdfBytes.length} total=7400000`);
  }, 120_000);

  it('creates a three-slide PPTX in Nextcloud and real engine converts it to a three-page PDF', async () => {
    const manager = await testApp.login('tp.mkt');
    const reader = await testApp.login('nv.mkt'); await reader.get('/spaces');
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const created = await manager.post('/drive/presentations', { spaceId: space.id, name: 'Ke-hoach-chat06' },
      { idem: `chat06-real-engine-slide-${Date.now()}` });
    const managerConfig = await manager.get(`/drive/files/${created.body.id}/editor-config`);
    const readerConfig = await reader.get(`/drive/files/${created.body.id}/editor-config`);
    expect(managerConfig.body).toMatchObject({ mode: 'edit', config: { documentType: 'slide', document: { fileType: 'pptx' } } });
    expect(readerConfig.body.mode).toBe('view');

    const pptx = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=pptx`)
      .buffer(true).parse(binaryParser as any);
    const pptxBytes = Buffer.from(pptx.body); const xml = pptxBytes.toString('utf8');
    expect(pptx.status).toBe(200); expect(pptxBytes.subarray(0, 2).toString()).toBe('PK');
    expect(xml).toContain('ppt/slides/slide3.xml'); expect(xml).toContain('Ba trọng tâm triển khai');
    expect(xml).toContain('Bảng kiểm nghiệm thu'); expect(xml).toContain('Liberation Sans');

    const pdf = await manager.agent.get(`/api/v1/drive/files/${created.body.id}/export?format=pdf`)
      .buffer(true).parse(binaryParser as any);
    const pdfBytes = Buffer.from(pdf.body);
    expect(pdf.status).toBe(200); expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    const extracted = spawnSync('pdftotext', ['-', '-'], { input: pdfBytes, encoding: 'utf8' });
    expect(extracted.status).toBe(0); expect(extracted.stdout).toContain('Ba trọng tâm triển khai');
    expect(extracted.stdout).toContain('Bảng kiểm nghiệm thu');
    const pages = spawnSync('pdfinfo', ['-'], { input: pdfBytes, encoding: 'utf8' });
    expect(pages.status).toBe(0); expect(pages.stdout).toMatch(/Pages:\s+3/);
    console.log(`ONLYOFFICE_PPTX_PDF_OK file=${created.body.id} version=1 pptxSha=${created.body.contentSha256} pdfBytes=${pdfBytes.length} pages=3`);
  }, 120_000);
});
