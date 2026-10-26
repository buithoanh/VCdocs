import type { components } from '@/api/schema';
import type { HandoverDetail } from '@/api/types';

/** Dữ liệu mẫu cố định, kiểu lấy từ schema OpenAPI nên lệch hợp đồng là test không biên dịch được. */
type S = components['schemas'];

export const ids = {
  company: '6712f0c2a1b2c3d4e5f60700',
  me: '6712f0c2a1b2c3d4e5f60701',
  boss: '6712f0c2a1b2c3d4e5f60702',
  dept: '6712f0c2a1b2c3d4e5f60711',
  dept2: '6712f0c2a1b2c3d4e5f60712',
  block: '6712f0c2a1b2c3d4e5f60721',
  rtApproved: '6712f0c2a1b2c3d4e5f60731',
  rtDraft: '6712f0c2a1b2c3d4e5f60732',
  rtOps: '6712f0c2a1b2c3d4e5f60733',
  doc: '6712f0c2a1b2c3d4e5f60741',
  record: '6712f0c2a1b2c3d4e5f60751',
  approval: '6712f0c2a1b2c3d4e5f60761',
  job: '6712f0c2a1b2c3d4e5f60771',
  folder: '6712f0c2a1b2c3d4e5f60781',
  leaver: '6712f0c2a1b2c3d4e5f60703',
  auditor: '6712f0c2a1b2c3d4e5f60704',
  handover: '6712f0c2a1b2c3d4e5f607c1',
  item1: '6712f0c2a1b2c3d4e5f607c2',
  item2: '6712f0c2a1b2c3d4e5f607c3',
  item3: '6712f0c2a1b2c3d4e5f607c4',
  access: '6712f0c2a1b2c3d4e5f607d1',
  pack: '6712f0c2a1b2c3d4e5f607e1',
};

const base = { companyId: ids.company, createdAt: '2026-10-19T08:00:00+07:00', updatedAt: '2026-10-19T08:00:00+07:00' };

export const user: S['User'] = { ...base, allowedActions: [], id: ids.me, email: 'nhanvien@vcprosperous.com', name: 'Nguyễn Văn A', status: 'active', systemRoles: ['R6'], departmentId: ids.dept };
export const boss: S['User'] = { ...base, allowedActions: [], id: ids.boss, email: 'truongphong@vcprosperous.com', name: 'Trần Thị B', status: 'active', systemRoles: ['R4'], departmentId: ids.dept };

export function makeMe(roles: S['SystemRole'][] = ['R6']): S['Me'] {
  return {
    user: { ...user, systemRoles: roles },
    systemRoles: roles,
    departmentId: ids.dept,
    drives: [{ driveId: '0AAmkt', departmentId: ids.dept, name: '11 MKT', role: 'writer', securityLevel: 'department' }],
    csrfToken: 'csrf-mau-123',
    limits: { shareMaxDays: 30, backdateWorkingDays: 3, approvalDueDays: 3, minorUnlockDays: 3, uploadMaxMb: 100 },
    sessionExpiresAt: '2026-10-19T16:00:00+07:00',
  };
}

export const departments: S['Department'][] = [
  { ...base, allowedActions: [], id: ids.dept, code: 'MKT', number: '11', name: 'Marketing', driveId: '0AAmkt', securityLevel: 'department', blockId: ids.block },
  { ...base, allowedActions: [], id: ids.dept2, code: 'KT', number: '13', name: 'Kế toán', driveId: '0AAkt', securityLevel: 'confidential', blockId: ids.block },
];

const rtBase = {
  ...base,
  allowedActions: [] as S['RecordType']['allowedActions'],
  departmentId: ids.dept,
  namingRule: '[Mã] [Loại] Nội dung – YYYY-MM-DD',
  folderId: ids.folder,
  keeperTitle: 'Trưởng phòng',
  retentionYears: 5,
  retentionBasis: 'QĐ-VCPV-01',
  disposalMethod: 'Xoá trên Drive',
  securityLevel: 'department' as const,
};
export const recordTypes: S['RecordType'][] = [
  { ...rtBase, id: ids.rtApproved, name: 'Báo cáo tuần SEO', kind: 'BC', retentionStatus: 'approved' },
  { ...rtBase, id: ids.rtDraft, name: 'Kế hoạch quý (chưa duyệt thời hạn)', kind: 'KH', retentionStatus: 'draft' },
  { ...rtBase, id: ids.rtOps, name: 'Hồ sơ xe vào xưởng', kind: 'OPS', retentionStatus: 'approved' },
];

export const people: S['People'] = {
  [ids.me]: { id: ids.me, name: 'Nguyễn Văn A', email: 'nhanvien@vcprosperous.com' },
  [ids.boss]: { id: ids.boss, name: 'Trần Thị B', email: 'truongphong@vcprosperous.com' },
  [ids.leaver]: { id: ids.leaver, name: 'Phạm Văn Nghỉ', email: 'nghi@vcprosperous.com' },
  [ids.auditor]: { id: ids.auditor, name: 'Đỗ Kiểm Toán', email: 'kiemtoan@vcprosperous.com' },
};

export const approval: S['ApprovalDetail'] = {
  ...base,
  people,
  id: ids.approval,
  allowedActions: ['decide'],
  objectType: 'document',
  objectId: ids.doc,
  objectTitle: 'QT-MKT-01 Quy trình SEO',
  submittedBy: ids.me,
  submittedAt: '2026-10-19T09:00:00+07:00',
  approverId: ids.boss,
  approverRule: 'HD, BM cấp phòng → trưởng phòng',
  status: 'pending',
  snapshot: { revisionId: 'r1', viewUrl: 'https://docs.google.com/document/d/x/edit' },
};

