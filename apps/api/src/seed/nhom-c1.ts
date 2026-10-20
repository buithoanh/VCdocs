import type { GooglePorts } from '../google/ports';
import { DRIVE_ROLE_RANK, DriveRole, SYSTEM_ROLES, SystemRole } from '../common/enums';
import { C1_NHOM_PHONG, SoDo, nhomHeThong, nhomPhong, timDrive, vaiTroTheoNguoi } from './so-do-to-chuc';

/**
 * Đối chiếu nhóm Google cần có theo mẫu C1 (hợp đồng mục 9.3) với Directory và
 * quyền trên shared drive. Chỉ đọc Google, không tạo/sửa gì (IT tạo nhóm).
 */
export interface NhomCanCo {
  email: string;
  vaiTro: SystemRole | '—';
  /** Drive nhóm phải là thành viên và vai trò trên drive đó */
  drive?: { so: string; name: string; driveId: string; vaiTro: DriveRole };
  /** Người theo sơ đồ nên là thành viên */
  nenCo: string[];
}

export interface BaoCaoC1 {
  mien: string;
  canCo: (NhomCanCo & {
    daCo: boolean;
    thanhVien?: string[];
    /** Vai trò thật của nhóm trên drive (undefined = chưa gắn) */
    vaiTroDriveThat?: DriveRole | 'owner';
    thieuThanhVien: string[];
  })[];
  /** Nhóm đúng dạng C1 nhưng không có trong sơ đồ */
  thua: string[];
  /** Nhóm khác trong Directory (không theo C1) */
  khac: string[];
}

export async function baoCaoNhomC1(google: GooglePorts, sd: SoDo, mien: string): Promise<BaoCaoC1> {
  mien = mien.toLowerCase();
  const drives = await timDrive(google, sd);
  const canCo: NhomCanCo[] = [];
  for (const p of sd.phong) {
    const d = drives.get(p.so)!;
    for (const n of C1_NHOM_PHONG) {
      canCo.push({
        email: nhomPhong(p, n.hauTo, mien),
        // Nhóm "xem" của drive Nội bộ là cả công ty: không tính vai trò
        vaiTro: p.baoMat === 'internal' && n.hauTo === 'xem' ? '—' : n.vaiTro,
        drive: { so: p.so, name: d.name, driveId: d.driveId, vaiTro: n.vaiTroDrive },
        nenCo: n.hauTo === 'quan-ly' && p.truongPhong ? [p.truongPhong] : [],
      });
    }
  }
  const theoNguoi = vaiTroTheoNguoi(sd);
  for (const r of SYSTEM_ROLES) {
    canCo.push({ email: nhomHeThong(r, mien), vaiTro: r, nenCo: [...theoNguoi].filter(([, rs]) => rs.has(r)).map(([e]) => e) });
  }

  const coSan = new Map((await google.directory.listGroups(mien)).map((g) => [g.email.toLowerCase(), g]));
  const quyen = new Map<string, Map<string, DriveRole | 'owner'>>();
  for (const d of drives.values()) {
    const m = new Map<string, DriveRole | 'owner'>();
    for (const p of await google.drive.listDrivePermissions(d.driveId)) if (p.type === 'group' && p.emailAddress) m.set(p.emailAddress.toLowerCase(), p.role);
    quyen.set(d.driveId, m);
  }
  const out: BaoCaoC1 = { mien, canCo: [], thua: [], khac: [] };
  for (const n of canCo) {
    const daCo = coSan.has(n.email);
    const thanhVien = daCo ? (await google.directory.listGroupMembers(n.email)).map((x) => x.toLowerCase()) : undefined;
    out.canCo.push({
      ...n,
      daCo,
      thanhVien,
      vaiTroDriveThat: n.drive ? quyen.get(n.drive.driveId)?.get(n.email) : undefined,
      thieuThanhVien: n.nenCo.filter((e) => !thanhVien?.includes(e)),
    });
  }
  const can = new Set(canCo.map((n) => n.email));
  const dangC1 = new RegExp(`^(\\d{2}b?-[a-z0-9]+-(quan-ly-noi-dung|quan-ly|dong-gop|nhan-xet|xem)|vcdocs-r[1-9])@${mien.replace(/\./g, '\\.')}$`);
  for (const e of [...coSan.keys()].sort()) {
    if (can.has(e)) continue;
    (dangC1.test(e) ? out.thua : out.khac).push(e);
  }
  return out;
}

