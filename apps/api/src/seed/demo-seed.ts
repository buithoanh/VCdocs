import { Types } from 'mongoose';
import type { Models } from '../db/models';
import type { FakeGoogle } from '../google/fake/fake-google';
import { FOLDER_MIME, GDOC_MIME } from '../google/ports';
import { normalizeText } from '../common/util';

/**
 * Dữ liệu mẫu (giả) cho chạy local và test: 11 drive theo cây thư mục VCPV,
 * nhóm Google theo quy ước, người dùng mẫu (không phải người thật).
 */
export const DEMO_DOMAIN = 'vcprosperous.com';
const e = (local: string) => `${local}@${DEMO_DOMAIN}`;

export const DEMO_DEPTS = [
  { number: '00', code: 'VCPV', name: 'VCPV Chung', securityLevel: 'internal', block: 'VHNB', head: 'hcns' },
  { number: '01', code: 'BDH', name: 'Ban Điều hành', securityLevel: 'confidential', block: 'VHNB', head: 'tgd' },
  { number: '10', code: 'KD', name: 'Kinh doanh VCpart', securityLevel: 'department', block: 'KD', head: 'tp.kd' },
  { number: '11', code: 'MKT', name: 'Marketing', securityLevel: 'department', block: 'KD', head: 'tp.mkt' },
  { number: '12', code: 'IT', name: 'IT – Phần mềm', securityLevel: 'department', block: 'VHNB', head: 'it' },
  { number: '13', code: 'VCE', name: 'VCE – Đào tạo', securityLevel: 'department', block: 'KD' },
  { number: '14', code: 'XDV', name: 'Xưởng dịch vụ', securityLevel: 'department', block: 'KD' },
  { number: '20', code: 'MH', name: 'Mua hàng – NCC', securityLevel: 'confidential', block: 'KD' },
  { number: '21', code: 'TCKT', name: 'TC – KT', securityLevel: 'confidential', block: 'VHNB', head: 'ktt' },
  { number: '21b', code: 'LT', name: 'Lương – Thưởng', securityLevel: 'confidential', block: 'VHNB', head: 'tgd' },
  { number: '22', code: 'HCNS', name: 'HCNS', securityLevel: 'confidential', block: 'VHNB', head: 'hcns' },
] as const;

/** key → (tên, nhóm Google) */
export const DEMO_USERS: Record<string, { name: string; title: string; groups: string[] }> = {
  tgd: { name: 'Tổng giám đốc (mẫu)', title: 'Tổng giám đốc', groups: ['vcdocs-r1', '01-bdh-quan-ly', '21b-lt-quan-ly'] },
  'gdk.vhnb': { name: 'GĐ khối Vận hành nội bộ (mẫu)', title: 'Giám đốc khối', groups: ['vcdocs-r2', '22-hcns-xem'] },
  'gdk.kd': { name: 'GĐ khối Kinh doanh (mẫu)', title: 'Giám đốc khối', groups: ['vcdocs-r2', '10-kd-xem', '11-mkt-xem'] },
  hcns: { name: 'Kiểm soát tài liệu HCNS (mẫu)', title: 'Chuyên viên HCNS', groups: ['vcdocs-r3', '00-vcpv-quan-ly', '22-hcns-quan-ly'] },
  'tp.mkt': { name: 'Trưởng phòng MKT (mẫu)', title: 'Trưởng phòng', groups: ['11-mkt-quan-ly'] },
  'leader.mkt': { name: 'Leader SEO (mẫu)', title: 'Leader', groups: ['11-mkt-quan-ly-noi-dung'] },
  'nv.mkt': { name: 'Nhân viên MKT (mẫu)', title: 'Nhân viên', groups: ['11-mkt-dong-gop'] },
  'xem.mkt': { name: 'Thực tập MKT (mẫu)', title: 'Thực tập sinh', groups: ['11-mkt-xem'] },
  'tp.kd': { name: 'Trưởng phòng KD (mẫu)', title: 'Trưởng phòng', groups: ['10-kd-quan-ly'] },
  'nv.kd': { name: 'Nhân viên KD (mẫu)', title: 'Nhân viên', groups: ['10-kd-dong-gop'] },
  ktt: { name: 'Kế toán trưởng (mẫu)', title: 'Kế toán trưởng', groups: ['vcdocs-r8', '21-tckt-quan-ly'] },
  it: { name: 'Quản trị hệ thống (mẫu)', title: 'Trưởng phòng IT', groups: ['vcdocs-r9', '12-it-quan-ly'] },
};