export const doc: S['DocumentDetail'] = {
  ...base,
  people,
  id: ids.doc,
  allowedActions: ['submit', 'request-feedback'],
  code: 'QT-MKT-01',
  type: 'QT',
  level: 'DEPT',
  title: 'Quy trình SEO',
  departmentId: ids.dept,
  status: 'drafting',
  drafterId: ids.me,
  fileId: 'file-abc',
  versions: [],
};

export function makeJob(status: S['JobStatus'], extra: Partial<S['JobDetail']> = {}): S['JobDetail'] {
  return {
    ...base,
    id: ids.job,
    type: 'record.create',
    status,
    progress: status === 'done' ? 100 : status === 'running' ? 50 : 0,
    steps: [
      { name: 'Tạo file từ biểu mẫu', status: status === 'queued' ? 'queued' : 'done' },
      { name: 'Đặt tên, chuyển vào thư mục tháng', status },
    ],
    requestedBy: ids.me,
    people,
    ...extra,
  };
}

export const notifications: S['NotificationPage'] = {
  people: {},
  page: 1,
  limit: 20,
  total: 1,
  unreadCount: 1,
  items: [{ id: '6712f0c2a1b2c3d4e5f60791', type: 'approval_pending', title: 'Có phiếu chờ bạn duyệt', createdAt: '2026-10-19T09:00:00+07:00', isRead: false, link: `/phe-duyet/${ids.approval}` }],
};

export function errorBody(code: S['ErrorCode'], message: string, rule?: string): S['Error'] {
  return { error: { code, message, rule, requestId: 'req-test' } };
}

export const codes: S['CodePage'] = {
  people: {},
  page: 1,
  limit: 200,
  total: 1,
  items: [{ ...base, id: '6712f0c2a1b2c3d4e5f607a1', allowedActions: [], code: 'SEO-PTDA', type: 'function', meaning: 'SEO – phát triển dự án', status: 'approved', departmentId: ids.dept }],
};

export const record: S['RecordDetail'] = {
  ...base,
  people,
  id: ids.record,
  allowedActions: ['hold', 'integrity'],
  number: 'HS-2026-000123',
  functionCode: 'SEO-PTDA',
  kind: 'BC',
  subject: 'Báo cáo tuần 42',
  recordTypeId: ids.rtApproved,
  workMonth: '2026-10',
  status: 'finalized',
  createdBy: ids.me,
  finalized: { at: '2026-10-19T10:00:00+07:00', by: ids.me, verifyCode: 'ABC123', pdfSha256: 'a'.repeat(64) },
};

/* ── Giai đoạn 2 ── */

export function makeHandover(extra: Partial<HandoverDetail> = {}): HandoverDetail {
  return {
    ...base,
    people,
    id: ids.handover,
    allowedActions: ['update', 'update-items', 'refresh', 'confirm-receiver', 'export', 'cancel'],
    userId: ids.leaver,
    departmentId: ids.dept,
    lastWorkingDay: '2026-10-31',
    receiverId: ids.boss,
    status: 'open',
    isAuto: true,
    counts: { total: 3, pending: 3, done: 0, skipped: 0, failed: 0 },
    listJobId: ids.job,
    items: [
      { id: ids.item1, kind: 'document', objectType: 'document', objectId: ids.doc, name: 'QT-MKT-01 Quy trình SEO', detail: 'Người soạn · Đang soạn', action: 'reassign', status: 'pending' },
      { id: ids.item2, kind: 'my_drive_file', fileId: 'f-123', name: 'Kế hoạch 2027.xlsx', action: 'transfer', status: 'pending' },
      { id: ids.item3, kind: 'group_membership', groupEmail: '11-mkt-dong-gop@vcprosperous.com', name: '11-mkt-dong-gop@vcprosperous.com', action: 'remove', status: 'pending' },
    ],
    ...extra,
  };
}

export const auditLog: S['AuditLog'] = {
  id: '6712f0c2a1b2c3d4e5f607f1',
  seq: 1024,
  at: '2026-10-19T10:00:00+07:00',
  actorId: ids.me,
  action: 'record.finalize',
  objectType: 'record',
  objectId: ids.record,
  departmentId: ids.dept,
  before: { status: 'drafting' },
  after: { status: 'finalized' },
  result: 'ok',
  requestId: 'req-1',
  prevHash: 'a'.repeat(64),
  hash: 'b'.repeat(64),
  isRedacted: false,
};

export const auditorAccess: S['AuditorAccessDetail'] = {
  ...base,
  people,
  id: ids.access,
  allowedActions: ['revoke'],
  email: 'kiemtoan@vcprosperous.com',
  userId: ids.auditor,
  departmentIds: [ids.dept],
  expiresAt: '2026-11-15T23:59:59+07:00',
  reason: 'Kiểm toán năm 2026',
  grantedBy: ids.boss,
  status: 'active',
};

export const evidencePack: S['EvidencePackDetail'] = {
  ...base,
  people,
  id: ids.pack,
  createdBy: ids.me,
  targetType: 'record',
  targetId: ids.record,
  files: [
    { path: 'manifest.json', sha256: 'c'.repeat(64), sizeBytes: 512 },
    { path: 'pdf/HS-2026-000123.pdf', sha256: 'd'.repeat(64), sizeBytes: 204800 },
  ],
  sha256: 'e'.repeat(64),
  sizeBytes: 210000,
  expiresAt: '2026-10-26T10:00:00+07:00',
};
