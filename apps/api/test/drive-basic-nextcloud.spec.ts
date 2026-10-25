import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTestApp, TestApp } from './support/app';

const enabled = process.env.RUN_NEXTCLOUD_INTEGRATION === '1';
const describeNextcloud = enabled ? describe : describe.skip;
const execFile = promisify(execFileCallback);

describeNextcloud('Drive cơ bản qua Nextcloud local', () => {
  let t: TestApp;
  beforeAll(async () => {
    const required = ['POC_BASE_URL', 'POC_USER_A_VALUE', 'POC_USER_B_VALUE'];
    for (const name of required) if (!process.env[name]) throw new Error('Thiếu ' + name);
    t = await createTestApp({ workspaceStorage: {
      mode: 'nextcloud', baseUrl: process.env.POC_BASE_URL,
      timeoutMs: 5_000,
      credentials: {
        'tp.mkt@vcprosperous.com': { username: 'vcw-poc-a', password: process.env.POC_USER_A_VALUE! },
        'nv.mkt@vcprosperous.com': { username: 'vcw-poc-b', password: process.env.POC_USER_B_VALUE! },
      },
    } });
  });
  afterAll(async () => { if (t) await t.close(); });

  it('UI API flow A tạo/upload/list/download, B chỉ đọc và sống qua restart kho', async () => {
    const manager = await t.login('tp.mkt');
    const managerSpaces = await manager.get('/spaces');
    const department = managerSpaces.body.items.find((item: any) => item.kind === 'department');
    expect(department.role).toBe('manager');
    const suffix = Date.now().toString(36);
    expect((await manager.post('/drive/folders', { spaceId: department.id, name: 'API-' + suffix })).status).toBe(201);
    const safeA = await manager.post('/drive/folders', { spaceId: department.id, name: 'Safe-A-' + suffix });
    const safeB = await manager.post('/drive/folders', { spaceId: department.id, name: 'Safe-B-' + suffix });
    const movedFolder = await manager.patch('/drive/items/' + safeA.body.id, { name: 'Safe-A2-' + suffix, parentId: safeB.body.id });
    expect(movedFolder).toMatchObject({ status: 200 });
    expect(movedFolder.body.id).toBe(safeA.body.id);
    const upload = await manager.upload('/drive/files', { spaceId: department.id }, {
      name: 'api-' + suffix + '.txt', type: 'text/plain', content: Buffer.from('nextcloud-product-' + suffix),
    }, { idem: 'nextcloud-api-' + suffix });
    expect(upload.status).toBe(201);
    const list = await manager.get('/drive/items?spaceId=' + department.id);
    expect(list.body.items.map((item: any) => item.id)).toContain(upload.body.id);
    expect((await manager.get('/drive/files/' + upload.body.id + '/content')).text).toBe('nextcloud-product-' + suffix);
    const version2 = await manager.upload('/drive/files/' + upload.body.id + '/versions', {}, {
      name: 'api-' + suffix + '.txt', type: 'text/plain', content: Buffer.from('nextcloud-v2-' + suffix),
    }, { idem: 'nextcloud-version-' + suffix });
    expect(version2.body.versionNumber).toBe(2);
    const versions = await manager.get('/drive/files/' + upload.body.id + '/versions');
    const version1 = versions.body.items.find((item: any) => item.number === 1);
    expect((await manager.post(`/drive/files/${upload.body.id}/versions/${version1.id}/restore`, {})).status).toBe(200);
    expect((await manager.get('/drive/files/' + upload.body.id + '/content')).text).toBe('nextcloud-product-' + suffix);
    expect((await manager.post('/drive/items/' + upload.body.id + '/trash', {})).status).toBe(200);
    expect((await manager.get('/drive/trash?spaceId=' + department.id)).body.items.map((item: any) => item.id)).toContain(upload.body.id);
    expect((await manager.post('/drive/items/' + upload.body.id + '/restore', {})).status).toBe(200);

    const reader = await t.login('nv.mkt');
    const readerSpaces = await reader.get('/spaces');
    const readerDepartment = readerSpaces.body.items.find((item: any) => item.kind === 'department');
    expect(readerDepartment).toMatchObject({ id: department.id, role: 'reader' });
    expect((await reader.post('/drive/folders', { spaceId: department.id, name: 'denied-' + suffix })).status).toBe(403);
    expect((await reader.get('/drive/files/' + upload.body.id + '/content')).text).toBe('nextcloud-product-' + suffix);

    await execFile('docker', ['compose', '-p', 'vcworkspace-drive-poc', 'restart', 'nextcloud'], {
      cwd: '../../poc/drive-nextcloud', timeout: 30_000,
    });
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await fetch(process.env.POC_BASE_URL + '/status.php')).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const metadata = await manager.get('/drive/files/' + upload.body.id);
    const content = await manager.get('/drive/files/' + upload.body.id + '/content');
    expect(metadata.body.contentSha256).toBe(upload.body.contentSha256);
    expect(content.headers['x-content-sha256']).toBe(upload.body.contentSha256);
    expect(content.text).toBe('nextcloud-product-' + suffix);
    const evidenceDir = resolve('../../poc/drive-nextcloud/evidence');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(resolve(evidenceDir, 'api-nextcloud-' + suffix + '.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), runId: suffix, endpoint: 'http://127.0.0.1:18080',
      storageMode: 'nextcloud', googleMode: 'fake', database: 'temporary',
      manager: { createFolder: 'pass', renameMoveStableId: 'pass', upload: 'pass', list: 'pass', download: 'pass',
        versionRestoreChecksum: 'pass', trashRestore: 'pass' },
      reader: { list: 'pass', download: 'pass', createFolder: 'forbidden' },
      restart: { container: 'pass', metadata: 'pass', bytes: 'pass', checksum: 'pass' },
      file: { id: upload.body.id, contentSha256: upload.body.contentSha256, size: upload.body.size },
      browserVerified: false,
    }, null, 2) + '\n', { mode: 0o600 });
  }, 60_000);
});
