import { Connection, Model, Schema } from 'mongoose';
import { tenantPlugin } from './tenant.plugin';

const Mixed = Schema.Types.Mixed;
const OID = Schema.Types.ObjectId;
const base = { companyId: { type: OID, required: true, index: true }, createdBy: OID, updatedBy: OID };
const opts = { timestamps: true, minimize: true, strict: true } as const;

function mk(def: Record<string, any>, extra: Partial<typeof opts> & Record<string, any> = {}) {
  return new Schema({ ...base, ...def }, { ...opts, ...extra });
}

// ── Hệ thống ──
const Company = new Schema(
  {
    name: { type: String, required: true },
    domain: { type: String, required: true, unique: true },
    settings: { type: Mixed, default: {} },
  },
  opts,
);

const User = mk({
  email: { type: String, required: true, lowercase: true },
  name: { type: String, required: true },
  title: String,
  departmentId: OID,
  status: { type: String, enum: ['active', 'leaving', 'left'], default: 'active' },
  systemRoles: { type: [String], default: [] },
  groupRoles: { type: [String], default: [] },
  manualRoles: { type: [String], default: [] },
  groupEmails: { type: [String], default: [] },
  driveRoles: { type: [{ _id: false, driveId: String, role: String }], default: [] },
  lastWorkingDay: String,
  isSuspended: { type: Boolean, default: false },
  lastLoginAt: Date,
  notificationSettings: { type: Mixed },
});
User.index({ companyId: 1, email: 1 }, { unique: true });

const OidcIdentity = mk({
  issuer: { type: String, required: true },
  subject: { type: String, required: true },
  userId: { type: OID, required: true },
  email: { type: String, required: true, lowercase: true },
  groups: { type: [String], default: [] },
  active: { type: Boolean, default: true },
  lastSeenAt: { type: Date, required: true },
  projectionPendingRevision: Number,
});
// Một danh tính upstream không bao giờ được bind sang hai tenant.
OidcIdentity.index({ issuer: 1, subject: 1 }, { unique: true });
OidcIdentity.index({ companyId: 1, userId: 1 }, { unique: true });

const IdentityLifecycleOperation = mk({
  idempotencyKey: { type: String, required: true },
  fingerprint: { type: String, required: true },
  subject: { type: String, required: true },
  desired: { type: Mixed, required: true },
  status: { type: String, enum: ['pending', 'running', 'partial', 'superseded', 'done'], default: 'pending' },
  subjectRevision: { type: Number, required: true },
  steps: { type: [Mixed], default: [] },
  version: { type: Number, default: 0 },
  leaseToken: String,
  leaseUntil: Date,
  lastError: String,
  completedAt: Date,
  createdBy: OID,
  updatedBy: OID,
});
IdentityLifecycleOperation.index({ companyId: 1, idempotencyKey: 1 }, { unique: true });

const IdentityLifecycleSubject = mk({
  subject: { type: String, required: true },
  revision: { type: Number, default: 0 },
  appliedRevision: { type: Number, default: 0 },
  desiredFingerprint: String,
  status: { type: String, enum: ['pending', 'running', 'partial', 'done'], default: 'pending' },
  leaseToken: String,
  leaseUntil: Date,
  reservedOperationId: OID,
  reservedRevision: Number,
});
IdentityLifecycleSubject.index({ companyId: 1, subject: 1 }, { unique: true });

const Session = new Schema(
  {
    sidHash: { type: String, required: true, unique: true },
    userId: { type: OID, required: true, index: true },
    companyId: { type: OID, required: true },
    csrfToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    ip: String,
    device: String,
    authProvider: { type: String, enum: ['google', 'oidc'], default: 'google' },
    identityId: OID,
  },
  opts,
);
Session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OAuthState = new Schema(
  {
    state: { type: String, required: true, unique: true },
    nonce: { type: String, required: true },
    provider: { type: String, enum: ['google', 'oidc'], default: 'google' },
    codeVerifier: String,
    returnTo: String,
    expiresAt: { type: Date, required: true },
  },
  opts,
);
OAuthState.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Counter = mk({ key: { type: String, required: true }, seq: { type: Number, default: 0 } });
Counter.index({ companyId: 1, key: 1 }, { unique: true });