const DRIVE_GROUP_ROLES = [
  ['quan-ly', 'organizer'],
  ['quan-ly-noi-dung', 'fileOrganizer'],
  ['dong-gop', 'writer'],
  ['nhan-xet', 'commenter'],
  ['xem', 'reader'],
] as const;

export const DEMO_CODES: [string, string, string][] = [
  ['MKT', 'department', 'Marketing'],
  ['KD', 'department', 'Kinh doanh'],
  ['HCNS', 'department', 'Hành chính nhân sự'],
  ['SEO', 'function', 'Tối ưu tìm kiếm'],
  ['SOCIAL', 'function', 'Mạng xã hội'],
  ['SAN', 'channel', 'Sàn thương mại điện tử'],
  ['MEDIA', 'function', 'Hình ảnh, video'],
  ['SEO-PTDA', 'channel', 'SEO phutungducanh.com'],
  ['SEO-FREY', 'channel', 'SEO Frey'],
  ['SEO-VCE', 'channel', 'SEO VCE'],
  ['SEO-ASP', 'channel', 'SEO ASP'],
  ['SEO-VCPV', 'channel', 'SEO VCPV'],
  ['TT-VCE', 'channel', 'TikTok VCE'],
  ['TT-KT4B', 'channel', 'TikTok KT4B'],
  ['FB-VCE', 'channel', 'Facebook VCE'],
  ['SAN-TTS', 'channel', 'Sàn TikTok Shop'],
  ['SAN-SPE', 'channel', 'Sàn Shopee'],
  ['DA-MAI', 'project', 'Dự án MAI'],
  ['DA-VDG', 'project', 'Dự án VDG'],
];

export interface DemoIds {
  companyId: string;
  users: Record<string, string>;
  emails: Record<string, string>;
  depts: Record<string, { id: string; driveId: string }>;
  folders: Record<string, string>;
  blocks: Record<string, string>;
  templates: Record<string, string>;
  recordTypes: Record<string, string>;
}

export const BM_KHUNG = `Mã: {{MA}} | Phiên bản: {{PHIEN_BAN}} | Trạng thái: {{TRANG_THAI}}
Người soạn: {{NGUOI_SOAN}} | Ngày hiệu lực: {{NGAY_HIEU_LUC}} | Phiếu duyệt: {{LINK_DUYET}}
Nội dung …`;

/** Danh bạ Google giả: người dùng mẫu và nhóm theo quy ước */
export function addDemoDirectory(fake: FakeGoogle) {
  const groupMembers = new Map<string, string[]>();
  for (const [key, u] of Object.entries(DEMO_USERS)) {
    fake.addUser({ email: e(key), name: u.name, title: u.title, suspended: false });
    for (const g of [...u.groups, '00-vcpv-xem']) {
      if (!groupMembers.has(g)) groupMembers.set(g, []);
      groupMembers.get(g)!.push(e(key));
    }
  }
  for (const d of DEMO_DEPTS) {
    const prefix = `${d.number}-${d.code.toLowerCase()}`;
    for (const [suffix] of DRIVE_GROUP_ROLES) if (!groupMembers.has(`${prefix}-${suffix}`)) groupMembers.set(`${prefix}-${suffix}`, []);
  }
  for (let i = 1; i <= 9; i++) if (!groupMembers.has(`vcdocs-r${i}`)) groupMembers.set(`vcdocs-r${i}`, []);
  for (const [g, members] of groupMembers) fake.addGroup(e(g), g, members);
}

