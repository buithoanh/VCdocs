import * as fs from 'fs';
import * as path from 'path';
import { createTestApp, TestApp } from './support/app';
import { khoiTaoCongTy } from '../src/seed/khoi-tao-cong-ty';
import { docSoDo, inKetQuaNap, napSoDo, soDoTuCsdl } from '../src/seed/so-do-to-chuc';
import { baoCaoNhomC1, inBaoCaoC1 } from '../src/seed/nhom-c1';
import { docThamSoSoDo } from '../src/nap-so-do';

const MIEN = 'thu-sodo.vn';
const e = (x: string) => `${x}@${MIEN}`;

const FILE = `
khoi:
  - { ma: VHNB, ten: Khối Vận hành nội bộ, giam_doc: ${e('gdk1')} }
  - { ma: KD, ten: Khối Kinh doanh, giam_doc: "" }
phong:
  - { so: "00", ma: VCPV, ten: VCPV Chung, drive: "00 Chung thử", bao_mat: internal, khoi: VHNB, truong_phong: "" }
  - { so: "11", ma: mkt, ten: Marketing, drive: "sd-11", bao_mat: department, khoi: KD, truong_phong: ${e('tp.mkt')} }
  - { so: "21B", ma: LT, ten: Lương – Thưởng, drive: "21b Lương thử [MẬT]", bao_mat: confidential, khoi: VHNB, truong_phong: ${e('Gdk1')} }
division:
  - { tien_to: VCP, ten: VCpart }
vai_tro:
  R1: [${e('tgd')}]
  R9: [${e('it')}]
`;

