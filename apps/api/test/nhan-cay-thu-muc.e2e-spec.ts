import { Types } from 'mongoose';
import { createTestApp, TestApp } from './support/app';
import { DEMO_DOMAIN } from '../src/seed/demo-seed';
import { khoiTaoCongTy } from '../src/seed/khoi-tao-cong-ty';
import { docTenThuMuc, inKetQuaNhanCay, nhanCayThuMuc } from '../src/seed/nhan-cay-thu-muc';
import { docThamSoNhanCay } from '../src/nhan-cay-thu-muc';

describe('Nhận cây thư mục có sẵn trên Drive vào sổ VCdocs', () => {
  let t: TestApp;
  let cid: Types.ObjectId;
  const mkt = 'drv-11';
  beforeAll(async () => {
    t = await createTestApp();
    cid = new Types.ObjectId(t.ids.companyId);
  });
  afterAll(async () => t.close());

  /** Ảnh chụp mọi thư mục, tệp trên Drive giả: tên, cha, thùng rác */
  const anhDrive = () => JSON.stringify(Object.values(t.fake.world.files).map((f: any) => [f.fileId, f.name, f.parents, !!f.trashed]).sort());
  const thuMuc = async (driveId: string, parent: string | undefined, name: string) =>
    (await t.fake.drive.createFolder({ driveId, parentGoogleId: parent, name })).fileId;

  it('docTenThuMuc: đọc số, mã, tên ngắn, loại theo khung 00–99', () => {
    const goc = undefined;
    const ok = (ten: string, cha?: any) => {
      const r = docTenThuMuc(ten, cha);
      if (!r.ok) throw new Error(`${ten}: ${r.lyDo}`);
      return r.tt;
    };
    const lyDo = (ten: string, cha?: any) => {
      const r = docTenThuMuc(ten, cha);
      if (r.ok) throw new Error(`${ten}: lẽ ra sai mẫu`);
      return r.lyDo;
    };
    expect(ok('00 Tài liệu hệ thống', goc)).toMatchObject({ number: '00', code: undefined, shortName: 'Tài liệu hệ thống', kind: 'docs' });
    expect(ok('01 Kế hoạch – Báo cáo phòng')).toMatchObject({ number: '01', kind: 'plan_report' });
    expect(ok('04 Thông báo chung')).toMatchObject({ kind: 'operations' });
    expect(ok('10 SEO')).toMatchObject({ number: '10', code: 'SEO', shortName: 'SEO', fullName: '', kind: 'area' });
    expect(ok('30 SAN-Sàn TMĐT')).toMatchObject({ code: 'SAN', shortName: 'Sàn', fullName: 'TMĐT', kind: 'area' });
    expect(ok('50 DA-MAI VC Marketing AI')).toMatchObject({ code: 'DA-MAI', shortName: 'MAI', fullName: 'VC Marketing AI', kind: 'project' });
    expect(ok('98 Đã kết thúc')).toMatchObject({ kind: 'closed' });
    expect(ok('99 Lưu trữ')).toMatchObject({ kind: 'archive' });
    // Dấu tiếng Việt viết tổ hợp (NFD) vẫn đọc ra mã QĐ
    const docs = { kind: 'docs', kindGoc: 'docs' };
    expect(ok('01 QĐ Quy định'.normalize('NFD'), docs)).toMatchObject({ number: '01', code: 'QĐ', shortName: 'QĐ', fullName: 'Quy định', kind: 'docs' });
    expect(ok('99 Hết hiệu lực', docs)).toMatchObject({ kind: 'archive' });
    const area = { kind: 'area', kindGoc: 'area' };
    expect(ok('01 SEO-PTDA phutungducanh.com', area)).toMatchObject({ code: 'SEO-PTDA', shortName: 'PTDA', fullName: 'phutungducanh.com', kind: 'area' });
    expect(ok('01 Kế hoạch', area)).toMatchObject({ code: undefined, kind: 'area' });
    expect(ok('01 DA-X Dự án con', area)).toMatchObject({ kind: 'project' });
    expect(ok('00 Thông tin dự án', { kind: 'project', kindGoc: 'project' })).toMatchObject({ kind: 'operations' });
    expect(ok('2026', area)).toMatchObject({ kind: 'year', year: 2026, shortName: '2026', number: '' });
    expect(ok('2026-10', { kind: 'year', year: 2026, kindGoc: 'area' })).toMatchObject({ kind: 'month', year: 2026, month: 10, shortName: '2026-10' });
    expect(ok('LOP-K12 Lớp K12', { kind: 'year', year: 2026, kindGoc: 'operations' })).toMatchObject({ kind: 'entity', number: '' });

    expect(lyDo('Bản nháp', docs)).toMatch(/thiếu số/);
    expect(lyDo('Ghi chú')).toMatch(/gốc drive phải đánh số/);
    expect(lyDo('92 Linh tinh')).toMatch(/ngoài khung/);
    expect(lyDo('2026')).toMatch(/gốc drive/);
    expect(lyDo('Tháng 1', { kind: 'year', year: 2026, kindGoc: 'area' })).toBe('tên tháng phải là 2026-01');
    expect(lyDo('2025-10', { kind: 'year', year: 2026, kindGoc: 'area' })).toMatch(/năm 2026/);
    expect(lyDo('2026-13', { kind: 'year', year: 2026, kindGoc: 'area' })).toMatch(/không có/);
    expect(lyDo('Bài viết', { kind: 'month', year: 2026, kindGoc: 'area' })).toMatch(/tháng không có thư mục con/);
    expect(lyDo('04 TT-ĐK- Tik Tok', area)).toMatch(/dở dang/);
    expect(lyDo('01 Kế hoạch', { kind: 'year', year: 2026, kindGoc: 'area' })).toMatch(/chỉ có thư mục tháng/);
  });

  it('docThamSoNhanCay', () => {
    expect(docThamSoNhanCay(['--', '--drive', '11', '--thu', '--ra=x.md'])).toEqual({ drive: '11', thu: true, ra: 'x.md' });
    expect(() => docThamSoNhanCay(['--drive'])).toThrow('Thiếu giá trị cho --drive');
    expect(() => docThamSoNhanCay(['--file', 'a'])).toThrow('Tham số lạ');
  });

  it('Công ty chưa nạp sơ đồ phòng → báo chạy nap-so-do', async () => {
    await khoiTaoCongTy(t.db.m, { ten: 'Công ty chưa có phòng', mien: 'chua-co-phong.vn' });
    await expect(nhanCayThuMuc(t.db.m, t.fake, { mien: 'chua-co-phong.vn' })).rejects.toThrow('nap-so-do');
    await expect(nhanCayThuMuc(t.db.m, t.fake, { mien: 'khong-co.vn' })).rejects.toThrow('khoi-tao');
    await expect(nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN, drive: '77' })).rejects.toThrow('Không có phòng/drive "77"');
  });

  it('Sổ trống, Drive có sẵn cây mẫu: nhận lại đúng số, mã, loại, đường dẫn như cây do VCdocs tạo', async () => {
    const goc = await t.db.m.Folder.find({ companyId: cid }).lean<any[]>();
    const soGoc = await t.db.m.FolderNumber.countDocuments({ companyId: cid });
    const byId = new Map(goc.map((f) => [String(f._id), f]));
    const tom = (f: any, map: Map<string, any>) => ({
      googleId: f.googleId,
      cha: f.parentId ? map.get(String(f.parentId))?.googleId : undefined,
      driveId: f.driveId,
      name: f.name,
      number: f.number,
      code: f.code,
      kind: f.kind,
      path: f.path,
      securityLevel: f.securityLevel,
      status: f.status,
    });
    const truoc = goc.map((f) => tom(f, byId)).sort((a, b) => a.googleId.localeCompare(b.googleId));
    // Giả lập CSDL mới: sổ thư mục trống nhưng Drive đã có cây
    await t.db.m.Folder.deleteMany({ companyId: cid });
    await t.db.m.FolderNumber.deleteMany({ companyId: cid });
    const drive = anhDrive();

    const kq = await nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN });
    expect(anhDrive()).toBe(drive);
    expect(kq.drives).toHaveLength(11);
    expect(kq.drives.flatMap((d) => d.saiMau)).toEqual([]);
    expect(kq.drives.reduce((s, d) => s + d.tao, 0)).toBe(goc.length);
    const sau = await t.db.m.Folder.find({ companyId: cid }).lean<any[]>();
    const byId2 = new Map(sau.map((f) => [String(f._id), f]));
    expect(sau.map((f) => tom(f, byId2)).sort((a, b) => a.googleId.localeCompare(b.googleId))).toEqual(truoc);
    expect(await t.db.m.FolderNumber.countDocuments({ companyId: cid })).toBe(soGoc);
    expect(await t.db.m.AuditLog.countDocuments({ companyId: cid, action: 'folder.import' })).toBe(goc.length);
    // Mã mảng/dự án đã duyệt trong Bảng mã mẫu nên không báo thiếu
    expect(kq.canhBao.join('\n')).not.toMatch(/SEO-PTDA/);

    // Trang thư mục và ban hành tài liệu dùng được cây vừa nhận
    const tp = await t.login('tp.mkt');
    const roots = await tp.get(`/folders?driveId=${mkt}`);
    expect(roots.status).toBe(200);
    expect(roots.body.items.map((f: any) => f.name)).toContain('10 SEO');
    const docs = sau.find((f) => f.driveId === mkt && !f.parentId && f.kind === 'docs');
    expect(sau.find((f) => String(f.parentId) === String(docs._id) && f.code === 'QT')).toBeTruthy();
  });

  it('Thư mục mới, sai mẫu trên Drive: --thu không ghi gì; chạy thật nhận đúng mẫu, báo sai mẫu, chạy lại không trùng', async () => {
    const seo = (await t.db.m.Folder.findOne({ companyId: cid, driveId: mkt, name: '10 SEO' }).lean<any>())!;
    const social = (await t.db.m.Folder.findOne({ companyId: cid, driveId: mkt, number: '20', parentId: { $exists: false } }).lean<any>())!;
    const da = await thuMuc(mkt, undefined, '60 DA-THU Dự án thử');
    const nam = await thuMuc(mkt, da, '2026');
    await thuMuc(mkt, nam, '2026-10');
    const thang11 = await thuMuc(mkt, nam, 'Tháng 11');
    await thuMuc(mkt, thang11, 'Bài viết');
    await thuMuc(mkt, da, '00 Thông tin dự án');
    const vh = await thuMuc(mkt, undefined, '02 VH Hồ sơ vận hành');
    await thuMuc(mkt, vh, 'LOP-K12 Lớp K12');
    await thuMuc(mkt, undefined, 'Ghi chú');
    await thuMuc(mkt, undefined, '92 Linh tinh');
    const doDang = await thuMuc(mkt, social.googleId, '05 TT-ĐK- Tik Tok');
    await thuMuc(mkt, doDang, '2026');
    await thuMuc(mkt, seo.googleId, '02 SEO-MOI Kênh mới');
    // Thư mục cha vào thùng rác: con vẫn trả trashed=false khi liệt kê (Drive thật cũng vậy)
    const rac = await thuMuc(mkt, undefined, '70 DA-RAC Dự án bỏ');
    await thuMuc(mkt, rac, '00 Thông tin dự án');
    t.fake.world.files[rac].trashed = true;

    const dem = async () => ({
      folder: await t.db.m.Folder.countDocuments({ companyId: cid }),
      so: await t.db.m.FolderNumber.countDocuments({ companyId: cid }),
      audit: await t.db.m.AuditLog.countDocuments({ companyId: cid }),
    });
    const truoc = await dem();
    const drive = anhDrive();

    const thu = await nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN, drive: '11', thu: true });
    expect(await dem()).toEqual(truoc);
    expect(thu.drives).toHaveLength(1);
    const m = thu.drives[0];
    expect(m.tao).toBe(7); // 60 DA-THU, 2026, 2026-10, 00 Thông tin dự án, 02 VH, LOP-K12, 02 SEO-MOI
    const sai = Object.fromEntries(m.saiMau.map((s) => [s.duongDan.split(' / ').slice(1).join(' / '), s]));
    expect(Object.keys(sai).sort()).toEqual(
      ['60 DA-THU Dự án thử / 2026 / Tháng 11', 'Ghi chú', '92 Linh tinh', '20 SOCIAL / 05 TT-ĐK- Tik Tok'].sort(),
    );
    expect(sai['60 DA-THU Dự án thử / 2026 / Tháng 11']).toMatchObject({ lyDo: 'tên tháng phải là 2026-11', boQua: 1 });
    expect(sai['20 SOCIAL / 05 TT-ĐK- Tik Tok'].boQua).toBe(1);
    const cb = m.canhBao.join('\n');
    expect(cb).toMatch(/1 thư mục có thư mục cha đã vào thùng rác/);
    expect(cb).toMatch(/60 DA-THU Dự án thử": chưa bật chia năm\/tháng/);
    expect(thu.canhBao.join('\n')).toMatch(/mã chưa có trong Bảng mã.*DA-THU.*SEO-MOI.*VH/);
    const text = inKetQuaNhanCay(thu);
    expect(text).toMatch(/^CHẠY THỬ/);
    expect(text).toMatch(/Tháng 11 — tên tháng phải là 2026-11 \(bỏ qua 1 thư mục con\)/);

    const that = await nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN, drive: 'MKT' });
    expect(anhDrive()).toBe(drive);
    expect(that.drives[0].tao).toBe(7);
    const sau = await dem();
    expect(sau.folder).toBe(truoc.folder + 7);
    expect(sau.audit).toBe(truoc.audit + 7);
    const f = async (name: string) => (await t.db.m.Folder.findOne({ companyId: cid, driveId: mkt, name }).lean<any>())!;
    const daRow = await f('60 DA-THU Dự án thử');
    expect(daRow).toMatchObject({ number: '60', code: 'DA-THU', shortName: 'THU', kind: 'project', path: '11 MKT / 60 DA-THU Dự án thử', hasPeriods: false, status: 'active', securityLevel: 'department' });
    expect(await f('2026-10')).toMatchObject({ kind: 'month', year: 2026, month: 10 });
    expect(await f('LOP-K12 Lớp K12')).toMatchObject({ kind: 'entity', number: '' });
    expect(await f('02 VH Hồ sơ vận hành')).toMatchObject({ kind: 'operations', hasPeriods: false });
    expect(await f('02 SEO-MOI Kênh mới')).toMatchObject({ kind: 'area', path: '11 MKT / 10 SEO / 02 SEO-MOI Kênh mới' });
    expect(await t.db.m.Folder.findOne({ companyId: cid, name: { $in: ['Tháng 11', 'Ghi chú', '92 Linh tinh', 'Bài viết'] } })).toBeNull();
    expect(await t.db.m.FolderNumber.findOne({ companyId: cid, parentKey: `root:${mkt}`, number: '60' })).toBeTruthy();

    // Số đã có trên Drive không cấp lại khi tạo thư mục bằng VCdocs
    const tp = await t.login('tp.mkt');
    const next = await tp.get(`/folders/next-number?driveId=${mkt}&kind=operations`);
    expect(next.body.number).toBe('03');
    const list = await tp.get(`/folders?parentId=${daRow._id}`);
    expect(list.body.items.map((x: any) => x.name).sort()).toEqual(['00 Thông tin dự án', '2026']);
    const one = await tp.get(`/folders/${daRow._id}`);
    expect(one.body.allowedActions).toContain('close-project');

    // Chạy lại: không tạo trùng, không ghi nhật ký thêm
    const truocLai = await dem();
    const lai = await nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN });
    expect(lai.drives.reduce((s, d) => s + d.tao, 0)).toBe(0);
    expect(await dem()).toEqual(truocLai);

    // Sửa tên tháng trên Drive rồi chạy lại: nhận tháng, bật chia năm/tháng cho dự án
    await t.fake.drive.updateFile(thang11, { name: '2026-11' });
    const sua = await nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN, drive: '11' });
    expect(sua.drives[0].tao).toBe(1);
    expect(sua.drives[0].saiMau.map((s) => s.duongDan.split(' / ').slice(1).join(' / '))).toContain('60 DA-THU Dự án thử / 2026 / 2026-11 / Bài viết');
    expect(sua.drives[0].canhBao.join('\n')).toMatch(/60 DA-THU Dự án thử": đã bật chia năm\/tháng/);
    expect((await f('60 DA-THU Dự án thử')).hasPeriods).toBe(true);
    expect(await f('2026-11')).toMatchObject({ kind: 'month', month: 11 });
  });

  it('Thư mục trong sổ đã đổi tên hoặc vào thùng rác trên Drive → chỉ cảnh báo, không sửa sổ', async () => {
    const row = (await t.db.m.Folder.findOne({ companyId: cid, driveId: mkt, name: '02 VH Hồ sơ vận hành' }).lean<any>())!;
    await t.fake.drive.updateFile(row.googleId, { name: '02 VH Vận hành' });
    const rac = (await t.db.m.Folder.findOne({ companyId: cid, driveId: mkt, name: '00 Thông tin dự án', path: /60 DA-THU/ }).lean<any>())!;
    t.fake.world.files[rac.googleId].trashed = true;
    const kq = await nhanCayThuMuc(t.db.m, t.fake, { mien: DEMO_DOMAIN, drive: '11' });
    const cb = kq.drives[0].canhBao.join('\n');
    expect(cb).toMatch(/"11 MKT \/ 02 VH Hồ sơ vận hành" đã đổi tên trên Drive thành "02 VH Vận hành"/);
    expect(cb).toMatch(/"11 MKT \/ 60 DA-THU Dự án thử \/ 00 Thông tin dự án" có trong sổ nhưng không còn trên Drive/);
    expect((await t.db.m.Folder.findOne({ companyId: cid, _id: row._id }).lean<any>()).name).toBe('02 VH Hồ sơ vận hành');
    expect(await t.db.m.Folder.findOne({ companyId: cid, _id: rac._id }).lean<any>()).toMatchObject({ status: 'active' });
  });
});
