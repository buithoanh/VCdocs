import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { escapeRegex, oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { GoogleSyncService } from './google-sync.service';
import { HandoversService } from '../m10-handovers/handovers.service';

export const USER_PRIVATE = ['groupRoles', 'manualRoles', 'groupEmails', 'driveRoles', 'isSuspended', 'lastLoginAt', 'notificationSettings'];
/** allowedActions của User (D9): R9 đổi vai trò người khác; R3 ghi ngày nghỉ */
export function userActions(ctx: Ctx, u: any): string[] {
  const out: string[] = [];
  if (ctx.user.systemRoles.includes('R9') && String(u._id) !== ctx.user.id) out.push('update-roles');
  if (ctx.user.systemRoles.includes('R3') && u.status !== 'left') out.push('update-leave');
  return out;
}
export function userToApi(ctx: Ctx, u: any) {
  return { ...toApi(u, USER_PRIVATE), allowedActions: userActions(ctx, u) };
}

@Controller()
export class MeController {
  constructor(private readonly db: Db, private readonly access: AccessService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** Tôi là ai: vai trò hệ thống, phòng, vai trò trên từng drive, csrfToken */
  @Get('me')
  async me(@CurrentCtx() ctx: Ctx) {
    const u = await this.db.m.User.findOne({ _id: new Types.ObjectId(ctx.user.id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    const depts = await this.access.departments(ctx.companyId);
    const drives = depts
      .filter((d) => ctx.driveRoles.has(d.driveId))
      .map((d) => ({ driveId: d.driveId, departmentId: d.id, name: `${d.number} ${d.code}`, role: ctx.driveRoles.get(d.driveId)!, securityLevel: d.securityLevel }));
    const block = await this.db.m.Block.findOne({ companyId: new Types.ObjectId(ctx.companyId), directorId: new Types.ObjectId(ctx.user.id) }).lean<any>();
    const r = this.cfg.rules;
    const auditor = await this.access.auditorScope(ctx.companyId, ctx.user.id);
    return {
      user: userToApi(ctx, u),
      systemRoles: ctx.user.systemRoles,
      departmentId: ctx.user.departmentId,
      ...(block ? { blockId: String(block._id) } : {}),
      drives,
      // Con số cấu hình để FE báo trước; BE vẫn là nơi quyết định (D12)
      limits: {
        shareMaxDays: r.shareMaxDays,
        backdateWorkingDays: r.backdateMaxWorkingDays,
        approvalDueDays: r.approvalDueDays,
        minorUnlockDays: r.minorUnlockDays,
        uploadMaxMb: 100,
        auditorMaxDays: r.auditorMaxDays,
        evidencePackDays: r.evidencePackDays,
      },
      ...(auditor ? { auditorAccess: { id: auditor.primaryId, departmentIds: auditor.departmentIds, expiresAt: auditor.expiresAt.toISOString() } } : {}),
      csrfToken: ctx.csrfToken,
      sessionExpiresAt: ctx.sessionExpiresAt?.toISOString(),
    };
  }
}

/** M01 người dùng: R3, R9 xem tất cả; R4 chỉ phòng mình (trả tối thiểu) */
@Controller()
export class UsersController {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly handovers: HandoversService,
    sync: GoogleSyncService,
  ) {
    jobs.register('google.sync', {
      title: 'Đồng bộ nhân sự, nhóm, thành viên drive',
      steps: ['Đọc nhân sự từ Google', 'Đọc nhóm Google', 'Cập nhật vai trò và thành viên drive'],
      handler: async (job) => sync.syncAll(job.companyId, job.step),
    });
  }

  private scopeDept(ctx: Ctx): string | undefined {
    if (this.access.hasRole(ctx, 'R3', 'R9')) return undefined;
    if (!ctx.user.departmentId) throw Errors.forbidden('Bạn chưa thuộc phòng nào');
    return ctx.user.departmentId;
  }

  @Get('users')
  @Roles('R3', 'R9', 'R4')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['name', 'email', 'createdAt', 'updatedAt', 'status'], 'name');
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    const forced = this.scopeDept(ctx);
    if (forced && q.departmentId && q.departmentId !== forced) throw Errors.forbidden('Trưởng phòng chỉ xem nhân sự phòng mình');
    const dept = forced ?? q.departmentId;
    if (dept) filter.departmentId = new Types.ObjectId(dept);
    if (q.role) filter.systemRoles = q.role;
    if (q.status) filter.status = q.status;
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q), 'i');
      filter.$or = [{ name: re }, { email: re }];
    }
    const [items, total] = await Promise.all([
      this.db.m.User.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean(),
      this.db.m.User.countDocuments(filter),
    ]);
    return pageResult(items.map((u) => userToApi(ctx, u)), p, total);
  }

  /** Tra người để chọn (người soạn, người góp ý…): mọi người đã đăng nhập, chỉ người đang làm, tối đa 20 (D3) */
  @Get('users/lookup')
  async lookup(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const re = new RegExp(escapeRegex(q.q.trim()), 'i');
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId), status: { $in: ['active', 'leaving'] }, isSuspended: { $ne: true }, $or: [{ name: re }, { email: re }, { title: re }] };
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    const rows = await this.db.m.User.find(filter, { name: 1, email: 1, title: 1, departmentId: 1 }).sort({ name: 1 }).limit(20).lean<any[]>();
    return {
      items: rows.map((u) => ({ id: String(u._id), name: u.name, email: u.email, ...(u.title ? { title: u.title } : {}), ...(u.departmentId ? { departmentId: String(u.departmentId) } : {}) })),
    };
  }

  private async load(ctx: Ctx, id: string) {
    const u = await this.db.m.User.findOne({ _id: oid(id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    if (!u) throw Errors.notFound('Không tìm thấy nhân sự');
    return u;
  }

  @Get('users/:id')
  @Roles('R3', 'R9', 'R4')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const u = await this.load(ctx, id);
    const forced = this.scopeDept(ctx);
    if (forced && String(u.departmentId) !== forced) throw Errors.forbidden('Trưởng phòng chỉ xem nhân sự phòng mình');
    return userToApi(ctx, u);
  }

  /** R9 đổi vai trò hệ thống; R3 ghi ngày nghỉ việc */
  @Patch('users/:id')
  @Roles('R3', 'R9')
  async patch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { systemRoles?: string[]; lastWorkingDay?: string }) {
    const u = await this.load(ctx, id);
    const set: any = { updatedBy: new Types.ObjectId(ctx.user.id) };
    if (body.systemRoles === undefined && body.lastWorkingDay === undefined) throw Errors.validation('Không có gì để sửa');
    if (body.systemRoles !== undefined) {
      if (!this.access.hasRole(ctx, 'R9')) throw Errors.forbidden('Chỉ quản trị hệ thống (R9) đổi vai trò');
      if (String(u._id) === ctx.user.id) throw Errors.forbidden('Không được tự sửa vai trò của chính mình');
      const wanted = [...new Set(body.systemRoles)].sort();
      const fromGroups: string[] = u.groupRoles ?? [];
      const missing = fromGroups.filter((r) => !wanted.includes(r));
      if (missing.length) {
        throw Errors.rule('BR-15', `Vai trò ${missing.join(', ')} được cấp qua nhóm Google; muốn gỡ thì gỡ khỏi nhóm`, [{ field: 'systemRoles', issue: 'granted_by_group' }]);
      }
      set.manualRoles = wanted.filter((r) => !fromGroups.includes(r));
      set.systemRoles = wanted;
    }
    let plan: Awaited<ReturnType<HandoversService['planForLastWorkingDay']>> | undefined;
    if (body.lastWorkingDay !== undefined) {
      if (!this.access.hasRole(ctx, 'R3')) throw Errors.forbidden('Chỉ HCNS (R3) ghi ngày nghỉ việc');
      if (u.status === 'left') throw Errors.state('Người này đã nghỉ việc');
      // Kiểm biên bản bàn giao trước khi ghi (E4): đang chuyển quyền, đã xong → 409
      plan = await this.handovers.planForLastWorkingDay(ctx, u);
      set.lastWorkingDay = body.lastWorkingDay;
      if (u.status === 'active') set.status = 'leaving';
    }
    await this.db.m.User.updateOne({ _id: u._id, companyId: u.companyId }, { $set: set });
    const after = await this.load(ctx, id);
    await this.audit.record(ctx, {
      action: 'user.update',
      objectType: 'user',
      objectId: id,
      before: { systemRoles: u.systemRoles, lastWorkingDay: u.lastWorkingDay, status: u.status },
      after: { systemRoles: after.systemRoles, lastWorkingDay: after.lastWorkingDay, status: after.status },
    });
    if (body.lastWorkingDay !== undefined && plan) {
      // Từ giai đoạn 2 (E4): tự lập biên bản (isAuto) hoặc cập nhật ngày của biên bản đang có
      const { handover } = await this.handovers.applyLastWorkingDay(ctx, { ...u, ...set }, body.lastWorkingDay, plan);
      const r3 = await this.db.m.User.find({ companyId: u.companyId, systemRoles: 'R3', status: { $ne: 'left' } }, { _id: 1 }).lean<any[]>();
      await this.notifications.notify(ctx.companyId, r3.map((x) => String(x._id)), {
        type: 'handover_needed',
        title: `Cần bàn giao: ${u.name} nghỉ việc ngày ${body.lastWorkingDay}`,
        link: `/ban-giao/${handover._id}`,
        objectType: 'handover',
        objectId: String(handover._id),
      });
    }
    return userToApi(ctx, after);
  }

  @Post('sync/google')
  @Roles('R9')
  @HttpCode(202)
  async syncGoogle(@CurrentCtx() ctx: Ctx) {
    const jobId = await this.jobs.enqueue(ctx, 'google.sync', {});
    await this.audit.record(ctx, { action: 'google.sync', objectType: 'job', objectId: jobId });
    return { jobId };
  }
}