const Idempotency = mk({
  userId: { type: OID, required: true },
  key: { type: String, required: true },
  method: String,
  path: String,
  bodyHash: String,
  state: { type: String, enum: ['pending', 'done'], default: 'pending' },
  status: Number,
  body: Mixed,
  auditId: String,
  expiresAt: { type: Date, required: true },
});
Idempotency.index({ companyId: 1, userId: 1, key: 1 }, { unique: true });
Idempotency.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AuditLog = new Schema(
  {
    companyId: { type: OID, required: true },
    seq: { type: Number, required: true },
    at: { type: Date, required: true },
    actorId: OID,
    actorEmail: String,
    action: { type: String, required: true },
    objectType: String,
    objectId: String,
    before: Mixed,
    after: Mixed,
    result: { type: String, enum: ['ok', 'denied'], default: 'ok' },
    requestId: String,
    ip: String,
    device: String,
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { strict: true, minimize: true },
);
AuditLog.index({ companyId: 1, seq: 1 }, { unique: true });
AuditLog.index({ companyId: 1, objectType: 1, objectId: 1 });
// Nhật ký chỉ thêm: chặn sửa, xoá ở tầng mô hình
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne']) {
  AuditLog.pre(op as any, function () {
    throw new Error('audit_logs chỉ được thêm, không sửa hoặc xoá');
  });
}

const Job = mk({
  type: { type: String, required: true },
  status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued', index: true },
  progress: { type: Number, default: 0 },
  steps: { type: [{ _id: false, name: String, status: String, error: String }], default: [] },
  payload: Mixed,
  result: Mixed,
  /** Số liệu thêm của việc (không thuộc result theo hợp đồng) */
  summary: Mixed,
  error: Mixed,
  startedAt: Date,
  finishedAt: Date,
  requestedBy: { type: OID, required: true },
  requestId: String,
  lockedUntil: Date,
  attempts: { type: Number, default: 0 },
});
Job.index({ status: 1, createdAt: 1 });

