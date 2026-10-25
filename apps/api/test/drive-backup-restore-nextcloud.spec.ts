import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { createTestApp, TestApp } from './support/app';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/config';
import { Db } from '../src/db/db.service';
import { GOOGLE } from '../src/google/ports';
import { FakeGoogle } from '../src/google/fake/fake-google';
import { addDemoDirectory, addDemoDrive, DEMO_DEPTS } from '../src/seed/demo-seed';

const enabled = process.env.RUN_NEXTCLOUD_RESTORE === '1';
const describeRestore = enabled ? describe : describe.skip;
const execFile = promisify(execFileCallback);
const image = 'nextcloud@sha256:f6653516c000dd83a8ead6d7eda3ccdc6437fee78153bae71702c70f727dd79b';

describeRestore('Drive backup/restore usable trên Nextcloud local', () => {
  let source: TestApp;
  afterAll(async () => { if (source) await source.close(); });

  it('boot volume mới + DB metadata mới và tải đúng fileId/checksum/quyền', async () => {
    for (const name of ['POC_BASE_URL', 'POC_USER_A_VALUE', 'POC_USER_B_VALUE', 'TEST_MONGO_URI']) {
      if (!process.env[name]) throw new Error('Thiếu biến thử ' + name);
    }
    source = await createTestApp({ workspaceStorage: {
      mode: 'nextcloud', baseUrl: process.env.POC_BASE_URL, timeoutMs: 5_000,
      credentials: {
        'tp.mkt@vcprosperous.com': { username: 'vcw-poc-a', password: process.env.POC_USER_A_VALUE! },
        'nv.mkt@vcprosperous.com': { username: 'vcw-poc-b', password: process.env.POC_USER_B_VALUE! },
      },
    } });
    const manager = await source.login('tp.mkt');
    const spaces = await manager.get('/spaces');
    const space = spaces.body.items.find((item: any) => item.kind === 'department');
    const runId = 'restore-' + Date.now().toString(36);
    const bytes = Buffer.from('usable-backup-restore-' + runId);
    const uploaded = await manager.upload('/drive/files', { spaceId: space.id }, {
      name: runId + '.txt', type: 'text/plain', content: bytes,
    }, { idem: runId });
    expect(uploaded.status).toBe(201);
    const sourceReader = await source.login('nv.mkt');
    expect((await sourceReader.get('/spaces')).body.items.find((item: any) => item.id === space.id)).toMatchObject({ role: 'reader' });

    const collections = await source.db.conn.db!.listCollections({}, { nameOnly: true }).toArray();
    const snapshot: Record<string, any[]> = {};
    for (const { name } of collections) snapshot[name] = await source.db.conn.collection(name).find({}).toArray();

    const restoredDbName = 'chat03_' + runId.replace(/-/g, '_');
    const restoredDb = source.db.conn.useDb(restoredDbName, { useCache: false });
    for (const [name, docs] of Object.entries(snapshot)) if (docs.length) await restoredDb.collection(name).insertMany(docs);

    const volume = 'vcworkspace_drive_chat03_usable_' + runId.replace(/-/g, '_');
    const container = 'vcworkspace-drive-chat03-' + runId;
    const archive = `/private/tmp/${runId}.tar.gz`;
    const compose = ['compose', '--env-file', 'poc/drive-nextcloud/.poc-secrets', '-p', 'vcworkspace-drive-poc',
      '-f', 'poc/drive-nextcloud/compose.yaml'];
    let sourceStopped = false;
    try {
      await execFile('docker', [...compose, 'stop', 'nextcloud'], { cwd: resolve('../..'), timeout: 30_000 });
      sourceStopped = true;
      await execFile('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', 'vcworkspace_drive_poc_nextcloud:/source:ro',
        '-v', '/private/tmp:/backup', image, '-c', `cd /source && tar -czf /backup/${runId}.tar.gz .`], { timeout: 120_000 });
      await execFile('docker', ['volume', 'create', volume]);
      await execFile('docker', ['run', '--rm', '--entrypoint', 'sh', '-v', `${volume}:/restore`,
        '-v', '/private/tmp:/backup:ro', image, '-c', `cd /restore && tar -xzf /backup/${runId}.tar.gz`], { timeout: 120_000 });
      await execFile('docker', [...compose, 'start', 'nextcloud'], { cwd: resolve('../..'), timeout: 30_000 });
      sourceStopped = false;
      await execFile('docker', ['run', '-d', '--name', container, '-p', '127.0.0.1:18081:80',
        '-v', `${volume}:/var/www/html`, image]);
      for (let attempt = 0; attempt < 60; attempt++) {
        try { if ((await fetch('http://127.0.0.1:18081/status.php')).ok) break; } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      for (const [user, password] of [['vcw-poc-a', process.env.POC_USER_A_VALUE!], ['vcw-poc-b', process.env.POC_USER_B_VALUE!]]) {
        await execFile('docker', ['exec', '-u', 'www-data', '-e', 'OC_PASS', container, 'php', 'occ',
          'user:resetpassword', '--password-from-env', user], { env: { ...process.env, OC_PASS: password }, timeout: 30_000 });
      }

      const base = process.env.TEST_MONGO_URI!;
      const restoredUri = base.replace(/\/?(\?|$)/, `/${restoredDbName}$1`);
      const cfg = loadConfig({ NODE_ENV: 'test', GOOGLE_MODE: 'fake' } as any, {
        mongoUri: restoredUri, jobsPollMs: 0, schedulerEnabled: false, seedDemo: false,
        vaultDir: ':memory:', cookieSecure: false, workspaceStorage: {
          mode: 'nextcloud', baseUrl: 'http://127.0.0.1:18081', timeoutMs: 5_000,
          credentials: {
            'tp.mkt@vcprosperous.com': { username: 'vcw-poc-a', password: process.env.POC_USER_A_VALUE! },
            'nv.mkt@vcprosperous.com': { username: 'vcw-poc-b', password: process.env.POC_USER_B_VALUE! },
          },
        },
      });
      const app = await createApp(cfg, { logger: false });
      const restoredFake = app.get(GOOGLE) as FakeGoogle;
      addDemoDirectory(restoredFake);
      for (const department of DEMO_DEPTS) addDemoDrive(restoredFake, department);
      const server = app.getHttpServer();
      const login = async (email: string) => {
        const agent = request.agent(server);
        const start = await agent.get('/api/v1/auth/google');
        const location = new URL(start.headers.location);
        const state = location.searchParams.get('state')!;
        const nonce = location.searchParams.get('nonce')!;
        const callback = await agent.get(`/api/v1/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`fake|${email}|${nonce}`)}`);
        if (callback.status !== 302 || String(callback.headers.location).includes('loi=')) {
          throw new Error(`Restore login callback failed: ${callback.status} ${callback.headers.location}`);
        }
        const me = await agent.get('/api/v1/me');
        if (me.status !== 200) throw new Error(`Restore login /me failed: ${me.status} ${JSON.stringify(me.body)}`);
        return { agent, csrf: me.body.csrfToken };
      };
      try {
        const restoredManager = await login('tp.mkt@vcprosperous.com');
        const content = await restoredManager.agent.get('/api/v1/drive/files/' + uploaded.body.id + '/content');
        expect(content.status).toBe(200);
        expect(content.text).toBe(bytes.toString());
        expect(content.headers['x-content-sha256']).toBe(uploaded.body.contentSha256);
        const metadata = await restoredManager.agent.get('/api/v1/drive/files/' + uploaded.body.id);
        expect(metadata.body).toMatchObject({ id: uploaded.body.id, currentVersionId: uploaded.body.currentVersionId,
          versionNumber: 1, contentSha256: uploaded.body.contentSha256 });
        const reader = await login('nv.mkt@vcprosperous.com');
        expect((await reader.agent.get('/api/v1/drive/files/' + uploaded.body.id + '/content')).status).toBe(200);
        expect((await reader.agent.patch('/api/v1/drive/items/' + uploaded.body.id)
          .set('X-CSRF-Token', reader.csrf).send({ name: 'denied.txt' })).status).toBe(403);
      } finally {
        await app.close();
      }

      const evidenceDir = resolve('../../poc/drive-nextcloud/evidence');
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(resolve(evidenceDir, 'chat03-usable-restore-' + runId + '.json'), JSON.stringify({
        generatedAt: new Date().toISOString(), runId, sourceVolume: 'vcworkspace_drive_poc_nextcloud',
        restoredVolume: volume, restoredContainer: container, restoredEndpoint: 'http://127.0.0.1:18081',
        restoredDatabase: restoredDbName, archive, file: { id: uploaded.body.id, name: uploaded.body.name,
          currentVersionId: uploaded.body.currentVersionId, versionNumber: 1, size: uploaded.body.size,
          contentSha256: uploaded.body.contentSha256 }, managerDownload: 'pass', readerDownload: 'pass',
        readerWrite: 'denied', sourcePreserved: true, cleanupPerformed: false,
      }, null, 2) + '\n', { mode: 0o600 });
    } finally {
      if (sourceStopped) await execFile('docker', [...compose, 'start', 'nextcloud'], { cwd: resolve('../..'), timeout: 30_000 });
    }
  }, 240_000);
});
