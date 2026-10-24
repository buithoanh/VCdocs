import { createHash } from 'crypto';
import { createTestApp, TestApp } from './support/app';
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[]=[]; res.on('data',(c)=>chunks.push(Buffer.from(c))); res.on('end',()=>done(null,Buffer.concat(chunks))); res.on('error',done); }
describe('Email cơ bản VCworkspace', () => {
  let t: TestApp;
  beforeAll(async()=>{ t=await createTestApp(); }); afterAll(()=>t.close());
  it('draft reopen, A→B, reply/thread, raw MIME Unicode và quyền mailbox', async()=>{
    const a=await t.login('tp.mkt'); const b=await t.login('nv.mkt');
    const draft=await a.post('/mail/drafts',{to:['nv.mkt@vcworkspace.test'],subject:'Báo cáo tiếng Việt',text:'Nội dung bản nháp'}); expect(draft.status).toBe(201);
    await a.patch(`/mail/drafts/${draft.body.id}`,{text:'Nội dung đã mở lại'});
    expect((await a.get(`/mail/drafts/${draft.body.id}`)).body.text).toBe('Nội dung đã mở lại');
    const attachment=Buffer.from('checksum-chat07-đính-kèm');
    const sent=await a.post('/mail/send',{to:['nv.mkt@vcworkspace.test'],subject:'Báo cáo tiếng Việt',text:'Xin chào',html:'<b onclick="steal()">An toàn</b><script>alert(1)</script>',draftId:draft.body.id,attachments:[{filename:'báo-cáo.txt',contentType:'text/plain',contentBase64:attachment.toString('base64')}]},{idem:'chat07-send-0001'});
    expect({status:sent.status,body:sent.body}).toMatchObject({status:201,body:{deliveryStatus:'accepted'}});
    const inbox=await b.get('/mail/messages?folder=inbox'); expect(inbox.body.items).toHaveLength(1);
    const raw=await b.agent.get(`/api/v1/mail/messages/${inbox.body.items[0].id}/raw`).buffer(true).parse(binary as any);
    const bytes=raw.body as Buffer; expect(bytes.toString()).toContain('Content-Disposition: attachment'); expect(bytes.toString()).not.toContain('onclick='); expect(bytes.toString()).not.toContain('<script>');
    const encoded=attachment.toString('base64'); expect(bytes.toString()).toContain(encoded); expect(createHash('sha256').update(attachment).digest('hex')).toHaveLength(64);
    expect((await a.get(`/mail/messages/${inbox.body.items[0].id}/raw`)).status).toBe(404);
    const original=(await t.db.m.WorkspaceMailMessage.findOne({_id:inbox.body.items[0].id,companyId:t.ids.companyId}).lean<any>()).internetMessageId;
    const reply=await b.post('/mail/send',{to:['tp.mkt@vcworkspace.test'],subject:'Re: Báo cáo tiếng Việt',text:'Đã nhận',inReplyTo:original,references:[original]},{idem:'chat07-reply-0001'});
    expect(reply.body.threadId).toBe(inbox.body.items[0].threadId);
    expect((await b.get(`/mail/threads/${reply.body.threadId}`)).body.items).toHaveLength(2);
  });
  it('chặn header injection/ngoài .test và retry không gửi trùng',async()=>{
    const a=await t.login('tp.mkt');
    expect((await a.post('/mail/send',{to:['person@example.com'],subject:'No',text:'x'},{idem:'outside-0001'})).status).toBe(400);
    const fields={to:['nv.mkt@vcworkspace.test'],subject:'Một lần',text:'x'};
    const first=await a.post('/mail/send',fields,{idem:'same-send-0001'}); const second=await a.post('/mail/send',fields,{idem:'same-send-0001'});
    expect(second.body.id).toBe(first.body.id); expect(await t.db.m.WorkspaceMailMessage.countDocuments({companyId:t.ids.companyId,mailboxOwner:'nv.mkt@vcworkspace.test',subject:'Một lần'})).toBe(1);
    expect((await a.post('/mail/send',{...fields,subject:'x\r\nBcc: bad@vcworkspace.test'},{idem:'inject-0001'})).status).toBe(400);
  });
});