const Notification = mk({
  userId: { type: OID, required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: String,
  link: String,
  objectType: String,
  objectId: OID,
  isRead: { type: Boolean, default: false },
  emailState: { type: String, enum: ['none', 'pending', 'sent', 'failed'], default: 'none' },
});
Notification.index({ companyId: 1, userId: 1, isRead: 1, createdAt: -1 });

// ── Drive cơ bản VCworkspace ──
const WorkspaceSpace = mk({
  kind: { type: String, enum: ['department', 'personal'], required: true },
  name: { type: String, required: true },
  rootStorageKey: { type: String, required: true },
  // Khoá nhận diện không gian theo ID, không theo tên hiển thị (trùng tên ≠ cùng không gian)
  ownerUserId: OID,
  departmentId: OID,
});
WorkspaceSpace.index({ companyId: 1, ownerUserId: 1 }, { unique: true, partialFilterExpression: { kind: 'personal' } });
WorkspaceSpace.index({ companyId: 1, departmentId: 1 }, { unique: true, partialFilterExpression: { kind: 'department' } });

const WorkspaceSpaceMember = mk({
  spaceId: { type: OID, required: true },
  userId: { type: OID, required: true },
  role: { type: String, enum: ['manager', 'reader'], required: true },
});
WorkspaceSpaceMember.index({ companyId: 1, spaceId: 1, userId: 1 }, { unique: true });

const WorkspaceDriveItem = mk({
  spaceId: { type: OID, required: true },
  parentId: OID,
  kind: { type: String, enum: ['folder', 'file'], required: true },
  name: { type: String, required: true },
  mimeType: String,
  size: Number,
  contentSha256: String,
  storageKey: { type: String, required: true },
  currentVersionId: OID,
  versionNumber: Number,
  trashedAt: Date,
  trashedFromParentId: OID,
  trashedRootId: OID,
});
WorkspaceDriveItem.index({ companyId: 1, spaceId: 1, parentId: 1, name: 1 }, { unique: true });

const WorkspaceDriveVersion = mk({
  fileId: { type: OID, required: true },
  number: { type: Number, required: true },
  storageKey: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  contentSha256: { type: String, required: true },
  provenance: Mixed,
});
WorkspaceDriveVersion.index({ companyId: 1, fileId: 1, number: 1 }, { unique: true });

const UploadAttempt = mk({
  userId: { type: OID, required: true },
  spaceId: { type: OID, required: true },
  idempotencyKey: { type: String, required: true },
  fingerprint: { type: String, required: true },
  state: { type: String, enum: ['pending', 'done', 'failed'], required: true },
  itemId: OID,
  errorCode: String,
});
UploadAttempt.index({ companyId: 1, userId: 1, idempotencyKey: 1 }, { unique: true });

const WorkspaceEditorSave = mk({
  fileId: { type: OID, required: true },
  editorKey: { type: String, required: true },
  callbackFingerprint: { type: String, required: true },
  status: { type: String, enum: ['saving', 'saved', 'failed'], required: true },
  versionId: OID,
  errorCode: String,
});
WorkspaceEditorSave.index({ companyId: 1, fileId: 1, callbackFingerprint: 1 }, { unique: true });

const WorkspaceDriveShareLink = mk({
  fileId: { type: OID, required: true },
  versionId: { type: OID, required: true },
  contentSha256: { type: String, required: true },
  recipients: { type: [String], required: true },
  idempotencyKey: { type: String, required: true },
  fingerprint: { type: String, required: true },
  token: { type: String, required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
});
WorkspaceDriveShareLink.index({ companyId: 1, tokenHash: 1 }, { unique: true });
WorkspaceDriveShareLink.index({ companyId: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
WorkspaceDriveShareLink.index({ companyId: 1, expiresAt: 1 });

// MIME/raw vẫn thuộc mail server. Mongo chỉ giữ mapping và metadata nghiệp vụ
// (ACL, nhãn, chỉ mục tìm kiếm/lọc) để không biến API thành một mail engine thứ hai.
const WorkspaceMailMessage = mk({
  mailboxOwner: { type: String, required: true, lowercase: true },
  engineOwner: { type: String, required: true, lowercase: true },
  engineId: { type: String, required: true },
  threadId: { type: String, required: true },
  internetMessageId: { type: String, required: true },
  inReplyTo: String,
  references: { type: [String], default: [] },
  from: { type: String, required: true },
  to: { type: [String], required: true },
  subject: { type: String, required: true },
  sentAt: { type: Date, required: true },
  folder: { type: String, required: true },
  labels: { type: [String], default: [] },
  searchText: { type: String, default: '' },
  searchBody: { type: String, default: '' },
  deliveryStatus: { type: String, enum: ['accepted', 'failed'], required: true },
});
WorkspaceMailMessage.index({ companyId: 1, mailboxOwner: 1, engineId: 1 }, { unique: true });
WorkspaceMailMessage.index({ companyId: 1, mailboxOwner: 1, threadId: 1, sentAt: 1 });
WorkspaceMailMessage.index({ companyId: 1, mailboxOwner: 1, folder: 1, sentAt: -1 });

const WorkspaceMailDraft = mk({
  ownerEmail: { type: String, required: true, lowercase: true },
  to: { type: [String], default: [] }, subject: { type: String, default: '' },
  text: { type: String, default: '' }, html: String,
  inReplyTo: String, references: { type: [String], default: [] },
  attachmentNames: { type: [String], default: [] },
});
WorkspaceMailDraft.index({ companyId: 1, ownerEmail: 1, _id: 1 });

const WorkspaceMailSend = mk({
  ownerEmail: { type: String, required: true, lowercase: true },
  idempotencyKey: { type: String, required: true },
  fingerprint: { type: String, required: true },
  state: { type: String, enum: ['sending', 'reconciling', 'sent', 'failed'], required: true },
  messageId: OID,
  internetMessageId: String,
  sentMailbox: String,
  engineIds: Mixed,
  deliveredAt: Date,
  leaseToken: String,
  leaseUntil: Date,
  errorCode: String,
});
WorkspaceMailSend.index({ companyId: 1, ownerEmail: 1, idempotencyKey: 1 }, { unique: true });

const WorkspaceMailLabel = mk({
  ownerEmail: { type: String, required: true, lowercase: true },
  name: { type: String, required: true },
  color: String,
});
WorkspaceMailLabel.index({ companyId: 1, ownerEmail: 1, name: 1 }, { unique: true });

const WorkspaceMailFilter = mk({
  ownerEmail: { type: String, required: true, lowercase: true },
  name: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  field: { type: String, enum: ['from', 'to', 'subject', 'body'], required: true },
  operator: { type: String, enum: ['equals', 'contains'], required: true },
  value: { type: String, required: true },
  addLabels: { type: [String], default: [] },
  moveToFolder: String,
  stop: { type: Boolean, default: false },
  publishStatus: { type: String, enum: ['pending', 'active'], default: 'active' },
  revision: Number,
});
WorkspaceMailFilter.index({ companyId: 1, ownerEmail: 1, _id: 1 });

// Journal/CAS này là khóa liên tiến trình và bằng chứng trạng thái engine.
// Không dùng mutex trong RAM vì API có thể chạy nhiều process hoặc restart giữa chừng.
const WorkspaceMailFilterState = mk({
  ownerEmail: { type: String, required: true, lowercase: true },
  revision: { type: Number, default: 0 },
  appliedRevision: { type: Number, default: 0 },
  status: { type: String, enum: ['idle', 'applying', 'applied', 'failed'], default: 'idle' },
  leaseToken: String,
  leaseUntil: Date,
  desiredFilters: Mixed,
  previousFilters: Mixed,
  lastError: String,
});
WorkspaceMailFilterState.index({ companyId: 1, ownerEmail: 1 }, { unique: true });

const WorkspaceMailAlias = mk({
  ownerEmail: { type: String, required: true, lowercase: true },
  address: { type: String, required: true, lowercase: true },
  displayName: String,
  active: { type: Boolean, default: true },
});
WorkspaceMailAlias.index({ companyId: 1, address: 1 }, { unique: true });

const WorkspaceSharedMailbox = mk({
  address: { type: String, required: true, lowercase: true },
  name: { type: String, required: true },
  members: [{ email: { type: String, required: true, lowercase: true }, roles: { type: [String], default: [] } }],
});
WorkspaceSharedMailbox.index({ companyId: 1, address: 1 }, { unique: true });

// ── M02 ──
const Block = mk({ code: { type: String, required: true }, name: { type: String, required: true }, directorId: OID });
Block.index({ companyId: 1, code: 1 }, { unique: true });

const Department = mk({
  code: { type: String, required: true },
  number: { type: String, required: true },
  name: { type: String, required: true },
  blockId: OID,
  driveId: { type: String, required: true },
  securityLevel: { type: String, required: true },
  headId: OID,
  groupEmails: { type: [String], default: undefined },
});
Department.index({ companyId: 1, code: 1 }, { unique: true });
Department.index({ companyId: 1, number: 1 }, { unique: true });
Department.index({ companyId: 1, driveId: 1 }, { unique: true });

const Division = mk({ prefix: { type: String, required: true }, name: { type: String, required: true } });
Division.index({ companyId: 1, prefix: 1 }, { unique: true });

const Code = mk({
  code: { type: String, required: true },
  type: { type: String, required: true },
  meaning: { type: String, required: true },
  scope: String,
  reason: String,
  departmentId: OID,
  status: { type: String, required: true },
  decision: Mixed,
  searchText: String,
});
Code.index({ companyId: 1, code: 1 });

// ── M03 ──
const Folder = mk({
  driveId: { type: String, required: true },
  googleId: { type: String, required: true },
  parentId: OID,
  number: { type: String, default: '' },
  code: String,
  shortName: { type: String, default: '' },
  fullName: { type: String, default: '' },
  name: String,
  kind: { type: String, required: true },
  path: String,
  year: Number,
  month: Number,
  securityLevel: { type: String, required: true },
  status: { type: String, default: 'active' },
  isManagedByVcdocs: { type: Boolean, default: true },
  hasPeriods: { type: Boolean, default: false },
  /** Cha ban đầu (để giữ số khi dự án chuyển vào 98) */
  originalParentKey: String,
});
Folder.index({ companyId: 1, driveId: 1, parentId: 1 });
Folder.index({ companyId: 1, googleId: 1 }, { unique: true });

/** Số thư mục đã cấp trong một thư mục cha – không cấp lại (US-03.3) */
const FolderNumber = mk({ parentKey: { type: String, required: true }, number: { type: String, required: true } });
FolderNumber.index({ companyId: 1, parentKey: 1, number: 1 }, { unique: true });

// ── M04 ──
const Document = mk({
  code: String,
  type: { type: String, required: true },
  level: { type: String, required: true },
  title: { type: String, required: true },
  departmentId: { type: OID, required: true },
  status: { type: String, required: true },
  securityLevel: String,
  driveId: String,
  drafterId: OID,
  checkerId: OID,
  approverId: OID,
  dueDate: String,
  reviewDue: String,
  current: Mixed,
  versions: { type: [Mixed], default: [] },
  lock: Mixed,
  replacesId: OID,
  replacedById: OID,
  folderId: OID,
  fileId: String,
  external: Mixed,
  relatedIds: { type: [OID], default: undefined },
  feedback: Mixed,
  draftVersion: Number,
  headerValues: Mixed,
  revision: Mixed,
  reviews: { type: [Mixed], default: undefined },
  searchText: String,
});
Document.index({ companyId: 1, code: 1 });
Document.index({ companyId: 1, status: 1 });

// ── M05 ──
const Approval = mk({
  objectType: { type: String, required: true },
  objectId: { type: OID, required: true },
  objectTitle: String,
  snapshot: Mixed,
  submittedBy: { type: OID, required: true },
  submittedAt: { type: Date, required: true },
  approverId: { type: OID, required: true },
  approverRule: String,
  checkerId: OID,
  checkedAt: Date,
  checkComment: String,
  status: { type: String, required: true },
  decision: Mixed,
  dueAt: Date,
  reminders: { type: [Date], default: [] },
  invalidatedReason: String,
  /** Việc nền chạy sau quyết định, vd document.withdraw (D15) */
  jobId: OID,
  meta: Mixed,
  driveId: String,
});
Approval.index({ companyId: 1, approverId: 1, status: 1 });
Approval.index({ companyId: 1, objectType: 1, objectId: 1 });

const Delegation = mk({
  blockId: { type: OID, required: true },
  recordTypeId: { type: OID, required: true },
  task: String,
  isLegalSignature: { type: Boolean, default: false },
  limitAmount: Number,
  delegateId: { type: OID, required: true },
  from: { type: String, required: true },
  to: String,
});

// ── M06 ──
const RecordType = mk({
  departmentId: { type: OID, required: true },
  name: { type: String, required: true },
  kind: { type: String, required: true },
  namingRule: String,
  example: String,
  folderId: OID,
  keeperTitle: String,
  retentionYears: Number,
  retentionBasis: String,
  disposalMethod: String,
  securityLevel: String,
  templateId: String,
  requiresApproval: { type: Boolean, default: false },
  retentionStatus: { type: String, default: 'draft' },
  retentionApprovalId: OID,
});
RecordType.index({ companyId: 1, departmentId: 1, name: 1 }, { unique: true });

// ── M07 ──
const RecordM = mk({
  number: { type: String, required: true },
  functionCode: { type: String, required: true },
  kind: { type: String, required: true },
  subject: { type: String, required: true },
  identifier: String,
  recordTypeId: { type: OID, required: true },
  departmentId: OID,
  driveId: String,
  workMonth: { type: String, required: true },
  createdDate: String,
  fileName: String,
  folderId: OID,
  fileId: String,
  mimeType: String,
  status: { type: String, required: true },
  isApproved: { type: Boolean, default: false },
  isClaimed: { type: Boolean, default: false },
  approvalId: OID,
  finalized: Mixed,
  lock: Mixed,
  paperLocation: String,
  scanFileId: String,
  hold: Mixed,
  retention: Mixed,
  adjustsId: OID,
  adjustedByIds: { type: [OID], default: undefined },
  backdateReason: String,
  adjustReason: String,
  searchText: String,
});
RecordM.index({ companyId: 1, number: 1 }, { unique: true });
RecordM.index({ companyId: 1, fileId: 1 });
RecordM.index({ companyId: 1, 'finalized.verifyCode': 1 });
RecordM.index({ companyId: 1, driveId: 1, workMonth: 1 });

// ── M09 ──
const ExternalShare = mk({
  fileId: { type: String, required: true },
  fileName: String,
  recordId: OID,
  documentId: OID,
  departmentId: OID,
  driveId: String,
  email: { type: String, required: true },
  role: { type: String, required: true },
  /** reason, expiresAt bắt buộc khi source = vcdocs; trống khi source = detected (D7) */
  reason: String,
  expiresAt: Date,
  sharedBy: OID,
  approvalId: OID,
  permissionId: String,
  status: { type: String, required: true },
  revokedAt: Date,
  revokedBy: OID,
  source: { type: String, required: true, default: 'vcdocs' },
  remindedAt: Date,
  /** Thời điểm trong nhật ký Google của lượt phát hiện (source = detected) */
  detectedAt: Date,
  /** Google không nhận hạn → VCdocs tự gỡ */
  isExpiryManaged: Boolean,
});
ExternalShare.index({ companyId: 1, status: 1, expiresAt: 1 });

export const MODEL_DEFS = {
  Company: { schema: Company, collection: 'companies' },
  User: { schema: User, collection: 'users' },
  Session: { schema: Session, collection: 'sessions' },
  OidcIdentity: { schema: OidcIdentity, collection: 'oidc_identities' },
  IdentityLifecycleOperation: { schema: IdentityLifecycleOperation, collection: 'identity_lifecycle_operations' },
  IdentityLifecycleSubject: { schema: IdentityLifecycleSubject, collection: 'identity_lifecycle_subjects' },
  OAuthState: { schema: OAuthState, collection: 'oauth_states' },
  Counter: { schema: Counter, collection: 'counters' },
  Idempotency: { schema: Idempotency, collection: 'idempotency_keys' },
  AuditLog: { schema: AuditLog, collection: 'audit_logs' },
  Job: { schema: Job, collection: 'jobs' },
  Notification: { schema: Notification, collection: 'notifications' },
  WorkspaceSpace: { schema: WorkspaceSpace, collection: 'workspace_spaces' },
  WorkspaceSpaceMember: { schema: WorkspaceSpaceMember, collection: 'workspace_space_members' },
  WorkspaceDriveItem: { schema: WorkspaceDriveItem, collection: 'workspace_drive_items' },
  WorkspaceDriveVersion: { schema: WorkspaceDriveVersion, collection: 'workspace_drive_versions' },
  UploadAttempt: { schema: UploadAttempt, collection: 'upload_attempts' },
  WorkspaceEditorSave: { schema: WorkspaceEditorSave, collection: 'workspace_editor_saves' },
  WorkspaceDriveShareLink: { schema: WorkspaceDriveShareLink, collection: 'workspace_drive_share_links' },
  WorkspaceMailMessage: { schema: WorkspaceMailMessage, collection: 'workspace_mail_messages' },
  WorkspaceMailDraft: { schema: WorkspaceMailDraft, collection: 'workspace_mail_drafts' },
  WorkspaceMailSend: { schema: WorkspaceMailSend, collection: 'workspace_mail_sends' },
  WorkspaceMailLabel: { schema: WorkspaceMailLabel, collection: 'workspace_mail_labels' },
  WorkspaceMailFilter: { schema: WorkspaceMailFilter, collection: 'workspace_mail_filters' },
  WorkspaceMailFilterState: { schema: WorkspaceMailFilterState, collection: 'workspace_mail_filter_states' },
  WorkspaceMailAlias: { schema: WorkspaceMailAlias, collection: 'workspace_mail_aliases' },
  WorkspaceSharedMailbox: { schema: WorkspaceSharedMailbox, collection: 'workspace_shared_mailboxes' },
  Block: { schema: Block, collection: 'blocks' },
  Department: { schema: Department, collection: 'departments' },
  Division: { schema: Division, collection: 'divisions' },
  Code: { schema: Code, collection: 'codes' },
  Folder: { schema: Folder, collection: 'folders' },
  FolderNumber: { schema: FolderNumber, collection: 'folder_numbers' },
  Document: { schema: Document, collection: 'documents' },
  Approval: { schema: Approval, collection: 'approvals' },
  Delegation: { schema: Delegation, collection: 'delegations' },
  RecordType: { schema: RecordType, collection: 'record_types' },
  Record: { schema: RecordM, collection: 'records' },
  ExternalShare: { schema: ExternalShare, collection: 'external_shares' },
} as const;

export type ModelName = keyof typeof MODEL_DEFS;
export type Models = { [K in ModelName]: Model<any> };

export function registerModels(conn: Connection): Models {
  const out: any = {};
  for (const [name, def] of Object.entries(MODEL_DEFS)) {
    if (!(def.schema as any).__tenant) {
      (def.schema as Schema).plugin(tenantPlugin);
      (def.schema as any).__tenant = true;
    }
    out[name] = conn.models[name] || conn.model(name, def.schema, def.collection);
  }
  return out as Models;
}
