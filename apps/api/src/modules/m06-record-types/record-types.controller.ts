import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { ApprovalsService, ApproverInfo } from '../m05-approvals/approvals.service';
import { ExportService } from '../shared/export.service';

const FIELDS = ['name', 'kind', 'namingRule', 'example', 'folderId', 'keeperTitle', 'retentionYears', 'retentionBasis', 'disposalMethod', 'securityLevel', 'templateId', 'requiresApproval'];
const RETENTION_FIELDS = ['retentionYears', 'retentionBasis', 'disposalMethod'];

/** M06 Danh mục hồ sơ: thời hạn chỉ hiệu lực khi BĐH duyệt (BR-20) */
@Controller('record-types')
export class RecordTypesController {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
    exporter: ExportService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    jobs.register('record_types.catalog_export', {
      title: 'Xuất Danh mục hồ sơ VCPV',
      steps: ['Đọc danh mục', 'Tạo Google Sheets'],
      handler: async (job) => {
        const rows = await job.step('Đọc danh mục', () => this.db.m.RecordType.find({ companyId: new Types.ObjectId(job.companyId) }).sort({ departmentId: 1, name: 1 }).lean<any[]>());
        const depts = await this.access.departments(job.companyId);
        const folders = await this.db.m.Folder.find({ companyId: new Types.ObjectId(job.companyId), _id: { $in: rows.map((r) => r.folderId).filter(Boolean) } }).lean<any[]>();
        return job.step('Tạo Google Sheets', () =>
          exporter.toSheet(
            job.companyId,
            'Danh mục hồ sơ VCPV',
            ['Phòng', 'Loại hồ sơ', 'Quy tắc tên', 'Ví dụ', 'Nơi lưu', 'Người giữ', 'Thời hạn (năm)', 'Căn cứ', 'Cách huỷ', 'Mức bảo mật', 'Thời hạn đã duyệt'],
            rows.map((r) => [
              depts.find((d) => d.id === String(r.departmentId))?.code ?? '',
              r.name,
              r.namingRule ?? '',
              r.example ?? '',
              folders.find((f) => String(f._id) === String(r.folderId))?.path ?? '',
              r.keeperTitle ?? '',
              r.retentionYears === 0 ? 'Vĩnh viễn' : (r.retentionYears ?? ''),
              r.retentionBasis ?? '',
              r.disposalMethod ?? '',
              r.securityLevel ?? '',
              r.retentionStatus === 'approved' ? 'Đã duyệt' : r.retentionStatus === 'submitted' ? 'Chờ duyệt' : 'Chưa trình',
            ]),
          ),
        );
      },
    });

