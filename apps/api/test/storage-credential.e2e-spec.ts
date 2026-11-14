import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../src/config/config';
import { open, parseKeyring, seal } from '../src/common/credential-cipher';
import { StorageCredentialStore } from '../src/modules/drive-basic/storage-credential.store';
import { parseArgs, run } from '../src/kho-credential';
import { createTestApp, TestApp } from './support/app';
import { fakeWebdav } from './support/fake-webdav';

// B1 P1 (docs/ke-hoach/vcworkspace-21-b1-drive-office-production.md mục 2): app password theo người, mã hoá trong CSDL.
const k = (kid: string, fill: number) => `${kid}:${Buffer.alloc(32, fill).toString('base64')}`;
const K1 = k('k1', 1);
const K2 = k('k2', 2);

describe('Mã hoá credential', () => {
  const keys = parseKeyring(K1);

  it('keyring đúng dạng kid:<base64 32 byte>, không trùng kid', () => {
    expect(parseKeyring(`${K2}, ${K1}`).map((x) => x.kid)).toEqual(['k2', 'k1']);
    expect(parseKeyring(undefined)).toEqual([]);
    for (const bad of ['k1', `k1:${Buffer.alloc(16).toString('base64')}`, `K 1:${Buffer.alloc(32).toString('base64')}`, `:${Buffer.alloc(32).toString('base64')}`])
      expect(() => parseKeyring(bad)).toThrow('kid:<base64 32 byte>');
    expect(() => parseKeyring(`${K1},${k('k1', 3)}`)).toThrow('kid trùng');
  });

  it('mở được đúng chủ; sai AAD, sửa bản mã, cắt tag, thiếu khoá đều lỗi chung', () => {
    const sealed = seal(keys, 'app-pass', 'c|u|nc');
    expect(sealed.kid).toBe('k1');
    expect(JSON.stringify(sealed)).not.toContain('app-pass');
    expect(seal(keys, 'app-pass', 'c|u|nc').iv).not.toBe(sealed.iv);
    expect(open(keys, sealed, 'c|u|nc')).toBe('app-pass');
    expect(() => open(keys, sealed, 'c|u2|nc')).toThrow('CREDENTIAL_DECRYPT_FAILED');
    const flipped = Buffer.from(sealed.ciphertext, 'base64'); flipped[0] ^= 1;
    expect(() => open(keys, { ...sealed, ciphertext: flipped.toString('base64') }, 'c|u|nc')).toThrow('CREDENTIAL_DECRYPT_FAILED');
    expect(() => open(keys, { ...sealed, tag: Buffer.from(sealed.tag, 'base64').subarray(0, 4).toString('base64') }, 'c|u|nc')).toThrow('CREDENTIAL_DECRYPT_FAILED');
    expect(() => open(parseKeyring(K2), sealed, 'c|u|nc')).toThrow('CREDENTIAL_KEY_NOT_FOUND');
    expect(() => seal([], 'x', 'a')).toThrow('Chưa cấu hình khoá');
  });
});

describe('Cấu hình nguồn credential', () => {
  const prod = { NODE_ENV: 'production', GOOGLE_MODE: 'real', PUBLIC_API_ORIGIN: 'https://vcdocs.example.com', WEB_ORIGIN: 'https://vcdocs.example.com',
    COOKIE_SECURE: 'true', WORKSPACE_STORAGE_MODE: 'nextcloud', WORKSPACE_STORAGE_BASE_URL: 'https://cloud.example.com', WORKSPACE_CREDENTIAL_KEYS: K1 };

  it('production mặc định lưu trong CSDL, chu kỳ xoay 90 ngày và cấu hình được', () => {
    expect(loadConfig(prod as any).workspaceStorage).toMatchObject({ credentialSource: 'store', credentialRotateDays: 90 });
    expect(loadConfig({ ...prod, WORKSPACE_CREDENTIAL_ROTATE_DAYS: '30' } as any).workspaceStorage.credentialRotateDays).toBe(30);
    for (const bad of ['0', '366', '1.5']) expect(() => loadConfig({ ...prod, WORKSPACE_CREDENTIAL_ROTATE_DAYS: bad } as any)).toThrow('WORKSPACE_CREDENTIAL_ROTATE_DAYS');
  });

  it('production chặn app password tĩnh trong env, nguồn env và thiếu keyring', () => {
    expect(() => loadConfig({ ...prod, WORKSPACE_STORAGE_CREDENTIALS_JSON: '{"a@x.com":{"username":"a","password":"p"}}' } as any)).toThrow('WORKSPACE_STORAGE_CREDENTIALS_JSON ở production');
    expect(() => loadConfig({ ...prod, WORKSPACE_STORAGE_CREDENTIAL_SOURCE: 'env' } as any)).toThrow('CREDENTIAL_SOURCE=store');
    expect(() => loadConfig({ ...prod, WORKSPACE_CREDENTIAL_KEYS: '' } as any)).toThrow('WORKSPACE_CREDENTIAL_KEYS bắt buộc');
    expect(() => loadConfig({ ...prod, WORKSPACE_STORAGE_CREDENTIAL_SOURCE: 'vault' } as any)).toThrow('env hoặc store');
  });

  it('keyring đọc được từ file secret; ngoài production mặc định env như PoC', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcw-keys-'));
    const file = path.join(dir, 'keys');
    fs.writeFileSync(file, `${K2},${K1}\n`, { mode: 0o600 });
    try {
      const { WORKSPACE_CREDENTIAL_KEYS, ...rest } = prod;
      expect(loadConfig({ ...rest, WORKSPACE_CREDENTIAL_KEYS_FILE: file } as any).workspaceStorage.credentialKeys!.map((x) => x.kid)).toEqual(['k2', 'k1']);
    } finally { fs.rmSync(dir, { recursive: true }); }
    const dev = loadConfig({ NODE_ENV: 'development', GOOGLE_MODE: 'fake', FAKE_GOOGLE_STATE_FILE: 'none', WORKSPACE_STORAGE_MODE: 'nextcloud', WORKSPACE_STORAGE_BASE_URL: 'http://127.0.0.1:18080' } as any);
    expect(dev.workspaceStorage.credentialSource).toBe('env');
  });
});

