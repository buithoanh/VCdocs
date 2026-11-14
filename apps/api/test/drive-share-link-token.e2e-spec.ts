import { simpleParser } from 'mailparser';
import { createHash } from 'crypto';
import { Errors } from '../src/common/errors';
import { MailBasicService } from '../src/modules/mail-basic/mail-basic.service';
import { createTestApp, TestApp } from './support/app';

const binary = (res: any, done: any) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); };

// Review O14: CSDL không giữ token link chia sẻ dạng rõ sau khi thư chứa link đã gửi.
describe('Link chia sẻ Drive: token rõ', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  async function setup(name: string) {
    const manager = await t.login('tp.mkt'), reader = await t.login('nv.mkt');
    const space = (await manager.get('/spaces')).body.items.find((x: any) => x.kind === 'department');
    await reader.get('/spaces');
    const doc = await manager.post('/drive/documents', { spaceId: space.id, name }, { idem: `review-o14-${name}` });
    const payload = { to: ['nv.mkt@vcworkspace.test'], subject: name, text: 'Mở bản cố định', fileId: doc.body.id,
      versionId: doc.body.currentVersionId, expectedSha256: doc.body.contentSha256, mode: 'link' };
    return { manager, reader, doc, payload };
  }
  async function tokenInInbox(reader: any, subject: string) {
    const inbox = (await reader.get('/mail/messages?folder=inbox')).body.items.find((x: any) => x.subject === subject);
    const mime = await reader.agent.get(`/api/v1/mail/messages/${inbox.id}/raw`).buffer(true).parse(binary);
    return String((await simpleParser(Buffer.from(mime.body))).text || '').match(/\/bo-nho\/lien-ket#([A-Za-z0-9_-]+)/)?.[1];
  }

  it('gửi xong thì chỉ còn tokenHash; gọi lại cùng key trả đúng thư cũ, link vẫn tải được', async () => {
    const { manager, reader, doc, payload } = await setup('O14-token-sau-gui');
    const sent = await manager.post('/mail/send-drive-file', payload, { idem: 'review-o14-token-sent' });
    expect(sent.status).toBe(201);
    const row = await t.db.m.WorkspaceDriveShareLink.findOne({ companyId: t.ids.companyId, fileId: doc.body.id }).lean<any>();
    expect(row.token).toBeUndefined();
    expect(String(row.sentMessageId)).toBe(sent.body.id);
    // Bỏ bản ghi Idempotency của interceptor để lượt gọi lại đi tới service.
    await t.db.m.Idempotency.deleteMany({ companyId: t.ids.companyId, key: 'review-o14-token-sent' });
    const again = await manager.post('/mail/send-drive-file', payload, { idem: 'review-o14-token-sent' });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(sent.body.id);
    expect((await reader.get('/mail/messages?folder=inbox')).body.items.filter((x: any) => x.subject === 'O14-token-sau-gui')).toHaveLength(1);
    const token = await tokenInInbox(reader, 'O14-token-sau-gui');
    expect(createHash('sha256').update(String(token)).digest('hex')).toBe(row.tokenHash);
    expect((await reader.agent.get(`/api/v1/drive/shared-links/${token}`)).status).toBe(200);
  });

  it('gửi lỗi trước khi mail server nhận thì giữ token để retry cùng link', async () => {
    const { manager, reader, doc, payload } = await setup('O14-token-retry');
    const mail = t.app.get(MailBasicService);
    const spy = jest.spyOn(mail, 'send').mockRejectedValueOnce(Errors.storageUnavailable('Mail server chưa xác nhận') as never);
    expect((await manager.post('/mail/send-drive-file', payload, { idem: 'review-o14-token-retry' })).status).toBe(503);
    spy.mockRestore();
    const pending = await t.db.m.WorkspaceDriveShareLink.findOne({ companyId: t.ids.companyId, fileId: doc.body.id }).lean<any>();
    expect(pending.token).toBeTruthy();
    expect((await manager.post('/mail/send-drive-file', payload, { idem: 'review-o14-token-retry' })).status).toBe(201);
    expect(await t.db.m.WorkspaceDriveShareLink.countDocuments({ companyId: t.ids.companyId, fileId: doc.body.id })).toBe(1);
    expect(await tokenInInbox(reader, 'O14-token-retry')).toBe(pending.token);
    expect((await t.db.m.WorkspaceDriveShareLink.findOne({ _id: pending._id, companyId: t.ids.companyId }).lean<any>()).token).toBeUndefined();
  });
});
