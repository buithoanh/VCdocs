import type { components } from './schema';

type S = components['schemas'];
export type Me = S['Me'];
export type User = S['User'];
export type UserRef = S['UserRef'];
export type Drive = S['Drive'];
export type DriveMember = S['DriveMember'];
export type Block = S['Block'];
export type Department = S['Department'];
export type Division = S['Division'];
export type Code = S['Code'];
export type Folder = S['Folder'];
export type DocumentSummary = S['DocumentSummary'];
export type Document = S['Document'];
export type Integrity = S['Integrity'];
export type Approval = S['Approval'];
export type Delegation = S['Delegation'];
export type RecordType = S['RecordType'];
export type RecordSummary = S['RecordSummary'];
export type VcRecord = S['Record'];
export type RecordInput = S['RecordInput'];
export type DriveFile = S['DriveFile'];
export type SearchHit = S['SearchHit'];
export type ExternalShare = S['ExternalShare'];
export type Notification = S['Notification'];
export type NotificationSettings = S['NotificationSettings'];
export type Job = S['Job'];
export type Handover = S['Handover'];
/**
 * S['HandoverDetail'] sinh ra `… & Record<string, never>` vì khối `{ type: object, required: [items] }`
 * trong openapi không có properties (đề nghị #16) – mọi trường thành never. Tự ghép lại cho đúng.
 */
export type HandoverDetail = S['Handover'] & S['WithPeople'] & { items: S['HandoverItem'][] };
export type HandoverItem = S['HandoverItem'];
export type AuditLog = S['AuditLog'];
export type AuditAnchor = S['AuditAnchor'];
export type AuditorAccess = S['AuditorAccess'];
export type EvidencePack = S['EvidencePack'];

export type SystemRole = S['SystemRole'];
export type DriveRole = S['DriveRole'];
export type SecurityLevel = S['SecurityLevel'];
export type DocumentType = S['DocumentType'];
export type DocumentLevel = S['DocumentLevel'];
export type DocumentStatus = S['DocumentStatus'];
export type RecordKind = S['RecordKind'];
export type RevisionKind = S['RevisionKind'];
export type RecordStatus = S['RecordStatus'];
export type ApprovalObjectType = S['ApprovalObjectType'];
export type ApprovalStatus = S['ApprovalStatus'];
export type FolderKind = S['FolderKind'];
export type ShareStatus = S['ShareStatus'];
export type ShareRole = S['ShareRole'];
export type CodeType = S['CodeType'];
export type CodeStatus = S['CodeStatus'];
export type UserStatus = S['UserStatus'];
export type JobStatus = S['JobStatus'];
export type NotificationChannel = S['NotificationChannel'];
export type HandoverStatus = S['HandoverStatus'];
export type HandoverItemKind = S['HandoverItemKind'];
export type HandoverItemAction = S['HandoverItemAction'];
export type HandoverItemStatus = S['HandoverItemStatus'];
export type AuditorAccessStatus = S['AuditorAccessStatus'];