describe('Drive dùng credential mã hoá trong CSDL', () => {
  let t: TestApp;
  let store: StorageCredentialStore;
  let companyId: string;
  let userId: string;
  const email = 'tp.mkt@vcprosperous.com';
  const dav = fakeWebdav({ 'vcw-a': 'pass-1' });
  const basic = (pass: string) => 'Basic ' + Buffer.from('vcw-a:' + pass).toString('base64');

  beforeAll(async () => {
    t = await createTestApp({ workspaceStorage: { mode: 'nextcloud', baseUrl: await dav.start(), timeoutMs: 2_000, credentials: {},
      credentialSource: 'store', credentialKeys: parseKeyring(K1), credentialRotateDays: 30 } });
    store = t.app.get(StorageCredentialStore);
    companyId = String(t.ids.companyId);
    userId = String(t.ids.users['tp.mkt']);
  });
  afterAll(async () => { await t?.close(); await dav.stop(); });

  const upload = async (name: string) => {
    const c = await t.login('tp.mkt');
    const spaces = await c.agent.get('/api/v1/spaces');
    if (spaces.status !== 200) return spaces.status;
    const department = spaces.body.items.find((item: any) => item.kind === 'department');
    const r = await c.upload('/drive/files', { spaceId: department.id }, { name, type: 'text/plain', content: Buffer.from(name) }, { idem: 'cred-' + name });
    return r.status === 201 ? (await c.get(`/drive/files/${r.body.id}/content`)).text : r.status;
  };

  it('chưa nạp credential thì 403; nạp rồi thì WebDAV dùng đúng app password, CSDL chỉ có bản mã', async () => {
    expect(await upload('a.txt')).toBe(403);
    const now = new Date('2026-10-26T00:00:00Z');
    await store.save({ companyId, userId, email, ncUid: 'vcw-a', password: 'pass-1' }, now);
    expect(await upload('a.txt')).toBe('a.txt');
    expect(dav.auth.at(-1)).toBe(basic('pass-1'));
    const row = await t.db.m.WorkspaceStorageCredential.findOne({ companyId, userId }).lean<any>();
    expect(JSON.stringify(row)).not.toContain('pass-1');
    expect(row).toMatchObject({ status: 'active', kid: 'k1', ncUid: 'vcw-a', email });
    expect(row.rotateAfter.toISOString()).toBe('2026-11-25T00:00:00.000Z');
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });

  it('bản mã chép sang người khác không giải mã được', async () => {
    const row = await t.db.m.WorkspaceStorageCredential.findOne({ companyId, userId }).lean<any>();
    const other = String(t.ids.users['nv.mkt']);
    await t.db.m.WorkspaceStorageCredential.create({ ...row, _id: undefined, userId: other, email: 'nv.mkt@vcprosperous.com' });
    await expect(store.resolve({ companyId, email: 'nv.mkt@vcprosperous.com' })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    await t.db.m.WorkspaceStorageCredential.deleteOne({ companyId, userId: other });
  });

  it('tới hạn xoay: cấp mới, dùng mới, xoá cũ; cấp lỗi thì giữ cũ; xoá cũ lỗi thì báo', async () => {
    expect(await store.dueForRotation(companyId, new Date('2026-11-01T00:00:00Z'))).toEqual([]);
    expect(await store.dueForRotation(companyId, new Date('2026-11-25T00:00:00Z'))).toEqual([expect.objectContaining({ email, ncUid: 'vcw-a' })]);

    const failing = { issue: async () => { throw new Error('nextcloud lỗi'); }, revoke: async () => undefined };
    await expect(store.rotate(companyId, userId, failing)).rejects.toThrow('nextcloud lỗi');
    expect(await upload('b.txt')).toBe('b.txt');

    const revoked: string[] = [];
    const issuer = {
      issue: async (uid: string, current: { password: string }) => { expect([uid, current.password]).toEqual(['vcw-a', 'pass-1']); dav.accounts['vcw-a'] = 'pass-2'; return 'pass-2'; },
      revoke: async (_uid: string, old: { password: string }) => { revoked.push(old.password); },
    };
    expect(await store.rotate(companyId, userId, issuer, new Date('2026-11-25T00:00:00Z'))).toEqual({ oldRevoked: true });
    expect(revoked).toEqual(['pass-1']);
    expect(await upload('c.txt')).toBe('c.txt');
    expect(dav.auth.at(-1)).toBe(basic('pass-2'));
    expect(await store.dueForRotation(companyId, new Date('2026-12-01T00:00:00Z'))).toEqual([]);

    const badRevoke = { issue: async () => { dav.accounts['vcw-a'] = 'pass-3'; return 'pass-3'; }, revoke: async () => { throw new Error('x'); } };
    expect(await store.rotate(companyId, userId, badRevoke)).toEqual({ oldRevoked: false });
    expect(await upload('d.txt')).toBe('d.txt');
  });

  it('tiến trình khác đổi app password: Nextcloud trả 401 thì bỏ cache, lần sau dùng bản mới', async () => {
    const other = new StorageCredentialStore(t.cfg, t.db);
    dav.accounts['vcw-a'] = 'pass-4';
    await other.save({ companyId, userId, email, ncUid: 'vcw-a', password: 'pass-4' });
    expect(await upload('e.txt')).toBe(403);
    expect(await upload('e2.txt')).toBe('e2.txt');
  });

  it('xoay khoá chủ: mã hoá lại bằng khoá đầu, gỡ khoá cũ vẫn dùng được', async () => {
    const both = new StorageCredentialStore({ ...t.cfg, workspaceStorage: { ...t.cfg.workspaceStorage, credentialKeys: parseKeyring(`${K2},${K1}`) } }, t.db);
    expect(await both.reencrypt(companyId)).toBe(1);
    expect(await both.reencrypt(companyId)).toBe(0);
    expect((await t.db.m.WorkspaceStorageCredential.findOne({ companyId, userId }).lean<any>()).kid).toBe('k2');
    const onlyNew = new StorageCredentialStore({ ...t.cfg, workspaceStorage: { ...t.cfg.workspaceStorage, credentialKeys: parseKeyring(K2) } }, t.db);
    expect((await onlyNew.resolve({ companyId, email })).password).toBe('pass-4');
    const onlyOld = new StorageCredentialStore(t.cfg, t.db);
    await expect(onlyOld.resolve({ companyId, email })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('lệnh kho-credential: bí mật chỉ qua stdin; nạp, liệt kê đến hạn, thu hồi', async () => {
    expect(() => parseArgs(['nap', '--email', email, '--password', 'x'])).toThrow('Không truyền bí mật qua tham số');
    expect(() => parseArgs(['xoa-het'])).toThrow('Lệnh:');
    const keys2 = new StorageCredentialStore({ ...t.cfg, workspaceStorage: { ...t.cfg.workspaceStorage, credentialKeys: parseKeyring(`${K2},${K1}`) } }, t.db);
    expect(await run(t.db.m, keys2, ['nap', '--email', email, '--uid', 'vcw-a'], async () => 'pass-5')).toEqual({ saved: email, ncUid: 'vcw-a' });
    expect((await keys2.resolve({ companyId, email })).password).toBe('pass-5');
    expect(await run(t.db.m, keys2, ['den-han', '--domain', 'vcprosperous.com'])).toEqual([]);
    expect(await run(t.db.m, keys2, ['thu-hoi', '--email', email])).toEqual({ revoked: true });
    const row = await t.db.m.WorkspaceStorageCredential.findOne({ companyId, userId }).lean<any>();
    expect(row).toMatchObject({ status: 'revoked' });
    expect(row.ciphertext).toBeUndefined();
    await expect(keys2.resolve({ companyId, email })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
