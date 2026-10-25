import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { simpleParser } from 'mailparser';
import request from 'supertest';
import { GoogleSyncService } from '../src/modules/m01-auth/google-sync.service';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { createTestApp, TestApp } from './support/app';

const SECRET = 'audit05-isolated-test-secret';
function jwt(payload: unknown) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // Document Server ký callback kèm exp (outbox mặc định 5 phút).
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300, ...(payload as object) })).toString('base64url');
  return `${header}.${body}.${createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')}`;
}
function binary(res: NodeJS.ReadableStream, done: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[]=[]; res.on('data',(c)=>chunks.push(Buffer.from(c))); res.on('end',()=>done(null,Buffer.concat(chunks))); res.on('error',done); }
const text = (name: string, content: string) => ({ name, type: 'text/plain', content: Buffer.from(content) });

// Audit 5/12 (drive-basic/space-membership/never-reconciled-after-role-or-department-change):
// quyền ở không gian phòng ban phải theo phòng ban và R4 hiện tại, không theo dòng thành viên đã lưu.
describe('Quyền không gian Drive theo phòng ban và R4 hiện tại', () => {
  let t: TestApp; let editor: Server; let origin: string;
  const move = async (key: string, dept: string) => t.app.get(GoogleSyncService).applyAccess(t.ids.companyId, t.ids.users[key],
    { groupEmails: [], groupRoles: [], departmentId: t.ids.depts[dept].id, driveRoles: [] });
  beforeAll(async () => {
    const edited = createDocumentTemplate('Sửa sau khi mất quyền');
    editor = createServer((req, res) => {
      if (req.url === '/saved.docx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.end(edited); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(editor.address() as any).port}`;
    t = await createTestApp({ documentEditor: { enabled: true, publicOrigin: origin, internalOrigin: origin,
      apiOriginForEditor: 'http://host.docker.internal:4000', jwtSecret: SECRET } });
  });
  afterAll(async () => { await t.close(); await new Promise<void>((resolve) => editor.close(() => resolve())); });

  it('đổi phòng và mất R4 qua đồng bộ Google: không còn đọc, ghi, nhận link hay lưu bằng vé editor cũ ở phòng cũ', async () => {
    const manager = await t.login('tp.mkt'), reader = await t.login('nv.mkt');
    const mkt = (await manager.get('/spaces')).body.items.find((x: any) => x.kind === 'department');
    expect(mkt).toMatchObject({ role: 'manager', departmentId: t.ids.depts.MKT.id });
    expect((await reader.get('/spaces')).body.items.find((x: any) => x.id === mkt.id)).toMatchObject({ role: 'reader' });
    const secret = await manager.upload('/drive/files', { spaceId: mkt.id }, text('noi-bo-mkt.txt', 'Nội bộ MKT'), { idem: 'audit05-secret' });
    expect(secret.status).toBe(201);
    const doc = await manager.post('/drive/documents', { spaceId: mkt.id, name: 'Audit05-ve-editor' }, { idem: 'audit05-doc' });
    expect(doc.status).toBe(201);
    const oldConfig = await manager.get(`/drive/files/${doc.body.id}/editor-config`);
    expect(oldConfig.body.mode).toBe('edit');
    const oldTicket = new URL(oldConfig.body.config.editorConfig.callbackUrl).searchParams.get('ticket')!;
    const oldContentTicket = new URL(oldConfig.body.config.document.url).searchParams.get('ticket')!;
    // Link gửi cho nv.mkt khi còn ở MKT
    expect((await manager.post('/mail/send-drive-file', { to: ['nv.mkt@vcworkspace.test'], subject: 'Link audit05', text: 'x',
      fileId: secret.body.id, versionId: secret.body.currentVersionId, expectedSha256: secret.body.contentSha256, mode: 'link' },
    { idem: 'audit05-link' })).status).toBe(201);
    const inbox = (await reader.get('/mail/messages?folder=inbox')).body.items.find((x: any) => x.subject === 'Link audit05');
    const mime = await reader.agent.get(`/api/v1/mail/messages/${inbox.id}/raw`).buffer(true).parse(binary as any);
    const token = String((await simpleParser(Buffer.from(mime.body))).text || '').match(/\/bo-nho\/lien-ket#([A-Za-z0-9_-]+)/)?.[1];
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(200);

    // nv.mkt chuyển sang KD
    await move('nv.mkt', 'KD');
    const readerSpaces = (await reader.get('/spaces')).body.items;
    expect(readerSpaces.some((x: any) => x.id === mkt.id)).toBe(false);
    expect(readerSpaces.find((x: any) => x.kind === 'department')).toMatchObject({ departmentId: t.ids.depts.KD.id, role: 'reader' });
    expect((await reader.get(`/drive/items?spaceId=${mkt.id}`)).status).toBe(404);
    expect((await reader.get(`/drive/files/${secret.body.id}/content`)).status).toBe(404);
    expect((await reader.get(`/drive/shared-links/${token}`)).status).toBe(404);
    expect((await manager.post('/mail/send-drive-file', { to: ['nv.mkt@vcworkspace.test'], subject: 'Link audit05 sau', text: 'x',
      fileId: secret.body.id, versionId: secret.body.currentVersionId, expectedSha256: secret.body.contentSha256, mode: 'link' },
    { idem: 'audit05-link-after' })).status).toBe(403);

    // tp.mkt chuyển sang KD và mất R4 (rời nhóm quản lý)
    await move('tp.mkt', 'KD');
    const managerSpaces = (await manager.get('/spaces')).body.items;
    expect(managerSpaces.some((x: any) => x.id === mkt.id)).toBe(false);
    const kd = managerSpaces.find((x: any) => x.kind === 'department');
    expect(kd).toMatchObject({ departmentId: t.ids.depts.KD.id, role: 'reader' });
    expect((await manager.upload('/drive/files', { spaceId: mkt.id }, text('sau-khi-chuyen.txt', 'x'), { idem: 'audit05-after' })).status).toBe(404);
    expect((await manager.get(`/drive/items?spaceId=${mkt.id}`)).status).toBe(404);
    expect((await manager.get(`/drive/files/${secret.body.id}/content`)).status).toBe(404);
    expect((await manager.post('/drive/folders', { spaceId: mkt.id, name: 'Không được tạo' })).status).toBe(404);
    expect((await manager.get(`/drive/files/${doc.body.id}/editor-config`)).status).toBe(404);
    expect((await manager.upload('/drive/files', { spaceId: kd.id }, text('kd.txt', 'x'), { idem: 'audit05-kd' })).status).toBe(403);
    // Vé editor cấp trước khi chuyển phòng không còn đọc hay lưu được
    expect((await request(t.app.getHttpServer()).get(`/api/v1/drive/editor/content?ticket=${encodeURIComponent(oldContentTicket)}`)).status).toBe(404);
    const body = { key: oldConfig.body.config.document.key, status: 2, url: `${origin}/saved.docx` };
    expect((await request(t.app.getHttpServer()).post(`/api/v1/drive/editor/callback?ticket=${encodeURIComponent(oldTicket)}`)
      .set('Authorization', `Bearer ${jwt(body)}`).send(body)).body).toEqual({ error: 1 });
    expect((await t.db.m.WorkspaceDriveItem.findOne({ _id: doc.body.id, companyId: t.ids.companyId }).lean<any>()).versionNumber).toBe(doc.body.versionNumber);
  });

  it('đối chứng: người chưa từng ở MKT nhận 404, thành viên hiện tại vẫn làm việc bình thường', async () => {
    const outsider = await t.login('nv.kd'), current = await t.login('leader.mkt');
    const mkt = (await current.get('/spaces')).body.items.find((x: any) => x.kind === 'department');
    expect(mkt.departmentId).toBe(t.ids.depts.MKT.id);
    expect((await current.get(`/drive/items?spaceId=${mkt.id}`)).status).toBe(200);
    expect((await outsider.upload('/drive/files', { spaceId: mkt.id }, text('ngoai.txt', 'x'), { idem: 'audit05-outsider' })).status).toBe(404);
    expect((await outsider.get(`/drive/items?spaceId=${mkt.id}`)).status).toBe(404);
  });

  it('R9 gỡ R4 gán tay qua PATCH /users/:id: vai trò trong không gian phòng hạ về reader ngay', async () => {
    const admin = await t.login('it'), head = await t.login('xem.mkt');
    const user = await t.db.m.User.findOne({ _id: t.ids.users['xem.mkt'], companyId: t.ids.companyId }).lean<any>();
    const base: string[] = user.groupRoles ?? [];
    expect((await admin.patch(`/users/${t.ids.users['xem.mkt']}`, { systemRoles: [...base, 'R4'] })).status).toBe(200);
    const mkt = (await head.get('/spaces')).body.items.find((x: any) => x.kind === 'department');
    expect(mkt).toMatchObject({ role: 'manager' });
    expect((await head.upload('/drive/files', { spaceId: mkt.id }, text('truoc.txt', 'x'), { idem: 'audit05-r4-before' })).status).toBe(201);
    expect((await admin.patch(`/users/${t.ids.users['xem.mkt']}`, { systemRoles: base })).status).toBe(200);
    expect((await head.upload('/drive/files', { spaceId: mkt.id }, text('sau.txt', 'x'), { idem: 'audit05-r4-after' })).status).toBe(403);
    expect((await head.post('/drive/folders', { spaceId: mkt.id, name: 'Sau khi mất R4' })).status).toBe(403);
    expect((await head.get('/spaces')).body.items.find((x: any) => x.id === mkt.id)).toMatchObject({ role: 'reader' });
  });
});
