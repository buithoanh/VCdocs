import { Types } from 'mongoose';
import { parse as parseYaml } from 'yaml';
import type { Models } from '../db/models';
import type { GooglePorts } from '../google/ports';
import type { AppConfig } from '../config/config';
import { AuditService } from '../audit/audit.service';
import type { Db } from '../db/db.service';
import { DriveRole, SecurityLevel, SystemRole } from '../common/enums';

/**
 * Sơ đồ tổ chức (khối, phòng, division, người giữ vai trò) đọc từ file YAML/JSON
 * do chủ dự án điền (mẫu: apps/api/so-do-to-chuc.mau.yaml) và nạp vào CSDL.
 * Nhóm Google theo mẫu C1 (hợp đồng mục 9.3) tính từ chính sơ đồ này.
 */

/** C1: hậu tố nhóm phòng → vai trò hệ thống, vai trò trên drive */
export const C1_NHOM_PHONG: { hauTo: string; vaiTro: SystemRole; vaiTroDrive: DriveRole }[] = [
  { hauTo: 'quan-ly', vaiTro: 'R4', vaiTroDrive: 'organizer' },
  { hauTo: 'quan-ly-noi-dung', vaiTro: 'R5', vaiTroDrive: 'fileOrganizer' },
  { hauTo: 'dong-gop', vaiTro: 'R6', vaiTroDrive: 'writer' },
  { hauTo: 'nhan-xet', vaiTro: 'R7', vaiTroDrive: 'commenter' },
  { hauTo: 'xem', vaiTro: 'R7', vaiTroDrive: 'reader' },
];
/** Vai trò ghi theo người trong file; R2, R4 lấy từ giam_doc, truong_phong; R5–R7 chỉ qua nhóm */
const VAI_TRO_THEO_NGUOI: SystemRole[] = ['R1', 'R3', 'R8', 'R9'];
const BAO_MAT: SecurityLevel[] = ['internal', 'department', 'confidential'];

