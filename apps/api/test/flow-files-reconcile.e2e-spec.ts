import { Types } from 'mongoose';
import { loadConfig } from '../src/config/config';
import { FlowService } from '../src/modules/flow/flow.service';
import { NextcloudFlowClient } from '../src/modules/flow/nextcloud-flow.client';
import { createTestApp, expectContract, TestApp } from './support/app';
import { FakeNextcloudFlow } from './support/fake-nextcloud-flow';

// Chat15 Flow × NAS: đối soát Files theo thư mục. Thay đổi ngoài Nextcloud (sửa/đổi tên
// trực tiếp trên NAS rồi notify/scan) không phát Node*Event cho webhook_listeners, nên
// worker liệt kê thư mục của rule bằng quyền runner, so fileid/ETag với ảnh chụp lần
// trước và đưa thay đổi chưa có journal vào hàng đợi (source = reconcile).
const SECRET = 'flow15-current-secret-0123456789abcdef';
const OWNER = 'nc-owner';
const MEMBER = 'nc-member';
const URL_WEBHOOK = '/api/v1/flow/nextcloud/webhooks';
const now = () => Math.floor(Date.now() / 1000);

describe('Cấu hình đối soát Files', () => {
  it('reconcile phải là boolean', () => {
    const env = (rule: Record<string, unknown>) => ({
      NODE_ENV: 'test', GOOGLE_MODE: 'fake', FLOW_ENABLED: 'true', FLOW_COMPANY_ID: 'a'.repeat(24), FLOW_WEBHOOK_SECRETS: SECRET, FLOW_NEXTCLOUD_BASE_URL: 'http://127.0.0.1:18130',
      FLOW_NEXTCLOUD_CREDENTIALS_JSON: JSON.stringify({ r: { username: 'u', password: 'p' } }),
      FLOW_RULES_JSON: JSON.stringify([{ id: 'f', kind: 'files.verify-tag', runner: 'r', folderPath: 'NAS-TeamA/HoSo', tagName: 't', ...rule }]),
    }) as any;
    expect(() => loadConfig(env({ reconcile: true }))).not.toThrow();
    expect(() => loadConfig(env({}))).not.toThrow();
    expect(() => loadConfig(env({ reconcile: 'yes' }))).toThrow(/boolean/);
  });
});

