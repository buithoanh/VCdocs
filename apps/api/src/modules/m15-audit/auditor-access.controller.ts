import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { dateVN, oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditChainService } from './audit-chain.service';

/** Quyền xem tạm của kiểm toán viên (E16) */
@Controller('auditor-access')
export class AuditorAccessController {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly chain: AuditChainService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private view(ctx: Ctx, a: any) {
    return { ...toApi(a), allowedActions: this.access.hasRole(ctx, 'R1') && a.status === 'active' ? ['revoke'] : [] };
  }

  @Get()
  @Roles('R1', 'R3')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    await this.chain.expireAuditorAccess(ctx.companyId);
    const p = parsePage(q, ['createdAt', 'expiresAt', 'updatedAt', 'status']);
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.status) filter.status = q.status;
    const [items, total] = await Promise.all([
      this.db.m.AuditorAccess.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean<any[]>(),
      this.db.m.AuditorAccess.countDocuments(filter),
    ]);
    return pageResult(items.map((a) => this.view(ctx, a)), p, total);
  }

  /** R1 cấp: chỉ tài khoản trong tên miền đang làm việc (BR-15), hạn ≤ 30 ngày */
  @Post()
  @Roles('R1')
  async grant(@CurrentCtx() ctx: Ctx, @Body() body: { email: string; departmentIds: string[]; expiresAt: string; reason?: string }) {
    const cid = new Types.ObjectId(ctx.companyId);
    const email = body.email.trim().toLowerCase();
    const expiresAt = new Date(body.expiresAt);
    const maxDays = this.cfg.rules.auditorMaxDays;
    if (!(expiresAt.getTime() > Date.now())) throw Errors.validation('Hạn quyền xem phải sau thời điểm hiện tại', [{ field: 'body.expiresAt', issue: 'in_past' }]);
    if (expiresAt.getTime() > Date.now() + maxDays * 86400_000) throw Errors.validation(`Quyền xem tạm tối đa ${maxDays} ngày`, [{ field: 'body.expiresAt', issue: `max_${maxDays}_days` }]);
    const depts = await this.access.departments(ctx.companyId);
    const unknown = body.departmentIds.filter((id) => !depts.some((d) => d.id === id));
    if (unknown.length) throw Errors.validation('Có phòng không tồn tại', unknown.map((id) => ({ field: 'body.departmentIds', issue: `unknown:${id}` })));
    const domain = (await this.db.m.Company.findOne({ _id: cid }).lean<any>())?.domain ?? this.cfg.allowedDomain;
    const user = email.endsWith(`@${domain}`) ? await this.db.m.User.findOne({ companyId: cid, email }).lean<any>() : undefined;
    if (!user || user.status === 'left' || user.isSuspended) {
      throw Errors.rule('BR-15', `Chỉ cấp cho tài khoản @${domain} đang làm việc trong VCdocs; chuyên gia ngoài thì IT cấp tài khoản tạm trong tên miền`, [{ field: 'email', issue: 'not_active_domain_user' }]);
    }
    const me = new Types.ObjectId(ctx.user.id);
    const row = await this.db.m.AuditorAccess.create({
      companyId: cid,
      email,
      userId: user._id,
      departmentIds: body.departmentIds.map((x) => new Types.ObjectId(x)),
      expiresAt,
      reason: body.reason,
      grantedBy: me,
      status: 'active',
      createdBy: me,
      updatedBy: me,
    });
    await this.audit.record(ctx, { action: 'auditor_access.grant', objectType: 'auditor_access', objectId: String(row._id), after: { email, userId: user._id, departmentIds: body.departmentIds, expiresAt, reason: body.reason } });
    const names = depts.filter((d) => body.departmentIds.includes(d.id)).map((d) => `${d.number} ${d.code}`).join(', ');
    await this.notifications.notify(ctx.companyId, [String(user._id)], {
      type: 'auditor_access_granted',
      title: `Bạn được cấp quyền xem tạm nhật ký, tài liệu, hồ sơ phòng ${names} đến ${dateVN(expiresAt)}`,
      link: '/nhat-ky',
      objectType: 'auditor_access',
      objectId: String(row._id),
    });
    return this.view(ctx, row.toObject());
  }

  @Delete(':id')
  @Roles('R1')
  @HttpCode(204)
  async revoke(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    await this.chain.expireAuditorAccess(ctx.companyId);
    const a = await this.db.m.AuditorAccess.findOne({ _id: oid(id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    if (!a) throw Errors.notFound('Không tìm thấy quyền xem tạm');
    if (a.status !== 'active') throw Errors.state(a.status === 'revoked' ? 'Quyền xem tạm đã thu hồi' : 'Quyền xem tạm đã hết hạn');
    const me = new Types.ObjectId(ctx.user.id);
    const r = await this.db.m.AuditorAccess.updateOne({ _id: a._id, companyId: a.companyId, status: 'active' }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: me, updatedBy: me } });
    if (!r.modifiedCount) throw Errors.state('Quyền xem tạm vừa đổi trạng thái');
    await this.audit.record(ctx, { action: 'auditor_access.revoke', objectType: 'auditor_access', objectId: id, before: { status: 'active' }, after: { status: 'revoked' } });
  }
}
