import { createTestApp, TestApp } from './support/app';

const D = '@vcworkspace.test';

/** Trả lời / Trả lời tất cả: bản trả lời cùng threadId với thư gốc ở mọi mailbox liên quan (cổng mail giả). */
describe('Email trả lời theo luồng', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); }); afterAll(() => t.close());
  const messageId = async (id: string) => (await t.db.m.WorkspaceMailMessage.findOne({ _id: id, companyId: t.ids.companyId }).lean<any>()).internetMessageId as string;

  it('trả lời tất cả từ mailbox cá nhân: người gửi và người nhận Cc thấy cùng threadId', async () => {
    const a = await t.login('tp.mkt'), b = await t.login('nv.mkt'), c = await t.login('xem.mkt');
    const sent = await a.post('/mail/send', { to: [`nv.mkt${D}`], cc: [`xem.mkt${D}`], subject: 'Kế hoạch', text: 'Gốc' }, { idem: 'reply-thread-orig-01' });
    expect(sent.status).toBe(201);
    const inbox = (await b.get('/mail/messages?folder=inbox')).body.items.find((x: any) => x.subject === 'Kế hoạch');
    const original = await messageId(inbox.id);
    const reply = await b.post('/mail/send', { to: [`tp.mkt${D}`], cc: [`xem.mkt${D}`], subject: 'Re: Kế hoạch', text: 'Đã nhận', inReplyTo: original, references: [original] }, { idem: 'reply-thread-reply-01' });
    expect(reply.status).toBe(201);
    expect(reply.body.threadId).toBe(sent.body.threadId);
    expect(reply.body.inReplyTo).toBe(original);
    for (const [client, count] of [[a, 2], [b, 2], [c, 2]] as const) {
      const thread = await client.get(`/mail/threads/${sent.body.threadId}`);
      expect(thread.status).toBe(200);
      expect(thread.body.items.map((x: any) => x.subject)).toHaveLength(count);
    }
    const raw = (await t.db.m.WorkspaceMailMessage.findOne({ companyId: t.ids.companyId, mailboxOwner: `tp.mkt${D}`, subject: 'Re: Kế hoạch' }).lean<any>());
    expect(raw).toMatchObject({ threadId: sent.body.threadId, inReplyTo: original, references: [original] });
  });

  it('trả lời trong hộp nhóm: có quyền gửi thì gửi từ hộp nhóm, chỉ đọc thì gửi từ cá nhân; đều cùng threadId', async () => {
    const admin = await t.login('it'), sender = await t.login('tp.kd'), member = await t.login('nv.mkt'), reader = await t.login('xem.mkt');
    const box = await admin.post('/mail/shared-mailboxes', { address: `nhom-tl${D}`, name: 'Nhóm trả lời' }, { idem: 'reply-shared-create-01' });
    expect(box.status).toBe(201);
    expect((await admin.patch(`/mail/shared-mailboxes/${box.body.id}/members`, { email: `nv.mkt${D}`, roles: ['read', 'send'] })).status).toBe(200);
    expect((await admin.patch(`/mail/shared-mailboxes/${box.body.id}/members`, { email: `xem.mkt${D}`, roles: ['read'] })).status).toBe(200);
    const sent = await sender.post('/mail/send', { to: [`nhom-tl${D}`], subject: 'Hỏi nhóm', text: 'Câu hỏi' }, { idem: 'reply-shared-orig-01' });
    expect(sent.status).toBe(201);
    const q = `mailbox=${encodeURIComponent(`nhom-tl${D}`)}`;
    const inbound = (await member.get(`/mail/messages?folder=inbox&${q}`)).body.items.find((x: any) => x.subject === 'Hỏi nhóm');
    const original = await messageId(inbound.id);

    const fromBox = await member.post('/mail/send', { fromIdentity: `nhom-tl${D}`, mailbox: `nhom-tl${D}`, to: [`tp.kd${D}`], subject: 'Re: Hỏi nhóm', text: 'Nhóm trả lời', inReplyTo: original, references: [original] }, { idem: 'reply-shared-send-01' });
    expect(fromBox.status).toBe(201);
    expect(fromBox.body).toMatchObject({ from: `nhom-tl${D}`, threadId: inbound.threadId });

    // Chỉ quyền đọc: không gửi được bằng hộp nhóm, gửi bằng cá nhân vẫn vào đúng luồng.
    expect((await reader.post('/mail/send', { fromIdentity: `nhom-tl${D}`, mailbox: `nhom-tl${D}`, to: [`tp.kd${D}`], subject: 'Re: Hỏi nhóm', text: 'x', inReplyTo: original }, { idem: 'reply-shared-denied-01' })).status).toBe(403);
    const personal = await reader.post('/mail/send', { mailbox: `nhom-tl${D}`, to: [`tp.kd${D}`], subject: 'Re: Hỏi nhóm', text: 'Cá nhân trả lời', inReplyTo: original, references: [original] }, { idem: 'reply-shared-personal-01' });
    expect(personal.status).toBe(201);
    expect(personal.body).toMatchObject({ from: `xem.mkt${D}`, threadId: inbound.threadId });

    expect(inbound.threadId).toBe(sent.body.threadId);
    expect((await sender.get(`/mail/threads/${sent.body.threadId}`)).body.items).toHaveLength(3);
    expect((await member.get(`/mail/threads/${sent.body.threadId}?${q}`)).body.items.map((x: any) => x.folder).sort()).toEqual(['inbox', 'sent']);
    // Không đọc được mailbox thì không dùng nó để tìm thư gốc.
    expect((await sender.post('/mail/send', { mailbox: `nhom-tl${D}`, to: [`nv.mkt${D}`], subject: 'Re: x', text: 'x', inReplyTo: original }, { idem: 'reply-shared-unreadable-01' })).status).toBe(403);
  }, 90000);
});
