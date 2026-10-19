import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
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

export const USER_PRIVATE = ['groupRoles', 'manualRoles', 'groupEmails', 'driveRoles', 'isSuspended', 'lastLoginAt', 'notificationSettings'];
export function userToApi(u: any) {
  return toApi(u, USER_PRIVATE);
}

@Controller()
export class MeController {
  constructor(private readonly db: Db, private readonly access: AccessService) {}

  /** Tôi là ai: vai trò hệ thống, phòng, vai trò trên từng drive, csrfToken */
  @Get('me')
  async me(@CurrentCtx() ctx: Ctx) {
    const u = await this.db.m.User.findOne({ _id: new Types.ObjectId(ctx.user.id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    const depts = await this.access.departments(ctx.companyId);
    const drives = depts
      .filter((d) => ctx.driveRoles.has(d.driveId))
      .map((d) => ({ driveId: d.driveId, departmentId: d.id, name: `${d.number} ${d.code}`, role: ctx.driveRoles.get(d.driveId)!, securityLevel: d.securityLevel }));
    return {
      user: userToApi(u),
      systemRoles: ctx.user.systemRoles,
      departmentId: ctx.user.departmentId,
      drives,
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
    return pageResult(items.map(userToApi), p, total);
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
    return userToApi(u);
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
    if (body.lastWorkingDay !== undefined) {
      if (!this.access.hasRole(ctx, 'R3')) throw Errors.forbidden('Chỉ HCNS (R3) ghi ngày nghỉ việc');
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
    if (body.lastWorkingDay !== undefined) {
      // Bàn giao (M10) thuộc giai đoạn 2: tạm nhắc HCNS lập biên bản
      const r3 = await this.db.m.User.find({ companyId: u.companyId, systemRoles: 'R3', status: { $ne: 'left' } }, { _id: 1 }).lean<any[]>();
      await this.notifications.notify(ctx.companyId, r3.map((x) => String(x._id)), {
        type: 'handover_needed',
        title: `Cần bàn giao: ${u.name} nghỉ việc ngày ${body.lastWorkingDay}`,
        link: `/nhan-su/${id}`,
        objectType: 'user',
        objectId: id,
      });
    }
    return userToApi(after);
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