describe('Flow đối soát Files theo thư mục (chat15)', () => {
  let t: TestApp;
  let nc: FakeNextcloudFlow;
  let flow: FlowService;
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const events = (filter: any = {}) => t.db.m.FlowEvent.find({ companyId: cid(), ...filter }).sort({ _id: 1 }).lean<any[]>();
  const states = () => t.db.m.FlowFileState.find({ companyId: cid(), ruleId: 'nas-tag' }).lean<any[]>();
  const put = (fileId: number, path: string, opts: { tags?: string[]; etag?: string; mtime?: number } = {}) =>
    nc.files.set(fileId, { paths: { [OWNER]: path, [MEMBER]: path }, tags: opts.tags ?? [], etag: opts.etag ?? `e${fileId}`, mtime: opts.mtime ?? now() });

  beforeAll(async () => {
    nc = new FakeNextcloudFlow();
    await nc.start();
    nc.passwords = { [OWNER]: 'owner-app-password', [MEMBER]: 'member-app-password' };
    // Có từ trước khi bật rule: không bù
    put(800, '/NAS-TeamA/HoSo/cu.txt', { tags: ['hoso'], mtime: now() - 3600 });
    // File ngoài thư mục rule: không bao giờ được liệt kê
    put(890, '/NAS-TeamA/Khac/ngoai.txt', { mtime: now() + 5 });
    t = await createTestApp({
      flow: {
        enabled: true,
        companyId: '000000000000000000000000',
        webhookSecrets: [SECRET],
        nextcloud: { baseUrl: nc.origin, timeoutMs: 2000, credentials: { owner: { username: OWNER, password: 'owner-app-password' } }, userBindings: {} },
        rules: [
          { id: 'nas-tag', kind: 'files.verify-tag', runner: 'owner', folderPath: 'NAS-TeamA/HoSo', tagName: 'hoso', reconcile: true },
          { id: 'nas-b', kind: 'files.verify-tag', runner: 'owner', folderPath: 'NAS-TeamB/HoSo', tagName: 'hoso', reconcile: true },
          { id: 'webhook-only', kind: 'files.verify-tag', runner: 'owner', folderPath: 'Flow14-HoSo', tagName: 'hoso' },
        ],
        workerPollMs: 0,
        leaseMs: 60_000,
        maxAttempts: 3,
        retryBaseMs: 0,
        reconcileMs: 0,
      },
    });
    t.cfg.flow.companyId = t.ids.companyId;
    flow = t.app.get(FlowService);
    nc.forbiddenFolders.add('/NAS-TeamB/HoSo');
  });
  afterAll(async () => {
    await t?.close();
    await nc?.stop();
  });

  it('lần đầu chỉ chụp ảnh gốc: file cũ không bù, file đổi sau mốc kích hoạt (kể cả thư mục con) vào hàng đợi; NAS ghi không tag → tag_missing có audit', async () => {
    await flow.ensureCursors();
    put(801, '/NAS-TeamA/HoSo/con/moi-tren-nas.txt', { mtime: now() + 5 });
    expect(await flow.reconcile()).toBe(1);
    const [ev] = await events({ resourceKey: 'files:node:801' });
    expect(ev).toMatchObject({ source: 'reconcile', eventClass: 'OCP\\Files\\Events\\Node\\NodeCreatedEvent', ruleIds: ['nas-tag'], status: 'queued' });
    expect(await events({ resourceKey: 'files:node:800' })).toHaveLength(0);
    expect(await events({ resourceKey: 'files:node:890' })).toHaveLength(0);
    expect((await states()).map((s) => s.fileId).sort()).toEqual([800, 801]);
    expect(await flow.reconcile()).toBe(0);
    await flow.drain();
    const [done] = await events({ resourceKey: 'files:node:801' });
    expect(done.status).toBe('skipped');
    expect(done.results[0]).toMatchObject({ ruleId: 'nas-tag', outcome: 'tag_missing' });
    const audits = await t.db.m.AuditLog.find({ companyId: cid(), requestId: done.correlationId }).sort({ seq: 1 }).lean<any[]>();
    expect(audits.map((a) => a.action)).toEqual(['flow.event.reconciled', 'flow.files.tag_missing', 'flow.rule.skipped', 'flow.event.skipped']);
    expect(audits[1].after).toMatchObject({ fileId: 801, expected: 'hoso', runner: OWNER });
  });

  it('ETag đổi → NodeWritten; file mới đã có tag → tag_verified; không đổi → không gì', async () => {
    nc.files.get(800)!.etag = 'e800-v2';
    nc.files.get(800)!.mtime = now();
    put(802, '/NAS-TeamA/HoSo/da-gan-tag.txt', { tags: ['hoso'] });
    expect(await flow.reconcile()).toBe(2);
    expect(await flow.reconcile()).toBe(0);
    await flow.drain();
    const [written] = await events({ resourceKey: 'files:node:800' });
    expect(written.eventClass).toBe('OCP\\Files\\Events\\Node\\NodeWrittenEvent');
    expect(written.results[0].outcome).toBe('tag_verified');
    expect((await events({ resourceKey: 'files:node:802' }))[0].results[0].outcome).toBe('tag_verified');
  });

  it('thay đổi đã có webhook (thao tác qua Nextcloud) không bị đối soát nhân đôi', async () => {
    put(803, '/NAS-TeamA/HoSo/qua-webdav.txt', { tags: ['hoso'] });
    const res = await t.http().post(URL_WEBHOOK).set('X-VCW-Flow-Token', SECRET).send({ event: { class: 'OCP\\Files\\Events\\Node\\NodeCreatedEvent', node: { id: 803, path: `/${MEMBER}/files/NAS-TeamA/HoSo/qua-webdav.txt` } }, user: { uid: MEMBER }, time: now() });
    expectContract('POST', URL_WEBHOOK, res);
    expect(res.status).toBe(202);
    expect(await flow.reconcile()).toBe(0);
    const evs = await events({ resourceKey: 'files:node:803' });
    expect(evs).toHaveLength(1);
    expect(evs[0].source).toBe('webhook');
    expect((await states()).some((s) => s.fileId === 803)).toBe(true);
    await flow.drain();
  });

  it('đổi tên ngoài Nextcloud: fileid mới được đưa vào, fileid cũ rời ảnh chụp', async () => {
    const old = nc.files.get(801)!;
    nc.files.delete(801);
    put(804, '/NAS-TeamA/HoSo/con/doi-ten-tren-nas.txt', { tags: old.tags });
    expect(await flow.reconcile()).toBe(1);
    const ids = (await states()).map((s) => s.fileId);
    expect(ids).toContain(804);
    expect(ids).not.toContain(801);
    expect((await events({ resourceKey: 'files:node:804' }))[0].source).toBe('reconcile');
    await flow.drain();
  });

  it('href lạ/ngoài thư mục trong phản hồi bị bỏ qua; chỉ gọi origin cấu hình bằng runner', async () => {
    nc.extraPropfindHrefs = [
      `/remote.php/dav/files/${OWNER}/NAS-TeamA/Khac/x.txt`,
      `/remote.php/dav/files/${OWNER}/NAS-TeamA/HoSo/../Khac/y.txt`,
      'http://169.254.169.254/latest/meta-data',
      '%E0%A4%A',
    ];
    const fetchSpy = jest.spyOn(global, 'fetch');
    nc.requests.length = 0;
    try {
      expect(await flow.reconcile()).toBe(0);
    } finally {
      nc.extraPropfindHrefs = [];
    }
    const fetched = fetchSpy.mock.calls.map((c) => String(c[0]));
    fetchSpy.mockRestore();
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((u) => u.startsWith(nc.origin))).toBe(true);
    expect((await states()).some((s) => s.fileId === 999999)).toBe(false);
    expect(new Set(nc.requests.map((r) => r.user))).toEqual(new Set([OWNER]));
  });

  it('runner bị chặn thư mục (403) hoặc app password bị thu hồi (401): không đưa gì vào, ghi audit, rule khác vẫn chạy', async () => {
    put(805, '/NAS-TeamA/HoSo/sau-403.txt', { tags: ['hoso'] });
    expect(await flow.reconcile()).toBe(1);
    const failed = await t.db.m.AuditLog.find({ companyId: cid(), action: 'flow.reconcile.failed', objectId: 'nas-b' }).lean<any[]>();
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.at(-1).after.outcome).toBe('runner_forbidden');
    nc.passwords[OWNER] = 'revoked';
    put(806, '/NAS-TeamA/HoSo/khi-bi-thu-hoi.txt');
    try {
      expect(await flow.reconcile()).toBe(0);
    } finally {
      nc.passwords[OWNER] = 'owner-app-password';
    }
    const unauth = await t.db.m.AuditLog.find({ companyId: cid(), action: 'flow.reconcile.failed', objectId: 'nas-tag' }).lean<any[]>();
    expect(unauth.at(-1).after.outcome).toBe('runner_unauthenticated');
    // Ảnh chụp không bị xoá khi không đọc được thư mục; có lại quyền thì 806 được bù
    expect((await states()).length).toBeGreaterThanOrEqual(5);
    expect(await flow.reconcile()).toBe(1);
    expect(await events({ resourceKey: 'files:node:806' })).toHaveLength(1);
    expect(await t.db.m.FlowFileState.countDocuments({ companyId: cid(), ruleId: 'webhook-only' })).toBe(0);
  });

  it('giới hạn số file/thư mục: liệt kê bị cắt thì báo truncated', async () => {
    const client = new NextcloudFlowClient(nc.origin, 2000, { username: OWNER, password: 'owner-app-password' });
    const full = await client.listFolderFiles('NAS-TeamA/HoSo');
    expect(full.truncated).toBe(false);
    expect(full.files.length).toBeGreaterThanOrEqual(5);
    const cut = await client.listFolderFiles('NAS-TeamA/HoSo', { maxFiles: 1, maxDirs: 10 });
    expect(cut).toMatchObject({ truncated: true });
    expect(cut.files).toHaveLength(1);
    const dirs = await client.listFolderFiles('NAS-TeamA/HoSo', { maxFiles: 100, maxDirs: 1 });
    expect(dirs.truncated).toBe(true);
    await expect(client.listFolderFiles('NAS-TeamB/HoSo')).rejects.toMatchObject({ outcome: 'runner_forbidden' });
  });
});
