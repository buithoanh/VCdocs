import { simpleParser } from 'mailparser';
import request from 'supertest';
import { SessionService } from '../src/session/session.service';
import { createTestApp, TestApp } from './support/app';
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[]=[]; res.on('data',(c)=>chunks.push(Buffer.from(c))); res.on('end',()=>done(null,Buffer.concat(chunks))); res.on('error',done); }

// Audit 2/12 (mail-basic/mailbox-owner-local-part): hộp thư không được suy từ local-part bất kể tên miền.
describe('Hộp thư gắn với email thuộc tên miền công ty', () => {
  let t: TestApp;
  let twinSid: string;
  const twin = () => request.agent(t.app.getHttpServer()).set('Cookie', `vcdocs_sid=${twinSid}`);
  beforeAll(async () => {
    t = await createTestApp();
    // Chèn thẳng DB: OIDC đã chặn email ngoài tên miền từ 1/12, nhưng dữ liệu cũ hoặc nhập tay vẫn có thể có.
    const original = await t.db.m.User.findOne({ _id: t.ids.users['nv.mkt'], companyId: t.ids.companyId }).lean<any>();
    const { _id, email, createdAt, updatedAt, ...rest } = original;
    const created = await t.db.m.User.create({ ...rest, email: 'nv.mkt@other.example', name: 'Trùng local-part' });
    twinSid = (await t.app.get(SessionService).create({ userId: String(created._id), companyId: t.ids.companyId, ip: 'test', device: 'twin' })).sid;
  });
  afterAll(() => t.close());

  it('user khác tên miền cùng local-part không đọc được hộp thư của user gốc', async () => {
    const a = await t.login('tp.mkt'), b = await t.login('nv.mkt');
    expect((await a.post('/mail/send', { to:['nv.mkt@vcworkspace.test'], subject:'Thư riêng nv.mkt', text:'Chỉ nv.mkt đọc' }, { idem:'audit02-private-mail' })).status).toBe(201);
    expect((await b.get('/mail/messages?folder=inbox')).body.items.some((x:any)=>x.subject==='Thư riêng nv.mkt')).toBe(true);
    const res = await twin().get('/api/v1/mail/messages?folder=inbox');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('Thư riêng nv.mkt');
    expect((await twin().get('/api/v1/mail/aliases')).status).toBe(403);
  });

  it('link Drive gửi cho user gốc không tải được bằng phiên user khác tên miền', async () => {
    const manager = await t.login('tp.mkt'), reader = await t.login('nv.mkt');
    const department = (await manager.get('/spaces')).body.items.find((x:any)=>x.kind==='department');
    await reader.get('/spaces');
    const twinUser = await t.db.m.User.findOne({ companyId: t.ids.companyId, email: 'nv.mkt@other.example' }).lean<any>();
    // Cho user trùng có ACL đọc space để chỉ còn kiểm người nhận link quyết định kết quả.
    await t.db.m.WorkspaceSpaceMember.create({ companyId: t.ids.companyId, spaceId: department.id, userId: twinUser._id, role: 'reader' });
    const created = await manager.post('/drive/documents', { spaceId:department.id, name:'Lien-ket-audit02' }, { idem:'audit02-link-doc' });
    expect((await manager.post('/mail/send-drive-file', { to:['nv.mkt@vcworkspace.test'], subject:'Link audit02', text:'Cho nv.mkt', fileId:created.body.id, versionId:created.body.currentVersionId, expectedSha256:created.body.contentSha256, mode:'link' }, { idem:'audit02-send-link' })).status).toBe(201);
    const inbox=(await reader.get('/mail/messages?folder=inbox')).body.items.find((x:any)=>x.subject==='Link audit02');
    const mime=await reader.agent.get(`/api/v1/mail/messages/${inbox.id}/raw`).buffer(true).parse(binary as any);
    const token=String((await simpleParser(Buffer.from(mime.body))).text || '').match(/\/bo-nho\/lien-ket#([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(200);
    expect((await twin().get(`/api/v1/drive/shared-links/${token}`)).status).toBe(403);
  });

  it('kiểm ACL người nhận link khớp chính xác email công ty, không lấy user ngoài tên miền cùng local-part', async () => {
    const manager = await t.login('tp.mkt');
    const department = (await manager.get('/spaces')).body.items.find((x:any)=>x.kind==='department');
    const outsider = await t.db.m.User.create({ companyId: t.ids.companyId, email: 'ghost.audit02@other.example', name: 'Ngoài tên miền' });
    await t.db.m.WorkspaceSpaceMember.create({ companyId: t.ids.companyId, spaceId: department.id, userId: outsider._id, role: 'reader' });
    const created = await manager.post('/drive/documents', { spaceId:department.id, name:'Lien-ket-audit02-ghost' }, { idem:'audit02-ghost-doc' });
    const sent = await manager.post('/mail/send-drive-file', { to:['ghost.audit02@vcworkspace.test'], subject:'Link ghost', text:'x', fileId:created.body.id, versionId:created.body.currentVersionId, expectedSha256:created.body.contentSha256, mode:'link' }, { idem:'audit02-ghost-link' });
    expect(sent.status).toBe(403);
    expect(await t.db.m.WorkspaceDriveShareLink.countDocuments({ companyId: t.ids.companyId, fileId: created.body.id })).toBe(0);
  });
});
