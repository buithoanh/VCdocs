import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { GoogleError } from '../../common/errors';
import type { DriveRole } from '../../common/enums';
import {
  DirectoryGroup,
  DirectoryUser,
  DriveFileMeta,
  DrivePermission,
  FOLDER_MIME,
  GDOC_MIME,
  GSHEET_MIME,
  GooglePorts,
  IdTokenClaims,
  ShareActivity,
  SharedDrive,
} from '../ports';
import { md5 } from '../../common/util';

/**
 * Google giả trong bộ nhớ: đủ để chạy local và test mà không cần tài khoản thật.
 * Có thể lưu ra file JSON (FAKE_GOOGLE_STATE_FILE) để giữ dữ liệu giữa các lần chạy.
 */
interface FakeFile extends DriveFileMeta {
  revision: number;
  /** Nội dung chữ (Docs) để kiểm điền chỗ giữ */
  text: string;
  rows?: (string | number)[][];
  versionRows: string[][];
  openComments: number;
  permissions: DrivePermission[];
  /** PDF/ảnh tải lên: md5 nội dung */
  binaryMd5?: string;
  binaryBase64?: string;
  /** Người tạo thật (trên shared drive files.get không trả người tạo; bản thật đọc phiên bản đầu) */
  creatorEmail?: string;
}

interface World {
  seq: number;
  users: DirectoryUser[];
  groups: (DirectoryGroup & { members: string[] })[];
  drives: (SharedDrive & { permissions: DrivePermission[] })[];
  files: Record<string, FakeFile>;
  activities: ShareActivity[];
  outbox: { to: string[]; subject: string; html: string; at: string }[];
}

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

