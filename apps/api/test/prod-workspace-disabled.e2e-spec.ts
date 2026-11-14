import { loadConfig } from '../src/config/config';
import { createTestApp, TestApp } from './support/app';

// Production phương án A: chạy nghiệp vụ VCdocs + Google thật, Drive/Office/Email VCworkspace tắt.
const productionGoogle = {
  NODE_ENV: 'production', GOOGLE_MODE: 'real', PUBLIC_API_ORIGIN: 'https://vcdocs.example.com', WEB_ORIGIN: 'https://vcdocs.example.com', COOKIE_SECURE: 'true',
};

describe('Cấu hình production khi chưa có Nextcloud/Stalwart thật', () => {
  it('không đặt WORKSPACE_STORAGE_MODE/MAIL_ENGINE_MODE thì khởi động được, các phân hệ tắt chứ không rơi về bản giả', () => {
    const cfg = loadConfig(productionGoogle as any);
    expect(cfg.workspaceStorage.mode).toBe('disabled');
    expect(cfg.mailEngine.mode).toBe('disabled');
    expect(cfg.identityLifecycle.mode).toBe('disabled');
    expect(cfg.documentEditor.enabled).toBe(false);
    expect(cfg.flow.enabled).toBe(false);
  });

  it('đặt tường minh bản giả ở production bị chặn khi khởi động', () => {
    expect(() => loadConfig({ ...productionGoogle, WORKSPACE_STORAGE_MODE: 'fake' } as any)).toThrow('WORKSPACE_STORAGE_MODE=fake');
    expect(() => loadConfig({ ...productionGoogle, MAIL_ENGINE_MODE: 'fake' } as any)).toThrow('MAIL_ENGINE_MODE=fake');
  });

  it('bật trình soạn thảo khi kho Drive tắt bị chặn', () => {
    expect(() => loadConfig({ ...productionGoogle, DOCUMENT_EDITOR_ENABLED: 'true', DOCUMENT_EDITOR_JWT_SECRET: 'x'.repeat(40) } as any)).toThrow('DOCUMENT_EDITOR_ENABLED');
  });

  it('giá trị lạ bị chặn', () => {
    expect(() => loadConfig({ ...productionGoogle, WORKSPACE_STORAGE_MODE: 'off' } as any)).toThrow('WORKSPACE_STORAGE_MODE');
    expect(() => loadConfig({ ...productionGoogle, MAIL_ENGINE_MODE: 'off' } as any)).toThrow('MAIL_ENGINE_MODE');
  });

  it('ngoài production vẫn mặc định bản giả để phát triển', () => {
    const cfg = loadConfig({ NODE_ENV: 'development', GOOGLE_MODE: 'fake', FAKE_GOOGLE_STATE_FILE: 'none' } as any);
    expect(cfg.workspaceStorage.mode).toBe('fake');
    expect(cfg.mailEngine.mode).toBe('fake');
  });
});

describe('Drive/Email tắt: route trả 503, nghiệp vụ VCdocs vẫn chạy', () => {
  let t: TestApp;
  beforeAll(async () => {
    const base = loadConfig({ NODE_ENV: 'test', GOOGLE_MODE: 'fake' } as any);
    t = await createTestApp({
      workspaceStorage: { ...base.workspaceStorage, mode: 'disabled' },
      mailEngine: { ...base.mailEngine, mode: 'disabled' },
      documentEditor: { ...base.documentEditor, enabled: false },
    });
  });
  afterAll(async () => t?.close());

  it('đăng nhập Google, /me và tra cứu tài liệu không phụ thuộc Drive/Email', async () => {
    const c = await t.login('nv.mkt');
    expect((await c.get('/me')).status).toBe(200);
    expect((await c.get('/documents')).status).toBe(200);
  });

  it('Drive, Email và liên thông trả 503 STORAGE_UNAVAILABLE, không chạm dữ liệu', async () => {
    const c = await t.login('nv.mkt');
    const res = (url: string) => c.agent.get(`/api/v1${url}`);
    for (const url of ['/spaces', '/drive/items', '/drive/trash', '/mail/messages', '/mail/labels', '/drive/shared-links/abcdefghijklmnopqrstuvwx']) {
      const r = await res(url);
      expect([url, r.status, r.body?.error?.code ?? r.body?.code]).toEqual([url, 503, 'STORAGE_UNAVAILABLE']);
    }
    const draft = await c.agent.post('/api/v1/mail/drafts').set('X-CSRF-Token', c.csrf).set('Idempotency-Key', 'disabled-draft-0001').send({ to: [], subject: 'x' });
    expect(draft.status).toBe(503);
    const folder = await c.agent.post('/api/v1/drive/folders').set('X-CSRF-Token', c.csrf).set('Idempotency-Key', 'disabled-folder-001').send({ name: 'x' });
    expect(folder.status).toBe(503);
    expect(await t.db.m.WorkspaceDriveItem.countDocuments({ companyId: t.ids.companyId })).toBe(0);
  });

  it('route trình soạn thảo công khai cũng bị chặn', async () => {
    expect((await t.http().get('/api/v1/drive/editor/content?ticket=x')).status).toBe(503);
  });
});
