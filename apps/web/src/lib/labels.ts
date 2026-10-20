import { formatNumber } from './format';
import type {
  ApprovalObjectType,
  Job,
  ApprovalStatus,
  CodeStatus,
  CodeType,
  DocumentLevel,
  DocumentStatus,
  DocumentType,
  DriveRole,
  AuditorAccessStatus,
  FolderKind,
  HandoverItemAction,
  HandoverItemKind,
  HandoverItemStatus,
  HandoverStatus,
  JobStatus,
  NotificationChannel,
  RecordKind,
  RecordStatus,
  SecurityLevel,
  ShareRole,
  ShareStatus,
  SystemRole,
  UserStatus,
} from '@/api/types';

/** Tên tiếng Việt cho các giá trị cố định (hợp đồng mục 2). */

export const roleLabel: Record<SystemRole, string> = {
  R1: 'Ban Điều hành',
  R2: 'Giám đốc khối',
  R3: 'Kiểm soát tài liệu',
  R4: 'Trưởng phòng',
  R5: 'Leader',
  R6: 'Nhân viên',
  R7: 'Người xem',
  R8: 'Kế toán trưởng',
  R9: 'Quản trị hệ thống',
};

export const driveRoleLabel: Record<DriveRole, string> = {
  organizer: 'Quản lý',
  fileOrganizer: 'Quản lý nội dung',
  writer: 'Đóng góp',
  commenter: 'Nhận xét',
  reader: 'Người xem',
};

export const securityLabel: Record<SecurityLevel, string> = {
  internal: 'Nội bộ',
  department: 'Phòng ban',
  confidential: 'Mật',
};

export const docTypeLabel: Record<DocumentType, string> = {
  QD: 'Quy định',
  QT: 'Quy trình',
  HD: 'Hướng dẫn',
  BM: 'Biểu mẫu',
  EXT: 'Tài liệu bên ngoài',
};

export const docLevelLabel: Record<DocumentLevel, string> = {
  VCPV: 'Cấp công ty (VCPV)',
  DEPT: 'Cấp phòng',
};

export const docStatusLabel: Record<DocumentStatus, string> = {
  registered: 'Đã đăng ký',
  coded: 'Đã cấp mã',
  drafting: 'Đang soạn',
  feedback: 'Đang lấy góp ý',
  submitted: 'Chờ phê duyệt',
  approved: 'Đã duyệt, chờ ban hành',
  effective: 'Hiệu lực',
  revising: 'Đang sửa đổi',
  withdrawn: 'Hết hiệu lực',
};

export const recordKindLabel: Record<RecordKind, string> = {
  KH: 'Kế hoạch',
  BC: 'Báo cáo',
  DX: 'Đề xuất',
  TD: 'Trình duyệt',
  GV: 'Giao việc',
  BB: 'Biên bản',
  TB: 'Thông báo',
  OPS: 'Hồ sơ vận hành',
};

export const recordStatusLabel: Record<RecordStatus, string> = {
  drafting: 'Đang lập',
  submitted: 'Chờ phê duyệt',
  finalized: 'Đã chốt',
  held: 'Giữ lại',
  disposal_proposed: 'Đề nghị huỷ',
  disposed: 'Đã huỷ',
};

export const approvalObjectLabel: Record<ApprovalObjectType, string> = {
  document: 'Tài liệu',
  document_withdrawal: 'Huỷ bỏ tài liệu',
  record: 'Hồ sơ',
  code: 'Mã mới',
  retention: 'Thời hạn lưu',
  external_share: 'Chia sẻ ra ngoài',
  disposal: 'Huỷ hồ sơ',
  delegation: 'Uỷ quyền',
};

export const approvalStatusLabel: Record<ApprovalStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã đồng ý',
  changes_requested: 'Yêu cầu sửa',
  cancelled: 'Đã rút',
  expired: 'Quá hạn',
  invalidated: 'Mất hiệu lực (file đã đổi)',
};

export const folderKindLabel: Record<FolderKind, string> = {
  docs: 'Tài liệu (00)',
  plan_report: 'Kế hoạch – báo cáo (01)',
  operations: 'Hồ sơ vận hành (02–09)',
  area: 'Mảng (10–49)',
  project: 'Dự án (50–89)',
  closed: 'Đã kết thúc (98)',
  archive: 'Hết hiệu lực (99)',
  year: 'Năm',
  month: 'Tháng',
  entity: 'Đối tượng',
};

export const shareStatusLabel: Record<ShareStatus, string> = {
  pending_approval: 'Chờ trưởng phòng duyệt',
  active: 'Đang chia sẻ',
  expired: 'Đã hết hạn',
  revoked: 'Đã gỡ',
};

