import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { escapeRegex, normalizeText, oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ExportService } from '../shared/export.service';

const CODE_RE = /^[A-ZĐ0-9]+(-[A-ZĐ0-9]+)*$/;

/** M02 Bảng mã: đề nghị (R4) → Ban Điều hành duyệt (R1); mã pending chưa dùng được (BR-12) */
@Controller('codes')
export class CodesController {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    exporter: ExportService,
  ) {
    jobs.register('codes.export', {
      title: 'Xuất Bảng mã ra Google Sheets',
      steps: ['Đọc Bảng mã', 'Tạo Google Sheets'],
      handler: async (job) => {
        const rows = await job.step('Đọc Bảng mã', () => this.db.m.Code.find({ companyId: new Types.ObjectId(job.companyId), status: 'approved' }).sort({ code: 1 }).lean<any[]>());
        const depts = await this.access.departments(job.companyId);
        return job.step('Tạo Google Sheets', () =>
          exporter.toSheet(job.companyId, 'Bảng mã VCPV', ['Mã', 'Loại mã', 'Ý nghĩa', 'Phạm vi', 'Phòng', 'Trạng thái'], rows.map((r) => [r.code, r.type, r.meaning, r.scope ?? '', depts.find((d) => d.id === String(r.departmentId))?.code ?? '', 'Đã duyệt'])),
        );
      },
    });
  }

  private toApi(ctx: Ctx, c: any) {
    const allowedActions: string[] = [];
    if (c.status === 'pending' && this.access.hasRole(ctx, 'R1')) allowedActions.push('decide');
    return { ...toApi(c, ['searchText']), allowedActions };
  }

  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['code', 'createdAt', 'updatedAt', 'type', 'status'], 'code');
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.type) filter.type = q.type;
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    if (q.status) filter.status = q.status;
    if (q.q) filter.searchText = new RegExp(escapeRegex(normalizeText(q.q)));
    const [items, total] = await Promise.all([this.db.m.Code.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean(), this.db.m.Code.countDocuments(filter)]);
    return pageResult(items.map((c) => this.toApi(ctx, c)), p, total);
  }

  @Post()
  @Roles('R4')
  async propose(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    const code = String(body.code).trim().toUpperCase();
    if (!CODE_RE.test(code)) throw Errors.validation('Mã chỉ gồm chữ in hoa, số và dấu gạch ngang (vd SEO-PTDA)', [{ field: 'code', issue: 'pattern' }]);
    const cid = new Types.ObjectId(ctx.companyId);
    const dup = await this.db.m.Code.findOne({ companyId: cid, code, status: { $in: ['pending', 'approved', 'retired'] } }).lean();
    if (dup) throw Errors.duplicate(`Mã ${code} đã có trong Bảng mã`, [{ field: 'code', issue: 'duplicate' }]);
    const me = new Types.ObjectId(ctx.user.id);
    const row = (
      await this.db.m.Code.create({
        companyId: cid,
        code,
        type: body.type,
        meaning: body.meaning,
        scope: body.scope,
        reason: body.reason,
        departmentId: ctx.user.departmentId ? new Types.ObjectId(ctx.user.departmentId) : undefined,
        status: 'pending',
        createdBy: me,
        updatedBy: me,
        searchText: normalizeText(`${code} ${body.meaning}`),
      })
    ).toObject();
    await this.audit.record(ctx, { action: 'code.propose', objectType: 'code', objectId: String(row._id), after: { code, type: body.type, meaning: body.meaning } });
    const r1 = await this.db.m.User.find({ companyId: cid, systemRoles: 'R1', status: { $ne: 'left' } }, { _id: 1 }).lean<any[]>();
    await this.notifications.notify(ctx.companyId, r1.map((u) => String(u._id)), {
      type: 'approval_pending',
      title: `Đề nghị mã mới ${code} chờ duyệt`,
      body: body.meaning,
      link: `/bang-ma/${row._id}`,
      objectType: 'code',
      objectId: String(row._id),
    });
    return this.toApi(ctx, row);
  }

  @Post('export')
  @Roles('R3')
  @HttpCode(202)
  async export(@CurrentCtx() ctx: Ctx) {
    const jobId = await this.jobs.enqueue(ctx, 'codes.export', {});
    await this.audit.record(ctx, { action: 'code.export', objectType: 'job', objectId: jobId });
    return { jobId };
  }

  @Post(':id/decide')
  @Roles('R1')
  @HttpCode(200)
  async decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { result: 'approve' | 'reject'; comment?: string }) {
    const filter = { _id: oid(id), companyId: new Types.ObjectId(ctx.companyId) };
    const before = await this.db.m.Code.findOne(filter).lean<any>();
    if (!before) throw Errors.notFound('Không tìm thấy mã');
    if (before.status !== 'pending') throw Errors.state('Mã này không còn chờ duyệt');
    if (body.result === 'reject' && !body.comment?.trim()) throw Errors.validation('Từ chối thì phải ghi lý do', [{ field: 'comment', issue: 'required' }]);
    const decision = { by: new Types.ObjectId(ctx.user.id), at: new Date(), result: body.result, comment: body.comment, device: ctx.device, ip: ctx.ip };
    const status = body.result === 'approve' ? 'approved' : 'rejected';
    const r = await this.db.m.Code.updateOne({ ...filter, status: 'pending' }, { $set: { status, decision, updatedBy: decision.by } });
    if (!r.modifiedCount) throw Errors.state('Mã này không còn chờ duyệt');
    const after = await this.db.m.Code.findOne(filter).lean<any>();
    await this.audit.record(ctx, { action: `code.${status}`, objectType: 'code', objectId: id, before: { status: before.status }, after: { status, decision } });
    await this.notifications.notify(ctx.companyId, [String(before.createdBy)], {
      type: 'approval_decided',
      title: `Mã ${before.code} ${status === 'approved' ? 'đã được duyệt' : 'bị từ chối'}`,
      body: body.comment,
      link: `/bang-ma/${id}`,
      objectType: 'code',
      objectId: id,
    });
    return this.toApi(ctx, after);
  }
}
