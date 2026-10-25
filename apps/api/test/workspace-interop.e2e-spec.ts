import { createHash } from 'crypto';
import { simpleParser } from 'mailparser';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createTestApp, TestApp } from './support/app';
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[]=[]; res.on('data',(c)=>chunks.push(Buffer.from(c))); res.on('end',()=>done(null,Buffer.concat(chunks))); res.on('error',done); }

describe('Liên thông Email–Drive–Office', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(() => t.close());

  it('lưu attachment đúng part/hash/idempotency rồi gửi snapshot đúng version', async () => {
    const a = await t.login('tp.mkt'), b = await t.login('nv.mkt');
    const bytes = createDocumentTemplate('BODY CHAT09 V1');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await a.post('/mail/send', { to:['nv.mkt@vcworkspace.test'], subject:'Tệp chat09', text:'Nhận tệp', attachments:[{
      filename:'../Báo-cáo-chat09.docx', contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', contentBase64:bytes.toString('base64'),
    }] }, { idem:'chat09-source-mail' });
    const inbox = await b.get('/mail/messages?folder=inbox');
    const message = inbox.body.items.find((x:any) => x.subject === 'Tệp chat09');
    const personal = (await b.get('/spaces')).body.items.find((x:any) => x.kind === 'personal');
    const first = await b.post(`/mail/messages/${message.id}/attachments/0/save-to-drive`, { spaceId:personal.id, expectedSha256:hash }, { idem:'chat09-save-attachment' });
    expect(first.status).toBe(201); expect(first.body).toMatchObject({ name:'Báo-cáo-chat09.docx', contentSha256:hash, versionNumber:1 });
    expect(first.body.provenance).toMatchObject({ messageId:message.id, part:0, sha256:hash });
    const retry = await b.post(`/mail/messages/${message.id}/attachments/0/save-to-drive`, { spaceId:personal.id, expectedSha256:hash }, { idem:'chat09-save-attachment' });
    expect(retry.body.id).toBe(first.body.id);
    expect(await t.db.m.WorkspaceDriveItem.countDocuments({ companyId:t.ids.companyId, name:'Báo-cáo-chat09.docx' })).toBe(1);

    const sent = await b.post('/mail/send-drive-file', { to:['tp.mkt@vcworkspace.test'], subject:'Snapshot chat09', text:'Bản đã chọn', fileId:first.body.id, versionId:first.body.currentVersionId, expectedSha256:hash, mode:'attachment' }, { idem:'chat09-send-snapshot' });
    expect(sent.status).toBe(201);
    const aInbox = await a.get('/mail/messages?folder=inbox');
    expect(aInbox.body.items.some((x:any)=>x.subject==='Snapshot chat09')).toBe(true);
    expect((await b.post('/mail/send-drive-file', { to:['tp.mkt@vcworkspace.test'], subject:'Hash sai', fileId:first.body.id, versionId:first.body.currentVersionId, expectedSha256:'0'.repeat(64), mode:'attachment' }, { idem:'chat09-wrong-hash' })).status).toBe(409);
    for (const fixture of [{ path:'/drive/spreadsheets', name:'Bang-chat09', mime:'spreadsheetml.sheet' }, { path:'/drive/presentations', name:'Slide-chat09', mime:'presentationml.presentation' }]) {
      const made=await b.post(fixture.path,{spaceId:personal.id,name:fixture.name},{idem:`chat09-${fixture.name}`});
      expect((await b.post('/mail/send-drive-file',{to:['tp.mkt@vcworkspace.test'],subject:`MIME ${fixture.name}`,fileId:made.body.id,versionId:made.body.currentVersionId,expectedSha256:made.body.contentSha256,mode:'attachment'},{idem:`chat09-send-${fixture.name}`})).status).toBe(201);
      const received=(await a.get('/mail/messages?folder=inbox')).body.items.find((x:any)=>x.subject===`MIME ${fixture.name}`);
      const rawMime=await a.agent.get(`/api/v1/mail/messages/${received.id}/raw`).buffer(true).parse(binary as any);
      expect((rawMime.body as Buffer).toString()).toContain(fixture.mime);
    }
  });

  it('link không tự cấp quyền và chỉ người nhận có ACL sẵn tải được', async () => {
    const manager = await t.login('tp.mkt'), reader = await t.login('nv.mkt');
    const department = (await manager.get('/spaces')).body.items.find((x:any)=>x.kind==='department');
    await reader.get('/spaces');
    const created = await manager.post('/drive/documents', { spaceId:department.id, name:'Lien-ket-chat09' }, { idem:'chat09-link-doc' });
    const sent = await manager.post('/mail/send-drive-file', { to:['nv.mkt@vcworkspace.test'], subject:'Link chat09', text:'Mở bản cố định', fileId:created.body.id, versionId:created.body.currentVersionId, expectedSha256:created.body.contentSha256, mode:'link' }, { idem:'chat09-send-link' });
    expect(sent.status).toBe(201);
    const linkRetry = await manager.post('/mail/send-drive-file', { to:['nv.mkt@vcworkspace.test'], subject:'Link chat09', text:'Mở bản cố định', fileId:created.body.id, versionId:created.body.currentVersionId, expectedSha256:created.body.contentSha256, mode:'link' }, { idem:'chat09-send-link' });
    expect(linkRetry.body.id).toBe(sent.body.id);
    const raw = await t.db.m.WorkspaceDriveShareLink.findOne({ companyId:t.ids.companyId, fileId:created.body.id }).lean<any>();
    expect(raw).toBeTruthy(); expect(raw.contentSha256).toBe(created.body.contentSha256);
    const inbox=(await reader.get('/mail/messages?folder=inbox')).body.items.find((x:any)=>x.subject==='Link chat09');
    const mime=await reader.agent.get(`/api/v1/mail/messages/${inbox.id}/raw`).buffer(true).parse(binary as any);
    const decoded=String((await simpleParser(Buffer.from(mime.body))).text || '');
    expect(decoded).toContain('http://localhost:3000/bo-nho/lien-ket#');
    expect(decoded).not.toContain('/api/v1/drive/shared-links/');
    const token=decoded.match(/\/bo-nho\/lien-ket#([A-Za-z0-9_-]+)/)?.[1]; expect(token).toBeTruthy();
    const download=await reader.agent.get(`/api/v1/drive/shared-links/${token}`).buffer(true).parse(binary as any);
    expect(download.status).toBe(200); expect(download.headers['x-content-sha256']).toBe(created.body.contentSha256);
    expect((await manager.get(`/drive/shared-links/${token}`)).status).toBe(403);
    await t.db.m.WorkspaceDriveShareLink.updateOne({ _id:raw._id, companyId:t.ids.companyId }, { $set:{ expiresAt:new Date(Date.now()-1_000) } });
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(404);
    await t.db.m.WorkspaceDriveShareLink.updateOne({ _id:raw._id, companyId:t.ids.companyId }, { $set:{ expiresAt:new Date(Date.now()+60_000) } });
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(200);
    await t.db.m.WorkspaceDriveShareLink.updateOne({ _id:raw._id, companyId:t.ids.companyId }, { $set:{ revokedAt:new Date() } });
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(404);
    const privateDoc = await manager.post('/drive/documents', { spaceId:(await manager.get('/spaces')).body.items.find((x:any)=>x.kind==='personal').id, name:'Private-chat09' }, { idem:'chat09-private-doc' });
    expect((await manager.post('/mail/send-drive-file', { to:['nv.mkt@vcworkspace.test'], subject:'Không cấp ngầm', fileId:privateDoc.body.id, versionId:privateDoc.body.currentVersionId, expectedSha256:privateDoc.body.contentSha256, mode:'link' }, { idem:'chat09-private-link' })).status).toBe(403);
  });

  it('bind Idempotency-Key vào toàn payload qua retry, race và outer-journal loss', async () => {
    const manager = await t.login('tp.mkt'), reader = await t.login('nv.mkt');
    const department = (await manager.get('/spaces')).body.items.find((x:any)=>x.kind==='department');
    await reader.get('/spaces');
    const first = await manager.post('/drive/documents', { spaceId:department.id, name:'Snapshot-idem-a' }, { idem:'chat09-idem-doc-a' });
    const second = await manager.post('/drive/documents', { spaceId:department.id, name:'Snapshot-idem-b' }, { idem:'chat09-idem-doc-b' });
    const payload=(file:any,subject:string)=>({to:['nv.mkt@vcworkspace.test'],subject,fileId:file.body.id,versionId:file.body.currentVersionId,expectedSha256:file.body.contentSha256,mode:'attachment'});
    const sent=await manager.post('/mail/send-drive-file',payload(first,'Snapshot idem A'),{idem:'chat09-snapshot-stable-key'});
    expect(sent.status).toBe(201);
    await t.db.m.Idempotency.deleteOne({companyId:t.ids.companyId,userId:t.ids.users['tp.mkt'],key:'chat09-snapshot-stable-key'});
    expect((await manager.post('/mail/send-drive-file',payload(second,'Snapshot idem B'),{idem:'chat09-snapshot-stable-key'})).status).toBe(409);
    expect(await t.db.m.WorkspaceMailSend.countDocuments({companyId:t.ids.companyId,idempotencyKey:'drive-snapshot:chat09-snapshot-stable-key'})).toBe(1);

    const raceKey='chat09-snapshot-race-key';
    const race=await Promise.all([
      manager.post('/mail/send-drive-file',payload(first,'Snapshot race A'),{idem:raceKey}),
      manager.post('/mail/send-drive-file',payload(second,'Snapshot race B'),{idem:raceKey}),
    ]);
    expect(race.map((response:any)=>response.status).sort()).toEqual([201,409]);
    expect(await t.db.m.WorkspaceMailSend.countDocuments({companyId:t.ids.companyId,idempotencyKey:`drive-snapshot:${raceKey}`})).toBe(1);

    const linkKey='chat09-link-create-race';
    await t.db.m.WorkspaceDriveShareLink.create({companyId:t.ids.companyId,fileId:first.body.id,versionId:first.body.currentVersionId,contentSha256:first.body.contentSha256,recipients:['nv.mkt@vcworkspace.test'],idempotencyKey:linkKey,fingerprint:'winner-with-different-payload',token:'winner-token-chat09-create-race',tokenHash:createHash('sha256').update('winner-token-chat09-create-race').digest('hex'),expiresAt:new Date(Date.now()+60_000),createdBy:t.ids.users['tp.mkt'],updatedBy:t.ids.users['tp.mkt']});
    const model=t.db.m.WorkspaceDriveShareLink;
    const lookup=jest.spyOn(model,'findOne').mockImplementationOnce(()=>({lean:async()=>null}) as any);
    const conflict=await manager.post('/mail/send-drive-file',{...payload(second,'Link race mismatch'),mode:'link'},{idem:linkKey});
    lookup.mockRestore();
    expect(conflict.status).toBe(409);
    expect(await t.db.m.WorkspaceMailSend.countDocuments({companyId:t.ids.companyId,idempotencyKey:`drive-link:${linkKey}`})).toBe(0);
  });

  it('không tái dùng save key cho source mail khác dù attachment giống hệt', async () => {
    const a=await t.login('tp.mkt'),b=await t.login('nv.mkt');
    const bytes=createDocumentTemplate('CHAT09 SAME ATTACHMENT'),hash=createHash('sha256').update(bytes).digest('hex');
    for(const [index,subject] of ['Nguồn attachment A','Nguồn attachment B'].entries())await a.post('/mail/send',{to:['nv.mkt@vcworkspace.test'],subject,attachments:[{filename:'same.docx',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',contentBase64:bytes.toString('base64')}]},{idem:`chat09-source-${index}`});
    const inbox=await b.get('/mail/messages?folder=inbox'),messages=Object.fromEntries(inbox.body.items.filter((x:any)=>x.subject.startsWith('Nguồn attachment')).map((x:any)=>[x.subject,x]));
    const personal=(await b.get('/spaces')).body.items.find((x:any)=>x.kind==='personal'),key='chat09-save-source-bound';
    expect((await b.post(`/mail/messages/${messages['Nguồn attachment A'].id}/attachments/0/save-to-drive`,{spaceId:personal.id,expectedSha256:hash},{idem:key})).status).toBe(201);
    await t.db.m.Idempotency.deleteOne({companyId:t.ids.companyId,userId:t.ids.users['nv.mkt'],key});
    expect((await b.post(`/mail/messages/${messages['Nguồn attachment B'].id}/attachments/0/save-to-drive`,{spaceId:personal.id,expectedSha256:hash},{idem:key})).status).toBe(409);
    expect(await t.db.m.UploadAttempt.countDocuments({companyId:t.ids.companyId,idempotencyKey:`mail-attachment:${key}`})).toBe(1);
  });
});
