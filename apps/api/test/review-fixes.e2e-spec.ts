import { createHmac } from 'crypto';
import request from 'supertest';
import { loadConfig } from '../src/config/config';
import { createTestApp, TestApp } from './support/app';

// Hồi quy cho các lỗi tìm thấy khi review/QA bàn giao chat01–12B (2026-10-25).
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('Review chat01–12B: Drive', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  it('hai người trùng họ tên có không gian cá nhân riêng', async () => {
    await t.db.m.User.updateOne({ _id: t.ids.users['nv.mkt'], companyId: t.ids.companyId }, { $set: { name: 'Trùng Tên' } });
    await t.db.m.User.updateOne({ _id: t.ids.users['xem.mkt'], companyId: t.ids.companyId }, { $set: { name: 'Trùng Tên' } });
    const a = await t.login('nv.mkt');
    const b = await t.login('xem.mkt');
    const spaceA = (await a.get('/spaces')).body.items.find((s: any) => s.kind === 'personal');
    const spaceB = (await b.get('/spaces')).body.items.find((s: any) => s.kind === 'personal');
    expect(spaceA.id).not.toBe(spaceB.id);
    const file = await a.upload('/drive/files', { spaceId: spaceA.id }, { name: 'rieng-tu.txt', type: 'text/plain', content: Buffer.from('chi cua A') });
    expect(file.status).toBe(201);
    expect((await b.get('/drive/items?spaceId=' + spaceA.id)).status).toBe(404);
    expect((await b.get('/drive/files/' + file.body.id + '/content')).status).toBe(404);
  });

  it('khôi phục phiên bản tạo số mới, sau đó vẫn tải được bản tiếp theo', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((s: any) => s.kind === 'department');
    const file = await manager.upload('/drive/files', { spaceId: space.id }, { name: 'khoi-phuc.txt', type: 'text/plain', content: Buffer.from('mot') });
    await manager.upload(`/drive/files/${file.body.id}/versions`, {}, { name: 'khoi-phuc.txt', type: 'text/plain', content: Buffer.from('hai') });
    const v1 = (await manager.get(`/drive/files/${file.body.id}/versions`)).body.items.find((v: any) => v.number === 1);
    const restored = await manager.post(`/drive/files/${file.body.id}/versions/${v1.id}/restore`, {});
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ versionNumber: 3, contentSha256: v1.contentSha256 });
    expect((await manager.get(`/drive/files/${file.body.id}/content`)).text).toBe('mot');
    const next = await manager.upload(`/drive/files/${file.body.id}/versions`, {}, { name: 'khoi-phuc.txt', type: 'text/plain', content: Buffer.from('bon') });
    expect(next.status).toBe(201);
    expect(next.body.versionNumber).toBe(4);
    expect((await manager.get(`/drive/files/${file.body.id}/versions`)).body.items.map((v: any) => v.number)).toEqual([4, 3, 2, 1]);
  });

  it('lưu lại đúng tên cũ không bị báo trùng, trùng tên khác vẫn 409', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((s: any) => s.kind === 'department');
    const one = await manager.post('/drive/folders', { spaceId: space.id, name: 'Giu nguyen ten' });
    await manager.post('/drive/folders', { spaceId: space.id, name: 'Ten khac' });
    expect((await manager.patch('/drive/items/' + one.body.id, { name: 'Giu nguyen ten' })).status).toBe(200);
    expect((await manager.patch('/drive/items/' + one.body.id, { name: 'Ten khac' })).status).toBe(409);
  });
});

describe('Review chat01–12B: editor tắt thì endpoint công khai không phục vụ', () => {
  const secret = 'review-fixes-editor-secret';
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ documentEditor: { enabled: false, publicOrigin: 'http://127.0.0.1:1', internalOrigin: 'http://127.0.0.1:1',
      apiOriginForEditor: 'http://127.0.0.1:1', jwtSecret: secret } });
  });
  afterAll(async () => { await t.close(); });

  it('vé tự ký hợp lệ vẫn không đọc/ghi được tệp', async () => {
    const manager = await t.login('tp.mkt');
    const space = (await manager.get('/spaces')).body.items.find((s: any) => s.kind === 'department');
    const file = await manager.upload('/drive/files', { spaceId: space.id }, { name: 'bi-mat.docx', type: DOCX, content: Buffer.from('PK bi mat') });
    const body = Buffer.from(JSON.stringify({ fileId: file.body.id, companyId: String(t.ids.companyId), email: 'tp.mkt@vcprosperous.com',
      exp: Date.now() + 60_000, mode: 'edit' })).toString('base64url');
    const ticket = body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
    const server = t.app.getHttpServer();
    expect((await request(server).get('/api/v1/drive/editor/content?ticket=' + encodeURIComponent(ticket))).status).toBe(404);
    const callback = await request(server).post('/api/v1/drive/editor/callback?ticket=' + encodeURIComponent(ticket)).send({ key: 'vcw-' + file.body.id + '-v1', status: 2, url: 'http://127.0.0.1:1/x.docx' });
    expect(callback.body).toEqual({ error: 1 });
  });
});

describe('Review chat01–12B: đăng nhập Google tắt khi AUTH_MODE=oidc', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ authMode: 'oidc', oidc: { issuer: 'http://127.0.0.1:1', clientId: 'app', clientSecret: 'test-only-secret',
      companyDomain: 'vcprosperous.com', groupRoleMap: {}, projectionMaxAgeSeconds: 300 } } as any);
  });
  afterAll(async () => { await t.close(); });

  it('route Google và callback Google đều trả về loi=provider', async () => {
    const server = t.app.getHttpServer();
    const start = await request(server).get('/api/v1/auth/google');
    expect(start.status).toBe(302);
    expect(start.headers.location).toContain('loi=provider');
    const callback = await request(server).get('/api/v1/auth/google/callback?state=x&code=' + encodeURIComponent('fake|tp.mkt@vcprosperous.com|n'));
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('loi=provider');
  });
});

describe('Review chat01–12B: cấu hình production', () => {
  const base = { NODE_ENV: 'production', GOOGLE_MODE: 'real', WORKSPACE_STORAGE_MODE: 'nextcloud', MAIL_ENGINE_MODE: 'stalwart',
    DOCUMENT_EDITOR_ENABLED: 'true', DOCUMENT_EDITOR_JWT_SECRET: 'x'.repeat(40) };

  it('chặn kho tệp và mail giả', () => {
    expect(() => loadConfig({ ...base, WORKSPACE_STORAGE_MODE: undefined } as any)).toThrow('WORKSPACE_STORAGE_MODE=fake');
    expect(() => loadConfig({ ...base, MAIL_ENGINE_MODE: undefined } as any)).toThrow('MAIL_ENGINE_MODE=fake');
  });

  it('chặn khoá editor mặc định hoặc quá ngắn', () => {
    expect(() => loadConfig({ ...base, DOCUMENT_EDITOR_JWT_SECRET: undefined } as any)).toThrow('DOCUMENT_EDITOR_JWT_SECRET');
    expect(() => loadConfig({ ...base, DOCUMENT_EDITOR_JWT_SECRET: 'ngan' } as any)).toThrow('DOCUMENT_EDITOR_JWT_SECRET');
    expect(() => loadConfig(base as any)).not.toThrow();
  });
});
