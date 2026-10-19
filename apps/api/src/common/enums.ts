export const SYSTEM_ROLES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const DRIVE_ROLES = ['organizer', 'fileOrganizer', 'writer', 'commenter', 'reader'] as const;
export type DriveRole = (typeof DRIVE_ROLES)[number];
/** Thứ hạng vai trò drive, càng lớn càng nhiều quyền */
export const DRIVE_ROLE_RANK: Record<DriveRole, number> = {
  reader: 1,
  commenter: 2,
  writer: 3,
  fileOrganizer: 4,
  organizer: 5,
};
export function maxDriveRole(a?: DriveRole, b?: DriveRole): DriveRole | undefined {
  if (!a) return b;
  if (!b) return a;
  return DRIVE_ROLE_RANK[a] >= DRIVE_ROLE_RANK[b] ? a : b;
}
export function driveRoleAtLeast(role: DriveRole | undefined, min: DriveRole): boolean {
  return !!role && DRIVE_ROLE_RANK[role] >= DRIVE_ROLE_RANK[min];
}

export type SecurityLevel = 'internal' | 'department' | 'confidential';
export type DocumentType = 'QD' | 'QT' | 'HD' | 'BM' | 'EXT';
export type DocumentLevel = 'VCPV' | 'DEPT';
export type DocumentStatus =
  | 'registered'
  | 'coded'
  | 'drafting'
  | 'feedback'
  | 'submitted'
  | 'approved'
  | 'effective'
  | 'revising'
  | 'withdrawn';
export type RecordKind = 'KH' | 'BC' | 'DX' | 'TD' | 'GV' | 'BB' | 'TB' | 'OPS';
export type RecordStatus = 'drafting' | 'submitted' | 'finalized' | 'held' | 'disposal_proposed' | 'disposed';
export type ApprovalObjectType =
  | 'document'
  | 'document_withdrawal'
  | 'record'
  | 'code'
  | 'retention'
  | 'external_share'
  | 'disposal'
  | 'delegation';
export type ApprovalStatus = 'pending' | 'approved' | 'changes_requested' | 'cancelled' | 'expired' | 'invalidated';
export type FolderKind =
  | 'docs'
  | 'plan_report'
  | 'operations'
  | 'area'
  | 'project'
  | 'closed'
  | 'archive'
  | 'year'
  | 'month'
  | 'entity';

/** Tên tiếng Việt của loại hồ sơ dùng trong tên file (BR-09) */
export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  KH: 'Kế hoạch',
  BC: 'Báo cáo',
  DX: 'Đề xuất',
  TD: 'Trình duyệt',
  GV: 'Giao việc',
  BB: 'Biên bản',
  TB: 'Thông báo',
  OPS: 'Hồ sơ vận hành',
};

/** Phần "Loại" trong mã tài liệu (QĐ-VCPV-01 dùng chữ Đ như tài liệu gốc) */
export const DOC_TYPE_CODE: Record<Exclude<DocumentType, 'EXT'>, string> = {
  QD: 'QĐ',
  QT: 'QT',
  HD: 'HD',
  BM: 'BM',
};