    approvals.register('retention', {
      load: (c, id) => this.db.m.RecordType.findOne({ companyId: new Types.ObjectId(c), _id: new Types.ObjectId(id) }).lean(),
      driveId: () => undefined,
      title: (rt) => `Thời hạn lưu: ${rt.name}`,
      link: (rt) => `/danh-muc-ho-so/${rt._id}`,
      isParticipant: () => true,
      resolveApprover: (ctx, rt) => this.resolveApprover(ctx, rt),
      onApproved: async (ctx, a, rt) => this.setRetention(rt, 'approved', a._id),
      onChangesRequested: async (ctx, a, rt) => this.setRetention(rt, 'draft'),
      onCancelled: async (ctx, a, rt) => this.setRetention(rt, 'draft'),
      onInvalidated: async (ctx, a, rt) => this.setRetention(rt, 'draft'),
    });
  }

  private async setRetention(rt: any, status: string, approvalId?: Types.ObjectId) {
    await this.db.m.RecordType.updateOne({ _id: rt._id, companyId: rt.companyId }, { $set: { retentionStatus: status, ...(approvalId ? { retentionApprovalId: approvalId } : {}) } });
  }

  /** BĐH (TGĐ) duyệt; chứng từ kế toán thêm kế toán trưởng (R8), hồ sơ nhân sự thêm HCNS (R3) xác nhận trước */
  private async resolveApprover(ctx: Ctx, rt: any): Promise<ApproverInfo> {
    const org = await this.approvals.org(ctx.companyId);
    if (!org.ceoId) throw Errors.rule('BR-20', 'Chưa có Ban Điều hành (R1) để duyệt thời hạn lưu');
    const dept = await this.access.deptById(ctx.companyId, String(rt.departmentId));
    let checkerId: string | undefined;
    let extra = '';
    if (dept && this.cfg.rules.accountingDeptCodes.includes(dept.code)) {
      checkerId = org.firstR8;
      extra = '; kế toán trưởng xác nhận chứng từ kế toán';
    } else if (dept && this.cfg.rules.hrDeptCodes.includes(dept.code)) {
      checkerId = org.firstR3;
      extra = '; HCNS xác nhận hồ sơ nhân sự';
    }
    return { approverId: org.ceoId, checkerId, approverRule: `Thời hạn lưu → Ban Điều hành duyệt${extra} (BR-20)` };
  }

  private async allowed(ctx: Ctx, rt: any) {
    const out: string[] = [];
    if (await this.access.isHeadOf(ctx, String(rt.departmentId))) {
      out.push('update');
      if (rt.retentionStatus === 'draft') out.push('submit-retention');
    }
    return out;
  }
  private async view(ctx: Ctx, rt: any) {
    return { ...toApi(rt), allowedActions: await this.allowed(ctx, rt) };
  }

  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    const rows = await this.db.m.RecordType.find(filter).sort({ name: 1 }).lean<any[]>();
    return { items: await Promise.all(rows.map((r) => this.view(ctx, r))) };
  }

  private async checkRefs(ctx: Ctx, departmentId: string, body: any) {
    if (body.folderId) {
      const dept = await this.access.deptById(ctx.companyId, departmentId);
      const f = await this.db.m.Folder.findOne({ companyId: new Types.ObjectId(ctx.companyId), _id: new Types.ObjectId(body.folderId) }).lean<any>();
      if (!f || f.driveId !== dept?.driveId) throw Errors.validation('Thư mục lưu phải thuộc drive của phòng', [{ field: 'folderId', issue: 'not_in_department_drive' }]);
    }
  }

  @Post()
  @Roles('R4')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    await this.access.requireHeadOf(ctx, body.departmentId);
    await this.checkRefs(ctx, body.departmentId, body);
    const cid = new Types.ObjectId(ctx.companyId);
    if (await this.db.m.RecordType.findOne({ companyId: cid, departmentId: new Types.ObjectId(body.departmentId), name: body.name }).lean()) {
      throw Errors.duplicate('Phòng đã có loại hồ sơ cùng tên', [{ field: 'name', issue: 'duplicate' }]);
    }
    const me = new Types.ObjectId(ctx.user.id);
    const data: any = { companyId: cid, departmentId: new Types.ObjectId(body.departmentId), retentionStatus: 'draft', createdBy: me, updatedBy: me };
    for (const f of FIELDS) if (body[f] !== undefined) data[f] = f === 'folderId' ? new Types.ObjectId(body[f]) : body[f];
    const row = (await this.db.m.RecordType.create(data)).toObject();
    await this.audit.record(ctx, { action: 'record_type.create', objectType: 'record_type', objectId: String(row._id), after: data });
    return this.view(ctx, row);
  }

  @Post('catalog/export')
  @Roles('R3')
  @HttpCode(202)
  async export(@CurrentCtx() ctx: Ctx) {
    const jobId = await this.jobs.enqueue(ctx, 'record_types.catalog_export', {});
    await this.audit.record(ctx, { action: 'record_type.catalog_export', objectType: 'job', objectId: jobId });
    return { jobId };
  }

  private async load(ctx: Ctx, id: string) {
    const rt = await this.db.m.RecordType.findOne({ companyId: new Types.ObjectId(ctx.companyId), _id: oid(id) }).lean<any>();
    if (!rt) throw Errors.notFound('Không tìm thấy loại hồ sơ');
    return rt;
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.view(ctx, await this.load(ctx, id));
  }

  /** Đổi thời hạn → về draft, phải trình lại */
  @Patch(':id')
  @Roles('R4')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    const rt = await this.load(ctx, id);
    await this.access.requireHeadOf(ctx, String(rt.departmentId));
    await this.checkRefs(ctx, String(rt.departmentId), body);
    if (body.name && body.name !== rt.name && (await this.db.m.RecordType.findOne({ companyId: rt.companyId, departmentId: rt.departmentId, name: body.name, _id: { $ne: rt._id } }).lean())) {
      throw Errors.duplicate('Phòng đã có loại hồ sơ cùng tên', [{ field: 'name', issue: 'duplicate' }]);
    }
    const set: any = { updatedBy: new Types.ObjectId(ctx.user.id) };
    for (const f of FIELDS) if (body[f] !== undefined) set[f] = f === 'folderId' ? new Types.ObjectId(body[f]) : body[f];
    const retentionChanged = RETENTION_FIELDS.some((f) => body[f] !== undefined && body[f] !== rt[f]);
    if (retentionChanged) {
      set.retentionStatus = 'draft';
      const pending = await this.approvals.pendingFor(ctx.companyId, 'retention', rt._id);
      if (pending) await this.approvals.invalidate(ctx, pending, rt, 'Thời hạn lưu đổi sau khi trình');
    }
    await this.db.m.RecordType.updateOne({ _id: rt._id, companyId: rt.companyId }, { $set: set, ...(retentionChanged ? { $unset: { retentionApprovalId: 1 } } : {}) });
    const after = await this.load(ctx, id);
    await this.audit.record(ctx, { action: 'record_type.update', objectType: 'record_type', objectId: id, before: rt, after });
    return this.view(ctx, after);
  }

  @Post(':id/submit-retention')
  @Roles('R4')
  async submitRetention(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const rt = await this.load(ctx, id);
    await this.access.requireHeadOf(ctx, String(rt.departmentId));
    if (rt.retentionStatus !== 'draft') throw Errors.state(rt.retentionStatus === 'approved' ? 'Thời hạn đã được duyệt' : 'Thời hạn đang chờ duyệt');
    const approver = await this.resolveApprover(ctx, rt);
    this.approvals.assertSeparation(approver, ctx.user.id);
    const a = await this.approvals.create(ctx, { objectType: 'retention', objectId: id, objectTitle: `Thời hạn lưu: ${rt.name}`, approver, link: `/danh-muc-ho-so/${id}`, meta: { retentionYears: rt.retentionYears, retentionBasis: rt.retentionBasis } });
    await this.db.m.RecordType.updateOne({ _id: rt._id, companyId: rt.companyId, retentionStatus: 'draft' }, { $set: { retentionStatus: 'submitted', retentionApprovalId: a._id } });
    return this.approvals.toApi(ctx, a);
  }
}
