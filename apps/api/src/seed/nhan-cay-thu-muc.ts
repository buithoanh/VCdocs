import { Types } from 'mongoose';
import type { Models } from '../db/models';
import type { DriveFileMeta, GooglePorts } from '../google/ports';
import { AuditService } from '../audit/audit.service';
import type { Db } from '../db/db.service';
import type { FolderKind } from '../common/enums';
import { folderName } from '../modules/m03-folders/folders.service';

/**
 * Nhận cây thư mục có sẵn trên shared drive của các phòng vào sổ VCdocs (collection `folders`).
 * Chỉ đọc Drive: không tạo, đổi tên, di chuyển gì trên Drive. Thư mục sai mẫu tên
 * `<số> <MÃ>-<tên ngắn> <tên đầy đủ>` (BR-11) thì báo cáo, không nhận cả nhánh của nó.
 * Chạy lại không trùng: khớp theo googleId; thư mục đã có trong sổ giữ nguyên.
 */

/** Vùng số ở gốc drive (BR-11), cùng khung với FoldersService */
const VUNG_GOC: { tu: number; den: number; kind: FolderKind }[] = [
  { tu: 0, den: 0, kind: 'docs' },
  { tu: 1, den: 1, kind: 'plan_report' },
  { tu: 2, den: 9, kind: 'operations' },
  { tu: 10, den: 49, kind: 'area' },
  { tu: 50, den: 89, kind: 'project' },
  { tu: 98, den: 98, kind: 'closed' },
  { tu: 99, den: 99, kind: 'archive' },
];
/** Thư mục con của 00 Tài liệu theo mã (khớp SUBFOLDER_CODE của M04) */
const MA_TAI_LIEU: Record<string, string> = { '01': 'QĐ', '02': 'QT', '03': 'HD', '04': 'BM' };
const MA_KHONG_TRA_BANG_MA = new Set(Object.values(MA_TAI_LIEU));
/** Một đoạn mã: chữ in hoa (có dấu như Đ), số */
const DOAN_MA = /^[\p{Lu}0-9]+$/u;
const CO_CHU = /\p{Lu}/u;

export interface TenThuMuc {
  number: string;
  code?: string;
  shortName: string;
  fullName: string;
  kind: FolderKind;
  year?: number;
  month?: number;
}
export type KetQuaTen = { ok: true; tt: TenThuMuc } | { ok: false; lyDo: string };

/** Ngữ cảnh cha khi đọc tên: undefined = gốc drive */
export interface ChaTen {
  kind: FolderKind;
  year?: number;
  /** Loại của tổ tiên gần nhất không phải năm/tháng */
  kindGoc: FolderKind;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Tách "MÃ-TÊN NGẮN" ở chữ đầu: mã = các đoạn in hoa đứng đầu, tên ngắn = phần còn lại */
function tachMa(chu: string): { code?: string; shortName?: string; loi?: string } {
  if (chu.endsWith('-') || chu.startsWith('-') || chu.includes('--')) return { loi: `mã "${chu}" dở dang (thừa dấu -)` };
  const doan = chu.split('-');
  let i = 0;
  while (i < doan.length && DOAN_MA.test(doan[i]) && CO_CHU.test(doan[i])) i++;
  if (i === 0) return {};
  if (i === 1 && doan.length === 1 && doan[0].length < 2) return {};
  const code = doan.slice(0, i).join('-');
  if (i === doan.length) return { code, shortName: i > 1 ? doan.slice(1).join('-') : code };
  return { code, shortName: doan.slice(i).join('-') };
}

/** Đọc tên một thư mục theo BR-10, BR-11 trong ngữ cảnh thư mục cha */
export function docTenThuMuc(tenGoc: string, cha?: ChaTen): KetQuaTen {
  const ten = tenGoc.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!ten) return { ok: false, lyDo: 'tên rỗng' };

