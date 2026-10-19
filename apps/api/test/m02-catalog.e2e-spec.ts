import { anon, createTestApp, TestApp } from './support/app';

describe('M02 Danh mục nền, Bảng mã', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('GET khối, phòng, division: ai đăng nhập cũng xem được; chưa đăng nhập → 401', async () => {
    const c = await t.login('nv.mkt');
    expect((await c.get('/blocks')).body.items).toHaveLength(2);
    const d = await c.get('/departments');
    expect(d.body.items).toHaveLength(11);
    expect(d.body.items[0]).toMatchObject({ number: '00', code: 'VCPV', securityLevel: 'internal' });
    expect((await c.get('/divisions')).body.items.map((x: any) => x.prefix)).toContain('VCSO');
    for (const u of ['/blocks', '/departments', '/divisions', '/codes']) expect((await anon(t, 'get', u)).status).toBe(401);
  });

  it('POST/PATCH khối: R9, R3; nhân viên → 403; trùng mã → 409; id không có → 404', async () => {
    const nv = await t.login('nv.mkt');
    expect((await nv.post('/blocks', { code: 'TC', name: 'Khối Tài chính' })).status).toBe(403);
    const r3 = await t.login('hcns');
    const c = await r3.post('/blocks', { code: 'TC', name: 'Khối Tài chính', directorId: t.ids.users.ktt });
    expect(c.status).toBe(201);
    expect((await r3.post('/blocks', { code: 'TC', name: 'Trùng' })).status).toBe(409);
    const u = await r3.patch(`/blocks/${c.body.id}`, { code: 'TC', name: 'Khối Tài chính – Kế toán' });
    expect(u.status).toBe(200);
    expect(u.body.name).toBe('Khối Tài chính – Kế toán');
    expect(u.body.directorId).toBeUndefined();
    expect((await r3.patch('/blocks/6712f0c2a1b2c3d4e5f60718', { code: 'X', name: 'X' })).status).toBe(404);
    expect((await r3.patch(`/blocks/${c.body.id}`, { name: 'thiếu mã' })).status).toBe(400);
    expect((await nv.patch(`/blocks/${c.body.id}`, { code: 'TC', name: 'x' })).status).toBe(403);
  });

  it('POST/PATCH phòng – drive: kiểm trùng số, drive; khoá ngoài phải tồn tại', async () => {
    const r9 = await t.login('it');
    const body = { code: 'PL', number: '23', name: 'Pháp lý', driveId: 'drv-23', securityLevel: 'confidential', blockId: t.ids.blocks.VHNB };
    const c = await r9.post('/departments', body);
    expect(c.status).toBe(201);
    expect((await r9.post('/departments', { ...body, code: 'PL2' })).status).toBe(409);
    expect((await r9.post('/departments', { ...body, code: 'PL3', number: '24', driveId: 'drv-24', blockId: '6712f0c2a1b2c3d4e5f60718' })).status).toBe(400);
    expect((await r9.post('/departments', { ...body, securityLevel: 'top-secret' })).status).toBe(400);
    const u = await r9.patch(`/departments/${c.body.id}`, { ...body, headId: t.ids.users.tgd });
    expect(u.status).toBe(200);
    expect(u.body.headId).toBe(t.ids.users.tgd);
    const nv = await t.login('nv.kd');
    expect((await nv.post('/departments', { ...body, code: 'X' })).status).toBe(403);
    expect((await nv.patch(`/departments/${c.body.id}`, body)).status).toBe(403);
    expect((await r9.patch('/departments/6712f0c2a1b2c3d4e5f60718', body)).status).toBe(404);
    expect((await r9.patch(`/departments/${c.body.id}`, { ...body, number: '11' })).status).toBe(409);
  });

  it('POST/PATCH division', async () => {
    const r3 = await t.login('hcns');
    const c = await r3.post('/divisions', { prefix: 'VCX', name: 'Thử' });
    expect(c.status).toBe(201);
    expect((await r3.post('/divisions', { prefix: 'VCX', name: 'Trùng' })).status).toBe(409);
    expect((await r3.post('/divisions', { name: 'thiếu tiền tố' })).status).toBe(400);
    expect((await r3.patch(`/divisions/${c.body.id}`, { prefix: 'VCX', name: 'Đổi tên' })).body.name).toBe('Đổi tên');
    expect((await r3.patch('/divisions/6712f0c2a1b2c3d4e5f60718', { prefix: 'A', name: 'A' })).status).toBe(404);
    const nv = await t.login('nv.mkt');
    expect((await nv.post('/divisions', { prefix: 'VCY', name: 'x' })).status).toBe(403);
    expect((await nv.patch(`/divisions/${c.body.id}`, { prefix: 'VCX', name: 'x' })).status).toBe(403);
  });

  describe('Bảng mã', () => {
    it('lọc theo loại, phòng, trạng thái, tìm không dấu', async () => {
      const c = await t.login('nv.mkt');
      const all = await c.get('/codes?limit=200');
      expect(all.body.total).toBeGreaterThanOrEqual(19);
      const ch = await c.get('/codes?type=channel&status=approved');
      expect(ch.body.items.every((x: any) => x.type === 'channel')).toBe(true);
      const mkt = await c.get(`/codes?departmentId=${t.ids.depts.MKT.id}`);
      expect(mkt.body.items.map((x: any) => x.code)).toContain('SEO-PTDA');
      const q = await c.get('/codes?q=san%20thuong%20mai');
      expect(q.body.items.map((x: any) => x.code)).toEqual(['SAN']);
      expect((await c.get('/codes?type=sai')).status).toBe(400);
      expect((await c.get('/codes?sort=-khongco')).status).toBe(400);
    });

    it('R4 đề nghị mã → pending; trùng → 409; R1 duyệt; duyệt lại → 409', async () => {
      const tp = await t.login('tp.mkt');
      const nv = await t.login('nv.mkt');
      const r1 = await t.login('tgd');
      expect((await nv.post('/codes', { code: 'SEO-NEW', type: 'channel', meaning: 'x', scope: 'MKT', reason: 'y' })).status).toBe(403);
      const c = await tp.post('/codes', { code: 'seo-new', type: 'channel', meaning: 'SEO trang mới', scope: '11 MKT', reason: 'Mở kênh' });
      expect(c.status).toBe(201);
      expect(c.body).toMatchObject({ code: 'SEO-NEW', status: 'pending', allowedActions: [] });
      expect((await tp.post('/codes', { code: 'SEO-NEW', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' })).status).toBe(409);
      expect((await tp.post('/codes', { code: 'SEO PTDA', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' })).status).toBe(400);
      expect((await tp.post('/codes', { code: 'X', type: 'channel' })).status).toBe(400);
      const inbox = await r1.get('/codes?status=pending');
      expect(inbox.body.items[0].allowedActions).toEqual(['decide']);
      expect((await tp.post(`/codes/${c.body.id}/decide`, { result: 'approve' })).status).toBe(403);
      expect((await r1.post(`/codes/${c.body.id}/decide`, { result: 'maybe' })).status).toBe(400);
      const ok = await r1.post(`/codes/${c.body.id}/decide`, { result: 'approve', comment: 'Đồng ý' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('approved');
      expect(ok.body.decision.result).toBe('approve');
      expect((await r1.post(`/codes/${c.body.id}/decide`, { result: 'reject', comment: 'x' })).status).toBe(409);
      expect((await r1.post('/codes/6712f0c2a1b2c3d4e5f60718/decide', { result: 'approve' })).status).toBe(404);
      const n = await tp.get('/notifications?unread=true');
      expect(n.body.items.some((x: any) => x.type === 'approval_decided')).toBe(true);
    });

    it('từ chối phải có lý do', async () => {
      const tp = await t.login('tp.mkt');
      const r1 = await t.login('tgd');
      const c = await tp.post('/codes', { code: 'TT-NEW', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' });
      expect((await r1.post(`/codes/${c.body.id}/decide`, { result: 'reject' })).status).toBe(400);
      const r = await r1.post(`/codes/${c.body.id}/decide`, { result: 'reject', comment: 'Trùng nghĩa SEO-VCE' });
      expect(r.body.status).toBe('rejected');
      // mã bị từ chối được đề nghị lại
      expect((await tp.post('/codes', { code: 'TT-NEW', type: 'channel', meaning: 'x', scope: 'x', reason: 'lần 2' })).status).toBe(201);
    });

    it('xuất Google Sheets (R3) → 202, job.result.fileId', async () => {
      const nv = await t.login('nv.mkt');
      expect((await nv.post('/codes/export')).status).toBe(403);
      const r3 = await t.login('hcns');
      const res = await r3.post('/codes/export');
      expect(res.status).toBe(202);
      await t.drain();
      const job = await r3.get(`/jobs/${res.body.jobId}`);
      expect(job.body.status).toBe('done');
      const sheet = t.fake.fileState(job.body.result.fileId);
      expect(sheet.rows![0]).toEqual(['Mã', 'Loại mã', 'Ý nghĩa', 'Phạm vi', 'Phòng', 'Trạng thái']);
      expect(sheet.rows!.length).toBeGreaterThan(19);
      const list = await r3.get('/jobs?mine=true');
      expect(list.body.items.some((j: any) => j.id === res.body.jobId)).toBe(true);
      // người khác không xem được job của tôi
      expect((await nv.get(`/jobs/${res.body.jobId}`)).status).toBe(404);
    });
  });
});
