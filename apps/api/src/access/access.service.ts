import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../db/db.service';
import { Errors } from '../common/errors';
import type { Ctx, RequestCtx } from '../common/context';
import { DriveRole, SecurityLevel, SystemRole, driveRoleAtLeast } from '../common/enums';

export interface DeptInfo {
  id: string;
  code: string;
  number: string;
  name: string;
  driveId: string;
  securityLevel: SecurityLevel;
  blockId?: string;
  headId?: string;
}

/**
 * Quyền ba tầng (hợp đồng mục 7): (1) vai trò hệ thống R1–R9, (2) phạm vi
 * phòng/khối, (3) vai trò trên drive chứa đối tượng. Đối tượng ở drive Mật mà
 * người gọi không xem được → 404 (không lộ sự tồn tại).
 */
@Injectable()
export class AccessService {
  private deptCache = new Map<string, { at: number; list: DeptInfo[] }>();
  constructor(private readonly db: Db) {}

  invalidate(companyId: string) {
    this.deptCache.delete(companyId);
  }

  async departments(companyId: string): Promise<DeptInfo[]> {
    const c = this.deptCache.get(companyId);
    if (c && Date.now() - c.at < 30_000) return c.list;
    const rows = await this.db.m.Department.find({ companyId: new Types.ObjectId(companyId) }).lean<any[]>();
    const list = rows.map((d) => ({
      id: String(d._id),
      code: d.code,
      number: d.number,
      name: d.name,
      driveId: d.driveId,
      securityLevel: d.securityLevel,
      blockId: d.blockId ? String(d.blockId) : undefined,
      headId: d.headId ? String(d.headId) : undefined,
    }));
    this.deptCache.set(companyId, { at: Date.now(), list });
    return list;
  }

  async deptById(companyId: string, id?: string): Promise<DeptInfo | undefined> {
    if (!id) return undefined;
    return (await this.departments(companyId)).find((d) => d.id === String(id));
  }
  async deptByDrive(companyId: string, driveId?: string): Promise<DeptInfo | undefined> {
    if (!driveId) return undefined;
    return (await this.departments(companyId)).find((d) => d.driveId === driveId);
  }
  async securityOfDrive(companyId: string, driveId?: string): Promise<SecurityLevel> {
    return (await this.deptByDrive(companyId, driveId))?.securityLevel ?? 'department';
  }

  /** Nạp vai trò drive, danh sách drive được xem vào ctx (gọi sau khi xác thực phiên) */
  async loadAccess(ctx: RequestCtx, user: any) {
    ctx.driveRoles = new Map((user.driveRoles || []).map((r: any) => [r.driveId, r.role as DriveRole]));
    const depts = await this.departments(String(user.companyId));
    const visible = new Set<string>(ctx.driveRoles.keys());
    // Drive Nội bộ (00 VCPV Chung) ai đăng nhập cũng xem được
    for (const d of depts) if (d.securityLevel === 'internal') visible.add(d.driveId);
    ctx.visibleDriveIds = [...visible];
  }

  // ───── tầng 1: vai trò hệ thống ─────
  hasRole(ctx: Ctx, ...roles: SystemRole[]): boolean {
    return roles.some((r) => ctx.user.systemRoles.includes(r));
  }
  requireRole(ctx: Ctx, ...roles: SystemRole[]) {
    if (!this.hasRole(ctx, ...roles)) throw Errors.forbidden(`Cần vai trò ${roles.join(' hoặc ')}`);
  }

  // ───── tầng 2: phạm vi phòng ─────
  /** Trưởng phòng (R4) của phòng này: phòng của mình hoặc được ghi là trưởng phòng */
  async isHeadOf(ctx: Ctx, departmentId?: string): Promise<boolean> {
    if (!departmentId || !this.hasRole(ctx, 'R4')) return false;
    if (ctx.user.departmentId === String(departmentId)) return true;
    const d = await this.deptById(ctx.companyId, departmentId);
    return d?.headId === ctx.user.id;
  }
  async requireHeadOf(ctx: Ctx, departmentId?: string) {
    if (!(await this.isHeadOf(ctx, departmentId))) throw Errors.forbidden('Chỉ trưởng phòng (R4) của phòng này được làm');
  }

  // ───── tầng 3: drive ─────
  driveRole(ctx: Ctx, driveId?: string): DriveRole | undefined {
    return driveId ? ctx.driveRoles.get(driveId) : undefined;
  }
  canViewDrive(ctx: RequestCtx, driveId?: string): boolean {
    return !!driveId && ctx.visibleDriveIds.includes(driveId);
  }
  requireDriveRole(ctx: Ctx, driveId: string | undefined, min: DriveRole) {
    if (!driveRoleAtLeast(this.driveRole(ctx, driveId), min)) {
      throw Errors.forbidden('Bạn không có đủ quyền trên drive chứa đối tượng này');
    }
  }

  /**
   * Đối tượng người gọi không được xem: drive Mật → 404, drive khác → 403.
   * `extraAllowed` = người liên quan trực tiếp (người soạn, người duyệt…).
   */
  async assertVisible(ctx: Ctx, driveId: string | undefined, extraAllowed = false) {
    if (extraAllowed || this.canViewDrive(ctx, driveId)) return;
    const level = await this.securityOfDrive(ctx.companyId, driveId);
    if (level === 'confidential') throw Errors.notFound();
    throw Errors.forbidden('Bạn không được xem nội dung drive này');
  }

  /** Bộ lọc Mongo: chỉ đối tượng ở drive được xem (lọc ở tầng CSDL, không lọc sau) */
  visibleFilter(ctx: Ctx, driveField = 'driveId', participantFields: string[] = []) {
    const me = new Types.ObjectId(ctx.user.id);
    return {
      $or: [{ [driveField]: { $in: ctx.visibleDriveIds } }, ...participantFields.map((f) => ({ [f]: me }))],
    };
  }

  /** Người dùng đầu tiên còn làm có vai trò này */
  async firstUserWithRole(companyId: string, role: SystemRole): Promise<any | undefined> {
    return this.db.m.User.findOne({ companyId: new Types.ObjectId(companyId), systemRoles: role, status: { $ne: 'left' } })
      .sort({ createdAt: 1 })
      .lean();
  }
}
