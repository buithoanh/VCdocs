import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly db: Db, private readonly approvals: ApprovalsService, private readonly access: AccessService, scheduler: SchedulerService) {
    scheduler.add({ name: 'approvals.autoRemind', everyMs: 3600_000, run: () => this.approvals.autoRemind() });
  }

  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['createdAt', 'submittedAt', 'dueAt', 'updatedAt', 'status'], '-submittedAt');
    const me = new Types.ObjectId(ctx.user.id);
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.box === 'inbox') {
      filter.$or = [{ approverId: me, $or: [{ checkerId: { $exists: false } }, { checkedAt: { $exists: true } }] }, { checkerId: me, checkedAt: { $exists: false } }];
      filter.status = q.status ?? 'pending';
    } else if (q.box === 'sent') {
      filter.submittedBy = me;
    } else {
      filter.$or = [{ approverId: me }, { checkerId: me }, { submittedBy: me }];
    }
    if (q.status) filter.status = q.status;
    if (q.objectType) filter.objectType = q.objectType;
    const [items, total] = await Promise.all([this.db.m.Approval.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean(), this.db.m.Approval.countDocuments(filter)]);
    return pageResult(items.map((a) => this.approvals.toApi(ctx, a)), p, total);
  }

  /** Ai sẽ duyệt theo thẩm quyền */
  @Get('preview')
  async preview(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const h = this.approvals.handler(q.objectType);
    const obj = await h.load(ctx.companyId, q.objectId);
    if (!obj) throw Errors.notFound();
    await this.access.assertVisible(ctx, h.driveId(obj), h.isParticipant?.(ctx, obj));
    const info = await h.resolveApprover(ctx, obj);
    const users = await this.db.m.User.find({ companyId: new Types.ObjectId(ctx.companyId), _id: { $in: [info.approverId, info.checkerId].filter(Boolean).map((x) => new Types.ObjectId(x)) } }).lean<any[]>();
    const ref = (id?: string) => {
      const u = users.find((x) => String(x._id) === id);
      return u ? { id: String(u._id), name: u.name, email: u.email } : undefined;
    };
    const out: any = { approver: ref(info.approverId), approverRule: info.approverRule };
    if (info.checkerId) out.checker = ref(info.checkerId);
    return out;
  }

  private async load(ctx: Ctx, id: string) {
    const a = await this.approvals.get(ctx.companyId, oid(id));
    if (!a) throw Errors.notFound('Không tìm thấy phiếu');
    if (this.approvals.isRelated(ctx, a)) return a;
    // R3 xem phiếu mọi drive trừ drive Mật không là thành viên (→ 404 như đối tượng Mật khác)
    if (this.access.hasRole(ctx, 'R3')) {
      await this.access.assertVisibleOrR3(ctx, a.driveId);
      return a;
    }
    await this.access.assertVisible(ctx, a.driveId);
    throw Errors.forbidden('Chỉ người liên quan xem được phiếu');
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.approvals.toApi(ctx, await this.load(ctx, id));
  }

  @Post(':id/check')
  @HttpCode(200)
  async check(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { comment?: string }) {
    const a = await this.load(ctx, id);
    return this.approvals.toApi(ctx, await this.approvals.check(ctx, a, body?.comment));
  }

  @Post(':id/decide')
  @HttpCode(200)
  async decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { result: 'approve' | 'changes_requested'; comment?: string }) {
    const a = await this.load(ctx, id);
    return this.approvals.toApi(ctx, await this.approvals.decide(ctx, a, body.result, body.comment));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const a = await this.load(ctx, id);
    return this.approvals.toApi(ctx, await this.approvals.cancel(ctx, a));
  }

  @Post(':id/remind')
  @HttpCode(200)
  async remind(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const a = await this.load(ctx, id);
    return this.approvals.toApi(ctx, await this.approvals.remind(ctx, a));
  }
}

/** Bảng uỷ quyền phê duyệt của khối (R2 – giám đốc khối của chính khối đó) */
@Controller('delegations')
export class DelegationsController {
  constructor(private readonly db: Db, private readonly audit: AuditService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private async myBlocks(ctx: Ctx) {
    return this.db.m.Block.find({ companyId: new Types.ObjectId(ctx.companyId), directorId: new Types.ObjectId(ctx.user.id) }).lean<any[]>();
  }

  @Get()
  @Roles('R2')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const blocks = (await this.myBlocks(ctx)).map((b) => String(b._id));
    if (q.blockId && !blocks.includes(q.blockId)) throw Errors.forbidden('Chỉ xem được bảng uỷ quyền khối mình');
    const ids = (q.blockId ? [q.blockId] : blocks).map((x) => new Types.ObjectId(x));
    const rows = await this.db.m.Delegation.find({ companyId: new Types.ObjectId(ctx.companyId), blockId: { $in: ids } }).sort({ from: -1 }).lean();
    return { items: rows.map((r) => this.view(r)) };
  }