describe('Sơ đồ tổ chức: nạp từ file, báo cáo nhóm C1', () => {
  let t: TestApp;
  let companyId: string;
  beforeAll(async () => {
    t = await createTestApp({ allowedDomain: MIEN });
    companyId = (await khoiTaoCongTy(t.db.m, { ten: 'Công ty thử sơ đồ', mien: MIEN })).id;
    for (const [k, name] of [
      ['gdk1', 'GĐ khối thử'],
      ['tp.mkt', 'Trưởng phòng MKT thử'],
      ['tgd', 'TGĐ thử'],
      ['it', 'IT thử'],
      ['nv', 'Nhân viên thử'],
    ])
      t.fake.addUser({ email: e(k), name, suspended: false });
    t.fake.addDrive('sd-00', '00 Chung thử');
    t.fake.addDrive('sd-11', '11 MKT thử');
    t.fake.addDrive('sd-21b', '21b Lương thử [MẬT]');
  });
  afterAll(async () => t.close());

  const count = async () => {
    const cid = { companyId };
    return {
      block: await t.db.m.Block.countDocuments(cid),
      dept: await t.db.m.Department.countDocuments(cid),
      div: await t.db.m.Division.countDocuments(cid),
      user: await t.db.m.User.countDocuments(cid),
      audit: await t.db.m.AuditLog.countDocuments(cid),
    };
  };

  it('docSoDo: đọc được file mẫu trong repo', () => {
    const sd = docSoDo(fs.readFileSync(path.join(__dirname, '../so-do-to-chuc.mau.yaml'), 'utf8'), 'vcprosperous.com');
    expect(sd.khoi.map((k) => k.ma)).toEqual(['VHNB', 'KD']);
    expect(sd.phong).toHaveLength(11);
    expect(sd.phong.find((p) => p.so === '21b')).toMatchObject({ ma: 'LT', baoMat: 'confidential', khoi: 'VHNB', truongPhong: undefined });
    expect(sd.division).toHaveLength(5);
  });

  it('docSoDo: chuẩn hoá mã/số/email, gom đủ lỗi', () => {
    const sd = docSoDo(FILE, MIEN);
    expect(sd.phong.map((p) => `${p.so} ${p.ma}`)).toEqual(['00 VCPV', '11 MKT', '21b LT']);
    expect(sd.phong[2].truongPhong).toBe(e('gdk1'));
    let msg = '';
    try {
      docSoDo(
        `
khoi: [{ ma: KD, ten: "" }]
phong:
  - { so: "1", ma: "M K", ten: A, drive: d, bao_mat: secret, khoi: XX, truong_phong: a@gmail.com }
  - { so: "1", ma: B, ten: B, drive: d, bao_mat: internal }
vai_tro: { R5: [], R1: [khong-email] }
la: 1
`,
        MIEN,
      );
    } catch (err: any) {
      msg = err.message;
    }
    for (const s of [
      'Mục lạ: la',
      'khoi[1]: thiếu tên',
      'số drive "1"',
      'mã phòng "M K"',
      'bao_mat "secret"',
      'khối XX không có',
      'không thuộc tên miền',
      'R5 không ghi theo người',
      '"khong-email" không phải email',
      'Số drive "1" bị lặp',
      'Drive "d" bị lặp',
    ])
      expect(msg).toContain(s);
  });

  it('napSoDo --thu: không ghi gì; người hoặc drive không có trên Google → lỗi, không ghi gì', async () => {
    const before = await count();
    const kq = await napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE, MIEN), { thu: true });
    expect(kq.thu).toBe(true);
    expect(kq.thayDoi.filter((x) => x.viec === 'tao')).toHaveLength(2 + 3 + 1 + 4);
    expect(inKetQuaNap(kq)).toMatch(/CHẠY THỬ/);
    expect(await count()).toEqual(before);

    await expect(napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE.replace(e('it'), e('khong-co')), MIEN))).rejects.toThrow(/Không thấy trong Google Workspace: khong-co@/);
    await expect(napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE.replace('sd-11', 'drive-la'), MIEN))).rejects.toThrow(/không thấy shared drive "drive-la"/);
    await expect(napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE, MIEN), { mien: 'chua-co.vn' })).rejects.toThrow(/khoi-tao/);
    expect(await count()).toEqual(before);
  });

  it('napSoDo: tạo khối, phòng, division, người, vai trò; chạy lại không tạo trùng; sửa theo file', async () => {
    const before = await count();
    const kq = await napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE, MIEN));
    expect(kq.thayDoi.filter((x) => x.viec === 'tao').map((x) => `${x.loai}:${x.khoa}`).sort()).toEqual(
      ['khoi:VHNB', 'khoi:KD', 'phong:00 VCPV', 'phong:11 MKT', 'phong:21b LT', 'division:VCP', ...['gdk1', 'tp.mkt', 'tgd', 'it'].map((k) => `nguoi:${e(k)}`)].sort(),
    );
    expect(kq.canhBao).toEqual(expect.arrayContaining(['Khối KD chưa có giam_doc', 'Phòng 00 VCPV chưa có truong_phong', 'Chưa ai giữ R3']));
    expect(kq.canhBao.some((c) => c.includes('ACCOUNTING_DEPT_CODES') && c.includes('TCKT'))).toBe(true);
    const after = await count();
    expect(after).toMatchObject({ block: before.block + 2, dept: before.dept + 3, div: before.div + 1, user: before.user + 4 });
    expect(after.audit).toBeGreaterThan(before.audit);

    const cid = { companyId };
    const u = async (k: string) => t.db.m.User.findOne({ ...cid, email: e(k) }).lean<any>();
    const mkt = await t.db.m.Department.findOne({ ...cid, code: 'MKT' }).lean<any>();
    const lt = await t.db.m.Department.findOne({ ...cid, code: 'LT' }).lean<any>();
    const vhnb = await t.db.m.Block.findOne({ ...cid, code: 'VHNB' }).lean<any>();
    expect(mkt).toMatchObject({ number: '11', driveId: 'sd-11', securityLevel: 'department' });
    expect(mkt.groupEmails).toEqual(['quan-ly', 'quan-ly-noi-dung', 'dong-gop', 'nhan-xet', 'xem'].map((s) => e(`11-mkt-${s}`)));
    expect(lt.driveId).toBe('sd-21b');
    expect(String(mkt.headId)).toBe(String((await u('tp.mkt'))._id));
    expect(String(vhnb.directorId)).toBe(String((await u('gdk1'))._id));
    expect(await u('tp.mkt')).toMatchObject({ name: 'Trưởng phòng MKT thử', manualRoles: ['R4'], systemRoles: ['R4'] });
    expect(String((await u('tp.mkt')).departmentId)).toBe(String(mkt._id));
    expect((await u('gdk1')).systemRoles).toEqual(['R2', 'R4']);
    expect((await u('tgd')).systemRoles).toEqual(['R1']);
    expect((await u('it')).systemRoles).toEqual(['R9']);
    expect(await t.db.m.User.findOne({ ...cid, email: e('nv') })).toBeNull();
    expect((await t.db.m.AuditLog.findOne({ ...cid, action: 'org.import', objectType: 'department', objectId: String(mkt._id) }).lean<any>())?.after?.code).toBe('MKT');

    // Chạy lại: giữ nguyên hết, không thêm bản ghi, không ghi nhật ký
    const lai = await napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE, MIEN));
    expect(lai.thayDoi.every((x) => x.viec === 'giu')).toBe(true);
    expect(await count()).toEqual(after);

    // Sửa theo file: đổi tên phòng, đổi trưởng phòng MKT, đổi mã phòng 11 (khớp theo drive)
    const sua = FILE.replace('ten: Marketing', 'ten: Tiếp thị').replace(`truong_phong: ${e('tp.mkt')}`, `truong_phong: ${e('nv')}`).replace('ma: mkt', 'ma: MAR');
    const kq3 = await napSoDo(t.db.m, t.fake, t.cfg, docSoDo(sua, MIEN));
    expect(kq3.thayDoi.find((x) => x.loai === 'phong' && x.khoa === '11 MAR')).toMatchObject({ viec: 'sua', chiTiet: 'code, name, headId, groupEmails' });
    expect(kq3.canhBao).toContain(`${e('tp.mkt')} đang giữ R4 (gán tay) mà file không ghi — giữ nguyên; gỡ ở màn hình Người dùng nếu cần`);
    const mar = await t.db.m.Department.findOne({ ...cid, _id: mkt._id }).lean<any>();
    expect(mar).toMatchObject({ code: 'MAR', name: 'Tiếp thị' });
    expect(mar.groupEmails[0]).toBe(e('11-mar-quan-ly'));
    expect(await t.db.m.Department.countDocuments(cid)).toBe(after.dept);
    expect((await u('tp.mkt')).systemRoles).toEqual(['R4']);
    expect((await u('nv')).systemRoles).toEqual(['R4']);

    // Trả về như cũ cho các test sau
    await napSoDo(t.db.m, t.fake, t.cfg, docSoDo(FILE, MIEN));
  });

  it('đăng nhập sau khi nạp: vai trò gán từ sơ đồ còn nguyên, /catalog thấy phòng', async () => {
    const c = await t.loginEmail(e('tp.mkt'));
    const me = await c.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.systemRoles).toEqual(['R4']);
    const mkt = await t.db.m.Department.findOne({ companyId, code: 'MKT' }).lean<any>();
    expect(me.body.departmentId).toBe(String(mkt._id));
    const ds = await c.get('/departments');
    expect(ds.status).toBe(200);
    expect(ds.body.items.map((d: any) => d.code).sort()).toEqual(['LT', 'MKT', 'VCPV']);
  });

  it('báo cáo nhóm C1: thiếu, gắn drive sai, thiếu người, thừa; đọc sơ đồ từ CSDL', async () => {
    t.fake.addGroup(e('11-mkt-quan-ly'), '11 MKT quản lý', [e('nv')]);
    t.fake.addDrivePermission('sd-11', { type: 'group', emailAddress: e('11-mkt-quan-ly'), role: 'organizer' });
    t.fake.addGroup(e('11-mkt-dong-gop'), '11 MKT đóng góp', []);
    t.fake.addDrivePermission('sd-11', { type: 'group', emailAddress: e('11-mkt-dong-gop'), role: 'fileOrganizer' });
    t.fake.addGroup(e('11-mkt-xem'), '11 MKT xem', []);
    t.fake.addGroup(e('vcdocs-r1'), 'R1', [e('tgd')]);
    t.fake.addGroup(e('12-it-quan-ly'), 'thừa', []);
    t.fake.addGroup(e('ke-toan'), 'khác', []);

    const sd = await soDoTuCsdl(t.db.m, MIEN);
    expect(sd.phong.map((p) => `${p.so} ${p.ma} ${p.drive}`)).toEqual(['00 VCPV sd-00', '11 MKT sd-11', '21b LT sd-21b']);
    expect(sd.vaiTro.R1).toEqual([e('tgd')]);
    const bc = await baoCaoNhomC1(t.fake, sd, MIEN);
    expect(bc.canCo).toHaveLength(3 * 5 + 9);
    const n = (x: string) => bc.canCo.find((g) => g.email === e(x))!;
    expect(n('11-mkt-quan-ly')).toMatchObject({ daCo: true, vaiTro: 'R4', vaiTroDriveThat: 'organizer', thieuThanhVien: [e('tp.mkt')] });
    expect(n('11-mkt-dong-gop')).toMatchObject({ daCo: true, vaiTro: 'R6', vaiTroDriveThat: 'fileOrganizer' });
    expect(n('11-mkt-xem')).toMatchObject({ daCo: true, vaiTro: 'R7', vaiTroDriveThat: undefined });
    expect(n('00-vcpv-xem')).toMatchObject({ daCo: false, vaiTro: '—' });
    expect(n('vcdocs-r1')).toMatchObject({ daCo: true, thieuThanhVien: [] });
    expect(n('vcdocs-r2')).toMatchObject({ daCo: false, nenCo: [e('gdk1')] });
    expect(bc.thua).toEqual([e('12-it-quan-ly')]);
    expect(bc.khac).toEqual([e('ke-toan')]);

    const text = inBaoCaoC1(bc);
    expect(text).toContain('Cần 24 nhóm · đã có 4 · thiếu 20 · gắn drive sai/chưa gắn 2 · thiếu người 1 · thừa 1');
    expect(text).toContain('**drive đang là Quản lý nội dung** (cao hơn mẫu)');
    expect(text).toContain('**chưa gắn vào drive**');
    expect(text).toContain(`**thiếu ${e('tp.mkt')}**`);
  });

  it('docThamSoSoDo: --file, --thu, --ra, báo tham số lạ', () => {
    expect(docThamSoSoDo(['--', '--file', 'a.yaml', '--thu'])).toEqual({ file: 'a.yaml', thu: true });
    expect(docThamSoSoDo(['--file=a.yaml', '--ra', 'b.md'])).toEqual({ file: 'a.yaml', ra: 'b.md', thu: false });
    expect(() => docThamSoSoDo(['--file'])).toThrow(/Thiếu giá trị/);
    expect(() => docThamSoSoDo(['--x'])).toThrow(/Tham số lạ/);
  });
});