export function inBaoCaoC1(bc: BaoCaoC1): string {
  const thieu = bc.canCo.filter((n) => !n.daCo);
  const saiDrive = bc.canCo.filter((n) => n.daCo && n.drive && n.vaiTroDriveThat !== n.drive.vaiTro);
  const thieuNguoi = bc.canCo.filter((n) => n.daCo && n.thieuThanhVien.length);
  const d: string[] = [
    `# Nhóm Google theo mẫu C1 — ${bc.mien}`,
    '',
    `Cần ${bc.canCo.length} nhóm · đã có ${bc.canCo.length - thieu.length} · thiếu ${thieu.length} · gắn drive sai/chưa gắn ${saiDrive.length} · thiếu người ${thieuNguoi.length} · thừa ${bc.thua.length}`,
    '',
    '## Danh sách nhóm cần có',
    '',
    '| Nhóm | Vai trò VCdocs | Drive · vai trò drive | Trạng thái | Người theo sơ đồ nên có |',
    '|---|---|---|---|---|',
  ];
  const tenVaiTroDrive: Record<string, string> = {
    organizer: 'Quản lý',
    fileOrganizer: 'Quản lý nội dung',
    writer: 'Người đóng góp',
    commenter: 'Người nhận xét',
    reader: 'Người xem',
    owner: 'Chủ sở hữu',
  };
  for (const n of bc.canCo) {
    const trangThai: string[] = [];
    if (!n.daCo) trangThai.push('**thiếu nhóm**');
    else {
      trangThai.push(`có (${n.thanhVien!.length} người)`);
      if (n.drive && !n.vaiTroDriveThat) trangThai.push('**chưa gắn vào drive**');
      else if (n.drive && n.vaiTroDriveThat !== n.drive.vaiTro)
        trangThai.push(
          `**drive đang là ${tenVaiTroDrive[n.vaiTroDriveThat!]}**${DRIVE_ROLE_RANK[n.vaiTroDriveThat as DriveRole] > DRIVE_ROLE_RANK[n.drive.vaiTro] ? ' (cao hơn mẫu)' : ''}`,
        );
      if (n.thieuThanhVien.length) trangThai.push(`**thiếu ${n.thieuThanhVien.join(', ')}**`);
    }
    const drive = n.drive ? `${n.drive.name} · ${tenVaiTroDrive[n.drive.vaiTro]}` : '—';
    d.push(`| ${n.email} | ${n.vaiTro} | ${drive} | ${trangThai.join('; ')} | ${n.nenCo.join(', ') || ''} |`);
  }
  if (bc.thua.length) d.push('', '## Nhóm đúng dạng C1 nhưng không có trong sơ đồ (thừa)', '', ...bc.thua.map((e) => `- ${e}`));
  if (bc.khac.length) d.push('', '## Nhóm khác trong Directory (VCdocs bỏ qua)', '', ...bc.khac.map((e) => `- ${e}`));
  d.push(
    '',
    '## Ghi chú',
    '',
    '- Nhóm "xem" của drive Nội bộ (bảo mật internal) không cấp vai trò VCdocs; mọi người đăng nhập đều xem được drive Nội bộ.',
    '- Báo cáo này chỉ đọc Google. Tạo nhóm, thêm người, gắn nhóm vào drive do IT làm trên admin.google.com / Drive.',
    '- Sau khi IT tạo nhóm: R9 bấm "Đồng bộ Google" (POST /sync/google) để VCdocs tính lại vai trò, phòng, quyền drive.',
  );
  return d.join('\n');
}
