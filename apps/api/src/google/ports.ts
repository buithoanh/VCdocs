/**
 * Lớp chuyển đổi Google: mọi chỗ gọi Drive/Docs/Sheets/Admin SDK/Gmail đi qua
 * các interface này. Có hai bản: giả (fake, dùng test và chạy local) và thật
 * (googleapis + tài khoản máy). Chọn bằng GOOGLE_MODE.
 */
import type { DriveRole } from '../common/enums';

export const GOOGLE = Symbol('GOOGLE');
export const VAULT = Symbol('VAULT');

export interface IdTokenClaims {
  email: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
  nonce?: string;
  sub: string;
}

export interface GoogleAuthPort {
  /** URL chuyển sang trang đăng nhập Google (hd = tên miền công ty) */
  buildAuthUrl(p: { state: string; nonce: string; redirectUri: string; hd: string }): string;
  /** Đổi code lấy id_token đã kiểm chữ ký; trả claims */
  exchangeCode(p: { code: string; redirectUri: string }): Promise<IdTokenClaims>;
}

export interface DirectoryUser {
  email: string;
  name: string;
  title?: string;
  suspended: boolean;
}
export interface DirectoryGroup {
  email: string;
  name: string;
}
export interface DirectoryPort {
  listUsers(domain: string): Promise<DirectoryUser[]>;
  getUser(email: string): Promise<DirectoryUser | undefined>;
  listGroups(domain: string): Promise<DirectoryGroup[]>;
  /** Email thành viên trực tiếp của nhóm */
  listGroupMembers(groupEmail: string): Promise<string[]>;
  /** Nhóm mà một người thuộc về */
  listUserGroups(email: string): Promise<string[]>;
}

export interface SharedDrive {
  driveId: string;
  name: string;
}
export interface DrivePermission {
  permissionId: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  emailAddress?: string;
  domain?: string;
  displayName?: string;
  role: DriveRole | 'owner';
  expirationTime?: string;
}
export interface DriveFileMeta {
  fileId: string;
  name: string;
  mimeType: string;
  driveId?: string;
  parents: string[];
  description?: string;
  createdTime: string;
  modifiedTime?: string;
  /** Người sửa cuối (lastModifyingUser), KHÔNG phải người tạo; người tạo lấy qua drive.getCreatorEmail */
  lastModifierEmail?: string;
  webViewLink?: string;
  trashed?: boolean;
  md5Checksum?: string;
  size?: number;
  contentRestriction?: { readOnly: boolean; reason?: string; ownerRestricted?: boolean };
  downloadRestricted?: boolean;
}
export interface DriveRevision {
  revisionId: string;
  modifiedTime: string;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const GDOC_MIME = 'application/vnd.google-apps.document';
export const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const GSLIDE_MIME = 'application/vnd.google-apps.presentation';

export interface DrivePort {
  listDrives(): Promise<SharedDrive[]>;
  listDrivePermissions(driveId: string): Promise<DrivePermission[]>;
  getFile(fileId: string): Promise<DriveFileMeta | undefined>;
  /** Email người tạo file (chữ thường); không xác định chắc chắn được thì undefined */
  getCreatorEmail(fileId: string): Promise<string | undefined>;
  /** Liệt kê file (không phải thư mục) trong drive, không lấy file đã vào thùng rác */
  listFiles(driveId: string, opts?: { foldersOnly?: boolean }): Promise<DriveFileMeta[]>;
  createFolder(p: { driveId: string; parentGoogleId?: string; name: string }): Promise<DriveFileMeta>;
  /** Tạo file Google trống (Docs) */
  createEmptyDoc(p: { parentGoogleId: string; name: string; mimeType?: string }): Promise<DriveFileMeta>;
  copyFile(p: { fileId: string; parentGoogleId: string; name: string }): Promise<DriveFileMeta>;
  /** Tải file lên; convertTo = mimeType Google để Drive tự chuyển định dạng */
  uploadFile(p: {
    parentGoogleId: string;
    name: string;
    mimeType: string;
    content: Buffer;
    convertTo?: string;
    description?: string;
  }): Promise<DriveFileMeta>;
  updateFile(
    fileId: string,
    p: { name?: string; description?: string; addParents?: string[]; removeParents?: string[] },
  ): Promise<DriveFileMeta>;
  /** Khoá/mở khoá nội dung (contentRestrictions readOnly, ownerRestricted) */
  setLock(fileId: string, p: { locked: boolean; reason?: string }): Promise<void>;
  /** Chặn tải, in, sao chép (downloadRestrictions) */
  setDownloadRestriction(fileId: string, restricted: boolean): Promise<void>;
  latestRevision(fileId: string): Promise<DriveRevision>;
  exportPdf(fileId: string): Promise<Buffer>;
  /** Số nhận xét chưa đóng (comments.list, resolved = false) */
  countOpenComments(fileId: string): Promise<number>;
  createPermission(
    fileId: string,
    p: { email: string; role: 'reader' | 'commenter'; expirationTime?: string; sendNotification?: boolean },
  ): Promise<{ permissionId: string; expirationApplied: boolean }>;
  updatePermissionExpiry(fileId: string, permissionId: string, expirationTime: string): Promise<boolean>;
  deletePermission(fileId: string, permissionId: string): Promise<void>;
  listFilePermissions(fileId: string): Promise<DrivePermission[]>;
}

export interface DocsPort {
  /** Thay chỗ giữ {{MA}}… trong Docs (replaceAllText); file Sheets thì values.update */
  replacePlaceholders(fileId: string, values: Record<string, string>): Promise<void>;
  /** Thay chữ (replaceAllText) theo từng cặp [cũ, mới] */
  replaceText(fileId: string, pairs: [string, string][]): Promise<void>;
  /** Thêm một dòng vào bảng Lịch sử phiên bản cuối file */
  appendVersionRow(fileId: string, cells: string[]): Promise<void>;
}

export interface SheetsPort {
  /** Tạo bảng tính theo quy cách HD-VCPV-02, trả fileId */
  createSheet(p: { parentGoogleId?: string; title: string; header: string[]; rows: (string | number)[][] }): Promise<string>;
}

export interface GmailPort {
  send(p: { to: string[]; subject: string; html: string }): Promise<void>;
}

export interface ShareActivity {
  fileId: string;
  fileName?: string;
  email: string;
  role: 'reader' | 'commenter' | 'writer';
  actorEmail?: string;
  permissionId?: string;
  at: string;
}
export interface ReportsPort {
  /** Lượt chia sẻ ra ngoài tên miền trong nhật ký kiểm tra Drive */
  listExternalShares(since: Date): Promise<ShareActivity[]>;
}

/** Tải tài liệu bên ngoài từ URL (chỉ https, giới hạn dung lượng) */
export interface UrlFetchPort {
  fetch(url: string): Promise<{ content: Buffer; mimeType: string; fileName?: string }>;
}

export interface GooglePorts {
  mode: 'fake' | 'real';
  auth: GoogleAuthPort;
  directory: DirectoryPort;
  drive: DrivePort;
  docs: DocsPort;
  sheets: SheetsPort;
  gmail: GmailPort;
  reports: ReportsPort;
  urls: UrlFetchPort;
}

/** Kho riêng giữ PDF đã chốt (MinIO/S3 sau này; giai đoạn 1 là thư mục máy chủ) */
export interface VaultPort {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  remove(key: string): Promise<void>;
}