  // Năm, tháng: không đánh số, phải nằm trong thư mục cha
  if (/^\d{4}$/.test(ten)) {
    const y = Number(ten);
    if (!cha) return { ok: false, lyDo: 'thư mục năm không được nằm ở gốc drive' };
    if (cha.kind === 'year' || cha.kind === 'month') return { ok: false, lyDo: 'thư mục năm nằm trong thư mục năm/tháng khác' };
    if (cha.kind === 'docs') return { ok: false, lyDo: 'thư mục năm nằm trong 00 Tài liệu' };
    if (y < 2000 || y > 2099) return { ok: false, lyDo: `năm ${y} ngoài khoảng 2000–2099` };
    return { ok: true, tt: { number: '', shortName: ten, fullName: '', kind: 'year', year: y } };
  }
  const thang = /^(\d{4})-(\d{2})$/.exec(ten);
  if (thang) {
    const [y, mo] = [Number(thang[1]), Number(thang[2])];
    if (cha?.kind !== 'year') return { ok: false, lyDo: 'thư mục tháng phải nằm trong thư mục năm' };
    if (y !== cha.year) return { ok: false, lyDo: `tháng ${ten} nằm trong thư mục năm ${cha.year}` };
    if (mo < 1 || mo > 12) return { ok: false, lyDo: `tháng ${mo} không có` };
    return { ok: true, tt: { number: '', shortName: ten, fullName: '', kind: 'month', year: y, month: mo } };
  }
  if (cha?.kind === 'month') return { ok: false, lyDo: 'thư mục tháng không có thư mục con (VCdocs lưu hồ sơ ngay trong tháng)' };
  const thangChu = /^tháng\s*(\d{1,2})$/i.exec(ten);
  if (thangChu && cha?.kind === 'year') return { ok: false, lyDo: `tên tháng phải là ${cha.year}-${pad(Number(thangChu[1]))}` };

  const so = /^(\d{2}) (.+)$/.exec(ten);
  if (!so) {
    if (!cha) return { ok: false, lyDo: 'thư mục ở gốc drive phải đánh số 2 chữ số theo khung 00–99' };
    // Thư mục theo đối tượng (lớp, xe, PO…) chỉ có trong hồ sơ vận hành
    if (['operations', 'entity'].includes(cha.kindGoc) && cha.kind !== 'docs')
      return { ok: true, tt: { number: '', shortName: ten, fullName: '', kind: 'entity' } };
    if (cha.kind === 'year') return { ok: false, lyDo: 'trong thư mục năm chỉ có thư mục tháng YYYY-MM' };
    return { ok: false, lyDo: 'thiếu số 2 chữ số (chỉ năm, tháng, thư mục đối tượng trong hồ sơ vận hành được không đánh số)' };
  }
  const number = so[1];
  const n = Number(number);
  const conLai = so[2];
  const sp = conLai.indexOf(' ');
  const chuDau = sp < 0 ? conLai : conLai.slice(0, sp);
  const sau = sp < 0 ? '' : conLai.slice(sp + 1);
  const ma = tachMa(chuDau);
  if (ma.loi) return { ok: false, lyDo: ma.loi };
  const code = ma.code;
  const shortName = code ? ma.shortName! : conLai;
  const fullName = code ? sau : '';

  let kind: FolderKind;
  if (!cha) {
    const v = VUNG_GOC.find((x) => n >= x.tu && n <= x.den);
    if (!v) return { ok: false, lyDo: `số ${number} ngoài khung ở gốc drive (90–97 chưa dùng)` };
    kind = v.kind;
  } else if (cha.kind === 'year') return { ok: false, lyDo: 'trong thư mục năm chỉ có thư mục tháng YYYY-MM' };
  else if (n === 99) kind = 'archive';
  else if (n === 98 && cha.kind !== 'docs') kind = 'closed';
  else if (cha.kind === 'docs') kind = 'docs';
  else if (code?.startsWith('DA-')) kind = 'project';
  else if (cha.kind === 'project') kind = 'operations';
  else if (cha.kind === 'closed') kind = 'closed';
  else kind = cha.kind === 'entity' ? 'operations' : cha.kind;
  return { ok: true, tt: { number, code, shortName, fullName, kind } };
}