export const shareRoleLabel: Record<ShareRole, string> = {
  reader: 'Chỉ xem',
  commenter: 'Xem và nhận xét',
};

export const codeTypeLabel: Record<CodeType, string> = {
  department: 'Phòng',
  function: 'Chức năng',
  channel: 'Kênh',
  project: 'Dự án / đối tượng',
  division: 'Division',
};

export const codeStatusLabel: Record<CodeStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Không duyệt',
  retired: 'Ngừng dùng',
};

export const userStatusLabel: Record<UserStatus, string> = {
  active: 'Đang làm việc',
  leaving: 'Sắp nghỉ',
  left: 'Đã nghỉ',
};

export const jobStatusLabel: Record<JobStatus, string> = {
  queued: 'Đang chờ',
  running: 'Đang chạy',
  done: 'Xong',
  failed: 'Lỗi',
};

export const channelLabel: Record<NotificationChannel, string> = {
  inapp: 'Trong ứng dụng',
  email: 'Email',
  zalo: 'Zalo',
};

/* ── M10 Bàn giao (hợp đồng mục 10, E5, E7) ── */

export const handoverStatusLabel: Record<HandoverStatus, string> = {
  listing: 'Đang liệt kê',
  open: 'Chờ người nhận',
  received: 'Người nhận đã nhận',
  verified: 'HCNS đã kiểm tra',
  executing: 'Đang chuyển quyền',
  done: 'Xong',
  cancelled: 'Đã huỷ',
};

export const handoverItemKindLabel: Record<HandoverItemKind, string> = {
  document: 'Tài liệu',
  record: 'Hồ sơ',
  approval_to_decide: 'Phiếu chờ người nghỉ duyệt',
  approval_submitted: 'Phiếu người nghỉ đã trình',
  external_share: 'Chia sẻ ra ngoài',
  delegation: 'Uỷ quyền',
  my_drive_file: 'File trong Drive của tôi',
  group_membership: 'Nhóm Google',
};

export const handoverItemActionLabel: Record<HandoverItemAction, string> = {
  reassign: 'Đổi người',
  revoke: 'Gỡ',
  end: 'Kết thúc',
  transfer: 'Chuyển sở hữu Google',
  remove: 'Gỡ khỏi nhóm',
  keep: 'Để nguyên',
};

/** Cách xử lý hợp với từng loại dòng, cách đầu là mặc định (HandoverItemAction, E5). */
export const handoverActionsByKind: Record<HandoverItemKind, HandoverItemAction[]> = {
  document: ['reassign', 'keep'],
  record: ['reassign', 'keep'],
  approval_to_decide: ['reassign', 'keep'],
  approval_submitted: ['reassign', 'keep'],
  external_share: ['reassign', 'revoke'],
  delegation: ['end', 'keep'],
  my_drive_file: ['transfer'],
  group_membership: ['remove', 'keep'],
};

export const handoverItemStatusLabel: Record<HandoverItemStatus, string> = {
  pending: 'Chờ làm',
  done: 'Đã làm',
  skipped: 'Bỏ qua',
  failed: 'Lỗi',
};

/* ── M15 Nhật ký (hợp đồng mục 10, E13–E17) ── */

export const auditorAccessStatusLabel: Record<AuditorAccessStatus, string> = {
  active: 'Đang hiệu lực',
  expired: 'Đã hết hạn',
  revoked: 'Đã thu hồi',
};

export const chainStatusLabel = { ok: 'Chuỗi nguyên vẹn', broken: 'Chuỗi bị lệch', never: 'Chưa kiểm lần nào' } as const;

export const auditResultLabel = { ok: 'Thành công', denied: 'Bị từ chối' } as const;

export const auditObjectTypeLabel: Record<string, string> = {
  user: 'Nhân sự',
  document: 'Tài liệu',
  record: 'Hồ sơ',
  record_type: 'Loại hồ sơ',
  folder: 'Thư mục',
  approval: 'Phiếu duyệt',
  external_share: 'Chia sẻ ngoài',
  code: 'Mã',
  delegation: 'Uỷ quyền',
  department: 'Phòng',
  block: 'Khối',
  division: 'Division',
  handover: 'Bàn giao',
  auditor_access: 'Quyền xem tạm',
  evidence_pack: 'Gói bằng chứng',
};

export function label<K extends string>(map: Record<K, string>, value: K | undefined | null): string {
  if (!value) return '—';
  return map[value] ?? value;
}

/** Màu thẻ trạng thái: xanh = xong, vàng = chờ, xám = nháp, đỏ = lỗi / hết hiệu lực. */
export type Tone = 'green' | 'amber' | 'grey' | 'red' | 'blue';