  /** BR-24: không vượt hạn mức tối đa của GĐ khối; việc liên khối, việc luật yêu cầu người có thẩm quyền ký không giao xuống */
  private async validate(ctx: Ctx, body: any) {
    const cid = new Types.ObjectId(ctx.companyId);
    const blocks = (await this.myBlocks(ctx)).map((b) => String(b._id));
    if (!blocks.includes(body.blockId)) throw Errors.forbidden('Chỉ giám đốc khối được lập uỷ quyền cho khối mình');
    if (body.to && body.to < body.from) throw Errors.validation('Ngày kết thúc phải sau ngày bắt đầu', [{ field: 'to', issue: 'before_from' }]);
    if (body.limitAmount !== undefined && body.limitAmount > this.cfg.rules.delegationMaxAmount) {
      throw Errors.rule('BR-24', `Hạn mức vượt mức tối đa của giám đốc khối (${this.cfg.rules.delegationMaxAmount.toLocaleString('vi-VN')} đ)`, [{ field: 'limitAmount', issue: 'over_limit' }]);
    }
    if (body.isLegalSignature === true) {
      throw Errors.rule('BR-24', 'Việc luật yêu cầu chữ ký người đại diện không được uỷ quyền xuống', [{ field: 'isLegalSignature', issue: 'not_delegable' }]);
    }
    const rt = await this.db.m.RecordType.findOne({ companyId: cid, _id: new Types.ObjectId(body.recordTypeId) }).lean<any>();
    if (!rt) throw Errors.validation('Loại hồ sơ không tồn tại', [{ field: 'recordTypeId', issue: 'not_found' }]);
    const rtDept = await this.db.m.Department.findOne({ companyId: cid, _id: rt.departmentId }).lean<any>();
    if (String(rtDept?.blockId) !== body.blockId) {
      throw Errors.rule('BR-24', 'Loại hồ sơ thuộc phòng của khối khác (việc liên khối không giao xuống)', [{ field: 'recordTypeId', issue: 'outside_block' }]);
    }
    const u = await this.db.m.User.findOne({ companyId: cid, _id: new Types.ObjectId(body.delegateId), status: { $ne: 'left' } }).lean<any>();
    if (!u) throw Errors.validation('Người được uỷ quyền không tồn tại', [{ field: 'delegateId', issue: 'not_found' }]);
    if (body.delegateId === ctx.user.id) throw Errors.validation('Không uỷ quyền cho chính mình', [{ field: 'delegateId', issue: 'self' }]);
    const dept = u.departmentId ? await this.db.m.Department.findOne({ companyId: cid, _id: u.departmentId }).lean<any>() : undefined;
    if (!dept || String(dept.blockId) !== body.blockId) {
      throw Errors.rule('BR-24', 'Người được uỷ quyền phải thuộc khối (việc liên khối không giao xuống)', [{ field: 'delegateId', issue: 'outside_block' }]);
    }
  }

  private view(r: any) {
    // CatalogActions: chỉ giám đốc khối thấy danh sách này nên luôn được sửa
    return { ...toApi(r), allowedActions: ['update'] };
  }

  @Post()
  @Roles('R2')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    await this.validate(ctx, body);
    const me = new Types.ObjectId(ctx.user.id);
    const row = (
      await this.db.m.Delegation.create({
        companyId: new Types.ObjectId(ctx.companyId),
        blockId: new Types.ObjectId(body.blockId),
        recordTypeId: new Types.ObjectId(body.recordTypeId),
        task: body.task,
        isLegalSignature: !!body.isLegalSignature,
        limitAmount: body.limitAmount,
        delegateId: new Types.ObjectId(body.delegateId),
        from: body.from,
        to: body.to,
        createdBy: me,
        updatedBy: me,
      })
    ).toObject();
    await this.audit.record(ctx, { action: 'delegation.create', objectType: 'delegation', objectId: String(row._id), after: body });
    return this.view(row);
  }

  @Patch(':id')
  @Roles('R2')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    const filter = { _id: oid(id), companyId: new Types.ObjectId(ctx.companyId) };
    const before = await this.db.m.Delegation.findOne(filter).lean<any>();
    if (!before) throw Errors.notFound('Không tìm thấy dòng uỷ quyền');
    await this.validate(ctx, body);
    const set: any = { blockId: new Types.ObjectId(body.blockId), recordTypeId: new Types.ObjectId(body.recordTypeId), isLegalSignature: !!body.isLegalSignature, delegateId: new Types.ObjectId(body.delegateId), from: body.from, updatedBy: new Types.ObjectId(ctx.user.id) };
    const unset: any = {};
    if (body.limitAmount !== undefined) set.limitAmount = body.limitAmount;
    else unset.limitAmount = 1;
    if (body.to !== undefined) set.to = body.to;
    else unset.to = 1;
    if (body.task !== undefined) set.task = body.task;
    else unset.task = 1;
    await this.db.m.Delegation.updateOne(filter, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    const after = await this.db.m.Delegation.findOne(filter).lean<any>();
    await this.audit.record(ctx, { action: 'delegation.update', objectType: 'delegation', objectId: id, before, after });
    return this.view(after);
  }
}
