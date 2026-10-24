import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { AuditService } from '../../audit/audit.service';
import { Ctx } from '../../common/context';
import { Errors } from '../../common/errors';
import { sha256, toApi } from '../../common/util';
import { WORKSPACE_STORAGE, WorkspaceStoragePort } from './storage.port';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { createDocumentTemplate } from './docx-template';
import { createSpreadsheetTemplate } from './xlsx-template';
import { createPresentationTemplate } from './pptx-template';
import { officeKind, validOfficePackage } from './ooxml';
import { canonical } from '../../audit/audit.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
type EditorTicket = { fileId: string; companyId: string; userId: string; email: string; exp: number; mode: 'edit' | 'view' };

@Injectable()
export class DriveBasicService {
  constructor(private readonly db: Db, private readonly audit: AuditService,
    @Inject(WORKSPACE_STORAGE) private readonly storage: WorkspaceStoragePort,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private cid(ctx: Ctx) { return new Types.ObjectId(ctx.companyId); }
  private uid(ctx: Ctx) { return new Types.ObjectId(ctx.user.id); }
  private actor(ctx: Ctx) { return { email: ctx.user.email }; }
  private async member(ctx: Ctx, spaceId: string) {
    const member = await this.db.m.WorkspaceSpaceMember.findOne({ companyId: this.cid(ctx),
      spaceId: new Types.ObjectId(spaceId), userId: this.uid(ctx) }).lean<any>();
    if (!member) throw Errors.notFound('Không tìm thấy không gian');
    return member;
  }
  private actions(kind: string, role: string) {
    if (kind === 'space') return role === 'manager'
      ? ['list', 'create-folder', 'upload', 'download'] : ['list', 'download'];
    if (kind === 'folder') return role === 'manager'
      ? ['list', 'create-folder', 'upload', 'rename', 'move', 'trash'] : ['list'];
    return role === 'manager'
      ? ['download', 'rename', 'move', 'upload-version', 'list-versions', 'restore-version', 'trash']
      : ['download', 'list-versions'];
  }
  private async ensureDefaultSpaces(ctx: Ctx) {
    const defaults: Array<{ kind: 'personal' | 'department'; name: string; key: { ownerUserId?: Types.ObjectId; departmentId?: Types.ObjectId } }> = [
      { kind: 'personal', name: 'Cá nhân · ' + ctx.user.name, key: { ownerUserId: this.uid(ctx) } },
    ];
    if (ctx.user.departmentId) {
      const department = await this.db.m.Department.findOne({ _id: ctx.user.departmentId,
        companyId: this.cid(ctx) }, { name: 1 }).lean<any>();
      if (department) defaults.unshift({ kind: 'department', name: department.name, key: { departmentId: department._id } });
    }
    for (const item of defaults) {
      const filter = { companyId: this.cid(ctx), kind: item.kind, ...item.key };
      let space = await this.db.m.WorkspaceSpace.findOne(filter);
      if (!space) {
        try {
          space = await this.db.m.WorkspaceSpace.create({ _id: new Types.ObjectId(), ...filter, name: item.name,
            rootStorageKey: item.kind, createdBy: this.uid(ctx), updatedBy: this.uid(ctx) });
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          space = await this.db.m.WorkspaceSpace.findOne(filter);
        }
      }
      if (!space) throw Errors.notFound('Không tìm thấy không gian');
      const role = item.kind === 'personal' || ctx.user.systemRoles.includes('R4') ? 'manager' : 'reader';
      await this.db.m.WorkspaceSpaceMember.updateOne({ companyId: this.cid(ctx), spaceId: space._id,
        userId: this.uid(ctx) }, { $setOnInsert: { role, createdBy: this.uid(ctx),
        updatedBy: this.uid(ctx) } }, { upsert: true });
      await this.storage.ensureFolder(space.rootStorageKey, this.actor(ctx));
    }
  }
  async spaces(ctx: Ctx) {
    await this.ensureDefaultSpaces(ctx);
    const memberships = await this.db.m.WorkspaceSpaceMember.find({ companyId: this.cid(ctx), userId: this.uid(ctx) }).lean<any[]>();
    const spaces = await this.db.m.WorkspaceSpace.find({ companyId: this.cid(ctx), _id: { $in: memberships.map((m) => m.spaceId) } }).lean<any[]>();
    const roles = new Map(memberships.map((m) => [String(m.spaceId), m.role]));
    return { items: spaces.map((s) => ({ ...toApi(s, ['rootStorageKey']), rootFolderId: String(s._id),
      role: roles.get(String(s._id)), allowedActions: this.actions('space', roles.get(String(s._id))) })) };
  }
  async items(ctx: Ctx, spaceId: string, parentId?: string) {
    const member = await this.member(ctx, spaceId);
    const filter: any = { companyId: this.cid(ctx), spaceId: new Types.ObjectId(spaceId) };
    filter.parentId = parentId ? new Types.ObjectId(parentId) : { $exists: false };
    filter.trashedAt = { $exists: false };
    const rows = await this.db.m.WorkspaceDriveItem.find(filter).sort({ kind: 1, name: 1 }).lean<any[]>();
    return { items: rows.map((r) => ({ ...toApi(r), allowedActions: this.actions(r.kind, member.role) })) };
  }
  private async assertManager(ctx: Ctx, spaceId: string) {
    const member = await this.member(ctx, spaceId);
    if (member.role !== 'manager') throw Errors.forbidden('Không gian này chỉ cho phép đọc');
  }
  private async itemStorageKey(ctx: Ctx, spaceId: string, parentId: string | undefined, leaf: string) {
    const space = await this.db.m.WorkspaceSpace.findOne({ _id: spaceId, companyId: this.cid(ctx) }).lean<any>();
    if (!space) throw Errors.notFound('Không tìm thấy không gian');
    if (!parentId) return space.rootStorageKey + '/' + leaf;
    const parent = await this.db.m.WorkspaceDriveItem.findOne({ _id: parentId, companyId: this.cid(ctx),
      spaceId: new Types.ObjectId(spaceId), kind: 'folder' }).lean<any>();
    if (!parent) throw Errors.notFound('Không tìm thấy thư mục cha');
    return parent.storageKey + '/' + leaf;
  }
  private async assertNameAvailable(ctx: Ctx, spaceId: string, parentId: string | undefined, name: string, excludeId?: Types.ObjectId) {
    const exists = await this.db.m.WorkspaceDriveItem.exists({ companyId: this.cid(ctx),
      spaceId: new Types.ObjectId(spaceId), parentId: parentId ? new Types.ObjectId(parentId) : { $exists: false }, name,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (exists) throw Errors.storageConflict();
  }
  async createFolder(ctx: Ctx, input: { spaceId: string; parentId?: string; name: string }) {
    await this.assertManager(ctx, input.spaceId);
    const name = input.name?.trim();
    if (!name || name.includes('/')) throw Errors.validation('Tên thư mục không hợp lệ');
    await this.assertNameAvailable(ctx, input.spaceId, input.parentId, name);
    const id = new Types.ObjectId();
    const storageKey = await this.itemStorageKey(ctx, input.spaceId, input.parentId, 'folder-' + id.toHexString());
    await this.storage.createFolder(storageKey, this.actor(ctx));
    try {
      const row = await this.db.m.WorkspaceDriveItem.create({ _id: id, companyId: this.cid(ctx),
        spaceId: new Types.ObjectId(input.spaceId), parentId: input.parentId ? new Types.ObjectId(input.parentId) : undefined,
        kind: 'folder', name, storageKey, createdBy: this.uid(ctx), updatedBy: this.uid(ctx) });
      await this.audit.record(ctx, { action: 'workspace_drive.folder.create', objectType: 'workspace_drive_item',
        objectId: id.toHexString(), after: { spaceId: input.spaceId, parentId: input.parentId, name, kind: 'folder' } });
      return { ...toApi(row.toObject()), allowedActions: this.actions('folder', 'manager') };
    } catch (error: any) {
      if (error?.code === 11000) throw Errors.storageConflict();
      throw error;
    }
  }
  async upload(ctx: Ctx, input: { spaceId: string; parentId?: string; provenance?: Record<string, unknown> }, file: Express.Multer.File, key: string) {
    await this.assertManager(ctx, input.spaceId);
    if (!file) throw Errors.validation('Thiếu tệp');
    if (file.size > 10 * 1024 * 1024) throw Errors.tooLarge('Tệp Drive cơ bản tối đa 10 MiB');
    if (!['text/plain', 'application/octet-stream', DOCX, XLSX, PPTX, 'application/pdf'].includes(file.mimetype)) throw Errors.unsupportedMedia();
    const fingerprint = sha256([input.spaceId, input.parentId || '', file.originalname, file.mimetype,
      String(file.size), sha256(file.buffer), canonical(input.provenance ?? {})].join('|'));
    const existing = await this.db.m.UploadAttempt.findOne({ companyId: this.cid(ctx), userId: this.uid(ctx), idempotencyKey: key }).lean<any>();
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Errors.state('Idempotency-Key đã dùng cho nội dung khác');
      if (existing.state === 'done') return this.file(ctx, String(existing.itemId));
    }
    if (!existing) await this.assertNameAvailable(ctx, input.spaceId, input.parentId, file.originalname);
    const id = existing?.itemId ? new Types.ObjectId(existing.itemId) : new Types.ObjectId();
    if (!existing) {
      await this.db.m.UploadAttempt.create({ companyId: this.cid(ctx), userId: this.uid(ctx),
        spaceId: new Types.ObjectId(input.spaceId), idempotencyKey: key, fingerprint, state: 'pending', itemId: id });
    } else {
      await this.db.m.UploadAttempt.updateOne({ _id: existing._id, companyId: this.cid(ctx) },
        { $set: { state: 'pending' }, $unset: { errorCode: 1 } });
    }
    try {
      // Blob phiên bản nằm ở khóa bất biến ngoài cây tên/cha. Vì vậy rename/move
      // metadata không làm mất khả năng đọc lại một phiên bản cũ.
      const storageKey = await this.itemStorageKey(ctx, input.spaceId, undefined, `version-${id.toHexString()}-v1`);
      let stored;
      if (existing) {
        const reconciled = await this.storage.get(storageKey, this.actor(ctx)).catch(() => undefined);
        if (reconciled?.sha256 === sha256(file.buffer)) stored = reconciled;
      }
      if (!stored) {
        try {
          stored = await this.storage.put(storageKey, file.buffer, this.actor(ctx));
        } catch (error: any) {
          if (!['STORAGE_TIMEOUT', 'STORAGE_UNAVAILABLE'].includes(error?.code)) throw error;
          const reconciled = await this.storage.get(storageKey, this.actor(ctx)).catch(() => undefined);
          if (!reconciled || reconciled.sha256 !== sha256(file.buffer)) throw error;
          stored = reconciled;
        }
      }
      if (stored.sha256 !== sha256(file.buffer)) throw Errors.storageIntegrity();
      const row = await this.db.m.WorkspaceDriveItem.create({ _id: id, companyId: this.cid(ctx),
        spaceId: new Types.ObjectId(input.spaceId), parentId: input.parentId ? new Types.ObjectId(input.parentId) : undefined,
        kind: 'file', name: file.originalname, mimeType: file.mimetype, size: file.size,
        contentSha256: stored.sha256, storageKey: stored.key, versionNumber: 1,
        createdBy: this.uid(ctx), updatedBy: this.uid(ctx) });
      const version = await this.db.m.WorkspaceDriveVersion.create({ companyId: this.cid(ctx), fileId: id,
        number: 1, storageKey: stored.key, mimeType: file.mimetype, size: file.size,
        contentSha256: stored.sha256, provenance: input.provenance, createdBy: this.uid(ctx), updatedBy: this.uid(ctx) });
      row.currentVersionId = version._id;
      await row.save();
      await this.db.m.UploadAttempt.updateOne({ companyId: this.cid(ctx), userId: this.uid(ctx),
        idempotencyKey: key, itemId: id }, { $set: { state: 'done' } });
      await this.audit.record(ctx, { action: 'workspace_drive.file.upload', objectType: 'workspace_drive_item',
        objectId: id.toHexString(), after: { spaceId: input.spaceId, name: file.originalname,
          mimeType: file.mimetype, size: file.size, contentSha256: stored.sha256 } });
      return { ...toApi(row.toObject()), allowedActions: ['download'] };
    } catch (error: any) {
      await this.db.m.UploadAttempt.updateOne({ companyId: this.cid(ctx), userId: this.uid(ctx), idempotencyKey: key }, { $set: { state: 'failed', errorCode: error?.code || 'INTERNAL' } });
      if (error?.code === 11000) throw Errors.storageConflict();
      throw error;
    }
  }
  async file(ctx: Ctx, fileId: string) {
    const row = await this.db.m.WorkspaceDriveItem.findOne({ _id: fileId, companyId: this.cid(ctx), kind: 'file',
      trashedAt: { $exists: false } }).lean<any>();
    if (!row) throw Errors.notFound('Không tìm thấy tệp');
    const member = await this.member(ctx, String(row.spaceId));
    return { ...toApi(row), allowedActions: this.actions('file', member.role) };
  }
  async content(ctx: Ctx, fileId: string) {
    const meta: any = await this.file(ctx, fileId);
    const stored = await this.storage.get(meta.storageKey, this.actor(ctx));
    if (stored.sha256 !== meta.contentSha256) throw Errors.storageIntegrity();
    return { meta, bytes: stored.bytes! };
  }

  async versionContent(ctx: Ctx, fileId: string, versionId?: string) {
    const meta: any = await this.file(ctx, fileId);
    const id = versionId || String(meta.currentVersionId);
    const version = await this.db.m.WorkspaceDriveVersion.findOne({ _id: id, companyId: this.cid(ctx), fileId: new Types.ObjectId(fileId) }).lean<any>();
    if (!version) throw Errors.notFound('Không tìm thấy phiên bản tệp');
    const stored = await this.storage.get(version.storageKey, this.actor(ctx));
    if (stored.sha256 !== version.contentSha256) throw Errors.storageIntegrity();
    return { meta, version: toApi(version, ['storageKey']), bytes: stored.bytes! };
  }

  private async activeItem(ctx: Ctx, itemId: string) {
    const row = await this.db.m.WorkspaceDriveItem.findOne({ _id: itemId, companyId: this.cid(ctx),
      trashedAt: { $exists: false } }).lean<any>();
    if (!row) throw Errors.notFound('Không tìm thấy mục Drive');
    const member = await this.member(ctx, String(row.spaceId));
    return { row, member };
  }

  async updateItem(ctx: Ctx, itemId: string, input: { name?: string; parentId?: string | null }) {
    const { row, member } = await this.activeItem(ctx, itemId);
    if (member.role !== 'manager') throw Errors.forbidden('Không gian này chỉ cho phép đọc');
    const name = input.name === undefined ? row.name : input.name.trim();
    if (!name || name.includes('/')) throw Errors.validation('Tên không hợp lệ');
    const parentId = input.parentId === undefined ? row.parentId : input.parentId;
    if (String(parentId || '') === itemId) throw Errors.validation('Không thể di chuyển vào chính mục này');
    if (parentId) {
      const parent = await this.db.m.WorkspaceDriveItem.findOne({ _id: parentId, companyId: this.cid(ctx),
        spaceId: row.spaceId, kind: 'folder', trashedAt: { $exists: false } }).lean<any>();
      if (!parent) throw Errors.notFound('Không tìm thấy thư mục đích');
      if (row.kind === 'folder' && String(parent.storageKey).startsWith(row.storageKey + '/'))
        throw Errors.validation('Không thể di chuyển thư mục vào thư mục con của chính nó');
    }
    await this.assertNameAvailable(ctx, String(row.spaceId), parentId ? String(parentId) : undefined, name, row._id);
    const leaf = row.kind + '-' + itemId;
    const nextKey = row.kind === 'file' ? row.storageKey
      : await this.itemStorageKey(ctx, String(row.spaceId), parentId ? String(parentId) : undefined, leaf);
    if (row.kind === 'folder' && nextKey !== row.storageKey) await this.storage.move(row.storageKey, nextKey, this.actor(ctx));
    const update: any = { $set: { name, storageKey: nextKey, updatedBy: this.uid(ctx) } };
    if (parentId) update.$set.parentId = new Types.ObjectId(parentId);
    else update.$unset = { parentId: 1 };
    await this.db.m.WorkspaceDriveItem.updateOne({ _id: row._id, companyId: this.cid(ctx) }, update);
    if (row.kind === 'folder' && nextKey !== row.storageKey) {
      const descendants = await this.db.m.WorkspaceDriveItem.find({ companyId: this.cid(ctx), spaceId: row.spaceId,
        storageKey: { $regex: '^' + row.storageKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/' } });
      for (const child of descendants) {
        child.storageKey = nextKey + child.storageKey.slice(row.storageKey.length);
        await child.save();
      }
    }
    await this.audit.record(ctx, { action: 'workspace_drive.item.update', objectType: 'workspace_drive_item', objectId: itemId,
      before: { name: row.name, parentId: row.parentId }, after: { name, parentId: parentId || null } });
    const updated = await this.db.m.WorkspaceDriveItem.findOne({ _id: row._id, companyId: this.cid(ctx) }).lean<any>();
    return { ...toApi(updated), allowedActions: this.actions(row.kind, 'manager') };
  }

  async uploadVersion(ctx: Ctx, fileId: string, file: Express.Multer.File) {
    const { row, member } = await this.activeItem(ctx, fileId);
    if (row.kind !== 'file') throw Errors.notFound('Không tìm thấy tệp');
    if (member.role !== 'manager') throw Errors.forbidden('Không gian này chỉ cho phép đọc');
    if (!file) throw Errors.validation('Thiếu tệp');
    if (file.size > 10 * 1024 * 1024) throw Errors.tooLarge('Tệp Drive tối đa 10 MiB');
    if (!['text/plain', 'application/octet-stream', DOCX, 'application/pdf'].includes(file.mimetype)) throw Errors.unsupportedMedia();
    const number = Number(row.versionNumber || 1) + 1;
    const key = await this.itemStorageKey(ctx, String(row.spaceId), undefined,
      `version-${fileId}-v${number}-${new Types.ObjectId().toHexString()}`);
    const stored = await this.storage.put(key, file.buffer, this.actor(ctx));
    if (stored.sha256 !== sha256(file.buffer)) throw Errors.storageIntegrity();
    const version = await this.db.m.WorkspaceDriveVersion.create({ companyId: this.cid(ctx), fileId: row._id,
      number, storageKey: key, mimeType: file.mimetype, size: file.size, contentSha256: stored.sha256,
      createdBy: this.uid(ctx), updatedBy: this.uid(ctx) });
    await this.db.m.WorkspaceDriveItem.updateOne({ _id: row._id, companyId: this.cid(ctx) }, { $set: {
      storageKey: key, currentVersionId: version._id, versionNumber: number, mimeType: file.mimetype,
      size: file.size, contentSha256: stored.sha256, updatedBy: this.uid(ctx),
    } });
    await this.audit.record(ctx, { action: 'workspace_drive.version.create', objectType: 'workspace_drive_item', objectId: fileId,
      after: { versionId: String(version._id), number, size: file.size, contentSha256: stored.sha256 } });
    return this.file(ctx, fileId);
  }

  async versions(ctx: Ctx, fileId: string) {
    await this.file(ctx, fileId);
    const rows = await this.db.m.WorkspaceDriveVersion.find({ companyId: this.cid(ctx), fileId: new Types.ObjectId(fileId) })
      .sort({ number: -1 }).lean<any[]>();
    return { items: rows.map((row) => toApi(row, ['storageKey'])) };
  }

  async restoreVersion(ctx: Ctx, fileId: string, versionId: string) {
    const { row, member } = await this.activeItem(ctx, fileId);
    if (member.role !== 'manager') throw Errors.forbidden('Không gian này chỉ cho phép đọc');
    const version = await this.db.m.WorkspaceDriveVersion.findOne({ _id: versionId, companyId: this.cid(ctx),
      fileId: row._id }).lean<any>();
    if (!version) throw Errors.notFound('Không tìm thấy phiên bản');
    const stored = await this.storage.get(version.storageKey, this.actor(ctx));
    if (stored.sha256 !== version.contentSha256) throw Errors.storageIntegrity();
    // Khôi phục = tạo phiên bản mới (số tiếp theo) trỏ tới đúng blob bất biến của bản cũ,
    // để số phiên bản luôn tăng và key editor không bị dùng lại.
    const number = Number(row.versionNumber || 1) + 1;
    const restored = await this.db.m.WorkspaceDriveVersion.create({ companyId: this.cid(ctx), fileId: row._id,
      number, storageKey: version.storageKey, mimeType: version.mimeType, size: version.size,
      contentSha256: version.contentSha256, createdBy: this.uid(ctx), updatedBy: this.uid(ctx) });
    await this.db.m.WorkspaceDriveItem.updateOne({ _id: row._id, companyId: this.cid(ctx) }, { $set: {
      storageKey: version.storageKey, currentVersionId: restored._id, versionNumber: number,
      mimeType: version.mimeType, size: version.size, contentSha256: version.contentSha256, updatedBy: this.uid(ctx),
    } });
    await this.audit.record(ctx, { action: 'workspace_drive.version.restore', objectType: 'workspace_drive_item', objectId: fileId,
      before: { versionId: row.currentVersionId, number: row.versionNumber },
      after: { versionId: String(restored._id), number, restoredFromVersionId: versionId, restoredFromNumber: version.number } });
    return this.file(ctx, fileId);
  }

  async trash(ctx: Ctx, itemId: string) {
    const { row, member } = await this.activeItem(ctx, itemId);
    if (member.role !== 'manager') throw Errors.forbidden('Không gian này chỉ cho phép đọc');
    const now = new Date();
    await this.db.m.WorkspaceDriveItem.updateOne({ _id: row._id, companyId: this.cid(ctx) }, { $set: {
      trashedAt: now, trashedFromParentId: row.parentId, trashedRootId: row._id, updatedBy: this.uid(ctx),
    } });
    if (row.kind === 'folder') {
      let parents = [row._id];
      while (parents.length) {
        const children = await this.db.m.WorkspaceDriveItem.find({ companyId: this.cid(ctx), spaceId: row.spaceId,
          parentId: { $in: parents }, trashedAt: { $exists: false } }, { _id: 1, kind: 1 }).lean<any[]>();
        if (!children.length) break;
        await this.db.m.WorkspaceDriveItem.updateMany({ companyId: this.cid(ctx), _id: { $in: children.map((item) => item._id) } },
          { $set: { trashedAt: now, trashedRootId: row._id, updatedBy: this.uid(ctx) } });
        parents = children.filter((item) => item.kind === 'folder').map((item) => item._id);
      }
    }
    await this.audit.record(ctx, { action: 'workspace_drive.item.trash', objectType: 'workspace_drive_item', objectId: itemId,
      after: { trashedAt: now.toISOString() } });
    return { id: itemId, trashedAt: now.toISOString() };
  }

  async trashItems(ctx: Ctx, spaceId: string) {
    const member = await this.member(ctx, spaceId);
    const rows = await this.db.m.WorkspaceDriveItem.find({ companyId: this.cid(ctx), spaceId: new Types.ObjectId(spaceId),
      trashedAt: { $exists: true } }).sort({ trashedAt: -1 }).lean<any[]>();
    return { items: rows.filter((row) => String(row._id) === String(row.trashedRootId))
      .map((row) => ({ ...toApi(row), allowedActions: member.role === 'manager' ? ['restore'] : [] })) };
  }

  async restoreItem(ctx: Ctx, itemId: string) {
    const row = await this.db.m.WorkspaceDriveItem.findOne({ _id: itemId, companyId: this.cid(ctx),
      trashedAt: { $exists: true } }).lean<any>();
    if (!row) throw Errors.notFound('Không tìm thấy mục trong thùng rác');
    if (String(row.trashedRootId) !== itemId) throw Errors.notFound('Chỉ khôi phục từ mục gốc trong thùng rác');
    await this.assertManager(ctx, String(row.spaceId));
    if (row.trashedFromParentId) {
      const parent = await this.db.m.WorkspaceDriveItem.findOne({ _id: row.trashedFromParentId,
        companyId: this.cid(ctx), trashedAt: { $exists: false } });
      if (!parent) throw Errors.state('Thư mục cha cũ không còn hoạt động');
    }
    await this.db.m.WorkspaceDriveItem.updateMany({ companyId: this.cid(ctx), trashedRootId: row._id }, {
      $unset: { trashedAt: 1, trashedFromParentId: 1, trashedRootId: 1 }, $set: { updatedBy: this.uid(ctx) },
    });
    await this.audit.record(ctx, { action: 'workspace_drive.item.restore', objectType: 'workspace_drive_item', objectId: itemId,
      after: { parentId: row.parentId || null } });
    const restored = await this.db.m.WorkspaceDriveItem.findOne({ _id: row._id, companyId: this.cid(ctx) }).lean<any>();
    return { ...toApi(restored), allowedActions: this.actions(row.kind, 'manager') };
  }

  async createDocument(ctx: Ctx, input: { spaceId: string; parentId?: string; name: string }, key: string) {
    const name = input.name?.trim().replace(/\.docx$/i, '') + '.docx';
    if (name === '.docx') throw Errors.validation('Tên văn bản không hợp lệ');
    const bytes = createDocumentTemplate(name.replace(/\.docx$/i, ''));
    return this.upload(ctx, input, { originalname: name, mimetype: DOCX, size: bytes.length, buffer: bytes } as any, key);
  }

  async createSpreadsheet(ctx: Ctx, input: { spaceId: string; parentId?: string; name: string }, key: string) {
    const name = input.name?.trim().replace(/\.xlsx$/i, '') + '.xlsx';
    if (name === '.xlsx') throw Errors.validation('Tên bảng tính không hợp lệ');
    const bytes = createSpreadsheetTemplate();
    return this.upload(ctx, input, { originalname: name, mimetype: XLSX, size: bytes.length, buffer: bytes } as any, key);
  }

  async createPresentation(ctx: Ctx, input: { spaceId: string; parentId?: string; name: string }, key: string) {
    const name = input.name?.trim().replace(/\.pptx$/i, '') + '.pptx';
    if (name === '.pptx') throw Errors.validation('Tên trình chiếu không hợp lệ');
    const bytes = createPresentationTemplate(name.replace(/\.pptx$/i, ''));
    return this.upload(ctx, input, { originalname: name, mimetype: PPTX, size: bytes.length, buffer: bytes } as any, key);
  }

  private sign(value: string) { return createHmac('sha256', this.cfg.documentEditor.jwtSecret).update(value).digest('base64url'); }
  private ticket(payload: EditorTicket) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + this.sign(body);
  }
  private readTicket(value: string): EditorTicket {
    const [body, signature] = String(value || '').split('.');
    const expected = this.sign(body || '');
    if (!body || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw Errors.forbidden('Vé editor không hợp lệ');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as EditorTicket;
    if (!payload.exp || payload.exp < Date.now()) throw Errors.forbidden('Vé editor đã hết hạn');
    return payload;
  }
  private jwt(payload: any) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.${this.sign(`${header}.${body}`)}`;
  }

  async editorConfig(ctx: Ctx, fileId: string) {
    if (!this.cfg.documentEditor.enabled) throw Errors.state('Trình soạn thảo đang tắt');
    const file: any = await this.file(ctx, fileId);
    const kind = officeKind(file.mimeType, file.name);
    if (!kind) throw Errors.validation('ONLYOFFICE chỉ mở DOCX, XLSX hoặc PPTX trong phạm vi hiện tại');
    const member = await this.member(ctx, file.spaceId);
    const mode = member.role === 'manager' ? 'edit' : 'view';
    const editorTicket = this.ticket({ fileId, companyId: ctx.companyId, userId: ctx.user.id,
      email: ctx.user.email, exp: Date.now() + 15 * 60_000, mode });
    const api = this.cfg.documentEditor.apiOriginForEditor.replace(/\/$/, '');
    const config: any = {
      documentType: kind === 'document' ? 'word' : kind === 'spreadsheet' ? 'cell' : 'slide',
      document: { fileType: kind === 'document' ? 'docx' : kind === 'spreadsheet' ? 'xlsx' : 'pptx', key: `vcw-${fileId}-v${file.versionNumber}`, title: file.name,
        url: `${api}/api/v1/drive/editor/content?ticket=${encodeURIComponent(editorTicket)}`,
        permissions: { edit: mode === 'edit', download: true, print: true, comment: mode === 'edit' },
        referenceData: { fileKey: fileId, instanceId: api } },
      editorConfig: { mode, lang: 'vi', callbackUrl: `${api}/api/v1/drive/editor/callback?ticket=${encodeURIComponent(editorTicket)}`,
        coEditing: { mode: 'fast', change: false }, user: { id: ctx.user.id, name: ctx.user.name },
        customization: { autosave: true, forcesave: true } },
    };
    return { documentServerUrl: this.cfg.documentEditor.publicOrigin.replace(/\/$/, ''), config: { ...config, token: this.jwt(config) }, mode };
  }

  async exportDocument(ctx: Ctx, fileId: string, format: 'docx' | 'xlsx' | 'pptx' | 'pdf') {
    const file: any = await this.file(ctx, fileId);
    const kind = officeKind(file.mimeType, file.name);
    if (!kind) throw Errors.validation('Chỉ xuất tệp Office DOCX, XLSX hoặc PPTX');
    const nativeFormat = kind === 'document' ? 'docx' : kind === 'spreadsheet' ? 'xlsx' : 'pptx';
    if (format === nativeFormat) {
      const current = await this.content(ctx, fileId);
      return { bytes: current.bytes, mimeType: file.mimeType, name: file.name };
    }
    if (format !== 'pdf') throw Errors.validation('Định dạng xuất không hỗ trợ');
    const ticket = this.ticket({ fileId, companyId: ctx.companyId, userId: ctx.user.id,
      email: ctx.user.email, exp: Date.now() + 5 * 60_000, mode: 'view' });
    const api = this.cfg.documentEditor.apiOriginForEditor.replace(/\/$/, '');
    const payload = { async: false, filetype: nativeFormat, outputtype: 'pdf',
      key: `export-${fileId}-v${file.versionNumber}`, title: file.name,
      url: `${api}/api/v1/drive/editor/content?ticket=${encodeURIComponent(ticket)}` };
    const origin = this.cfg.documentEditor.internalOrigin.replace(/\/$/, '');
    const response = await fetch(`${origin}/converter`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${this.jwt(payload)}` },
      body: JSON.stringify({ ...payload, token: this.jwt(payload) }), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw Errors.storageUnavailable('Editor không xuất được PDF');
    const converted: any = await response.json();
    if (!converted.endConvert || !converted.fileUrl) throw Errors.storageUnavailable('Editor chưa hoàn tất xuất PDF');
    const parsed = new URL(converted.fileUrl); const allowed = new URL(this.cfg.documentEditor.internalOrigin);
    if (parsed.protocol !== allowed.protocol || parsed.hostname !== allowed.hostname || (parsed.port || '') !== (allowed.port || ''))
      throw Errors.storageUnavailable('Editor trả URL xuất không an toàn');
    const fileResponse = await fetch(converted.fileUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (!fileResponse.ok || bytes.subarray(0, 4).toString() !== '%PDF') throw Errors.storageIntegrity('PDF xuất không hợp lệ');
    return { bytes, mimeType: 'application/pdf', name: file.name.replace(/\.(docx|xlsx|pptx)$/i, '.pdf') };
  }

  async editorContent(ticketValue: string) {
    if (!this.cfg.documentEditor.enabled) throw Errors.notFound('Không tìm thấy văn bản');
    const ticket = this.readTicket(ticketValue);
    const row = await this.db.m.WorkspaceDriveItem.findOne({ _id: ticket.fileId, companyId: ticket.companyId,
      kind: 'file', trashedAt: { $exists: false } }).lean<any>();
    if (!row) throw Errors.notFound('Không tìm thấy văn bản');
    const stored = await this.storage.get(row.storageKey, { email: ticket.email });
    if (stored.sha256 !== row.contentSha256) throw Errors.storageIntegrity();
    return { row, bytes: stored.bytes! };
  }

  async editorCallback(ticketValue: string, body: any, authorization?: string) {
    if (!this.cfg.documentEditor.enabled) return { error: 1 };
    const ticket = this.readTicket(ticketValue);
    if (ticket.mode !== 'edit') return { error: 1 };
    // Document Server ký toàn bộ callback; không nhận callback không xác thực.
    const token = String(authorization || '').replace(/^Bearer\s+/i, '') || body?.token;
    if (!this.verifyJwt(token)) return { error: 1 };
    if (![2, 6].includes(Number(body?.status))) return { error: 0 };
    const editorKey = String(body?.key || ''); const url = String(body?.url || '');
    const expectedKeyPrefix = `vcw-${ticket.fileId}-v`;
    if (!editorKey.startsWith(expectedKeyPrefix)) return { error: 1 };
    let parsed: URL;
    try { parsed = new URL(url); } catch { return { error: 1 }; }
    const allowed = new URL(this.cfg.documentEditor.internalOrigin);
    if (parsed.protocol !== allowed.protocol || parsed.hostname !== allowed.hostname || (parsed.port || '') !== (allowed.port || '')) return { error: 1 };
    const fingerprint = sha256(`${editorKey}|${body.status}|${url}`);
    const existing = await this.db.m.WorkspaceEditorSave.findOne({ companyId: ticket.companyId, fileId: ticket.fileId, callbackFingerprint: fingerprint }).lean<any>();
    if (existing?.status === 'saved') {
      const auditId = await this.audit.write({ companyId: ticket.companyId, userId: ticket.userId, email: ticket.email }, {
        action: 'workspace_drive.editor.callback.replay', objectType: 'workspace_drive_item', objectId: ticket.fileId,
        after: { editorKey, status: body.status, replayed: true },
      });
      return { error: 0, auditId };
    }
    const save = existing || await this.db.m.WorkspaceEditorSave.create({ companyId: ticket.companyId,
      createdBy: ticket.userId, updatedBy: ticket.userId, fileId: ticket.fileId, editorKey, callbackFingerprint: fingerprint, status: 'saving' });
    try {
      const row = await this.db.m.WorkspaceDriveItem.findOne({ _id: ticket.fileId, companyId: ticket.companyId, kind: 'file' }).lean<any>();
      if (!row) throw new Error('NOT_FOUND');
      // Hai phiên cùng version dùng chung key. Sau khi một callback đã tạo version
      // mới, callback khác mang key cũ không được ghi đè currentVersion.
      if (editorKey !== `vcw-${ticket.fileId}-v${row.versionNumber}`) throw new Error('EDITOR_STALE_VERSION');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('EDITOR_DOWNLOAD_FAILED');
      const bytes = Buffer.from(await response.arrayBuffer());
      const kind = officeKind(row.mimeType, row.name);
      if (!kind || bytes.length > 10 * 1024 * 1024 || !validOfficePackage(bytes, kind)) throw new Error('EDITOR_INVALID_OOXML');
      const number = Number(row.versionNumber || 1) + 1;
      const key = `${String(row.storageKey).split('/').slice(0, -1).join('/')}/version-${ticket.fileId}-v${number}-${new Types.ObjectId().toHexString()}`;
      const stored = await this.storage.put(key, bytes, { email: ticket.email });
      if (stored.sha256 !== sha256(bytes)) throw new Error('STORAGE_INTEGRITY_MISMATCH');
      const version = await this.db.m.WorkspaceDriveVersion.create({ companyId: ticket.companyId, fileId: row._id,
        number, storageKey: key, mimeType: row.mimeType, size: bytes.length, contentSha256: stored.sha256,
        createdBy: ticket.userId, updatedBy: ticket.userId });
      await this.db.m.WorkspaceDriveItem.updateOne({ _id: row._id, companyId: ticket.companyId }, { $set: {
        storageKey: key, currentVersionId: version._id, versionNumber: number, mimeType: row.mimeType, size: bytes.length,
        contentSha256: stored.sha256, updatedBy: new Types.ObjectId(ticket.userId) } });
      await this.db.m.WorkspaceEditorSave.updateOne({ _id: save._id, companyId: ticket.companyId }, { $set: { status: 'saved', versionId: version._id } });
      const auditId = await this.audit.write({ companyId: ticket.companyId, userId: ticket.userId, email: ticket.email }, {
        action: 'workspace_drive.editor.save', objectType: 'workspace_drive_item', objectId: ticket.fileId,
        after: { editorKey, status: body.status, versionId: String(version._id), number, size: bytes.length, contentSha256: stored.sha256 },
      });
      return { error: 0, auditId };
    } catch (error: any) {
      await this.db.m.WorkspaceEditorSave.updateOne({ _id: save._id, companyId: ticket.companyId }, { $set: { status: 'failed', errorCode: error?.message || 'EDITOR_SAVE_FAILED' } });
      return { error: 1 };
    }
  }

  private verifyJwt(token: string) {
    const [header, body, signature] = String(token || '').split('.');
    if (!header || !body || !signature) return false;
    const expected = this.sign(`${header}.${body}`);
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