export class FakeGoogle implements GooglePorts {
  readonly mode = 'fake' as const;
  world: World;
  /** Đặt true để giả lập Google trả lỗi (kiểm 502) */
  failNext: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: { publicApiOrigin: string; stateFile?: string }) {
    this.world = this.load() ?? { seq: 1000, users: [], groups: [], drives: [], files: {}, activities: [], outbox: [] };
  }

  // ───────────── tiện ích nội bộ ─────────────
  private load(): World | undefined {
    if (!this.opts.stateFile || !fs.existsSync(this.opts.stateFile)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(this.opts.stateFile, 'utf8'));
    } catch {
      return undefined;
    }
  }
  private touch() {
    if (!this.opts.stateFile) return;
    fs.mkdirSync(path.dirname(this.opts.stateFile), { recursive: true });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.writeFileSync(this.opts.stateFile!, JSON.stringify(this.world));
    }, 200);
    this.saveTimer.unref?.();
  }
  flush() {
    if (this.opts.stateFile) fs.mkdirSync(path.dirname(this.opts.stateFile), { recursive: true });
    if (this.opts.stateFile) fs.writeFileSync(this.opts.stateFile, JSON.stringify(this.world));
  }
  isEmpty() {
    return this.world.drives.length === 0;
  }
  private id(prefix: string) {
    this.world.seq++;
    return `${prefix}${this.world.seq.toString(36)}FAKE${Math.random().toString(36).slice(2, 8)}`;
  }
  private check(op: string) {
    if (this.failNext && (this.failNext === '*' || this.failNext === op)) {
      this.failNext = null;
      throw new GoogleError(`Google giả trả lỗi ở ${op}`, 500);
    }
  }
  private file(fileId: string): FakeFile {
    const f = this.world.files[fileId];
    if (!f) throw new GoogleError(`File ${fileId} không tồn tại`, 404);
    return f;
  }
  private meta(f: FakeFile): DriveFileMeta {
    const { revision, text, rows, versionRows, openComments, permissions, binaryBase64, binaryMd5, creatorEmail, ...m } = f;
    return { ...m, md5Checksum: binaryMd5, parents: [...f.parents] };
  }
  private newFile(p: Partial<FakeFile> & { name: string; mimeType: string; parents: string[]; driveId?: string }): FakeFile {
    const fileId = this.id(p.mimeType === FOLDER_MIME ? 'fo' : 'fi');
    const parentDrive = p.driveId ?? (p.parents[0] ? this.world.files[p.parents[0]]?.driveId ?? p.parents[0] : undefined);
    const f: FakeFile = {
      fileId,
      createdTime: new Date().toISOString(),
      revision: 1,
      text: '',
      versionRows: [],
      openComments: 0,
      permissions: [],
      webViewLink: `https://drive.google.com/fake/${fileId}`,
      ...p,
      driveId: parentDrive,
    };
    this.world.files[fileId] = f;
    this.touch();
    return f;
  }

  // ───────────── điều khiển trong test / dữ liệu mẫu ─────────────
  addUser(u: DirectoryUser) {
    this.world.users = this.world.users.filter((x) => x.email !== u.email);
    this.world.users.push(u);
    this.touch();
  }
  addGroup(email: string, name: string, members: string[] = []) {
    this.world.groups = this.world.groups.filter((g) => g.email !== email);
    this.world.groups.push({ email, name, members });
    this.touch();
  }
  addGroupMember(group: string, email: string) {
    const g = this.world.groups.find((x) => x.email === group);
    if (g && !g.members.includes(email)) g.members.push(email);
    this.touch();
  }
  addDrive(driveId: string, name: string, permissions: Omit<DrivePermission, 'permissionId'>[] = []) {
    this.world.drives = this.world.drives.filter((d) => d.driveId !== driveId);
    this.world.drives.push({ driveId, name, permissions: permissions.map((p) => ({ ...p, permissionId: this.id('pe') })) });
    this.touch();
  }
  addDrivePermission(driveId: string, p: Omit<DrivePermission, 'permissionId'>) {
    const d = this.world.drives.find((x) => x.driveId === driveId);
    if (d) d.permissions.push({ ...p, permissionId: this.id('pe') });
    this.touch();
  }
  /** Dựng lại một file/thư mục với đúng id cũ (khôi phục sau khi khởi động lại) */
  restoreFile(p: { fileId: string; name: string; mimeType: string; parents: string[]; driveId?: string; text?: string; locked?: boolean }) {
    if (this.world.files[p.fileId]) return;
    this.world.files[p.fileId] = {
      fileId: p.fileId,
      name: p.name,
      mimeType: p.mimeType,
      parents: p.parents,
      driveId: p.driveId,
      createdTime: new Date().toISOString(),
      webViewLink: `https://drive.google.com/fake/${p.fileId}`,
      revision: 1,
      text: p.text ?? '',
      versionRows: [],
      openComments: 0,
      permissions: [],
      ...(p.locked ? { contentRestriction: { readOnly: true, ownerRestricted: true } } : {}),
    };
    this.touch();
  }

  /** Ai đó sửa file trực tiếp trên Drive → phiên bản mới */
  editFile(fileId: string, text?: string, byEmail?: string) {
    const f = this.file(fileId);
    f.revision++;
    if (text !== undefined) f.text = text;
    if (byEmail) f.lastModifierEmail = byEmail;
    f.modifiedTime = new Date().toISOString();
    this.touch();
  }
  setOpenComments(fileId: string, n: number) {
    this.file(fileId).openComments = n;
  }
  /** File tạo thẳng trên Drive, không qua VCdocs */
  createLooseFile(p: { parentGoogleId: string; name: string; mimeType?: string; createdByEmail?: string; createdTime?: string }) {
    return this.meta(
      this.newFile({
        name: p.name,
        mimeType: p.mimeType ?? GDOC_MIME,
        parents: [p.parentGoogleId],
        creatorEmail: p.createdByEmail,
        lastModifierEmail: p.createdByEmail,
        createdTime: p.createdTime ?? new Date().toISOString(),
      }),
    );
  }
  simulateExternalShare(a: Omit<ShareActivity, 'at'> & { at?: string }) {
    this.world.activities.push({ ...a, at: a.at ?? new Date().toISOString() });
  }
  fileState(fileId: string) {
    return this.world.files[fileId];
  }

  // ───────────── Đăng nhập ─────────────
  auth = {
    buildAuthUrl: (p: { state: string; nonce: string; redirectUri: string; hd: string }) => {
      const u = new URL(`${this.opts.publicApiOrigin}/api/v1/dev/fake-google`);
      u.searchParams.set('state', p.state);
      u.searchParams.set('nonce', p.nonce);
      u.searchParams.set('redirect_uri', p.redirectUri);
      u.searchParams.set('hd', p.hd);
      return u.toString();
    },
    /** code dạng fake|email|nonce (trang chọn người dùng giả tạo ra) */
    exchangeCode: async (p: { code: string }): Promise<IdTokenClaims> => {
      this.check('auth.exchangeCode');
      const [tag, email, nonce] = p.code.split('|');
      if (tag !== 'fake' || !email) throw new GoogleError('code không hợp lệ', 400);
      const domain = email.split('@')[1];
      const known = this.world.users.find((u) => u.email === email);
      // Google chỉ trả hd với tài khoản Workspace; gmail.com không có hd
      const hd = domain && domain !== 'gmail.com' ? domain : undefined;
      return { sub: `fake-${email}`, email, email_verified: true, hd, name: known?.name ?? email.split('@')[0], nonce };
    },
  };

  // ───────────── Admin SDK Directory ─────────────
  directory = {
    listUsers: async (domain: string) => {
      this.check('directory.listUsers');
      return this.world.users.filter((u) => u.email.endsWith(`@${domain}`)).map((u) => ({ ...u }));
    },
    getUser: async (email: string) => this.world.users.find((u) => u.email === email),
    listGroups: async (domain: string) =>
      this.world.groups.filter((g) => g.email.endsWith(`@${domain}`)).map(({ email, name }) => ({ email, name })),
    listGroupMembers: async (groupEmail: string) => [...(this.world.groups.find((g) => g.email === groupEmail)?.members ?? [])],
    listUserGroups: async (email: string) => this.world.groups.filter((g) => g.members.includes(email)).map((g) => g.email),
  };

  // ───────────── Drive ─────────────
  drive = {
    listDrives: async () => this.world.drives.map(({ driveId, name }) => ({ driveId, name })),
    listDrivePermissions: async (driveId: string) => {
      this.check('drive.listDrivePermissions');
      const d = this.world.drives.find((x) => x.driveId === driveId);
      if (!d) throw new GoogleError('Drive không tồn tại', 404);
      return d.permissions.map((p) => ({ ...p }));
    },
    getFile: async (fileId: string) => {
      this.check('drive.getFile');
      const f = this.world.files[fileId];
      return f ? this.meta(f) : undefined;
    },
    getCreatorEmail: async (fileId: string) => {
      this.check('drive.getCreatorEmail');
      return this.world.files[fileId]?.creatorEmail?.toLowerCase();
    },
    listFiles: async (driveId: string, opts?: { foldersOnly?: boolean }) =>
      Object.values(this.world.files)
        .filter((f) => f.driveId === driveId && !f.trashed && (opts?.foldersOnly ? f.mimeType === FOLDER_MIME : f.mimeType !== FOLDER_MIME))
        .map((f) => this.meta(f)),
    createFolder: async (p: { driveId: string; parentGoogleId?: string; name: string }) => {
      this.check('drive.createFolder');
      if (p.parentGoogleId && p.parentGoogleId !== p.driveId) this.file(p.parentGoogleId);
      return this.meta(this.newFile({ name: p.name, mimeType: FOLDER_MIME, parents: [p.parentGoogleId ?? p.driveId], driveId: p.driveId }));
    },
    createEmptyDoc: async (p: { parentGoogleId: string; name: string; mimeType?: string }) => {
      this.check('drive.createEmptyDoc');
      return this.meta(this.newFile({ name: p.name, mimeType: p.mimeType ?? GDOC_MIME, parents: [p.parentGoogleId] }));
    },
    copyFile: async (p: { fileId: string; parentGoogleId: string; name: string }) => {
      this.check('drive.copyFile');
      const src = this.file(p.fileId);
      return this.meta(
        this.newFile({ name: p.name, mimeType: src.mimeType, parents: [p.parentGoogleId], text: src.text, rows: src.rows ? JSON.parse(JSON.stringify(src.rows)) : undefined }),
      );
    },
    uploadFile: async (p: { parentGoogleId: string; name: string; mimeType: string; content: Buffer; convertTo?: string; description?: string }) => {
      this.check('drive.uploadFile');
      const isText = p.mimeType.startsWith('text/');
      return this.meta(
        this.newFile({
          name: p.name,
          mimeType: p.convertTo ?? p.mimeType,
          parents: [p.parentGoogleId],
          description: p.description,
          text: isText ? p.content.toString('utf8') : '',
          binaryMd5: p.convertTo ? undefined : md5(p.content),
          binaryBase64: p.convertTo || p.content.length > 2_000_000 ? undefined : p.content.toString('base64'),
          size: p.content.length,
        }),
      );
    },
    updateFile: async (fileId: string, p: { name?: string; description?: string; addParents?: string[]; removeParents?: string[] }) => {
      this.check('drive.updateFile');
      const f = this.file(fileId);
      if (p.name !== undefined) {
        if (f.contentRestriction?.readOnly) throw new GoogleError('File đang khoá, không đổi tên được', 403);
        f.name = p.name;
      }
      if (p.description !== undefined) f.description = p.description;
      if (p.removeParents) f.parents = f.parents.filter((x) => !p.removeParents!.includes(x));
      if (p.addParents) {
        for (const a of p.addParents) {
          const parent = this.world.files[a];
          if (parent) f.driveId = parent.driveId;
          if (!f.parents.includes(a)) f.parents.push(a);
        }
      }
      this.touch();
      return this.meta(f);
    },
    setLock: async (fileId: string, p: { locked: boolean; reason?: string }) => {
      this.check('drive.setLock');
      const f = this.file(fileId);
      f.contentRestriction = p.locked ? { readOnly: true, reason: p.reason, ownerRestricted: true } : { readOnly: false };
      this.touch();
    },
    setDownloadRestriction: async (fileId: string, restricted: boolean) => {
      this.file(fileId).downloadRestricted = restricted;
      this.touch();
    },
    latestRevision: async (fileId: string) => {
      this.check('drive.latestRevision');
      const f = this.file(fileId);
      return { revisionId: `${fileId}-r${f.revision}`, modifiedTime: f.modifiedTime ?? f.createdTime };
    },
    exportPdf: async (fileId: string) => {
      this.check('drive.exportPdf');
      const f = this.file(fileId);
      if (f.binaryBase64 && f.mimeType === 'application/pdf') return Buffer.from(f.binaryBase64, 'base64');
      // PDF tất định theo phiên bản: cùng phiên bản → cùng mã băm
      const pdf = await PDFDocument.create({ updateMetadata: false });
      pdf.setCreationDate(FIXED_DATE);
      pdf.setModificationDate(FIXED_DATE);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const page = pdf.addPage([595, 842]);
      const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').replace(/[^\x20-\x7e]/g, '?');
      page.drawText(ascii(`${f.name} (rev ${f.revision})`), { x: 40, y: 800, size: 12, font });
      ascii(f.text || '').split('\n').slice(0, 40).forEach((line, i) => page.drawText(line.slice(0, 90), { x: 40, y: 770 - i * 16, size: 10, font }));
      return Buffer.from(await pdf.save({ useObjectStreams: false }));
    },
    countOpenComments: async (fileId: string) => {
      this.check('drive.countOpenComments');
      return this.file(fileId).openComments;
    },
    createPermission: async (fileId: string, p: { email: string; role: 'reader' | 'commenter'; expirationTime?: string }) => {
      this.check('drive.createPermission');
      const f = this.file(fileId);
      const permissionId = this.id('pe');
      f.permissions.push({ permissionId, type: 'user', emailAddress: p.email, role: p.role as DriveRole, expirationTime: p.expirationTime });
      this.touch();
      return { permissionId, expirationApplied: !!p.expirationTime };
    },
    updatePermissionExpiry: async (fileId: string, permissionId: string, expirationTime: string) => {
      this.check('drive.updatePermissionExpiry');
      const perm = this.file(fileId).permissions.find((x) => x.permissionId === permissionId);
      if (!perm) throw new GoogleError('Quyền không tồn tại', 404);
      perm.expirationTime = expirationTime;
      this.touch();
      return true;
    },
    deletePermission: async (fileId: string, permissionId: string) => {
      this.check('drive.deletePermission');
      const f = this.file(fileId);
      f.permissions = f.permissions.filter((x) => x.permissionId !== permissionId);
      this.touch();
    },
    listFilePermissions: async (fileId: string) => this.file(fileId).permissions.map((p) => ({ ...p })),
  };

  // ───────────── Docs / Sheets ─────────────
  docs = {
    replacePlaceholders: async (fileId: string, values: Record<string, string>) => {
      this.check('docs.replacePlaceholders');
      const f = this.file(fileId);
      if (f.contentRestriction?.readOnly) throw new GoogleError('File đang khoá', 403);
      let t = f.text;
      for (const [k, v] of Object.entries(values)) t = t.split(`{{${k}}}`).join(v);
      if (t !== f.text) {
        f.text = t;
        f.revision++;
      }
      this.touch();
    },
    replaceText: async (fileId: string, pairs: [string, string][]) => {
      this.check('docs.replaceText');
      const f = this.file(fileId);
      if (f.contentRestriction?.readOnly) throw new GoogleError('File đang khoá', 403);
      let t = f.text;
      for (const [a, b] of pairs) if (a) t = t.split(a).join(b);
      if (t !== f.text) {
        f.text = t;
        f.revision++;
      }
      this.touch();
    },
    appendVersionRow: async (fileId: string, cells: string[]) => {
      const f = this.file(fileId);
      if (f.contentRestriction?.readOnly) throw new GoogleError('File đang khoá', 403);
      f.versionRows.push(cells);
      f.revision++;
      this.touch();
    },
  };

  sheets = {
    createSheet: async (p: { parentGoogleId?: string; title: string; header: string[]; rows: (string | number)[][] }) => {
      this.check('sheets.createSheet');
      const f = this.newFile({ name: p.title, mimeType: GSHEET_MIME, parents: p.parentGoogleId ? [p.parentGoogleId] : [], rows: [p.header, ...p.rows] });
      return f.fileId;
    },
  };

  gmail = {
    send: async (p: { to: string[]; subject: string; html: string }) => {
      this.check('gmail.send');
      this.world.outbox.push({ ...p, at: new Date().toISOString() });
      if (this.world.outbox.length > 500) this.world.outbox.splice(0, this.world.outbox.length - 500);
      this.touch();
    },
  };

  /** Không gọi mạng: trả một PDF nhỏ thay cho nội dung tải về */
  urls = {
    fetch: async (url: string) => {
      this.check('urls.fetch');
      const pdf = await PDFDocument.create({ updateMetadata: false });
      pdf.addPage([200, 200]);
      return { content: Buffer.from(await pdf.save()), mimeType: 'application/pdf', fileName: url.split('/').pop() || 'tai-lieu.pdf' };
    },
  };

  reports = {
    listExternalShares: async (since: Date) => this.world.activities.filter((a) => new Date(a.at) >= since).map((a) => ({ ...a })),
  };
}
