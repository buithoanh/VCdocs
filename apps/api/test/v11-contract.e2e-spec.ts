import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { dateVN } from '../src/common/util';

/** Phần thay đổi theo hợp đồng 1.1.0-gd1 (mục 7 rev 16 + mục 9 D1–D14) */
describe('Hợp đồng 1.1: people, allowedActions, limits, lookup, 413, gốc drive', () => {
  let t: TestApp;
  let nv: Client, tp: Client, r3: Client, r9: Client, gdk: Client, leader: Client;
  beforeAll(async () => {
    t = await createTestApp({ rules: { ...(await import('../src/config/config')).loadConfig({} as any).rules, shareMaxDays: 21 } });
    nv = await t.login('nv.mkt');
    tp = await t.login('tp.mkt');
    r3 = await t.login('hcns');
    r9 = await t.login('it');
    gdk = await t.login('gdk.kd');
    leader = await t.login('leader.mkt');
  });
  afterAll(async () => t.close());

  it('/me có limits lấy từ cấu hình và blockId của giám đốc khối (D12)', async () => {
    const me = (await gdk.get('/me')).body;
    expect(me.blockId).toBe(t.ids.blocks.KD);
    expect(me.limits).toEqual({ shareMaxDays: 21, backdateWorkingDays: 3, approvalDueDays: 3, minorUnlockDays: 3, uploadMaxMb: 100 });
    expect((await nv.get('/me')).body.blockId).toBeUndefined();
    expect(me.user.allowedActions).toEqual([]);
  });

  it('GET /users/lookup: mọi người đã đăng nhập, chỉ người đang làm, ≤ 20, có title + departmentId (D3)', async () => {
    await t.db.m.User.updateOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(t.ids.users['xem.mkt']) }, { $set: { status: 'left' } });
    const r = await nv.get('/users/lookup?q=mkt');
    expect(r.status).toBe(200);
    const emails = r.body.items.map((u: any) => u.email);
    expect(emails).toEqual(expect.arrayContaining([t.ids.emails['tp.mkt'], t.ids.emails['nv.mkt']]));
    expect(emails).not.toContain(t.ids.emails['xem.mkt']);
    expect(r.body.items.find((u: any) => u.email === t.ids.emails['tp.mkt'])).toEqual({ id: t.ids.users['tp.mkt'], name: 'Trưởng phòng MKT (mẫu)', email: t.ids.emails['tp.mkt'], title: 'Trưởng phòng', departmentId: t.ids.depts.MKT.id });
    const byDept = await nv.get(`/users/lookup?q=m%E1%BA%ABu&departmentId=${t.ids.depts.KD.id}`);
    expect(byDept.body.items.every((u: any) => u.departmentId === t.ids.depts.KD.id)).toBe(true);
    expect((await nv.get('/users/lookup')).status).toBe(400);
    expect((await nv.get('/users/lookup?q=m')).body.items.length).toBeLessThanOrEqual(20);
  });

  it('allowedActions của User (update-roles, update-leave) và danh mục nền (update)', async () => {
    const u = (await r9.get(`/users/${t.ids.users['nv.mkt']}`)).body;
    expect(u.allowedActions).toEqual(['update-roles']);
    expect((await r9.get(`/users/${t.ids.users.it}`)).body.allowedActions).toEqual([]);
    expect((await r3.get(`/users/${t.ids.users['nv.mkt']}`)).body.allowedActions).toEqual(['update-leave']);
    expect((await r3.get('/blocks')).body.items[0].allowedActions).toEqual(['update']);
    expect((await nv.get('/departments')).body.items[0].allowedActions).toEqual([]);
    expect((await r9.get('/divisions')).body.items[0].allowedActions).toEqual(['update']);
  });

  it('people: trang danh sách và từng đối tượng có id → UserRef cho mọi id người (D10)', async () => {
    const page = (await nv.get('/documents?type=BM')).body;
    expect(page.people[t.ids.users.hcns]).toMatchObject({ name: 'Kiểm soát tài liệu HCNS (mẫu)', email: t.ids.emails.hcns });
    const d = (await nv.get(`/documents/${t.ids.templates['BM-VCPV-02']}`)).body;
    expect(Object.keys(d.people).sort()).toEqual([t.ids.users.hcns, t.ids.users['gdk.vhnb']].sort());
    // D17: danh sách chỉ có people ở cấp trang
    const codes = (await nv.get('/codes?limit=1')).body;
    expect(codes.items[0].people).toBeUndefined();
    expect(codes.people[t.ids.users.tgd].name).toBe('Tổng giám đốc (mẫu)');
    // D19: danh mục nền và bảng uỷ quyền có people
    const depts = (await nv.get('/departments')).body;
    expect(depts.people[t.ids.users['tp.mkt']].email).toBe(t.ids.emails['tp.mkt']);
    expect((await nv.get('/blocks')).body.people[t.ids.users['gdk.kd']].name).toBe('GĐ khối Kinh doanh (mẫu)');
    expect((await nv.get('/divisions')).body.people).toEqual({});
    expect((await gdk.get('/delegations')).body.people).toEqual({});
  });

  it('thư mục: allowedActions; tạo ở gốc drive không cần parentId; next-number theo driveId (D8)', async () => {
    const mkt = t.ids.depts.MKT.driveId;
    const roots = (await tp.get(`/folders?driveId=${mkt}`)).body.items;
    const proj = roots.find((f: any) => f.name === '50 DA-MAI');
    expect(proj.allowedActions).toEqual(['create-child', 'rename', 'close-project', 'resync']);
    expect(roots.find((f: any) => f.name === '10 SEO').allowedActions).toEqual(['create-child', 'rename', 'resync']);
    const lRoots = (await leader.get(`/folders?driveId=${mkt}`)).body.items;
    expect(lRoots.find((f: any) => f.name === '10 SEO').allowedActions).toEqual(['create-child']);
    expect(lRoots.find((f: any) => f.name === '00 Tài liệu').allowedActions).toEqual([]);
    expect((await nv.get(`/folders/${proj.id}`)).body.allowedActions).toEqual([]);
    expect((await r3.get(`/folders/${t.ids.folders['VCPV:00']}`)).body.allowedActions).toEqual(['create-child', 'rename', 'resync']);

    // D20: gốc drive không có thư mục năm, tháng, đối tượng
    const e = await tp.get(`/folders/next-number?driveId=${mkt}&kind=entity`);
    expect(e.status).toBe(422);
    expect(e.body.error.rule).toBe('BR-11');
    const pe = await tp.post('/folders', { driveId: mkt, kind: 'entity', shortName: '30A-12345' });
    expect(pe.status).toBe(422);
    expect(pe.body.error.rule).toBe('BR-11');
    expect((await tp.post('/folders', { driveId: mkt, kind: 'year', shortName: '2027' })).body.error.rule).toBe('BR-11');
    const ent = await tp.post('/folders', { driveId: mkt, parentId: proj.id, kind: 'entity', shortName: '30A-12345' });
    expect(ent.status).toBe(202);
    const n = await tp.get(`/folders/next-number?driveId=${mkt}&kind=project`);
    expect(n.body.number).toBe('52');
    expect((await tp.get('/folders/next-number?kind=project')).status).toBe(400);
    expect((await tp.get('/folders/next-number?driveId=khong-co&kind=area')).status).toBe(404);
    const c = await tp.post('/folders', { driveId: mkt, kind: 'project', code: 'DA-MAI', shortName: 'MAI3' });
    expect(c.status).toBe(202);
    await t.drain();
    const job = (await tp.get(`/jobs/${c.body.jobId}`)).body;
    expect(job.result).toEqual({ objectType: 'folder', objectId: expect.any(String) });
    expect(job.people[t.ids.users['tp.mkt']].name).toBe('Trưởng phòng MKT (mẫu)');
    const sync = await r9.post('/sync/google');
    await t.drain();
    const sj = (await r9.get(`/jobs/${sync.body.jobId}`)).body;
    expect(sj.result).toBeUndefined();
    expect(sj.summary.total).toBeGreaterThan(0);
    expect((await tp.get(`/folders/${job.result.objectId}`)).body).toMatchObject({ number: '52', path: '11 MKT / 52 DA-MAI-MAI3' });
  });

  it('413 PAYLOAD_TOO_LARGE: thân JSON > 1 MB, file > 100 MB', async () => {
    const big = 'x'.repeat(1_100_000);
    const r = await tp.agent.post('/api/v1/codes').set('X-CSRF-Token', tp.csrf).set('Idempotency-Key', 'k-big-000001').send({ code: 'A', type: 'channel', meaning: big, scope: 'x', reason: 'x' });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const month = dateVN().slice(0, 7);
    const t2 = await createTestApp();
    try {
      const c = await t2.login('nv.mkt');
      const res = await c.upload('/records/upload', { recordTypeId: t2.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'x', workMonth: month }, { name: 'a.pdf', type: 'application/pdf', content: Buffer.alloc(101 * 1024 * 1024) });
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await t2.close();
    }
  });

  it('trường lạ trong thân bị loại, không báo lỗi', async () => {
    const r = await tp.post('/codes', { code: 'LA-2', type: 'channel', meaning: 'x', scope: 'x', reason: 'x', status: 'approved', hack: { $gt: 1 } });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    const row = await t.db.m.Code.findOne({ companyId: new Types.ObjectId(t.ids.companyId), code: 'LA-2' }).lean<any>();
    expect(row.hack).toBeUndefined();
  });
});
