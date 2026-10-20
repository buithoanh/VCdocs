import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { AuditChainService } from './audit-chain.service';

/** M15 Nhật ký thao tác – chỉ đọc (hợp đồng mục 10.4, E13–E15) */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly db: Db, private readonly access: AccessService, private readonly audit: AuditService, private readonly chain: AuditChainService) {}

  /**
   * Phòng người gọi được xem nhật ký (E14): undefined = tất cả (R1, R3, R9);
   * R2 các phòng trong khối mình, R4 phòng mình, kiểm toán viên phòng được cấp.
   */
  async scope(ctx: Ctx): Promise<Set<string> | undefined> {
    if (this.access.hasRole(ctx, 'R1', 'R3', 'R9')) return undefined;
    const out = new Set<string>([...(await this.access.blockDeptIds(ctx)), ...(await this.access.headDeptIds(ctx)), ...(ctx.auditor?.departmentIds ?? [])]);
    if (!out.size) throw Errors.forbidden('Bạn không có quyền xem nhật ký');
    return out;
  }

  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['seq'], '-seq');
    const scope = await this.scope(ctx);
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.departmentId && scope && !scope.has(q.departmentId)) throw Errors.forbidden('Bạn không được xem nhật ký của phòng này');
    // Dòng không có departmentId chỉ R1, R3, R9 thấy
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    else if (scope) filter.departmentId = { $in: [...scope].map((x) => new Types.ObjectId(x)) };
    for (const k of ['objectType', 'objectId', 'action']) if (q[k]) filter[k] = q[k];
    if (q.actorId) filter.actorId = new Types.ObjectId(q.actorId);
    if (q.from || q.to) filter.at = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to) } : {}) };
    const [rows, total] = await Promise.all([
      this.db.m.AuditLog.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean<any[]>(),
      this.db.m.AuditLog.countDocuments(filter),
    ]);
    const depts = new Map((await this.access.departments(ctx.companyId)).map((d) => [d.id, d]));
    const items = rows.map((r) => {
      const d = r.departmentId ? depts.get(String(r.departmentId)) : undefined;
      // Đối tượng ở drive Mật người gọi không được xem → bỏ before, after (R9 cũng vậy)
      const isRedacted = !!d && d.securityLevel === 'confidential' && !this.access.canViewDrive(ctx, d.driveId);
      const out: any = toApi(r, ['companyId', ...(isRedacted ? ['before', 'after'] : [])]);
      out.isRedacted = isRedacted;
      return out;
    });
    return pageResult(items, p, total);
  }

  @Get('anchor')
  @Roles('R1', 'R3')
  async anchor(@CurrentCtx() ctx: Ctx) {
    return this.chain.anchorView(ctx.companyId);
  }

  @Post('verify')
  @Roles('R1', 'R3')
  @HttpCode(202)
  async verify(@CurrentCtx() ctx: Ctx) {
    const jobId = await this.chain.enqueueVerify(ctx);
    await this.audit.record(ctx, { action: 'audit.verify', objectType: 'job', objectId: jobId });
    return { jobId };
  }
}