export interface SaiMau {
  duongDan: string;
  lyDo: string;
  /** Số thư mục con bị bỏ qua theo */
  boQua: number;
}
export interface KetQuaDrive {
  phong: string;
  drive: string;
  driveId: string;
  tren: number;
  tao: number;
  giu: number;
  saiMau: SaiMau[];
  canhBao: string[];
}
export interface KetQuaNhanCay {
  thu: boolean;
  drives: KetQuaDrive[];
  canhBao: string[];
}

/**
 * Nhận cây thư mục của các drive phòng (đã nạp bằng nap-so-do) vào CSDL.
 * `drive` = số phòng (vd 11, 21b), mã phòng hoặc id drive để chỉ nhận một drive.
 */
export async function nhanCayThuMuc(m: Models, google: GooglePorts, opts: { mien: string; thu?: boolean; drive?: string }): Promise<KetQuaNhanCay> {
  const thu = !!opts.thu;
  const company = await m.Company.findOne({ domain: opts.mien.toLowerCase() }).lean<any>();
  if (!company) throw new Error(`Chưa có công ty tên miền ${opts.mien}: chạy "pnpm --filter api run khoi-tao" trước`);
  const cid = company._id as Types.ObjectId;
  let depts = await m.Department.find({ companyId: cid, driveId: { $exists: true, $ne: '' } }).sort({ number: 1 }).lean<any[]>();
  if (!depts.length) throw new Error('CSDL chưa có phòng nào gắn drive: chạy "pnpm --filter api run nap-so-do" trước');
  if (opts.drive) {
    const k = opts.drive.toLowerCase();
    depts = depts.filter((d) => [String(d.number).toLowerCase(), String(d.code).toLowerCase(), String(d.driveId).toLowerCase()].includes(k));
    if (!depts.length) throw new Error(`Không có phòng/drive "${opts.drive}" trong CSDL`);
  }
  const kq: KetQuaNhanCay = { thu, drives: [], canhBao: [] };
  const audit = new AuditService({ m } as Db);
  const maDaDuyet = new Set((await m.Code.find({ companyId: cid, status: 'approved' }, { code: 1 }).lean<any[]>()).map((c) => String(c.code).normalize('NFC')));
  const thieuMa = new Map<string, string[]>();
  const dsDrive = await google.drive.listDrives();

  for (const dept of depts) {
    const kd: KetQuaDrive = { phong: `${dept.number} ${dept.code}`, drive: dept.driveId, driveId: dept.driveId, tren: 0, tao: 0, giu: 0, saiMau: [], canhBao: [] };
    kq.drives.push(kd);
    const drive = dsDrive.find((d) => d.driveId === dept.driveId);
    if (!drive) {
      kd.canhBao.push('tài khoản máy không thấy drive này (chưa là thành viên?) — bỏ qua');
      continue;
    }
    kd.drive = drive.name;
    const tren = await google.drive.listFiles(dept.driveId, { foldersOnly: true });
    kd.tren = tren.length;
    const byGoogle = new Map(tren.map((f) => [f.fileId, f]));
    const con = new Map<string, DriveFileMeta[]>();
    const moCoi: DriveFileMeta[] = [];
    for (const f of tren) {
      const p = f.parents[0];
      if (p !== dept.driveId && !byGoogle.has(p)) {
        moCoi.push(f);
        continue;
      }
      if (!con.has(p)) con.set(p, []);
      con.get(p)!.push(f);
    }
    for (const l of con.values()) l.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    const demCon = (id: string): number => (con.get(id) ?? []).reduce((s, c) => s + 1 + demCon(c.fileId), 0);
    const laNam = (f: DriveFileMeta) => /^\d{4}$/.test(f.name.trim());
    /** Chia năm/tháng: đã có thư mục năm và mọi thư mục trong năm đều đúng YYYY-MM */
    const chiaKy = (id: string): 'co' | 'khong' | 'sai' => {
      const nam = (con.get(id) ?? []).filter(laNam);
      if (!nam.length) return 'khong';
      const dungThang = (y: DriveFileMeta, t: DriveFileMeta) => /^\d{4}-\d{2}$/.test(t.name.trim()) && t.name.trim().startsWith(`${y.name.trim()}-`);
      return nam.every((y) => (con.get(y.fileId) ?? []).every((t) => dungThang(y, t))) ? 'co' : 'sai';
    };
    const coTheChiaKy = (k: FolderKind) => !['year', 'month', 'docs', 'closed', 'archive', 'entity'].includes(k);
    if (moCoi.length)
      kd.canhBao.push(`${moCoi.length} thư mục có thư mục cha đã vào thùng rác hoặc không đọc được — không nhận: ${moCoi.slice(0, 5).map((f) => f.name).join(' · ')}${moCoi.length > 5 ? ' …' : ''}`);

    const trongSo = new Map((await m.Folder.find({ companyId: cid, driveId: dept.driveId }).lean<any[]>()).map((f) => [f.googleId, f]));
    for (const [gid, f] of trongSo) if (!byGoogle.has(gid) && f.status !== 'archived') kd.canhBao.push(`"${f.path}" có trong sổ nhưng không còn trên Drive (thùng rác?) — dùng "Làm mới" ở màn hình Thư mục`);

    const dongMoi: any[] = [];
    const soMoi: { parentKey: string; number: string }[] = [];
    const goc = `${dept.number} ${dept.code}`;
    const nhan = async (f: DriveFileMeta, cha: { row: any; ten: ChaTen } | undefined, duongCha: string) => {
      const duongDrive = `${duongCha} / ${f.name}`;
      const cu = trongSo.get(f.fileId);
      let row: any;
      let ten: ChaTen;
      if (cu) {
        kd.giu++;
        if (cu.name !== f.name) kd.canhBao.push(`"${cu.path}" đã đổi tên trên Drive thành "${f.name}" — dùng "Làm mới" để sổ lấy tên mới`);
        if (String(cu.parentId ?? '') !== String(cha?.row._id ?? '')) kd.canhBao.push(`"${cu.path}" đã chuyển chỗ trên Drive — dùng "Làm mới"`);
        row = cu;
        // Chạy lại sau khi đã sửa tên tháng trên Drive: bật chia năm/tháng (chỉ bật, không tự tắt)
        if (!cu.hasPeriods && coTheChiaKy(cu.kind) && chiaKy(f.fileId) === 'co') {
          if (!thu) await m.Folder.updateOne({ _id: cu._id, companyId: cid }, { $set: { hasPeriods: true } });
          kd.canhBao.push(`"${duongDrive}": ${thu ? 'sẽ bật' : 'đã bật'} chia năm/tháng (thư mục năm đã đúng mẫu)`);
        }
        ten = { kind: cu.kind, year: cu.year, kindGoc: ['year', 'month'].includes(cu.kind) ? cha?.ten.kindGoc ?? cu.kind : cu.kind };
      } else {
        const r = docTenThuMuc(f.name, cha?.ten);
        if (!r.ok) {
          kd.saiMau.push({ duongDan: duongDrive, lyDo: r.lyDo, boQua: demCon(f.fileId) });
          return;
        }
        const tt = r.tt;
        const name = f.name.normalize('NFC');
        const ky = coTheChiaKy(tt.kind) ? chiaKy(f.fileId) : 'khong';
        if (ky === 'sai')
          kd.canhBao.push(`"${duongDrive}": chưa bật chia năm/tháng tự động vì trong thư mục năm có thư mục sai mẫu (tránh tạo YYYY-MM cạnh thư mục cũ); sửa tên rồi chạy lại lệnh`);
        row = {
          _id: new Types.ObjectId(),
          companyId: cid,
          driveId: dept.driveId,
          googleId: f.fileId,
          parentId: cha?.row._id,
          number: tt.number,
          code: tt.code,
          shortName: tt.shortName,
          fullName: tt.fullName,
          name,
          kind: tt.kind,
          path: cha ? `${cha.row.path} / ${name}` : `${goc} / ${name}`,
          year: tt.year ?? (tt.kind === 'month' ? cha?.ten.year : undefined),
          month: tt.month,
          securityLevel: dept.securityLevel,
          status: cha && (cha.row.kind === 'closed' || cha.row.status === 'closed') ? 'closed' : 'active',
          isManagedByVcdocs: true,
          // Chỉ chia năm/tháng nơi trên Drive đã có thư mục năm, để ensure-periods không tạo năm/tháng tràn lan
          hasPeriods: ky === 'co',
        };
        if (name !== folderName(tt) && !['year', 'month', 'entity'].includes(tt.kind))
          kd.canhBao.push(`"${duongDrive}": tên chưa đúng cách ghép của VCdocs, đổi tên bằng VCdocs sẽ thành "${folderName(tt)}"`);
        if (['area', 'project'].includes(tt.kind) && !tt.code && !(cha && ['area', 'project'].includes(cha.row.kind)))
          kd.canhBao.push(`"${duongDrive}": ${tt.kind === 'project' ? 'dự án' : 'mảng'} chưa có mã (BR-12)`);
        if (tt.kind === 'project' && tt.code && !tt.code.startsWith('DA-')) kd.canhBao.push(`"${duongDrive}": dự án nên có mã DA-…`);
        if (cha?.row.kind === 'docs' && !cha.row.parentId && MA_TAI_LIEU[tt.number] && tt.code !== MA_TAI_LIEU[tt.number])
          kd.canhBao.push(`"${duongDrive}": số ${tt.number} trong 00 Tài liệu phải mang mã ${MA_TAI_LIEU[tt.number]} — tài liệu sẽ lưu thẳng vào 00 Tài liệu`);
        if (tt.code && ['area', 'project', 'operations', 'plan_report'].includes(tt.kind) && !MA_KHONG_TRA_BANG_MA.has(tt.code) && !maDaDuyet.has(tt.code)) {
          if (!thieuMa.has(tt.code)) thieuMa.set(tt.code, []);
          thieuMa.get(tt.code)!.push(`${goc} / … ${name}`);
        }
        dongMoi.push(row);
        if (tt.number) soMoi.push({ parentKey: cha ? String(cha.row._id) : `root:${dept.driveId}`, number: tt.number });
        kd.tao++;
        ten = { kind: tt.kind, year: tt.year, kindGoc: ['year', 'month'].includes(tt.kind) ? cha?.ten.kindGoc ?? tt.kind : tt.kind };
      }
      const anhEm = con.get(f.fileId) ?? [];
      const trung = anhEm.map((c) => /^(\d{2}) /.exec(c.name.trim())?.[1]).filter((x): x is string => !!x);
      for (const s of new Set(trung.filter((x, i) => trung.indexOf(x) !== i))) kd.canhBao.push(`"${duongDrive}": số ${s} bị trùng giữa các thư mục con`);
      for (const c of anhEm) await nhan(c, { row, ten }, duongDrive);
    };
    const cap1 = con.get(dept.driveId) ?? [];
    const trungGoc = cap1.map((c) => /^(\d{2}) /.exec(c.name.trim())?.[1]).filter((x): x is string => !!x);
    for (const s of new Set(trungGoc.filter((x, i) => trungGoc.indexOf(x) !== i))) kd.canhBao.push(`gốc drive: số ${s} bị trùng`);
    for (const f of cap1) await nhan(f, undefined, drive.name);

    // Khung tối thiểu để VCdocs chạy (chỉ báo, không tạo)
    const tatCa = [...trongSo.values(), ...dongMoi];
    const gocKind = (k: FolderKind) => tatCa.find((f) => !f.parentId && f.kind === k);
    const docs = gocKind('docs');
    if (!docs) kd.canhBao.push('thiếu 00 Tài liệu ở gốc drive — chưa ban hành tài liệu của phòng vào drive này được');
    else {
      const ma = new Set(tatCa.filter((f) => String(f.parentId) === String(docs._id)).map((f) => f.code));
      const can = dept.securityLevel === 'internal' ? ['QĐ', 'QT', 'HD', 'BM'] : ['QT', 'HD', 'BM'];
      const thieu = can.filter((c) => !ma.has(c));
      if (thieu.length) kd.canhBao.push(`00 Tài liệu thiếu thư mục ${thieu.join(', ')} — tài liệu loại đó sẽ lưu thẳng vào 00 Tài liệu`);
      if (!tatCa.some((f) => String(f.parentId) === String(docs._id) && f.kind === 'archive')) kd.canhBao.push('00 Tài liệu thiếu 99 Hết hiệu lực — tài liệu hết hiệu lực sẽ không chuyển chỗ');
    }
    if (!gocKind('archive')) kd.canhBao.push('thiếu 99 Lưu trữ ở gốc drive');

    if (thu) continue;
    // Ghi sổ: cha trước con (thứ tự duyệt cây), số đã dùng giữ trong folder_numbers
    for (const row of dongMoi) {
      await m.Folder.create(row);
      await audit.write(
        { companyId: String(cid), requestId: 'nhan-cay-thu-muc' },
        { action: 'folder.import', objectType: 'folder', objectId: String(row._id), after: { googleId: row.googleId, name: row.name, kind: row.kind, path: row.path } },
      );
    }
    for (const s of soMoi) {
      try {
        await m.FolderNumber.create({ companyId: cid, ...s });
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
  }
  if (thieuMa.size)
    kq.canhBao.push(
      `${thieuMa.size} mã chưa có trong Bảng mã (đã duyệt): ${[...thieuMa.keys()].sort().join(', ')} — thư mục vẫn nhận; HCNS cấp mã để tạo thư mục con mới bằng VCdocs`,
    );
  return kq;
}

export function inKetQuaNhanCay(kq: KetQuaNhanCay): string {
  const d: string[] = [kq.thu ? 'CHẠY THỬ — chưa ghi gì vào CSDL' : 'Đã nhận cây thư mục vào sổ VCdocs', 'Không đổi gì trên Drive.'];
  const tong = (k: 'tren' | 'tao' | 'giu') => kq.drives.reduce((s, x) => s + x[k], 0);
  const sai = kq.drives.reduce((s, x) => s + x.saiMau.length, 0);
  const boQua = kq.drives.reduce((s, x) => s + x.saiMau.reduce((a, b) => a + b.boQua, 0), 0);
  d.push(`Tổng: ${tong('tren')} thư mục trên Drive · ${kq.thu ? 'sẽ nhận' : 'nhận mới'} ${tong('tao')} · đã có trong sổ ${tong('giu')} · sai mẫu ${sai} (kèm ${boQua} thư mục con bỏ qua theo)`);
  for (const x of kq.drives) {
    d.push(`\n## ${x.phong} · ${x.drive}`);
    d.push(`Trên Drive ${x.tren} · ${kq.thu ? 'sẽ nhận' : 'nhận mới'} ${x.tao} · đã có ${x.giu} · sai mẫu ${x.saiMau.length}`);
    if (x.saiMau.length) {
      d.push('Sai mẫu (không nhận, cần sửa tên/chỗ trên Drive rồi chạy lại):');
      // Gom các thư mục anh em sai cùng một kiểu (vd 12 thư mục "Tháng NN") thành một dòng
      const nhom = new Map<string, SaiMau[]>();
      for (const s of x.saiMau) {
        const k = `${s.duongDan.slice(0, s.duongDan.lastIndexOf(' / '))}\n${s.lyDo.replace(/\d/g, '#')}`;
        if (!nhom.has(k)) nhom.set(k, []);
        nhom.get(k)!.push(s);
      }
      for (const ds of nhom.values()) {
        const boQua = ds.reduce((a, b) => a + b.boQua, 0);
        const sau = boQua ? ` (bỏ qua ${boQua} thư mục con)` : '';
        if (ds.length === 1) d.push(`  - ${ds[0].duongDan} — ${ds[0].lyDo}${sau}`);
        else {
          const cha = ds[0].duongDan.slice(0, ds[0].duongDan.lastIndexOf(' / '));
          const ten = ds.map((s) => s.duongDan.slice(cha.length + 3));
          d.push(`  - ${cha} / {${ten.join(', ')}} — ${ds.length} thư mục: ${ds[0].lyDo}${ds[0].lyDo.includes('phải là') ? ' …' : ''}${sau}`);
        }
      }
    }
    if (x.canhBao.length) d.push('Cảnh báo:', ...x.canhBao.map((c) => `  - ${c}`));
  }
  if (kq.canhBao.length) d.push('\nChung:', ...kq.canhBao.map((c) => `  - ${c}`));
  return d.join('\n');
}