/** Bộ nhớ dùng chung giả của một phòng, quyền cấp qua nhóm Google */
export function addDemoDrive(fake: FakeGoogle, d: { number: string; code: string; name: string; securityLevel: string }, driveId = `drv-${d.number}`) {
  const prefix = `${d.number}-${d.code.toLowerCase()}`;
  fake.addDrive(driveId, `${d.number} ${d.name}${d.securityLevel === 'confidential' ? ' [MẬT]' : ''}`, [
    ...DRIVE_GROUP_ROLES.map(([suffix, role]) => ({ type: 'group' as const, emailAddress: e(`${prefix}-${suffix}`), role: role as any })),
    ...(d.number === '00' ? [{ type: 'group' as const, emailAddress: e('00-vcpv-xem'), role: 'reader' as const }] : []),
    // Ban Điều hành là Người xem ở drive phòng khác (cây thư mục VCPV mục 3.6)
    ...(d.number !== '01' ? [{ type: 'group' as const, emailAddress: e('vcdocs-r1'), role: 'reader' as const }] : []),
  ]);
}

export async function seedDemo(m: Models, fake: FakeGoogle): Promise<DemoIds> {
  const companyRow = await m.Company.create({ name: 'VC Phồn Vinh', domain: DEMO_DOMAIN, settings: {} });
  const cid = companyRow._id as Types.ObjectId;
  const ids: DemoIds = { companyId: String(cid), users: {}, emails: {}, depts: {}, folders: {}, blocks: {}, templates: {}, recordTypes: {} };

  // Google giả: người dùng, nhóm Google
  addDemoDirectory(fake);

  // Users trong VCdocs (vai trò, phòng được tính lại khi đăng nhập/đồng bộ)
  for (const [key, u] of Object.entries(DEMO_USERS)) {
    const row = await m.User.create({ companyId: cid, email: e(key), name: u.name, title: u.title });
    ids.users[key] = String(row._id);
    ids.emails[key] = e(key);
  }
  for (const [code, name, dir] of [
    ['VHNB', 'Khối Vận hành nội bộ', 'gdk.vhnb'],
    ['KD', 'Khối Kinh doanh', 'gdk.kd'],
  ]) {
    const b = await m.Block.create({ companyId: cid, code, name, directorId: new Types.ObjectId(ids.users[dir]) });
    ids.blocks[code] = String(b._id);
  }
  for (const [prefix, name] of [
    ['VCP', 'VCpart'],
    ['VCSO', 'VCsoft'],
    ['VCE', 'VCedu'],
    ['VCSE', 'VCservice'],
    ['VCPV', 'Việc chung VC Phồn Vinh'],
  ]) {
    await m.Division.create({ companyId: cid, prefix, name });
  }

  const folder = async (key: string, p: { driveId: string; parentKey?: string; number?: string; code?: string; shortName: string; fullName?: string; kind: string; securityLevel: string; hasPeriods?: boolean }) => {
    const parentId = p.parentKey ? ids.folders[p.parentKey] : undefined;
    const parent = parentId ? await m.Folder.findOne({ _id: parentId, companyId: cid }).lean<any>() : undefined;
    const token = p.code ? (p.shortName && !p.code.toLowerCase().includes(p.shortName.toLowerCase()) ? `${p.code}-${p.shortName}` : p.code) : p.shortName;
    const name = [p.number, token, p.fullName].filter(Boolean).join(' ');
    const g = await fake.drive.createFolder({ driveId: p.driveId, parentGoogleId: parent?.googleId, name });
    const deptLabel = DEMO_DEPTS.find((d) => `drv-${d.number}` === p.driveId)!;
    const path = parent ? `${parent.path} / ${name}` : `${deptLabel.number} ${deptLabel.code} / ${name}`;
    const row = await m.Folder.create({
      companyId: cid,
      driveId: p.driveId,
      googleId: g.fileId,
      parentId: parentId ? new Types.ObjectId(parentId) : undefined,
      number: p.number ?? '',
      code: p.code,
      shortName: p.shortName,
      fullName: p.fullName ?? '',
      name,
      kind: p.kind,
      path,
      securityLevel: p.securityLevel,
      status: 'active',
      isManagedByVcdocs: true,
      hasPeriods: !!p.hasPeriods,
    });
    if (p.number) await m.FolderNumber.create({ companyId: cid, parentKey: parentId ?? `root:${p.driveId}`, number: p.number });
    ids.folders[key] = String(row._id);
    return row;
  };

  for (const d of DEMO_DEPTS) {
    const driveId = `drv-${d.number}`;
    const prefix = `${d.number}-${d.code.toLowerCase()}`;
    addDemoDrive(fake, d);
    const dept = await m.Department.create({
      companyId: cid,
      code: d.code,
      number: d.number,
      name: d.name,
      blockId: new Types.ObjectId(ids.blocks[d.block]),
      driveId,
      securityLevel: d.securityLevel,
      headId: 'head' in d && d.head ? new Types.ObjectId(ids.users[d.head]) : undefined,
      groupEmails: DRIVE_GROUP_ROLES.map(([s]) => e(`${prefix}-${s}`)),
    });
    ids.depts[d.code] = { id: String(dept._id), driveId };
    const sl = d.securityLevel;
    const k = (x: string) => `${d.code}:${x}`;
    await folder(k('00'), { driveId, number: '00', shortName: d.number === '00' ? 'Tài liệu hệ thống' : 'Tài liệu', kind: 'docs', securityLevel: sl });
    if (d.number === '00') await folder(k('00/01'), { driveId, parentKey: k('00'), number: '01', code: 'QĐ', shortName: 'QĐ', kind: 'docs', securityLevel: sl });
    await folder(k('00/02'), { driveId, parentKey: k('00'), number: '02', code: 'QT', shortName: 'QT', kind: 'docs', securityLevel: sl });
    await folder(k('00/03'), { driveId, parentKey: k('00'), number: '03', code: 'HD', shortName: 'HD', kind: 'docs', securityLevel: sl });
    await folder(k('00/04'), { driveId, parentKey: k('00'), number: '04', code: 'BM', shortName: 'BM', kind: 'docs', securityLevel: sl });
    await folder(k('00/99'), { driveId, parentKey: k('00'), number: '99', shortName: 'Hết hiệu lực', kind: 'archive', securityLevel: sl });
    await folder(k('01'), { driveId, number: '01', shortName: d.number === '00' ? 'Danh mục tài liệu – hồ sơ' : 'Kế hoạch – Báo cáo', kind: 'plan_report', securityLevel: sl, hasPeriods: d.number !== '00' });
    if (d.number !== '00') await folder(k('98'), { driveId, number: '98', shortName: 'Đã kết thúc', kind: 'closed', securityLevel: sl });
    await folder(k('99'), { driveId, number: '99', shortName: 'Lưu trữ', kind: 'archive', securityLevel: sl });
  }
  // Phòng mẫu 11 MKT
  const mkt = ids.depts.MKT.driveId;
  await folder('MKT:10', { driveId: mkt, number: '10', code: 'SEO', shortName: 'SEO', kind: 'area', securityLevel: 'department', hasPeriods: true });
  await folder('MKT:10/01', { driveId: mkt, parentKey: 'MKT:10', number: '01', code: 'SEO-PTDA', shortName: 'PTDA', fullName: 'phutungducanh.com', kind: 'area', securityLevel: 'department', hasPeriods: true });
  await folder('MKT:20', { driveId: mkt, number: '20', code: 'SOCIAL', shortName: 'Social', kind: 'area', securityLevel: 'department' });
  await folder('MKT:30', { driveId: mkt, number: '30', code: 'SAN', shortName: 'Sàn TMĐT', kind: 'area', securityLevel: 'department' });
  await folder('MKT:40', { driveId: mkt, number: '40', code: 'MEDIA', shortName: 'Media', kind: 'area', securityLevel: 'department' });
  await folder('MKT:50', { driveId: mkt, number: '50', code: 'DA-MAI', shortName: 'MAI', kind: 'project', securityLevel: 'department' });
  await folder('MKT:51', { driveId: mkt, number: '51', code: 'DA-VDG', shortName: 'VDG', kind: 'project', securityLevel: 'department' });

  const r1 = new Types.ObjectId(ids.users.tgd);
  for (const [code, type, meaning] of DEMO_CODES) {
    await m.Code.create({
      companyId: cid,
      code,
      type,
      meaning,
      status: 'approved',
      departmentId: code.startsWith('SEO') || code.startsWith('TT-') || code.startsWith('FB-') || code.startsWith('SAN') || code.startsWith('DA-') ? new Types.ObjectId(ids.depts.MKT.id) : undefined,
      decision: { by: r1, at: new Date(), result: 'approve' },
      searchText: normalizeText(`${code} ${meaning}`),
    });
  }

  // Biểu mẫu khung đang hiệu lực: BM-VCPV-02 (QĐ), 03 (QT), 04 (HD) – có chỗ giữ {{MA}}…
  const chung = ids.depts.VCPV;
  const bmFolder = await m.Folder.findOne({ _id: ids.folders['VCPV:00/04'], companyId: cid }).lean<any>();
  for (const [n, title] of [
    ['02', 'Biểu mẫu khung Quy định'],
    ['03', 'Biểu mẫu khung Quy trình'],
    ['04', 'Biểu mẫu khung Hướng dẫn'],
  ]) {
    const code = `BM-VCPV-${n}`;
    const f = await fake.drive.createEmptyDoc({ parentGoogleId: bmFolder.googleId, name: `${code} v1 ${title}`, mimeType: GDOC_MIME });
    fake.world.files[f.fileId].text = BM_KHUNG;
    await fake.drive.setLock(f.fileId, { locked: true, reason: 'Biểu mẫu gốc' });
    const rev = await fake.drive.latestRevision(f.fileId);
    const doc = await m.Document.create({
      companyId: cid,
      code,
      type: 'BM',
      level: 'VCPV',
      title,
      departmentId: new Types.ObjectId(chung.id),
      status: 'effective',
      securityLevel: 'internal',
      driveId: chung.driveId,
      drafterId: new Types.ObjectId(ids.users.hcns),
      approverId: new Types.ObjectId(ids.users['gdk.vhnb']),
      folderId: bmFolder._id,
      fileId: f.fileId,
      current: { number: 1, fileId: f.fileId, revisionId: rev.revisionId, effectiveFrom: '2026-10-01', issuedBy: new Types.ObjectId(ids.users.hcns) },
      versions: [{ number: 1, kind: 'major', changeNote: 'Ban hành lần đầu', effectiveFrom: '2026-10-01', revisionId: rev.revisionId }],
      lock: { isLocked: true, lockedAt: new Date() },
      reviewDue: '2027-10-01',
      searchText: normalizeText(`${code} ${title}`),
    });
    ids.templates[code] = String(doc._id);
  }
  await m.Counter.create({ companyId: cid, key: 'doc:BM-VCPV', seq: 8 });

  // Loại hồ sơ mẫu của 11 MKT (thời hạn đã duyệt)
  const rt = async (key: string, p: any) => {
    const row = await m.RecordType.create({ companyId: cid, departmentId: new Types.ObjectId(ids.depts.MKT.id), retentionStatus: 'approved', securityLevel: 'department', ...p });
    ids.recordTypes[key] = String(row._id);
  };
  await rt('seoPlan', { name: 'Kế hoạch SEO tháng', kind: 'KH', namingRule: '[Mã] KH Nội dung – YYYY-MM-DD', example: 'SEO-PTDA KH Kế hoạch SEO tháng 10 – 2026-10-01', folderId: new Types.ObjectId(ids.folders['MKT:10']), keeperTitle: 'Leader SEO', retentionYears: 5, retentionBasis: 'QĐ-VCPV-01', disposalMethod: 'Xoá trên Drive', requiresApproval: false });
  await rt('seoReport', { name: 'Báo cáo SEO tháng', kind: 'BC', namingRule: '[Mã] BC Nội dung – YYYY-MM-DD', folderId: new Types.ObjectId(ids.folders['MKT:10']), keeperTitle: 'Leader SEO', retentionYears: 5, retentionBasis: 'QĐ-VCPV-01', disposalMethod: 'Xoá trên Drive', requiresApproval: true });

  await m.Company.updateOne({ _id: cid }, { $set: { settings: { ceoUserId: String(r1), internalOpsBlockId: ids.blocks.VHNB } } });
  void FOLDER_MIME;
  return ids;
}
