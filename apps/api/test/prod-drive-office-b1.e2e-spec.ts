import { loadConfig } from '../src/config/config';
import { checkServiceUrl } from '../src/common/service-url';
import { NextcloudWorkspaceStorage } from '../src/modules/drive-basic/nextcloud-storage';
import { createTestApp, TestApp } from './support/app';
import { fakeWebdav } from './support/fake-webdav';

// Giai đoạn B1 (docs/ke-hoach/vcworkspace-21-b1-drive-office-production.md): Drive/Office lên production.
const production = {
  NODE_ENV: 'production', GOOGLE_MODE: 'real', PUBLIC_API_ORIGIN: 'https://vcdocs.example.com', WEB_ORIGIN: 'https://vcdocs.example.com', COOKIE_SECURE: 'true',
};
const nextcloudProd = { ...production, WORKSPACE_STORAGE_MODE: 'nextcloud', WORKSPACE_STORAGE_BASE_URL: 'https://cloud.example.com',
  WORKSPACE_CREDENTIAL_KEYS: 'k1:' + Buffer.alloc(32, 1).toString('base64') };
const editorProd = {
  ...nextcloudProd, DOCUMENT_EDITOR_ENABLED: 'true', DOCUMENT_EDITOR_JWT_SECRET: 'x'.repeat(40),
  DOCUMENT_EDITOR_PUBLIC_ORIGIN: 'https://office.example.com', DOCUMENT_EDITOR_INTERNAL_ORIGIN: 'http://onlyoffice', DOCUMENT_EDITOR_API_ORIGIN: 'http://api:4000',
};
const storageCfg = (baseUrl: string) => ({ mode: 'nextcloud' as const, baseUrl, credentials: {}, timeoutMs: 1_000 });
const noCredentials = { resolve: async () => { throw new Error('không dùng'); }, forget: () => undefined };

describe('URL dịch vụ nội bộ', () => {
  it('https luôn nhận; http chỉ loopback ngoài production, hoặc tên dịch vụ một nhãn khi cho phép', () => {
    expect(checkServiceUrl('X', 'https://cloud.example.com/nextcloud', { production: true }).pathname).toBe('/nextcloud');
    expect(checkServiceUrl('X', 'http://127.0.0.1:18080', { production: false }).port).toBe('18080');
    expect(checkServiceUrl('X', 'http://[::1]:18080', { production: false }).hostname).toBe('[::1]');
    expect(checkServiceUrl('X', 'http://onlyoffice', { production: true, internalHttp: true }).hostname).toBe('onlyoffice');
    expect(() => checkServiceUrl('X', 'http://127.0.0.1:18080', { production: true })).toThrow('X production bắt buộc https');
    expect(() => checkServiceUrl('X', 'http://cloud.example.com', { production: false })).toThrow('X http chỉ được phép tới loopback');
    expect(() => checkServiceUrl('X', 'http://cloud.example.com', { production: true, internalHttp: true })).toThrow('bắt buộc https');
    for (const bad of ['https://u:p@cloud.example.com', 'https://u@cloud.example.com', 'https://cloud.example.com/?x=1', 'https://cloud.example.com/#a'])
      expect(() => checkServiceUrl('X', bad, { production: true })).toThrow('không được chứa thông tin đăng nhập');
    for (const bad of ['ftp://cloud.example.com', 'file:///etc/passwd']) expect(() => checkServiceUrl('X', bad, { production: false })).toThrow('chỉ nhận https');
    for (const bad of [undefined, '', 'cloud.example.com']) expect(() => checkServiceUrl('X', bad, { production: false })).toThrow('không phải URL hợp lệ');
  });
});

describe('Nextcloud production', () => {
  it('cấu hình: production nhận https, chặn http (kể cả loopback) và URL có user/pass/query', () => {
    expect(loadConfig(nextcloudProd as any).workspaceStorage).toMatchObject({ mode: 'nextcloud', baseUrl: 'https://cloud.example.com' });
    for (const [url, message] of [
      ['http://cloud.example.com', 'production bắt buộc https'],
      ['http://127.0.0.1:18080', 'production bắt buộc https'],
      ['https://admin:secret@cloud.example.com', 'không được chứa thông tin đăng nhập'],
      ['https://cloud.example.com/?token=x', 'không được chứa thông tin đăng nhập'],
    ]) expect(() => loadConfig({ ...nextcloudProd, WORKSPACE_STORAGE_BASE_URL: url } as any)).toThrow(message);
    expect(() => loadConfig({ ...production, WORKSPACE_STORAGE_MODE: 'nextcloud' } as any)).toThrow('WORKSPACE_STORAGE_BASE_URL không phải URL hợp lệ');
  });

  it('cấu hình: ngoài production giữ http loopback cho PoC, chặn http mạng', () => {
    const dev = { NODE_ENV: 'development', GOOGLE_MODE: 'fake', FAKE_GOOGLE_STATE_FILE: 'none', WORKSPACE_STORAGE_MODE: 'nextcloud' };
    expect(loadConfig({ ...dev, WORKSPACE_STORAGE_BASE_URL: 'http://127.0.0.1:18080' } as any).workspaceStorage.baseUrl).toBe('http://127.0.0.1:18080');
    expect(loadConfig({ ...dev, WORKSPACE_STORAGE_BASE_URL: 'https://cloud.example.com' } as any).workspaceStorage.mode).toBe('nextcloud');
    expect(() => loadConfig({ ...dev, WORKSPACE_STORAGE_BASE_URL: 'http://cloud.example.com' } as any)).toThrow('http chỉ được phép tới loopback');
  });

  it('adapter tự kiểm lại URL dù cấu hình được dựng ngoài loadConfig', () => {
    const make = (url: string, production: boolean) => () => new NextcloudWorkspaceStorage(storageCfg(url), { production, credentials: noCredentials });
    expect(make('https://cloud.example.com', true)).not.toThrow();
    expect(make('http://127.0.0.1:18080', true)).toThrow('production bắt buộc https');
    expect(make('http://127.0.0.1:18080', false)).not.toThrow();
    expect(make('http://cloud.example.com', false)).toThrow('loopback');
  });
});