export interface SoDoKhoi {
  ma: string;
  ten: string;
  giamDoc?: string;
}
export interface SoDoPhong {
  so: string;
  ma: string;
  ten: string;
  drive: string;
  baoMat: SecurityLevel;
  khoi?: string;
  truongPhong?: string;
}
export interface SoDo {
  khoi: SoDoKhoi[];
  phong: SoDoPhong[];
  division: { tienTo: string; ten: string }[];
  vaiTro: Partial<Record<SystemRole, string[]>>;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** Đọc và kiểm file sơ đồ; gom đủ lỗi rồi báo một lần */
export function docSoDo(text: string, mien: string): SoDo {
  let raw: any;
  try {
    raw = parseYaml(text);
  } catch (e: any) {
    throw new Error(`File sơ đồ không đọc được: ${e?.message ?? e}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('File sơ đồ rỗng');
  const loi: string[] = [];
  const domain = mien.toLowerCase();
  const email = (v: unknown, noi: string): string | undefined => {
    const s = str(v).toLowerCase();
    if (!s || s === '?') return undefined;
    if (!/^[^@\s]+@[^@\s]+$/.test(s)) loi.push(`${noi}: "${s}" không phải email`);
    else if (!s.endsWith(`@${domain}`)) loi.push(`${noi}: ${s} không thuộc tên miền ${domain}`);
    return s;
  };
  const list = (v: unknown, ten: string): any[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      loi.push(`"${ten}" phải là danh sách`);
      return [];
    }
    return v;
  };
  const tenLa = Object.keys(raw).filter((k) => !['khoi', 'phong', 'division', 'vai_tro'].includes(k));
  if (tenLa.length) loi.push(`Mục lạ: ${tenLa.join(', ')} (chỉ có khoi, phong, division, vai_tro)`);

  const khoi: SoDoKhoi[] = list(raw.khoi, 'khoi').map((k: any, i: number) => {
    const noi = `khoi[${i + 1}]`;
    const ma = str(k?.ma).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(ma)) loi.push(`${noi}: mã khối "${ma}" chỉ gồm chữ in hoa không dấu, số`);
    if (!str(k?.ten)) loi.push(`${noi}: thiếu tên`);
    return { ma, ten: str(k?.ten), giamDoc: email(k?.giam_doc, `${noi} (${ma}) giam_doc`) };
  });
  const maKhoi = new Set(khoi.map((k) => k.ma));

  const phong: SoDoPhong[] = list(raw.phong, 'phong').map((p: any, i: number) => {
    const so = str(p?.so).toLowerCase();
    const ma = str(p?.ma).toUpperCase();
    const noi = `phong[${i + 1}] (${so || '?'} ${ma || '?'})`;
    if (!/^\d{2}b?$/.test(so)) loi.push(`${noi}: số drive "${so}" phải 2 chữ số, có thể thêm "b" (vd 21b)`);
    if (!/^[A-Z0-9]+$/.test(ma)) loi.push(`${noi}: mã phòng "${ma}" chỉ gồm chữ in hoa không dấu, số`);
    if (!str(p?.ten)) loi.push(`${noi}: thiếu tên`);
    if (!str(p?.drive)) loi.push(`${noi}: thiếu drive`);
    const baoMat = str(p?.bao_mat) as SecurityLevel;
    if (!BAO_MAT.includes(baoMat)) loi.push(`${noi}: bao_mat "${baoMat}" phải là ${BAO_MAT.join(' | ')}`);
    const k = str(p?.khoi).toUpperCase() || undefined;
    if (k && !maKhoi.has(k)) loi.push(`${noi}: khối ${k} không có trong mục khoi`);
    return { so, ma, ten: str(p?.ten), drive: str(p?.drive), baoMat, khoi: k, truongPhong: email(p?.truong_phong, `${noi} truong_phong`) };
  });

  const division = list(raw.division, 'division').map((d: any, i: number) => {
    const tienTo = str(d?.tien_to).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(tienTo)) loi.push(`division[${i + 1}]: tiền tố "${tienTo}" chỉ gồm chữ in hoa không dấu, số`);
    if (!str(d?.ten)) loi.push(`division[${i + 1}] (${tienTo}): thiếu tên`);
    return { tienTo, ten: str(d?.ten) };
  });

  const vaiTro: SoDo['vaiTro'] = {};
  const vt = raw.vai_tro ?? {};
  if (typeof vt !== 'object' || Array.isArray(vt)) loi.push('"vai_tro" phải có dạng R1: [email, …]');
  else
    for (const [r, emails] of Object.entries(vt)) {
      const role = r.toUpperCase() as SystemRole;
      if (!VAI_TRO_THEO_NGUOI.includes(role)) {
        loi.push(`vai_tro: ${r} không ghi theo người được (chỉ ${VAI_TRO_THEO_NGUOI.join(', ')}; R2, R4 lấy từ giam_doc, truong_phong; R5–R7 qua nhóm Google)`);
        continue;
      }
      vaiTro[role] = list(emails, `vai_tro.${r}`)
        .map((x, i) => email(x, `vai_tro.${r}[${i + 1}]`))
        .filter((x): x is string => !!x);
    }

  const trung = (ten: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (k && seen.has(k)) loi.push(`${ten} "${k}" bị lặp`);
      seen.add(k);
    }
  };
  trung('Mã khối', khoi.map((k) => k.ma));
  trung('Số drive', phong.map((p) => p.so));
  trung('Mã phòng', phong.map((p) => p.ma));
  trung('Drive', phong.map((p) => p.drive));
  trung('Tiền tố division', division.map((d) => d.tienTo));
  if (loi.length) throw new Error(`File sơ đồ có ${loi.length} lỗi:\n- ${loi.join('\n- ')}`);
  return { khoi, phong, division, vaiTro };
}

/** Tên nhóm C1 của một phòng, vd 11-mkt-dong-gop@vcprosperous.com */
export function nhomPhong(p: { so: string; ma: string }, hauTo: string, mien: string) {
  return `${p.so.toLowerCase()}-${p.ma.toLowerCase()}-${hauTo}@${mien.toLowerCase()}`;
}
export function nhomHeThong(role: SystemRole, mien: string) {
  return `vcdocs-${role.toLowerCase()}@${mien.toLowerCase()}`;
}

/** Vai trò gán theo người: vai_tro + GĐ khối (R2) + trưởng phòng (R4) */
export function vaiTroTheoNguoi(sd: SoDo): Map<string, Set<SystemRole>> {
  const out = new Map<string, Set<SystemRole>>();
  const add = (email: string | undefined, r: SystemRole) => {
    if (!email) return;
    if (!out.has(email)) out.set(email, new Set());
    out.get(email)!.add(r);
  };
  for (const [r, emails] of Object.entries(sd.vaiTro)) for (const e of emails ?? []) add(e, r as SystemRole);
  for (const k of sd.khoi) add(k.giamDoc, 'R2');
  for (const p of sd.phong) add(p.truongPhong, 'R4');
  return out;
}

/** Tìm id shared drive theo tên đúng từng chữ hoặc theo id */
export async function timDrive(google: GooglePorts, sd: SoDo): Promise<Map<string, { driveId: string; name: string }>> {
  const drives = await google.drive.listDrives();
  const out = new Map<string, { driveId: string; name: string }>();
  const loi: string[] = [];
  for (const p of sd.phong) {
    const d = drives.find((x) => x.driveId === p.drive) ?? drives.find((x) => x.name.normalize('NFC') === p.drive.normalize('NFC'));
    if (!d) loi.push(`${p.so} ${p.ma}: không thấy shared drive "${p.drive}" (tài khoản máy phải là thành viên drive)`);
    else out.set(p.so, d);
  }
  if (loi.length) throw new Error(`Thiếu drive:\n- ${loi.join('\n- ')}\nDrive đang thấy: ${drives.map((d) => d.name).join(' · ')}`);
  return out;
}

export type ThayDoi = { loai: 'khoi' | 'phong' | 'division' | 'nguoi'; khoa: string; viec: 'tao' | 'sua' | 'giu'; chiTiet?: string };

export interface KetQuaNap {
  thu: boolean;
  thayDoi: ThayDoi[];
  canhBao: string[];
}

const same = (a: any, b: any) => String(a ?? '') === String(b ?? '');

/**
 * Nạp sơ đồ vào công ty (theo tên miền). Chạy lại không tạo trùng: khối theo mã,
 * phòng theo mã (đổi mã thì khớp theo drive), division theo tiền tố; có rồi thì
 * cập nhật theo file. Không xoá gì; mục có trong CSDL mà thiếu trong file chỉ cảnh báo.
 * Người: thiếu trong CSDL thì lấy từ Google Directory; vai trò chỉ thêm vào manualRoles
 * (không gỡ vai trò đã có). `thu` = chỉ tính, không ghi.
 */
export async function napSoDo(
  m: Models,
  google: GooglePorts,
  cfg: Pick<AppConfig, 'allowedDomain' | 'rules'>,
  sd: SoDo,
  opts: { thu?: boolean; mien?: string } = {},
): Promise<KetQuaNap> {
  const mien = (opts.mien ?? cfg.allowedDomain).toLowerCase();
  const thu = !!opts.thu;
  const company = await m.Company.findOne({ domain: mien }).lean<any>();
  if (!company) throw new Error(`Chưa có công ty tên miền ${mien}: chạy "pnpm --filter api run khoi-tao" trước`);
  const cid = company._id as Types.ObjectId;
  const kq: KetQuaNap = { thu, thayDoi: [], canhBao: [] };
  const audit = new AuditService({ m } as Db);
  const ghiNhatKy = async (objectType: string, objectId: string, before: any, after: any) => {
    if (!thu) await audit.write({ companyId: String(cid), requestId: 'nap-so-do' }, { action: 'org.import', objectType, objectId, before, after });
  };

  // ── Kiểm trước khi ghi: drive, người, mã theo cấu hình ──
  const drives = await timDrive(google, sd);
  const vaiTro = vaiTroTheoNguoi(sd);
  const nguoi = new Map<string, any>();
  const thieuNguoi: string[] = [];
  for (const email of vaiTro.keys()) {
    const u = await m.User.findOne({ companyId: cid, email }).lean<any>();
    if (u) {
      nguoi.set(email, u);
      if (u.status === 'left') kq.canhBao.push(`${email} đã nghỉ việc trong VCdocs nhưng vẫn được giao vai trò`);
      continue;
    }
    const du = await google.directory.getUser(email);
    if (!du) thieuNguoi.push(email);
    else nguoi.set(email, { _new: true, email, name: du.name, title: du.title, isSuspended: du.suspended });
  }
  if (thieuNguoi.length) throw new Error(`Không thấy trong Google Workspace: ${thieuNguoi.join(', ')}`);
  for (const p of sd.phong) if (p.truongPhong && sd.phong.filter((x) => x.truongPhong === p.truongPhong).length > 1)
    kq.canhBao.push(`${p.truongPhong} là trưởng nhiều phòng; phòng của người này lấy theo nhóm Google (hoặc phòng đầu tiên trong file)`);
  const maPhong = new Set(sd.phong.map((p) => p.ma));
  for (const c of [...cfg.rules.accountingDeptCodes, ...cfg.rules.hrDeptCodes])
    if (!maPhong.has(c)) kq.canhBao.push(`Cấu hình .env nhắc phòng ${c} (ACCOUNTING_DEPT_CODES / HR_DEPT_CODES) nhưng file không có phòng mã này`);
  if (!sd.khoi.some((k) => k.ma === cfg.rules.internalOpsBlockCode))
    kq.canhBao.push(`INTERNAL_OPS_BLOCK_CODE=${cfg.rules.internalOpsBlockCode} không có trong mục khoi`);
  for (const k of sd.khoi) if (!k.giamDoc) kq.canhBao.push(`Khối ${k.ma} chưa có giam_doc`);
  for (const p of sd.phong) if (!p.truongPhong) kq.canhBao.push(`Phòng ${p.so} ${p.ma} chưa có truong_phong`);
  for (const r of VAI_TRO_THEO_NGUOI) if (!sd.vaiTro[r]?.length) kq.canhBao.push(`Chưa ai giữ ${r}`);

  // ── Người ──
  const userId = new Map<string, Types.ObjectId>();
  for (const [email, u] of nguoi) {
    if (u._new) {
      const id = new Types.ObjectId();
      if (!thu) await m.User.create({ _id: id, companyId: cid, email, name: u.name, title: u.title, isSuspended: u.isSuspended });
      userId.set(email, id);
      nguoi.set(email, { _id: id, email, manualRoles: [], groupRoles: [], systemRoles: [] });
      kq.thayDoi.push({ loai: 'nguoi', khoa: email, viec: 'tao', chiTiet: `lấy từ Google Directory (${u.name})` });
    } else userId.set(email, u._id);
  }

  // ── Khối ──
  const blockId = new Map<string, Types.ObjectId>();
  for (const k of sd.khoi) {
    const want = { code: k.ma, name: k.ten, directorId: k.giamDoc ? userId.get(k.giamDoc) : undefined };
    const cur = await m.Block.findOne({ companyId: cid, code: k.ma }).lean<any>();
    if (!cur) {
      const id = new Types.ObjectId();
      if (!thu) await m.Block.create({ _id: id, companyId: cid, ...want });
      await ghiNhatKy('block', String(id), undefined, want);
      blockId.set(k.ma, id);
      kq.thayDoi.push({ loai: 'khoi', khoa: k.ma, viec: 'tao', chiTiet: k.ten });
      continue;
    }
    blockId.set(k.ma, cur._id);
    const doi = (['name', 'directorId'] as const).filter((f) => want[f] !== undefined && !same(cur[f], want[f]));
    if (!doi.length) {
      kq.thayDoi.push({ loai: 'khoi', khoa: k.ma, viec: 'giu' });
      continue;
    }
    const set = Object.fromEntries(doi.map((f) => [f, want[f]]));
    if (!thu) await m.Block.updateOne({ _id: cur._id, companyId: cid }, { $set: set });
    await ghiNhatKy('block', String(cur._id), Object.fromEntries(doi.map((f) => [f, cur[f]])), set);
    kq.thayDoi.push({ loai: 'khoi', khoa: k.ma, viec: 'sua', chiTiet: doi.join(', ') });
  }

  // ── Phòng ──
  const deptId = new Map<string, Types.ObjectId>();
  for (const p of sd.phong) {
    const driveId = drives.get(p.so)!.driveId;
    const want: any = {
      code: p.ma,
      number: p.so,
      name: p.ten,
      blockId: p.khoi ? blockId.get(p.khoi) : undefined,
      driveId,
      securityLevel: p.baoMat,
      headId: p.truongPhong ? userId.get(p.truongPhong) : undefined,
      groupEmails: C1_NHOM_PHONG.map((n) => nhomPhong(p, n.hauTo, mien)),
    };
    const cur =
      (await m.Department.findOne({ companyId: cid, code: p.ma }).lean<any>()) ??
      (await m.Department.findOne({ companyId: cid, driveId }).lean<any>());
    if (!cur) {
      const id = new Types.ObjectId();
      if (!thu) await m.Department.create({ _id: id, companyId: cid, ...want });
      await ghiNhatKy('department', String(id), undefined, want);
      deptId.set(p.ma, id);
      kq.thayDoi.push({ loai: 'phong', khoa: `${p.so} ${p.ma}`, viec: 'tao', chiTiet: `${p.ten} · ${drives.get(p.so)!.name}` });
      continue;
    }
    deptId.set(p.ma, cur._id);
    const fields = ['code', 'number', 'name', 'blockId', 'driveId', 'securityLevel', 'headId'] as const;
    const doi: string[] = fields.filter((f) => want[f] !== undefined && !same(cur[f], want[f]));
    if ((cur.groupEmails ?? []).join(',') !== want.groupEmails.join(',')) doi.push('groupEmails');
    if (!doi.length) {
      kq.thayDoi.push({ loai: 'phong', khoa: `${p.so} ${p.ma}`, viec: 'giu' });
      continue;
    }
    const set = Object.fromEntries(doi.map((f) => [f, want[f]]));
    if (!thu) {
      try {
        await m.Department.updateOne({ _id: cur._id, companyId: cid }, { $set: set });
      } catch (e: any) {
        if (e?.code === 11000) throw new Error(`Phòng ${p.so} ${p.ma}: số/mã/drive trùng với phòng khác đã có trong CSDL (${JSON.stringify(e.keyValue)})`);
        throw e;
      }
    }
    await ghiNhatKy('department', String(cur._id), Object.fromEntries(doi.map((f) => [f, cur[f]])), set);
    kq.thayDoi.push({ loai: 'phong', khoa: `${p.so} ${p.ma}`, viec: 'sua', chiTiet: doi.join(', ') });
  }

  // ── Division ──
  for (const d of sd.division) {
    const cur = await m.Division.findOne({ companyId: cid, prefix: d.tienTo }).lean<any>();
    if (!cur) {
      const id = new Types.ObjectId();
      if (!thu) await m.Division.create({ _id: id, companyId: cid, prefix: d.tienTo, name: d.ten });
      await ghiNhatKy('division', String(id), undefined, { prefix: d.tienTo, name: d.ten });
      kq.thayDoi.push({ loai: 'division', khoa: d.tienTo, viec: 'tao', chiTiet: d.ten });
    } else if (cur.name !== d.ten) {
      if (!thu) await m.Division.updateOne({ _id: cur._id, companyId: cid }, { $set: { name: d.ten } });
      await ghiNhatKy('division', String(cur._id), { name: cur.name }, { name: d.ten });
      kq.thayDoi.push({ loai: 'division', khoa: d.tienTo, viec: 'sua', chiTiet: 'name' });
    } else kq.thayDoi.push({ loai: 'division', khoa: d.tienTo, viec: 'giu' });
  }

  // ── Vai trò, phòng của người ──
  const phongCuaTruong = new Map<string, Types.ObjectId>();
  for (const p of sd.phong) if (p.truongPhong && !phongCuaTruong.has(p.truongPhong)) phongCuaTruong.set(p.truongPhong, deptId.get(p.ma)!);
  for (const [email, roles] of vaiTro) {
    const u = nguoi.get(email);
    const manual: string[] = u.manualRoles ?? [];
    const them = [...roles].filter((r) => !manual.includes(r)).sort();
    const set: any = {};
    if (them.length) {
      set.manualRoles = [...new Set([...manual, ...them])].sort();
      set.systemRoles = [...new Set([...(u.groupRoles ?? []), ...set.manualRoles])].sort();
    }
    // Phòng tạm cho trưởng phòng khi chưa có nhóm Google (đồng bộ nhóm sẽ tính lại)
    if (!u.departmentId && phongCuaTruong.has(email)) set.departmentId = phongCuaTruong.get(email);
    if (!Object.keys(set).length) continue;
    if (!thu) await m.User.updateOne({ _id: u._id, companyId: cid }, { $set: set });
    await ghiNhatKy('user', String(u._id), { systemRoles: u.systemRoles, departmentId: u.departmentId }, { systemRoles: set.systemRoles, departmentId: set.departmentId });
    const chiTiet = [them.length ? `thêm ${them.join(', ')}` : '', set.departmentId ? 'gán phòng' : ''].filter(Boolean).join(', ');
    const daTao = kq.thayDoi.find((t) => t.loai === 'nguoi' && t.khoa === email);
    if (daTao) daTao.chiTiet += `; ${chiTiet}`;
    else kq.thayDoi.push({ loai: 'nguoi', khoa: email, viec: 'sua', chiTiet });
  }

  // ── Có trong CSDL mà không có trong file ──
  const maKhoi = new Set(sd.khoi.map((k) => k.ma));
  for (const b of await m.Block.find({ companyId: cid }).lean<any[]>()) if (!maKhoi.has(b.code)) kq.canhBao.push(`Khối ${b.code} có trong CSDL nhưng không có trong file (không xoá)`);
  const giuPhong = new Set([...deptId.values()].map(String));
  for (const d of await m.Department.find({ companyId: cid }).lean<any[]>())
    if (!giuPhong.has(String(d._id))) kq.canhBao.push(`Phòng ${d.number} ${d.code} có trong CSDL nhưng không có trong file (không xoá)`);
  const tienTo = new Set(sd.division.map((d) => d.tienTo));
  for (const d of await m.Division.find({ companyId: cid }).lean<any[]>()) if (!tienTo.has(d.prefix)) kq.canhBao.push(`Division ${d.prefix} có trong CSDL nhưng không có trong file (không xoá)`);
  const coVaiTro = await m.User.find({ companyId: cid, manualRoles: { $in: [...VAI_TRO_THEO_NGUOI, 'R2', 'R4'] } }).lean<any[]>();
  for (const u of coVaiTro) {
    const ngoai = (u.manualRoles as SystemRole[]).filter((r) => !vaiTro.get(u.email)?.has(r) && [...VAI_TRO_THEO_NGUOI, 'R2', 'R4'].includes(r));
    if (ngoai.length) kq.canhBao.push(`${u.email} đang giữ ${ngoai.join(', ')} (gán tay) mà file không ghi — giữ nguyên; gỡ ở màn hình Người dùng nếu cần`);
  }
  return kq;
}

export function inKetQuaNap(kq: KetQuaNap): string {
  const dong: string[] = [kq.thu ? 'CHẠY THỬ — chưa ghi gì vào CSDL' : 'Đã nạp sơ đồ tổ chức'];
  const nhan = { tao: 'tạo', sua: 'sửa', giu: 'giữ nguyên' };
  for (const loai of ['khoi', 'phong', 'division', 'nguoi'] as const) {
    const ds = kq.thayDoi.filter((t) => t.loai === loai);
    if (!ds.length) continue;
    const dem = (v: ThayDoi['viec']) => ds.filter((t) => t.viec === v).length;
    dong.push(`\n${{ khoi: 'Khối', phong: 'Phòng', division: 'Division', nguoi: 'Người' }[loai]}: tạo ${dem('tao')}, sửa ${dem('sua')}, giữ ${dem('giu')}`);
    for (const t of ds.filter((x) => x.viec !== 'giu')) dong.push(`  ${nhan[t.viec]} ${t.khoa}${t.chiTiet ? ` — ${t.chiTiet}` : ''}`);
  }
  if (kq.canhBao.length) dong.push(`\nCảnh báo (${kq.canhBao.length}):`, ...kq.canhBao.map((c) => `  - ${c}`));
  return dong.join('\n');
}

/** Dựng lại sơ đồ từ CSDL (drive ghi bằng id) — dùng khi báo cáo nhóm C1 không kèm file */
export async function soDoTuCsdl(m: Models, mien: string): Promise<SoDo> {
  const company = await m.Company.findOne({ domain: mien.toLowerCase() }).lean<any>();
  if (!company) throw new Error(`Chưa có công ty tên miền ${mien}`);
  const cid = company._id;
  const users = new Map((await m.User.find({ companyId: cid }, { email: 1, manualRoles: 1, systemRoles: 1 }).lean<any[]>()).map((u) => [String(u._id), u]));
  const blocks = await m.Block.find({ companyId: cid }).lean<any[]>();
  const depts = await m.Department.find({ companyId: cid }).sort({ number: 1 }).lean<any[]>();
  const vaiTro: SoDo['vaiTro'] = {};
  for (const r of VAI_TRO_THEO_NGUOI) vaiTro[r] = [...users.values()].filter((u) => (u.systemRoles ?? []).includes(r)).map((u) => u.email);
  return {
    khoi: blocks.map((b) => ({ ma: b.code, ten: b.name, giamDoc: users.get(String(b.directorId))?.email })),
    phong: depts.map((d) => ({
      so: d.number,
      ma: d.code,
      ten: d.name,
      drive: d.driveId,
      baoMat: d.securityLevel,
      khoi: blocks.find((b) => String(b._id) === String(d.blockId))?.code,
      truongPhong: users.get(String(d.headId))?.email,
    })),
    division: (await m.Division.find({ companyId: cid }).lean<any[]>()).map((d) => ({ tienTo: d.prefix, ten: d.name })),
    vaiTro,
  };
}
