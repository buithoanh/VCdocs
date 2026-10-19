import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { AccessService } from '../../access/access.service';
import { Errors } from '../../common/errors';
import type { Ctx } from '../../common/context';
import type { FolderKind } from '../../common/enums';
import { toApi } from '../../common/util';

/** Vùng số trong khung (BR-11), áp dụng ở gốc drive */
const ROOT_RANGES: Partial<Record<FolderKind, { from: number; to: number; step?: number }>> = {
  docs: { from: 0, to: 0 },
  plan_report: { from: 1, to: 1 },
  operations: { from: 2, to: 9 },
  area: { from: 10, to: 49, step: 10 },
  project: { from: 50, to: 89 },
  closed: { from: 98, to: 98 },
  archive: { from: 99, to: 99 },
};
export const UNNUMBERED: FolderKind[] = ['year', 'month', 'entity'];

export function folderToken(code?: string, shortName?: string) {
  if (!code) return shortName ?? '';
  if (!shortName || code.toLowerCase().includes(shortName.toLowerCase())) return code;
  return `${code}-${shortName}`;
}
/** Tên thư mục = số 2 chữ số + MÃ-TÊN NGẮN + tên đầy đủ; năm, tháng, đối tượng không đánh số (BR-11) */
export function folderName(p: { number?: string; code?: string; shortName?: string; fullName?: string }) {
  return [p.number, folderToken(p.code, p.shortName), p.fullName].filter((x) => x && String(x).trim()).join(' ').trim();
}
const pad = (n: number) => String(n).padStart(2, '0');

@Injectable()
export class FoldersService {
  constructor(private readonly db: Db, private readonly access: AccessService, @Inject(GOOGLE) private readonly google: GooglePorts) {}

  cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }

  toApi(f: any, hasChildren?: boolean) {
    const o: any = toApi(f, ['hasPeriods', 'originalParentKey']);
    if (hasChildren !== undefined) o.hasChildren = hasChildren;
    return o;
  }

  async withChildrenFlag(companyId: string, rows: any[]) {
    if (!rows.length) return [];
    const parents = await this.db.m.Folder.distinct('parentId', { companyId: this.cid(companyId), parentId: { $in: rows.map((r) => r._id) } });
    const set = new Set(parents.map(String));
    return rows.map((r) => this.toApi(r, set.has(String(r._id))));
  }

  async get(companyId: string, id: string | Types.ObjectId) {
    return this.db.m.Folder.findOne({ _id: id, companyId: this.cid(companyId) }).lean<any>();
  }

  /** Thư mục người gọi được xem; drive Mật không xem được → 404 */
  async getVisible(ctx: Ctx, id: string) {
    const f = await this.get(ctx.companyId, id);
    if (!f) throw Errors.notFound('Không tìm thấy thư mục');
    await this.access.assertVisible(ctx, f.driveId);
    return f;
  }

  parentKey(driveId: string, parentId?: string | Types.ObjectId) {
    return parentId ? String(parentId) : `root:${driveId}`;
  }

  /** Số kế tiếp còn trống; số đã cấp (kể cả dự án đã kết thúc) không cấp lại */
  async nextNumber(companyId: string, driveId: string, parentId: string | undefined, kind: FolderKind): Promise<string> {
    if (UNNUMBERED.includes(kind)) return '';
    const key = this.parentKey(driveId, parentId);
    const used = new Set<string>(
      (await this.db.m.FolderNumber.find({ companyId: this.cid(companyId), parentKey: key }, { number: 1 }).lean<any[]>()).map((x) => x.number),
    );
    const siblings = await this.db.m.Folder.find({ companyId: this.cid(companyId), driveId, parentId: parentId ? new Types.ObjectId(parentId) : { $exists: false } }, { number: 1 }).lean<any[]>();
    siblings.forEach((s) => s.number && used.add(s.number));
    let range = ROOT_RANGES[kind];
    if (parentId) range = kind === 'closed' ? { from: 98, to: 98 } : kind === 'archive' ? { from: 99, to: 99 } : { from: 1, to: 97 };
    if (!range) throw Errors.rule('BR-11', 'Loại thư mục này không đánh số');
    const candidates: number[] = [];
    if (range.step) for (let n = range.from; n <= range.to; n += range.step) candidates.push(n);
    for (let n = range.from; n <= range.to; n++) if (!candidates.includes(n)) candidates.push(n);
    const free = candidates.find((n) => !used.has(pad(n)));
    if (free === undefined) throw Errors.rule('BR-11', `Hết số trống trong vùng ${pad(range.from)}–${pad(range.to)}`);
    return pad(free);
  }

  async reserveNumber(companyId: string, driveId: string, parentId: string | undefined, number: string) {
    if (!number) return;
    try {
      await this.db.m.FolderNumber.create({ companyId: this.cid(companyId), parentKey: this.parentKey(driveId, parentId), number });
    } catch (e: any) {
      if (e?.code === 11000) throw Errors.duplicate(`Số ${number} vừa được cấp cho thư mục khác, hãy thử lại`);
      throw e;
    }
  }

  async pathOf(companyId: string, driveId: string, parent: any | undefined, name: string) {
    if (parent) return `${parent.path} / ${name}`;
    const d = await this.access.deptByDrive(companyId, driveId);
    return `${d ? `${d.number} ${d.code}` : driveId} / ${name}`;
  }

  /** Tạo thư mục trên Drive rồi ghi sổ (ghi sổ sau khi Drive làm xong – BA 9.3) */
  async createFolder(companyId: string, userId: string | undefined, p: { driveId: string; parentId?: string; kind: FolderKind; number: string; code?: string; shortName: string; fullName?: string; year?: number; month?: number; hasPeriods?: boolean }) {
    const parent = p.parentId ? await this.get(companyId, p.parentId) : undefined;
    const name = folderName(p);
    const g = await this.google.drive.createFolder({ driveId: p.driveId, parentGoogleId: parent?.googleId, name });
    const securityLevel = await this.access.securityOfDrive(companyId, p.driveId);
    const by = userId ? new Types.ObjectId(userId) : undefined;
    const row = await this.db.m.Folder.create({
      companyId: this.cid(companyId),
      driveId: p.driveId,
      googleId: g.fileId,
      parentId: parent?._id,
      number: p.number,
      code: p.code,
      shortName: p.shortName,
      fullName: p.fullName ?? '',
      name,
      kind: p.kind,
      path: await this.pathOf(companyId, p.driveId, parent, name),
      year: p.year,
      month: p.month,
      securityLevel,
      status: 'active',
      isManagedByVcdocs: true,
      hasPeriods: p.hasPeriods ?? ['area', 'project', 'operations', 'plan_report'].includes(p.kind),
      createdBy: by,
      updatedBy: by,
    });
    return row.toObject();
  }

  /** Thư mục năm / tháng của công việc (BR-10); thiếu thì tạo */
  async ensurePeriod(companyId: string, folderId: string | Types.ObjectId, month: string, userId?: string): Promise<{ folder: any; created: number }> {
    const base = await this.get(companyId, folderId);
    if (!base) throw Errors.notFound('Không tìm thấy thư mục lưu');
    const [y, mm] = month.split('-').map(Number);
    let created = 0;
    const find = (parentId: Types.ObjectId, kind: string, shortName: string) =>
      this.db.m.Folder.findOne({ companyId: this.cid(companyId), parentId, kind, shortName }).lean<any>();
    let year = await find(base._id, 'year', String(y));
    if (!year) {
      year = await this.createFolder(companyId, userId, { driveId: base.driveId, parentId: String(base._id), kind: 'year', number: '', shortName: String(y), year: y, hasPeriods: false });
      created++;
    }
    let mon = await find(year._id, 'month', month);
    if (!mon) {
      mon = await this.createFolder(companyId, userId, { driveId: base.driveId, parentId: String(year._id), kind: 'month', number: '', shortName: month, year: y, month: mm, hasPeriods: false });
      created++;
    }
    return { folder: mon, created };
  }

  /** Thư mục gốc theo loại trong drive (vd 98 Đã kết thúc, 00 Tài liệu) */
  async rootOfKind(companyId: string, driveId: string, kind: FolderKind) {
    return this.db.m.Folder.findOne({ companyId: this.cid(companyId), driveId, kind, parentId: { $exists: false } }).lean<any>();
  }

  /** Đổi lại đường dẫn của cả nhánh sau khi đổi tên hoặc di chuyển */
  async repath(companyId: string, folder: any) {
    const children = await this.db.m.Folder.find({ companyId: this.cid(companyId), parentId: folder._id }).lean<any[]>();
    for (const c of children) {
      const path = `${folder.path} / ${c.name}`;
      await this.db.m.Folder.updateOne({ _id: c._id, companyId: c.companyId }, { $set: { path } });
      await this.repath(companyId, { ...c, path });
    }
  }
}
