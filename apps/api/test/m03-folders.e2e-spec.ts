import { createTestApp, TestApp } from './support/app';

describe('M03 Cây thư mục', () => {
  let t: TestApp;
  let mkt: string;
  beforeAll(async () => {
    t = await createTestApp();
    mkt = t.ids.depts.MKT.driveId;
  });
  afterAll(async () => t.close());

  it('GET /folders theo quyền drive: drive Mật không xem được không hiện', async () => {
    const nv = await t.login('nv.mkt');
    const roots = await nv.get(`/folders?driveId=${mkt}`);
    expect(roots.status).toBe(200);
    expect(roots.body.items.map((f: any) => f.name)).toEqual(expect.arrayContaining(['00 Tài liệu', '10 SEO', '50 DA-MAI']));
    const seo = roots.body.items.find((f: any) => f.name === '10 SEO');
    expect(seo).toMatchObject({ number: '10', code: 'SEO', kind: 'area', path: '11 MKT / 10 SEO', hasChildren: true });
    const hcns = await nv.get(`/folders?driveId=${t.ids.depts.HCNS.driveId}`);
    expect(hcns.body.items).toEqual([]);
    const deep = await nv.get(`/folders?driveId=${mkt}&depth=2&kind=docs`);
    expect(deep.body.items.map((f: any) => f.name)).toEqual(expect.arrayContaining(['00 Tài liệu', '02 QT', '04 BM']));
    const child = await nv.get(`/folders?parentId=${seo.id}`);
    expect(child.body.items[0].name).toBe('01 SEO-PTDA phutungducanh.com');
    expect((await nv.get('/folders?depth=11')).status).toBe(400);
  });

  it('GET /folders/{id}, /children; drive Mật → 404', async () => {
    const nv = await t.login('nv.mkt');
    const id = t.ids.folders['MKT:10'];
    const one = await nv.get(`/folders/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.googleId).toBeTruthy();
    const ch = await nv.get(`/folders/${id}/children`);
    expect(ch.body.items).toHaveLength(1);
    expect((await nv.get(`/folders/${t.ids.folders['HCNS:00']}`)).status).toBe(404);
    expect((await nv.get(`/folders/${t.ids.folders['HCNS:00']}/children`)).status).toBe(404);
    expect((await nv.get('/folders/6712f0c2a1b2c3d4e5f60718')).status).toBe(404);
  });

  it('next-number: mảng bước 10 (BR-11); nhân viên → 403', async () => {
    const tp = await t.login('tp.mkt');
    const nv = await t.login('nv.mkt');
    const r = await tp.get(`/folders/next-number?parentId=${t.ids.folders['MKT:10']}&kind=area`);
    expect(r.status).toBe(200);
    expect(r.body.number).toBe('02');
    expect((await nv.get(`/folders/next-number?parentId=${t.ids.folders['MKT:10']}&kind=area`)).status).toBe(403);
    expect((await tp.get(`/folders/next-number?parentId=${t.ids.folders['HCNS:00']}&kind=area`)).status).toBe(404);
    expect((await tp.get(`/folders/next-number?kind=area`)).status).toBe(400);
  });

  it('POST /folders tạo mảng ở gốc drive: số kế tiếp 50→ dự án, mã phải đã duyệt (BR-12), tên máy chủ ghép', async () => {
    const tp = await t.login('tp.mkt');
    const res = await tp.post('/folders', { driveId: mkt, kind: 'area', code: 'SEO-VCE', shortName: 'VCE', fullName: 'Website VCE' });
    expect(res.status).toBe(202);
    await t.drain();
    const job = await tp.get(`/jobs/${res.body.jobId}`);
    expect(job.body.status).toBe('done');
    const f = await tp.get(`/folders/${job.body.result.objectId}`);
    // 10, 20, 30, 40 đã dùng → số trống kế tiếp trong vùng 10–49
    expect(f.body).toMatchObject({ number: '11', kind: 'area', name: '11 SEO-VCE Website VCE', path: '11 MKT / 11 SEO-VCE Website VCE' });
    expect(t.fake.fileState(f.body.googleId).name).toBe(f.body.name);
    const proj = await tp.post('/folders', { driveId: mkt, kind: 'project', code: 'DA-VDG', shortName: 'VDG2' });
    await t.drain();
    const pj = await tp.get(`/jobs/${proj.body.jobId}`);
    expect((await tp.get(`/folders/${pj.body.result.objectId}`)).body.number).toBe('52');
    const pending = await tp.post('/folders', { driveId: mkt, kind: 'area', code: 'CHUA-DUYET', shortName: 'X' });
    expect(pending.status).toBe(422);
    expect(pending.body.error.rule).toBe('BR-12');
    const noCode = await tp.post('/folders', { driveId: mkt, kind: 'project', shortName: 'X' });
    expect(noCode.status).toBe(422);
    const month = await tp.post('/folders', { driveId: mkt, parentId: t.ids.folders['MKT:10'], kind: 'month', shortName: '2026-10' });
    expect(month.status).toBe(422);
  });

  it('POST /folders: leader (R5) tạo trong mảng của mình; ngoài mảng → 403; nhân viên → 403', async () => {
    const leader = await t.login('leader.mkt');
    const ok = await leader.post('/folders', { driveId: mkt, parentId: t.ids.folders['MKT:10'], kind: 'area', code: 'SEO-ASP', shortName: 'ASP' });
    expect(ok.status).toBe(202);
    await t.drain();
    const job = await leader.get(`/jobs/${ok.body.jobId}`);
    expect(job.body.summary.name).toBe('02 SEO-ASP');
    expect(job.body.result).toEqual({ objectType: 'folder', objectId: expect.any(String) });
    expect((await leader.post('/folders', { driveId: mkt, kind: 'area', code: 'SEO-FREY', shortName: 'FREY' })).status).toBe(403);
    const nv = await t.login('nv.mkt');
    expect((await nv.post('/folders', { driveId: mkt, parentId: t.ids.folders['MKT:10'], kind: 'area', code: 'SEO-FREY', shortName: 'F' })).status).toBe(403);
    const other = await t.login('tp.kd');
    expect((await other.post('/folders', { driveId: mkt, kind: 'area', code: 'SEO-FREY', shortName: 'F' })).status).toBe(403);
    expect((await other.post('/folders', { driveId: mkt, kind: 'nope', shortName: 'F' })).status).toBe(400);
  });

  it('đổi tên giữ số và mã; Google lỗi → 502', async () => {
    const tp = await t.login('tp.mkt');
    const id = t.ids.folders['MKT:40'];
    const r = await tp.post(`/folders/${id}/rename`, { shortName: 'Media', fullName: 'Ảnh – Video' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('40 MEDIA Ảnh – Video');
    expect(r.body.path).toBe('11 MKT / 40 MEDIA Ảnh – Video');
    t.fake.failNext = 'drive.updateFile';
    const bad = await tp.post(`/folders/${id}/rename`, { shortName: 'Media2' });
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe('DRIVE_ERROR');
    expect((await tp.get(`/folders/${id}`)).body.name).toBe('40 MEDIA Ảnh – Video');
    const nv = await t.login('nv.mkt');
    expect((await nv.post(`/folders/${id}/rename`, { shortName: 'x' })).status).toBe(403);
    expect((await tp.post(`/folders/6712f0c2a1b2c3d4e5f60718/rename`, { shortName: 'x' })).status).toBe(404);
  });

  it('kết thúc dự án → chuyển vào 98, số không cấp lại; làm lại → 409', async () => {
    const tp = await t.login('tp.mkt');
    const id = t.ids.folders['MKT:51'];
    const r = await tp.post(`/folders/${id}/close-project`);
    expect(r.status).toBe(202);
    await t.drain();
    const f = await tp.get(`/folders/${id}`);
    expect(f.body.status).toBe('closed');
    expect(f.body.path).toBe('11 MKT / 98 Đã kết thúc / 51 DA-VDG');
    expect(t.fake.fileState(f.body.googleId).parents).toEqual([(await tp.get(`/folders/${f.body.parentId}`)).body.googleId]);
    expect((await tp.post(`/folders/${id}/close-project`)).status).toBe(409);
    expect((await tp.post(`/folders/${t.ids.folders['MKT:10']}/close-project`)).status).toBe(409);
    const nxt = await tp.post('/folders', { driveId: mkt, kind: 'project', code: 'DA-MAI', shortName: 'MAI2' });
    await t.drain();
    const job = await tp.get(`/jobs/${nxt.body.jobId}`);
    expect(job.body.summary.name.startsWith('51')).toBe(false);
    const nv = await t.login('nv.mkt');
    expect((await nv.post(`/folders/${t.ids.folders['MKT:50']}/close-project`)).status).toBe(403);
    expect((await tp.post('/folders/6712f0c2a1b2c3d4e5f60718/close-project')).status).toBe(404);
  });

  it('ensure-periods (R3): tạo năm, tháng còn thiếu, không đánh số', async () => {
    const r3 = await t.login('hcns');
    const nv = await t.login('nv.mkt');
    expect((await nv.post('/folders/ensure-periods', { month: '2026-11' })).status).toBe(403);
    expect((await r3.post('/folders/ensure-periods', { month: '2026-13' })).status).toBe(400);
    const r = await r3.post('/folders/ensure-periods', { driveId: mkt, month: '2026-11' });
    expect(r.status).toBe(202);
    await t.drain();
    const job = await r3.get(`/jobs/${r.body.jobId}`);
    expect(job.body.status).toBe('done');
    expect(job.body.result).toBeUndefined();
    expect(job.body.summary.created).toBeGreaterThan(0);
    const tp = await t.login('tp.mkt');
    const tree = await tp.get(`/folders?parentId=${t.ids.folders['MKT:10']}&depth=2`);
    const names = tree.body.items.map((f: any) => f.name);
    expect(names).toEqual(expect.arrayContaining(['2026', '2026-11']));
    const mon = tree.body.items.find((f: any) => f.name === '2026-11');
    expect(mon).toMatchObject({ kind: 'month', number: '', year: 2026, month: 11 });
    // chạy lại không tạo trùng
    const again = await r3.post('/folders/ensure-periods', { driveId: mkt, month: '2026-11' });
    await t.drain();
    expect((await r3.get(`/jobs/${again.body.jobId}`)).body.summary.created).toBe(0);
  });

  it('resync: đọc lại tên từ Drive khi có người đổi thẳng', async () => {
    const tp = await t.login('tp.mkt');
    const id = t.ids.folders['MKT:20'];
    const f = await tp.get(`/folders/${id}`);
    t.fake.world.files[f.body.googleId].name = '20 SOCIAL bị đổi tay';
    const r = await tp.post(`/folders/${id}/resync`);
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('20 SOCIAL bị đổi tay');
    const nv = await t.login('nv.mkt');
    expect((await nv.post(`/folders/${id}/resync`)).status).toBe(403);
    expect((await tp.post(`/folders/${t.ids.folders['HCNS:00']}/resync`)).status).toBe(404);
    t.fake.failNext = 'drive.getFile';
    expect((await tp.post(`/folders/${id}/resync`)).status).toBe(502);
  });
});
