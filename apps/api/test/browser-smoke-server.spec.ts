import { createTestApp, TestApp } from './support/app';
import { createServer, Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function binaryParser(response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

const enabled = process.env.RUN_BROWSER_SMOKE_SERVER === '1';
const describeBrowser = enabled ? describe : describe.skip;
const holdMs = Number(process.env.BROWSER_SMOKE_HOLD_MS || 900_000);

describeBrowser('Browser smoke server', () => {
  let testApp: TestApp;
  let evidenceServer: Server;

  beforeAll(async () => {
    const required = ['POC_BASE_URL', 'POC_USER_A_VALUE', 'POC_USER_B_VALUE'];
    for (const name of required) if (!process.env[name]) throw new Error('Thiếu biến thử ' + name);
    testApp = await createTestApp({
      port: 14000,
      publicApiOrigin: 'http://127.0.0.1:14000',
      webOrigin: 'http://127.0.0.1:13000',
      workspaceStorage: {
        mode: 'nextcloud',
        baseUrl: process.env.POC_BASE_URL,
        timeoutMs: 5_000,
        credentials: {
          'tp.mkt@vcprosperous.com': { username: 'vcw-poc-a', password: process.env.POC_USER_A_VALUE! },
          'nv.mkt@vcprosperous.com': { username: 'vcw-poc-b', password: process.env.POC_USER_B_VALUE! },
        },
      },
      documentEditor: {
        enabled: true,
        publicOrigin: 'http://127.0.0.1:18082',
        internalOrigin: 'http://127.0.0.1:18082',
        apiOriginForEditor: 'http://host.docker.internal:14000',
        jwtSecret: process.env.DOCUMENT_EDITOR_JWT_SECRET || 'vcworkspace-test-editor-secret',
      },
    });
    const manager = await testApp.login('tp.mkt');
    const spaces = await manager.get('/spaces');
    const space = spaces.body.items.find((item: any) => item.kind === 'department');
    const suffix = process.env.BROWSER_SMOKE_RUN_ID || Date.now().toString(36);
    await manager.post('/drive/folders', { spaceId: space.id, name: 'UI03-A-' + suffix });
    await manager.post('/drive/folders', { spaceId: space.id, name: 'UI03-B-' + suffix });
    const file = await manager.upload('/drive/files', { spaceId: space.id }, {
      name: 'ui03-' + suffix + '.txt', type: 'text/plain', content: Buffer.from('chat03-version-one-' + suffix),
    }, { idem: 'ui03-v1-' + suffix });
    await manager.upload('/drive/files/' + file.body.id + '/versions', {}, {
      name: file.body.name, type: 'text/plain', content: Buffer.from('chat03-version-two-' + suffix),
    }, { idem: 'ui03-v2-' + suffix });
    const document = await manager.post('/drive/documents', { spaceId: space.id,
      name: 'Bien-ban-chat04-' + suffix }, { idem: 'ui04-document-' + suffix });
    const spreadsheet = await manager.post('/drive/spreadsheets', { spaceId: space.id,
      name: 'Bao-cao-chat05-' + suffix }, { idem: 'ui05-spreadsheet-' + suffix });
    const presentation = await manager.post('/drive/presentations', { spaceId: space.id,
      name: 'Ke-hoach-chat06-' + suffix }, { idem: 'ui06-presentation-' + suffix });
    console.log(`VCworkspace browser seed ${suffix} file=${file.body.id} shaV1=${file.body.contentSha256}`);
    console.log(`VCworkspace browser document ${suffix} file=${document.body.id} shaV1=${document.body.contentSha256}`);
    console.log(`VCworkspace browser spreadsheet ${suffix} file=${spreadsheet.body.id} shaV1=${spreadsheet.body.contentSha256}`);
    console.log(`VCworkspace browser presentation ${suffix} file=${presentation.body.id} shaV1=${presentation.body.contentSha256}`);
    await testApp.app.listen(14000, '127.0.0.1');
    evidenceServer = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1:14002');
        const fileId = url.searchParams.get('fileId');
        if (!['/chat05-evidence', '/chat06-evidence'].includes(url.pathname) || !fileId) { res.statusCode = 404; res.end(); return; }
        const meta = await manager.get(`/drive/files/${fileId}`);
        const versions = await manager.get(`/drive/files/${fileId}/versions`);
        const isSlide = url.pathname === '/chat06-evidence';
        const nativeFormat = isSlide ? 'pptx' : 'xlsx';
        const native = await manager.agent.get(`/api/v1/drive/files/${fileId}/export?format=${nativeFormat}`).buffer(true).parse(binaryParser as any);
        const pdf = await manager.agent.get(`/api/v1/drive/files/${fileId}/export?format=pdf`).buffer(true).parse(binaryParser as any);
        if (native.status !== 200 || pdf.status !== 200) throw new Error(`EXPORT_${native.status}_${pdf.status}`);
        const nativeBytes = Buffer.from(native.body); const pdfBytes = Buffer.from(pdf.body);
        const evidenceDir = resolve(__dirname, '../../../poc/onlyoffice/evidence'); await mkdir(evidenceDir, { recursive: true });
        const prefix = isSlide ? 'chat06-browser-v2' : 'chat05-browser-v2';
        await writeFile(resolve(evidenceDir, `${prefix}.${nativeFormat}`), nativeBytes);
        await writeFile(resolve(evidenceDir, `${prefix}.pdf`), pdfBytes);
        const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
        const evidence = { runId: suffix, fileId, versionNumber: meta.body.versionNumber,
          currentContentSha256: meta.body.contentSha256,
          versions: versions.body.items.map((item: any) => ({ id: item.id, number: item.number, contentSha256: item.contentSha256 })),
          [`${nativeFormat}Bytes`]: nativeBytes.length, [`${nativeFormat}Sha256`]: sha(nativeBytes),
          pdfBytes: pdfBytes.length, pdfSha256: sha(pdfBytes) };
        await writeFile(resolve(evidenceDir, `${prefix}.json`), JSON.stringify(evidence, null, 2) + '\n');
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(evidence));
      } catch (error: any) { res.statusCode = 500; res.end(JSON.stringify({ error: error?.message || 'UNKNOWN' })); }
    });
    await new Promise<void>((resolveReady) => evidenceServer.listen(14002, '127.0.0.1', resolveReady));
    console.log('VCworkspace browser smoke ready at http://127.0.0.1:14000');
    console.log('VCworkspace browser evidence ready at http://127.0.0.1:14002/chat05-evidence?fileId=...');
    console.log('VCworkspace slide evidence ready at http://127.0.0.1:14002/chat06-evidence?fileId=...');
  });

  afterAll(async () => {
    if (evidenceServer) await new Promise<void>((resolveClose) => evidenceServer.close(() => resolveClose()));
    if (testApp) await testApp.close();
  });

  it('keeps the isolated test application available for browser verification', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, holdMs));
  }, holdMs + 30_000);
});