const toneMap: Record<string, Tone> = {
  effective: 'green',
  approved: 'green',
  finalized: 'green',
  active: 'green',
  done: 'green',
  submitted: 'amber',
  pending: 'amber',
  pending_approval: 'amber',
  feedback: 'amber',
  running: 'blue',
  queued: 'blue',
  revising: 'blue',
  held: 'blue',
  changes_requested: 'red',
  withdrawn: 'red',
  rejected: 'red',
  failed: 'red',
  invalidated: 'red',
  revoked: 'grey',
  expired: 'grey',
  cancelled: 'grey',
  disposed: 'grey',
  disposal_proposed: 'amber',
  listing: 'blue',
  open: 'amber',
  received: 'amber',
  verified: 'blue',
  executing: 'blue',
  skipped: 'grey',
  ok: 'green',
  broken: 'red',
  never: 'grey',
  denied: 'red',
};

export function toneOf(status: string | undefined): Tone {
  return (status && toneMap[status]) || 'grey';
}

/** Tên việc chạy nền theo enum Job.type (D11). */
export const jobTypeLabel: Record<Job['type'], string> = {
  'document.withdraw': 'Huỷ bỏ tài liệu',
  'google.sync': 'Đồng bộ nhân sự Google',
  'codes.export': 'Xuất Bảng mã',
  'folder.create': 'Tạo thư mục',
  'folder.close_project': 'Kết thúc dự án',
  'folder.ensure_periods': 'Tạo thư mục năm, tháng',
  'document.create_draft': 'Tạo file nháp tài liệu',
  'document.issue': 'Ban hành tài liệu',
  'documents.catalog_export': 'Xuất Danh mục tài liệu',
  'external_document.import': 'Nhập tài liệu bên ngoài',
  'record_types.catalog_export': 'Xuất Danh mục hồ sơ',
  'record.create': 'Lập hồ sơ',
  'record.upload': 'Tải file hồ sơ',
  'record.claim': 'Đăng ký file có sẵn',
  'record.finalize': 'Chốt hồ sơ',
  'record.scan': 'Gắn bản scan',
  'share.revoke_all': 'Gỡ hết chia sẻ ngoài',
  'handover.list': 'Liệt kê bàn giao',
  'handover.execute': 'Chuyển quyền bàn giao',
  'handover.export': 'Xuất biên bản bàn giao',
  'audit.verify': 'Kiểm chuỗi nhật ký',
  'audit.anchor': 'Neo nhật ký',
  'evidence_pack.build': 'Lập gói bằng chứng',
};

export function jobTypeText(type?: string): string {
  return (type && jobTypeLabel[type as Job['type']]) || 'Việc chạy nền';
}

export const retentionStatusLabel = { draft: 'Nháp – chưa lập được hồ sơ', submitted: 'Đang trình duyệt', approved: 'Đã duyệt' } as const;

export function retentionText(years?: number) {
  if (years === undefined) return '—';
  return years === 0 ? 'Vĩnh viễn' : `${years} năm`;
}

export const holdReasonLabel = {
  dispute: 'Tranh chấp',
  inspection: 'Thanh tra, kiểm toán',
  warranty: 'Bảo hành',
  receivable: 'Công nợ',
  contract_open: 'Hợp đồng chưa thanh lý',
  board_request: 'Ban Điều hành yêu cầu',
} as const;
export type HoldReasonType = keyof typeof holdReasonLabel;

/** Job.summary (D16) → một câu ngắn, vd { created: 12, skipped: 1 } → "Đã tạo 12 · bỏ qua 1". */
const summaryWords: Record<string, string> = {
  created: 'tạo',
  updated: 'cập nhật',
  deleted: 'xoá',
  removed: 'bỏ',
  revoked: 'gỡ',
  skipped: 'bỏ qua',
  failed: 'lỗi',
  moved: 'chuyển',
  renamed: 'đổi tên',
  notified: 'gửi thông báo',
  users: 'nhân sự',
  groups: 'nhóm',
  members: 'thành viên',
  folders: 'thư mục',
  files: 'file',
  rows: 'dòng',
  total: 'tổng',
};

export function jobSummaryText(summary: Record<string, unknown> | undefined | null): string | undefined {
  if (!summary) return undefined;
  // Chỉ lấy số liệu có tên quen thuộc; trường kỹ thuật (googleId, name…) không hiện cho người dùng.
  const parts = Object.entries(summary)
    .filter(([k, v]) => typeof v === 'number' && k in summaryWords)
    .map(([k, v]) => `${summaryWords[k]} ${formatNumber(v as number)}`);
  if (!parts.length) return undefined;
  const text = parts.join(' · ');
  return `Đã ${text}.`;
}
