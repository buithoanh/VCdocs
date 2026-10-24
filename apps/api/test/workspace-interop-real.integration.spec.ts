import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { createTestApp, TestApp } from './support/app';

function binaryParser(response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error) => callback(error));
}

const enabled = process.env.RUN_CHAT09_REAL_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('Chat09 real Stalwart + Nextcloud integration', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    const required = [
      'POC_BASE_URL',
      'POC_USER_A_VALUE',
      'POC_USER_B_VALUE',
      'MAIL_TEST_A_PASSWORD',
      'MAIL_TEST_B_PASSWORD',
      'STALWART_RECOVERY_ADMIN',
    ];
    for (const name of required) if (!process.env[name]) throw new Error(`Thiếu biến thử ${name}`);
    const recovery = process.env.STALWART_RECOVERY_ADMIN!;
    const separator = recovery.indexOf(':');
    if (separator < 1) throw new Error('Recovery credential thử không hợp lệ');
    testApp = await createTestApp({
      port: 14002,
      publicApiOrigin: 'http://127.0.0.1:14002',
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
      mailEngine: {
        mode: 'stalwart',
        host: '127.0.0.1',
        smtpPort: 18465,
        imapPort: 18993,
        sievePort: 14190,
        controlPort: 19090,
        controlToken: process.env.MAIL_TEST_A_PASSWORD!,
        credentials: {
          'tp.mkt@vcworkspace.test': { username: 'tp.mkt@vcworkspace.test', password: process.env.MAIL_TEST_A_PASSWORD! },
          'nv.mkt@vcworkspace.test': { username: 'nv.mkt@vcworkspace.test', password: process.env.MAIL_TEST_B_PASSWORD! },
        },
        management: {
          baseUrl: 'http://127.0.0.1:18084',
          username: recovery.slice(0, separator),
          password: recovery.slice(separator + 1),
        },
      },
    });
    await testApp.app.listen(14002, '127.0.0.1');
  });

  afterAll(async () => { if (testApp) await testApp.close(); });

  it('keeps one delivery on retry and enforces recipient, ACL, expiry, and revoke', async () => {
    const runId = `chat09-real-${Date.now()}`;
    const manager = await testApp.login('tp.mkt');
    const reader = await testApp.login('nv.mkt');
    const department = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    await reader.get('/spaces');
    const created = await manager.post('/drive/documents', {
      spaceId: department.id,
      name: runId,
    }, { idem: `${runId}-document` });
    expect(created.status).toBe(201);

    const request = {
      to: ['nv.mkt@vcworkspace.test'],
      subject: `CHAT09 REAL LINK ${runId}`,
      text: 'Mở snapshot cố định',
      fileId: created.body.id,
      versionId: created.body.currentVersionId,
      expectedSha256: created.body.contentSha256,
      mode: 'link',
    };
    const sent = await manager.post('/mail/send-drive-file', request, { idem: `${runId}-link` });
    const retry = await manager.post('/mail/send-drive-file', request, { idem: `${runId}-link` });
    expect(sent.status).toBe(201);
    expect(retry.body.id).toBe(sent.body.id);
    expect(await testApp.db.m.WorkspaceDriveShareLink.countDocuments({
      companyId: testApp.ids.companyId,
      fileId: created.body.id,
    })).toBe(1);

    const inbox = await reader.get('/mail/messages?folder=inbox');
    const matches = inbox.body.items.filter((item: any) => item.subject === request.subject);
    expect(matches).toHaveLength(1);
    const rawResponse = await reader.agent.get(`/api/v1/mail/messages/${matches[0].id}/raw`)
      .buffer(true).parse(binaryParser as any);
    const parsed = await simpleParser(Buffer.from(rawResponse.body));
    expect(parsed.text).toContain('http://127.0.0.1:13000/bo-nho/lien-ket#');
    expect(parsed.text).not.toContain('/api/v1/drive/shared-links/');
    const token = parsed.text?.match(/\/bo-nho\/lien-ket#([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();

    const downloaded = await reader.agent.get(`/api/v1/drive/shared-links/${token}`)
      .buffer(true).parse(binaryParser as any);
    expect(downloaded.status).toBe(200);
    expect(createHash('sha256').update(Buffer.from(downloaded.body)).digest('hex')).toBe(created.body.contentSha256);
    expect((await manager.get(`/drive/shared-links/${token}`)).status).toBe(403);

    const row = await testApp.db.m.WorkspaceDriveShareLink.findOne({
      companyId: testApp.ids.companyId,
      fileId: created.body.id,
    }).lean<any>();
    await testApp.db.m.WorkspaceDriveShareLink.updateOne(
      { _id: row._id, companyId: testApp.ids.companyId },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(404);
    await testApp.db.m.WorkspaceDriveShareLink.updateOne(
      { _id: row._id, companyId: testApp.ids.companyId },
      { $set: { expiresAt: new Date(Date.now() + 60_000) }, $unset: { revokedAt: 1 } },
    );
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(200);
    await testApp.db.m.WorkspaceDriveShareLink.updateOne(
      { _id: row._id, companyId: testApp.ids.companyId },
      { $set: { revokedAt: new Date() } },
    );
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(404);

    console.log(`CHAT09_REAL_INTEROP_OK file=${created.body.id} sha256=${created.body.contentSha256} delivery=1 recipient=deny-other expiry=deny revoke=deny`);
  }, 120_000);
});