describe('ONLYOFFICE production', () => {
  it('đủ origin https công khai, http nội bộ tới tên dịch vụ Docker thì khởi động được', () => {
    expect(loadConfig(editorProd as any).documentEditor).toMatchObject({
      enabled: true, publicOrigin: 'https://office.example.com', internalOrigin: 'http://onlyoffice', apiOriginForEditor: 'http://api:4000',
    });
    const allHttps = { ...editorProd, DOCUMENT_EDITOR_INTERNAL_ORIGIN: 'https://office.example.com' } as any;
    delete allHttps.DOCUMENT_EDITOR_API_ORIGIN;
    expect(loadConfig(allHttps).documentEditor.apiOriginForEditor).toBe('https://vcdocs.example.com');
  });

  it('origin công khai phải https, không rơi về giá trị PoC, không chứa bí mật', () => {
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_PUBLIC_ORIGIN: 'http://office.example.com' } as any)).toThrow('DOCUMENT_EDITOR_PUBLIC_ORIGIN production bắt buộc https');
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_PUBLIC_ORIGIN: 'http://onlyoffice' } as any)).toThrow('DOCUMENT_EDITOR_PUBLIC_ORIGIN production bắt buộc https');
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_PUBLIC_ORIGIN: '' } as any)).toThrow('bắt buộc khi bật trình soạn thảo');
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_INTERNAL_ORIGIN: '' } as any)).toThrow('bắt buộc khi bật trình soạn thảo');
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_PUBLIC_ORIGIN: 'https://office.example.com/?jwt=x' } as any)).toThrow('không được chứa thông tin đăng nhập');
  });

  it('origin nội bộ chỉ nhận https hoặc http tới tên dịch vụ một nhãn', () => {
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_INTERNAL_ORIGIN: 'http://office.example.com' } as any)).toThrow('DOCUMENT_EDITOR_INTERNAL_ORIGIN production bắt buộc https');
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_API_ORIGIN: 'http://host.docker.internal:4000' } as any)).toThrow('DOCUMENT_EDITOR_API_ORIGIN production bắt buộc https');
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_API_ORIGIN: 'http://u:p@api:4000' } as any)).toThrow('không được chứa thông tin đăng nhập');
  });

  it('khoá JWT và kho tắt vẫn bị chặn như trước', () => {
    expect(() => loadConfig({ ...editorProd, DOCUMENT_EDITOR_JWT_SECRET: 'ngan' } as any)).toThrow('DOCUMENT_EDITOR_JWT_SECRET');
    expect(() => loadConfig({ ...editorProd, WORKSPACE_STORAGE_MODE: 'disabled' } as any)).toThrow('DOCUMENT_EDITOR_ENABLED cần WORKSPACE_STORAGE_MODE');
  });
});

describe('Drive qua adapter Nextcloud trên http loopback (dev/test)', () => {
  let t: TestApp;
  const dav = fakeWebdav({ 'vcw-a': 'app-pass-a' });
  beforeAll(async () => {
    t = await createTestApp({ workspaceStorage: { mode: 'nextcloud', baseUrl: await dav.start(), timeoutMs: 2_000,
      credentials: { 'tp.mkt@vcprosperous.com': { username: 'vcw-a', password: 'app-pass-a' } } } });
  });
  afterAll(async () => { await t?.close(); await dav.stop(); });

  it('tải lên/tải về đi qua WebDAV của đúng người, người không có credential bị từ chối', async () => {
    const manager = await t.login('tp.mkt');
    const department = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const uploaded = await manager.upload('/drive/files', { spaceId: department.id }, {
      name: 'b1.txt', type: 'text/plain', content: Buffer.from('B1 Drive production'),
    }, { idem: 'b1-nextcloud-loopback' });
    expect(uploaded.status).toBe(201);
    expect((await manager.get(`/drive/files/${uploaded.body.id}/content`)).text).toBe('B1 Drive production');
    const stored = [...dav.objects.keys()].filter((key) => key.startsWith('/remote.php/dav/files/vcw-a/'));
    expect(stored.some((key) => dav.objects.get(key) instanceof Buffer)).toBe(true);
    expect(new Set(dav.auth)).toEqual(new Set(['Basic ' + Buffer.from('vcw-a:app-pass-a').toString('base64')]));

    const other = await t.login('nv.mkt');
    expect((await other.agent.get('/api/v1/spaces')).status).toBe(403);
  });
});
