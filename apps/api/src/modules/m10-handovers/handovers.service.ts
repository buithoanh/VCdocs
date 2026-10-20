import { Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import type { Ctx } from '../../common/context';
import { AppError, Errors, GoogleError } from '../../common/errors';
import { dateVN, monthVN, toApi, workingDaysBetween } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobContext, JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { ApprovalsService } from '../m05-approvals/approvals.service';
import { FoldersService } from '../m03-folders/folders.service';

export type HandoverStatus = 'listing' | 'open' | 'received' | 'verified' | 'executing' | 'done' | 'cancelled';
type Kind = 'document' | 'record' | 'approval_to_decide' | 'approval_submitted' | 'external_share' | 'delegation' | 'my_drive_file' | 'group_membership';

/** action hợp kind (bảng HandoverItemAction); phần tử đầu là mặc định (E5) */
export const KIND_ACTIONS: Record<Kind, string[]> = {
  document: ['reassign', 'keep'],
  record: ['reassign', 'keep'],
  approval_to_decide: ['reassign', 'keep'],
  approval_submitted: ['reassign', 'keep'],
  external_share: ['reassign', 'revoke'],
  delegation: ['end', 'keep'],
  my_drive_file: ['transfer'],
  group_membership: ['remove', 'keep'],
};
const KIND_LABEL: Record<Kind, string> = {
  document: 'Tài liệu',
  record: 'Hồ sơ',
  approval_to_decide: 'Phiếu chờ duyệt',
  approval_submitted: 'Phiếu đã trình',
  external_share: 'Chia sẻ ngoài',
  delegation: 'Uỷ quyền',
  my_drive_file: 'File Drive của tôi',
  group_membership: 'Nhóm Google',
};
const ACTION_LABEL: Record<string, string> = { reassign: 'Đổi người', revoke: 'Gỡ', end: 'Kết thúc', transfer: 'Chuyển sở hữu Google', remove: 'Gỡ khỏi nhóm', keep: 'Để nguyên' };
const STATUS_LABEL: Record<string, string> = { listing: 'Đang liệt kê', open: 'Chờ người nhận', received: 'Người nhận đã nhận', verified: 'HCNS đã kiểm tra', executing: 'Đang chuyển quyền', done: 'Xong', cancelled: 'Đã huỷ' };
const ITEM_STATUS_LABEL: Record<string, string> = { pending: 'Chờ', done: 'Xong', skipped: 'Bỏ qua', failed: 'Lỗi' };

/** Biên bản chưa xong (E4: mỗi người chỉ một) */
export const UNFINISHED: HandoverStatus[] = ['listing', 'open', 'received', 'verified', 'executing'];
/** Tài liệu đang dở: registered → revising (E5), không gồm đã hiệu lực, đã huỷ bỏ */
const DOC_OPEN = ['registered', 'coded', 'drafting', 'feedback', 'submitted', 'approved', 'revising'];
const MY_DRIVE_MAX = 1000;
export const HANDOVER_TEMPLATE_CODE = 'BM-VCPV-08';

interface Candidate {
  key: string;
  kind: Kind;
  objectType?: string;
  objectId?: Types.ObjectId;
  fileId?: string;
  groupEmail?: string;
  name: string;
  detail?: string;
}

/**
 * M10 Bàn giao khi nghỉ việc (hợp đồng mục 10.3, E3–E12): lập biên bản, liệt kê
 * việc đang dở của người nghỉ, người nhận xác nhận, HCNS kiểm tra, R9 chuyển quyền.
 */
@Injectable()
export class HandoversService {
  private readonly log = new Logger('Handover');
  /** Chờ Google Data Transfer xong (test đặt 0) */
  transferPollMs = 3000;

  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
    private readonly folders: FoldersService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    jobs.register('handover.list', {
      title: 'Liệt kê việc cần bàn giao',
      steps: ['Liệt kê tài liệu, hồ sơ, phiếu, chia sẻ, uỷ quyền', 'Liệt kê Drive của tôi, nhóm Google', 'Ghi biên bản'],
      handler: (j) => this.runList(j),
    });
    jobs.register('handover.execute', {
      title: 'Chuyển quyền bàn giao',
      steps: ['Liệt kê lại', 'Đổi người trong VCdocs', 'Chuyển Drive của tôi sang người nhận', 'Gỡ khỏi nhóm Google', 'Hoàn tất biên bản'],
      handler: (j) => this.runExecute(j),
    });
    jobs.register('handover.export', {
      title: 'Xuất biên bản bàn giao BM-VCPV-08',
      steps: ['Sao biểu mẫu BM-VCPV-08', 'Điền biên bản', 'Ghi biên bản'],
      handler: (j) => this.runExport(j),
    });
  }

  private cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }

  async load(companyId: string, id: Types.ObjectId | string) {
    return this.db.m.Handover.findOne({ _id: new Types.ObjectId(String(id)), companyId: this.cid(companyId) }).lean<any>();
  }

  // ───── quyền xem, allowedActions (E12) ─────
  async canView(ctx: Ctx, h: any): Promise<boolean> {
    if (this.access.hasRole(ctx, 'R1', 'R3', 'R9')) return true;
    if (String(h.userId) === ctx.user.id || String(h.receiverId) === ctx.user.id) return true;
    return !!h.departmentId && (await this.access.blockDeptIds(ctx)).has(String(h.departmentId));
  }

  actions(ctx: Ctx, h: any): string[] {
    const r3 = this.access.hasRole(ctx, 'R3');
    const receiver = String(h.receiverId) === ctx.user.id;
    const editable = ['open', 'received'].includes(h.status);
    const out: string[] = [];
    if (r3 && editable) out.push('update');
    if ((r3 || receiver) && editable) out.push('update-items', 'refresh');
    if (receiver && h.status === 'open') out.push('confirm-receiver');
    if (r3 && h.status === 'received') out.push('verify');
    if (this.access.hasRole(ctx, 'R9') && h.status === 'verified') out.push('execute');
    if (r3 && !['listing', 'cancelled'].includes(h.status)) out.push('export');
    if (r3 && ['listing', 'open', 'received', 'verified'].includes(h.status)) out.push('cancel');
    return out;
  }

  counts(h: any) {
    const items: any[] = h.items ?? [];
    const by = (s: string) => items.filter((i) => i.status === s).length;
    return { total: items.length, pending: by('pending'), done: by('done'), skipped: by('skipped'), failed: by('failed') };
  }

  itemToApi(h: any, i: any) {
    const out: any = toApi(i, ['key']);
    // toUserId mặc định là người nhận của biên bản (E5) – trả giá trị đang áp dụng
    if (i.action === 'reassign') out.toUserId = String(i.toUserId ?? h.receiverId);
    else delete out.toUserId;
    return out;
  }

  toApi(ctx: Ctx, h: any, withItems: boolean) {
    const out: any = toApi(h, ['items', 'verifyDueNotifiedAt', 'overdueNotifiedAt']);
    out.counts = this.counts(h);
    out.allowedActions = this.actions(ctx, h);
    if (withItems) out.items = (h.items ?? []).map((i: any) => this.itemToApi(h, i));
    return out;
  }

  // ───── người nhận (E3) ─────
  /** Trưởng phòng của phòng người nghỉ; người nghỉ là trưởng phòng → GĐ khối phụ trách */
  async defaultReceiver(companyId: string, user: any): Promise<string | undefined> {
    const uid = String(user._id);
    const dept = await this.access.deptById(companyId, user.departmentId ? String(user.departmentId) : undefined);
    if (!dept) return undefined;
    const ok = async (id?: string) => (id && id !== uid && (await this.isWorking(companyId, id)) ? id : undefined);
    return (await ok(dept.headId)) ?? (await ok(await this.approvals.blockDirector(companyId, dept.id)));
  }

  private async isWorking(companyId: string, userId: string) {
    const u = await this.db.m.User.findOne({ companyId: this.cid(companyId), _id: new Types.ObjectId(userId) }, { status: 1, isSuspended: 1 }).lean<any>();
    return !!u && u.status === 'active' && !u.isSuspended;
  }

  /** Người nhận phải đang làm việc và khác người nghỉ (E3) – sai → 422 BR-25 */
  async assertReceiver(companyId: string, receiverId: string, leaverId: string, field = 'receiverId') {
    if (receiverId === leaverId) throw Errors.rule('BR-25', 'Người nhận bàn giao phải khác người nghỉ việc', [{ field, issue: 'same_as_leaver' }]);
    if (!(await this.isWorking(companyId, receiverId))) throw Errors.rule('BR-25', 'Người nhận bàn giao phải là người đang làm việc', [{ field, issue: 'not_active' }]);
  }

  async unfinishedOf(companyId: string, userId: string | Types.ObjectId) {
    return this.db.m.Handover.findOne({ companyId: this.cid(companyId), userId: new Types.ObjectId(String(userId)), status: { $in: UNFINISHED } }).lean<any>();
  }

  // ───── lập biên bản (E4) ─────
  /**
   * Kiểm trước khi ghi lastWorkingDay ở PATCH /users (E4): biên bản đang chuyển
   * quyền hoặc đã xong → 409; chưa có biên bản thì phải tìm được người nhận mặc định.
   */
  async planForLastWorkingDay(ctx: Ctx, user: any): Promise<{ existing?: any; receiverId?: string }> {
    const existing = await this.unfinishedOf(ctx.companyId, user._id);
    if (existing) {
      if (existing.status === 'executing') throw Errors.state('Biên bản bàn giao đang chuyển quyền, không đổi được ngày làm việc cuối');
      return { existing };
    }
    if (user.status !== 'active') {
      const done = await this.db.m.Handover.findOne({ companyId: this.cid(ctx.companyId), userId: user._id, status: 'done' }).lean<any>();
      if (done) throw Errors.state('Biên bản bàn giao của người này đã xong, không đổi được ngày làm việc cuối');
    }
    const receiverId = await this.defaultReceiver(ctx.companyId, user);
    if (!receiverId) throw Errors.rule('BR-25', 'Chưa xác định được người nhận bàn giao mặc định (trưởng phòng hoặc GĐ khối); lập biên bản bằng tay và chọn người nhận', [{ field: 'lastWorkingDay', issue: 'no_default_receiver' }]);
    return { receiverId };
  }

  /** Sau khi PATCH /users đã ghi lastWorkingDay: cập nhật biên bản đang có hoặc tự lập (isAuto) */
  async applyLastWorkingDay(ctx: Ctx, user: any, lastWorkingDay: string, plan: { existing?: any; receiverId?: string }) {
    if (plan.existing) {
      const h = plan.existing;
      const set: any = { lastWorkingDay, updatedBy: new Types.ObjectId(ctx.user.id), verifyDueNotifiedAt: null, overdueNotifiedAt: null };
      const unset: any = {};
      // Đã kiểm tra thì phải kiểm tra lại (verified → received)
      if (h.status === 'verified') {
        set.status = 'received';
        unset.verification = 1;
      }
      await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId, status: h.status }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      await this.audit.record(ctx, { action: 'handover.update', objectType: 'handover', objectId: String(h._id), before: { lastWorkingDay: h.lastWorkingDay, status: h.status }, after: { lastWorkingDay, status: set.status ?? h.status } });
      return { handover: await this.load(ctx.companyId, h._id) };
    }
    return this.create(ctx, user, { lastWorkingDay, receiverId: plan.receiverId!, isAuto: true });
  }

  /** Tạo biên bản ở trạng thái listing và chạy việc nền handover.list */
  async create(ctx: Ctx, user: any, p: { lastWorkingDay: string; receiverId: string; note?: string; isAuto: boolean }) {
    const me = new Types.ObjectId(ctx.user.id);
    const h = await this.db.m.Handover.create({
      companyId: this.cid(ctx.companyId),
      userId: user._id,
      departmentId: user.departmentId,
      lastWorkingDay: p.lastWorkingDay,
      receiverId: new Types.ObjectId(p.receiverId),
      status: 'listing',
      isAuto: p.isAuto,
      items: [],
      note: p.note,
      createdBy: me,
      updatedBy: me,
    });
    const jobId = await this.jobs.enqueue(ctx, 'handover.list', { handoverId: String(h._id) });
    await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId }, { $set: { listJobId: new Types.ObjectId(jobId) } });
    await this.audit.record(ctx, {
      action: 'handover.create',
      objectType: 'handover',
      objectId: String(h._id),
      departmentId: user.departmentId ? String(user.departmentId) : undefined,
      after: { userId: user._id, lastWorkingDay: p.lastWorkingDay, receiverId: p.receiverId, isAuto: p.isAuto, jobId },
    });
    await this.notifications.notify(ctx.companyId, [p.receiverId], {
      type: 'handover_assigned',
      title: `Bạn nhận bàn giao của ${user.name} (nghỉ việc ngày ${p.lastWorkingDay})`,
      link: `/ban-giao/${h._id}`,
      objectType: 'handover',
      objectId: String(h._id),
    });
    return { handover: await this.load(ctx.companyId, h._id), jobId };
  }

  /** POST /handovers – lập bằng tay (R3): ghi lastWorkingDay, người đó → leaving (E4) */
  async createManual(ctx: Ctx, body: { userId: string; lastWorkingDay: string; receiverId?: string; note?: string }) {
    const user = await this.db.m.User.findOne({ companyId: this.cid(ctx.companyId), _id: new Types.ObjectId(body.userId) }).lean<any>();
    if (!user) throw Errors.notFound('Không tìm thấy nhân sự');
    if (user.status === 'left') throw Errors.state('Người này đã nghỉ việc');
    if (await this.unfinishedOf(ctx.companyId, user._id)) throw Errors.duplicate('Người này đã có biên bản bàn giao chưa xong', [{ field: 'userId', issue: 'handover_exists' }]);
    const receiverId = body.receiverId ?? (await this.defaultReceiver(ctx.companyId, user));
    if (!receiverId) throw Errors.rule('BR-25', 'Chưa xác định được người nhận mặc định, hãy chọn người nhận', [{ field: 'receiverId', issue: 'required' }]);
    await this.assertReceiver(ctx.companyId, receiverId, String(user._id));
    const set: any = { lastWorkingDay: body.lastWorkingDay, updatedBy: new Types.ObjectId(ctx.user.id) };
    if (user.status === 'active') set.status = 'leaving';
    await this.db.m.User.updateOne({ _id: user._id, companyId: user.companyId }, { $set: set });
    await this.audit.record(ctx, {
      action: 'user.update',
      objectType: 'user',
      objectId: String(user._id),
      before: { lastWorkingDay: user.lastWorkingDay, status: user.status },
      after: { lastWorkingDay: body.lastWorkingDay, status: set.status ?? user.status },
    });
    return this.create(ctx, { ...user, ...set }, { lastWorkingDay: body.lastWorkingDay, receiverId, note: body.note, isAuto: false });
  }

  // ───── thao tác trên biên bản ─────
  private requireR3(ctx: Ctx) {
    this.access.requireRole(ctx, 'R3');
  }
  private requireR3OrReceiver(ctx: Ctx, h: any) {
    if (!this.access.hasRole(ctx, 'R3') && String(h.receiverId) !== ctx.user.id) throw Errors.forbidden('Chỉ HCNS (R3) hoặc người nhận bàn giao được làm');
  }
  private requireState(h: any, allowed: HandoverStatus[], what: string) {
    if (!allowed.includes(h.status)) throw Errors.state(`Biên bản đang ở trạng thái "${STATUS_LABEL[h.status]}", không ${what} được`);
  }
  /** Đổi trạng thái có kiểm trạng thái cũ (chống hai người bấm cùng lúc) */
  private async transition(h: any, from: HandoverStatus[], set: any, unset?: any) {
    const r = await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId, status: { $in: from } }, { $set: set, ...(unset ? { $unset: unset } : {}) });
    if (!r.modifiedCount) throw Errors.state('Biên bản vừa đổi trạng thái, hãy tải lại');
  }

  async update(ctx: Ctx, h: any, body: { receiverId?: string; note?: string }) {
    this.requireR3(ctx);
    this.requireState(h, ['open', 'received'], 'sửa');
    if (body.receiverId === undefined && body.note === undefined) throw Errors.validation('Không có gì để sửa');
    const set: any = { updatedBy: new Types.ObjectId(ctx.user.id) };
    if (body.receiverId !== undefined && body.receiverId !== String(h.receiverId)) {
      await this.assertReceiver(ctx.companyId, body.receiverId, String(h.userId));
      set.receiverId = new Types.ObjectId(body.receiverId);
    }
    if (body.note !== undefined) set.note = body.note;
    await this.transition(h, ['open', 'received'], set);
    await this.audit.record(ctx, { action: 'handover.update', objectType: 'handover', objectId: String(h._id), before: { receiverId: h.receiverId, note: h.note }, after: { receiverId: set.receiverId ?? h.receiverId, note: set.note ?? h.note } });
    if (set.receiverId) {
      const leaver = await this.db.m.User.findOne({ companyId: h.companyId, _id: h.userId }, { name: 1 }).lean<any>();
      await this.notifications.notify(ctx.companyId, [body.receiverId], { type: 'handover_assigned', title: `Bạn nhận bàn giao của ${leaver?.name ?? 'nhân sự nghỉ việc'} (nghỉ việc ngày ${h.lastWorkingDay})`, link: `/ban-giao/${h._id}`, objectType: 'handover', objectId: String(h._id) });
    }
    return this.load(ctx.companyId, h._id);
  }

  async updateItem(ctx: Ctx, h: any, itemId: string, body: { action?: string; toUserId?: string; note?: string }) {
    this.requireR3OrReceiver(ctx, h);
    this.requireState(h, ['open', 'received'], 'sửa dòng');
    const item = (h.items ?? []).find((i: any) => String(i._id) === itemId);
    if (!item) throw Errors.notFound('Không tìm thấy dòng trong biên bản');
    if (item.status === 'done') throw Errors.state('Dòng này đã chuyển xong');
    const action = body.action ?? item.action;
    if (!KIND_ACTIONS[item.kind as Kind].includes(action)) {
      throw Errors.validation(`Cách xử lý "${action}" không dùng được với ${KIND_LABEL[item.kind as Kind]}`, [{ field: 'body.action', issue: `not_allowed_for_kind:${item.kind}` }]);
    }
    if (body.toUserId !== undefined && action !== 'reassign') throw Errors.validation('Chỉ chọn người nhận khi cách xử lý là đổi người', [{ field: 'body.toUserId', issue: 'only_with_reassign' }]);
    if (body.toUserId !== undefined) await this.assertReceiver(ctx.companyId, body.toUserId, String(h.userId), 'toUserId');
    const before = { action: item.action, toUserId: item.toUserId, note: item.note, status: item.status };
    const set: any = { 'items.$.action': action, updatedBy: new Types.ObjectId(ctx.user.id) };
    if (body.toUserId !== undefined) set['items.$.toUserId'] = new Types.ObjectId(body.toUserId);
    if (body.note !== undefined) set['items.$.note'] = body.note;
    // Dòng bỏ qua hoặc lỗi được đưa lại hàng chờ khi chọn cách xử lý khác "để nguyên"
    if (['failed', 'skipped'].includes(item.status)) set['items.$.status'] = action === 'keep' ? 'skipped' : 'pending';
    const unset: any = action !== 'reassign' ? { 'items.$.toUserId': 1 } : {};
    const r = await this.db.m.Handover.updateOne(
      { _id: h._id, companyId: h.companyId, status: { $in: ['open', 'received'] }, 'items._id': item._id },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    );
    if (!r.modifiedCount) throw Errors.state('Biên bản vừa đổi trạng thái, hãy tải lại');
    await this.audit.record(ctx, { action: 'handover.update_item', objectType: 'handover', objectId: String(h._id), before: { itemId, ...before }, after: { itemId, action, toUserId: body.toUserId ?? item.toUserId, note: body.note ?? item.note } });
    return this.load(ctx.companyId, h._id);
  }

  async refresh(ctx: Ctx, h: any) {
    this.requireR3OrReceiver(ctx, h);
    this.requireState(h, ['open', 'received'], 'liệt kê lại');
    const jobId = await this.jobs.enqueue(ctx, 'handover.list', { handoverId: String(h._id) });
    await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId }, { $set: { listJobId: new Types.ObjectId(jobId) } });
    await this.audit.record(ctx, { action: 'handover.refresh', objectType: 'handover', objectId: String(h._id), after: { jobId } });
    return jobId;
  }

  async confirmReceiver(ctx: Ctx, h: any, note?: string) {
    if (String(h.receiverId) !== ctx.user.id) throw Errors.forbidden('Chỉ người nhận bàn giao được xác nhận');
    this.requireState(h, ['open'], 'xác nhận nhận');
    const receipt = { at: new Date(), by: new Types.ObjectId(ctx.user.id), ...(note ? { note } : {}) };
    await this.transition(h, ['open'], { status: 'received', receipt, updatedBy: receipt.by });
    await this.audit.record(ctx, { action: 'handover.confirm_receiver', objectType: 'handover', objectId: String(h._id), before: { status: h.status }, after: { status: 'received', receipt } });
    return this.load(ctx.companyId, h._id);
  }

  /** HCNS kiểm tra (E9): sau ngày làm việc cuối vẫn được nhưng bắt buộc lý do */
  async verify(ctx: Ctx, h: any, body: { note?: string; lateReason?: string }) {
    this.requireR3(ctx);
    this.requireState(h, ['received'], 'kiểm tra');
    const isLate = dateVN() > h.lastWorkingDay;
    const lateReason = body.lateReason?.trim();
    if (isLate && !lateReason) {
      throw Errors.rule('BR-25', `Đã quá ngày làm việc cuối (${h.lastWorkingDay}); cần ghi lý do kiểm tra trễ`, [{ field: 'lateReason', issue: 'required_when_late' }]);
    }
    const verification = { at: new Date(), by: new Types.ObjectId(ctx.user.id), isLate, ...(body.note ? { note: body.note } : {}), ...(isLate ? { lateReason } : {}) };
    await this.transition(h, ['received'], { status: 'verified', verification, updatedBy: verification.by });
    await this.audit.record(ctx, { action: 'handover.verify', objectType: 'handover', objectId: String(h._id), before: { status: h.status }, after: { status: 'verified', verification } });
    const leaver = await this.db.m.User.findOne({ companyId: h.companyId, _id: h.userId }, { name: 1 }).lean<any>();
    const r9 = await this.usersWithRoles(ctx.companyId, ['R9']);
    await this.notifications.notify(ctx.companyId, r9, { type: 'handover_ready', title: `Bàn giao của ${leaver?.name ?? ''} đã kiểm tra, chờ chuyển quyền`, link: `/ban-giao/${h._id}`, objectType: 'handover', objectId: String(h._id) });
    return this.load(ctx.companyId, h._id);
  }

  /** R9 chuyển quyền (E7, E9, E10): chỉ từ ngày làm việc cuối, không đảo ngược */
  async execute(ctx: Ctx, h: any) {
    this.access.requireRole(ctx, 'R9');
    this.requireState(h, ['verified'], 'chuyển quyền');
    if (dateVN() < h.lastWorkingDay) {
      throw Errors.rule('BR-25', `Chỉ chuyển quyền từ ngày làm việc cuối (${h.lastWorkingDay}) trở đi`, [{ field: 'lastWorkingDay', issue: 'too_early' }]);
    }
    const me = new Types.ObjectId(ctx.user.id);
    await this.transition(h, ['verified'], { status: 'executing', execution: { startedAt: new Date(), by: me }, updatedBy: me });
    const jobId = await this.jobs.enqueue(ctx, 'handover.execute', { handoverId: String(h._id) });
    await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId }, { $set: { 'execution.jobId': new Types.ObjectId(jobId) } });
    await this.audit.record(ctx, { action: 'handover.execute', objectType: 'handover', objectId: String(h._id), before: { status: h.status }, after: { status: 'executing', jobId } });
    return jobId;
  }

  async export(ctx: Ctx, h: any) {
    this.requireR3(ctx);
    if (['listing', 'cancelled'].includes(h.status)) this.requireState(h, [], 'xuất biên bản');
    await this.template(ctx.companyId);
    const jobId = await this.jobs.enqueue(ctx, 'handover.export', { handoverId: String(h._id) });
    await this.audit.record(ctx, { action: 'handover.export', objectType: 'handover', objectId: String(h._id), after: { jobId } });
    return jobId;
  }

  /** Huỷ (R3, trước executing): xoá lastWorkingDay, người đó về active (E7) */
  async cancel(ctx: Ctx, h: any, reason: string) {
    this.requireR3(ctx);
    this.requireState(h, ['listing', 'open', 'received', 'verified'], 'huỷ');
    const me = new Types.ObjectId(ctx.user.id);
    await this.transition(h, ['listing', 'open', 'received', 'verified'], { status: 'cancelled', cancelledAt: new Date(), cancelledBy: me, cancelReason: reason, updatedBy: me });
    const user = await this.db.m.User.findOne({ companyId: h.companyId, _id: h.userId }).lean<any>();
    if (user && user.status !== 'left') {
      await this.db.m.User.updateOne({ _id: user._id, companyId: user.companyId }, { $set: { status: 'active', updatedBy: me }, $unset: { lastWorkingDay: 1 } });
      await this.audit.record(ctx, { action: 'user.update', objectType: 'user', objectId: String(user._id), before: { lastWorkingDay: user.lastWorkingDay, status: user.status }, after: { status: 'active' } });
    }
    await this.audit.record(ctx, { action: 'handover.cancel', objectType: 'handover', objectId: String(h._id), before: { status: h.status }, after: { status: 'cancelled', cancelReason: reason } });
    return this.load(ctx.companyId, h._id);
  }

  async usersWithRoles(companyId: string, roles: string[]): Promise<string[]> {
    const rows = await this.db.m.User.find({ companyId: this.cid(companyId), systemRoles: { $in: roles }, status: { $ne: 'left' } }, { _id: 1 }).lean<any[]>();
    return rows.map((r) => String(r._id));
  }

  // ───── liệt kê (E5, E6) ─────
  private async candidates(companyId: string, user: any): Promise<Candidate[]> {
    const cid = this.cid(companyId);
    const u = user._id;
    const m = this.db.m;
    const today = dateVN();
    const out: Candidate[] = [];
    const docs = await m.Document.find({ companyId: cid, status: { $in: DOC_OPEN }, $or: [{ drafterId: u }, { checkerId: u }] }).lean<any[]>();
    for (const d of docs) {
      const roles = [String(d.drafterId) === String(u) ? 'người soạn' : '', String(d.checkerId) === String(u) ? 'người kiểm tra' : ''].filter(Boolean).join(', ');
      out.push({ key: `document:${d._id}`, kind: 'document', objectType: 'document', objectId: d._id, fileId: d.fileId, name: [d.code, d.title].filter(Boolean).join(' '), detail: `${d.status} · ${roles}` });
    }
    const recs = await m.Record.find({ companyId: cid, createdBy: u, status: { $in: ['drafting', 'submitted'] } }).lean<any[]>();
    for (const r of recs) out.push({ key: `record:${r._id}`, kind: 'record', objectType: 'record', objectId: r._id, fileId: r.fileId, name: `${r.number} ${r.fileName ?? r.subject}`, detail: `${r.status} · người lập` });
    const apps = await m.Approval.find({ companyId: cid, status: 'pending', $or: [{ approverId: u }, { checkerId: u, checkedAt: { $exists: false } }, { submittedBy: u }] }).lean<any[]>();
    for (const a of apps) {
      const decides = String(a.approverId) === String(u) || (String(a.checkerId) === String(u) && !a.checkedAt);
      const kind: Kind = decides ? 'approval_to_decide' : 'approval_submitted';
      const role = decides ? (String(a.approverId) === String(u) ? 'người duyệt' : 'người kiểm tra') : 'người trình';
      out.push({ key: `${kind}:${a._id}`, kind, objectType: 'approval', objectId: a._id, name: a.objectTitle ?? `Phiếu ${a.objectType}`, detail: `${a.objectType} · ${role}${a.dueAt ? ` · hạn ${dateVN(a.dueAt)}` : ''}` });
    }
    const shares = await m.ExternalShare.find({ companyId: cid, sharedBy: u, status: 'active' }).lean<any[]>();
    for (const s of shares) out.push({ key: `external_share:${s._id}`, kind: 'external_share', objectType: 'external_share', objectId: s._id, fileId: s.fileId, name: `${s.fileName ?? s.fileId} → ${s.email}`, detail: `${s.role}${s.expiresAt ? ` · hết hạn ${dateVN(s.expiresAt)}` : ''}` });
    const dels = await m.Delegation.find({ companyId: cid, delegateId: u, $or: [{ to: { $exists: false } }, { to: null }, { to: { $gte: today } }] }).lean<any[]>();
    const rtNames = new Map((await m.RecordType.find({ companyId: cid, _id: { $in: dels.map((d) => d.recordTypeId) } }, { name: 1 }).lean<any[]>()).map((r) => [String(r._id), r.name]));
    for (const d of dels) out.push({ key: `delegation:${d._id}`, kind: 'delegation', objectType: 'delegation', objectId: d._id, name: d.task || rtNames.get(String(d.recordTypeId)) || 'Uỷ quyền phê duyệt', detail: `từ ${d.from}${d.to ? ` đến ${d.to}` : ''}` });
    return out;
  }

  private async googleCandidates(user: any): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const f of await this.google.drive.listOwnedFiles(user.email, MY_DRIVE_MAX)) {
      out.push({ key: `my_drive_file:${f.fileId}`, kind: 'my_drive_file', fileId: f.fileId, name: f.name, detail: `${f.mimeType}${f.modifiedTime ? ` · sửa ${dateVN(new Date(f.modifiedTime))}` : ''}` });
    }
    for (const g of await this.google.directory.listUserGroups(user.email)) {
      out.push({ key: `group_membership:${g}`, kind: 'group_membership', groupEmail: g, name: g });
    }
    return out;
  }

  /** Gộp danh sách mới: dòng cũ giữ action đã sửa, thêm dòng mới, dòng không còn → skipped (E6) */
  private merge(h: any, found: Candidate[]) {
    const items: any[] = [...(h.items ?? [])];
    const byKey = new Map(items.map((i) => [i.key, i]));
    const seen = new Set<string>();
    let added = 0;
    let gone = 0;
    for (const c of found) {
      seen.add(c.key);
      const old = byKey.get(c.key);
      if (old) {
        old.name = c.name;
        old.detail = c.detail;
        if (old.status === 'skipped' && old.action !== 'keep' && old.error === 'Không còn trong danh sách') {
          old.status = 'pending';
          delete old.error;
        }
        continue;
      }
      items.push({ _id: new Types.ObjectId(), ...c, action: KIND_ACTIONS[c.kind][0], status: 'pending' });
      added++;
    }
    for (const i of items) {
      if (!seen.has(i.key) && ['pending', 'failed'].includes(i.status)) {
        i.status = 'skipped';
        i.error = 'Không còn trong danh sách';
        gone++;
      }
    }
    return { items, added, gone };
  }

  private async relist(companyId: string, h: any, step: JobContext['step']) {
    const user = await this.db.m.User.findOne({ companyId: this.cid(companyId), _id: h.userId }).lean<any>();
    if (!user) throw Errors.notFound('Không tìm thấy người nghỉ việc');
    const local = await step('Liệt kê tài liệu, hồ sơ, phiếu, chia sẻ, uỷ quyền', () => this.candidates(companyId, user));
    const remote = await step('Liệt kê Drive của tôi, nhóm Google', () => this.googleCandidates(user));
    const r = this.merge(h, [...local, ...remote]);
    return { user, ...r };
  }

  async runList(job: JobContext) {
    const h = await this.load(job.companyId, job.payload.handoverId);
    if (!h) throw Errors.notFound('Không tìm thấy biên bản');
    if (!['listing', 'open', 'received'].includes(h.status)) throw Errors.state(`Biên bản đang "${STATUS_LABEL[h.status]}", không liệt kê lại`);
    const r = await this.relist(job.companyId, h, job.step);
    await job.step('Ghi biên bản', async () => {
      const set: any = { items: r.items };
      if (h.status === 'listing') set.status = 'open';
      const u = await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId, status: h.status }, { $set: set });
      if (!u.matchedCount) throw Errors.state('Biên bản vừa đổi trạng thái trong lúc liệt kê');
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'handover.listed', objectType: 'handover', objectId: String(h._id), after: { total: r.items.length, added: r.added, gone: r.gone, status: set.status ?? h.status } });
    });
    return { total: r.items.length, added: r.added, skipped: r.gone };
  }

  // ───── chuyển quyền (E10) ─────
  async runExecute(job: JobContext) {
    const h0 = await this.load(job.companyId, job.payload.handoverId);
    if (!h0) throw Errors.notFound('Không tìm thấy biên bản');
    if (h0.status !== 'executing') throw Errors.state('Biên bản không ở trạng thái đang chuyển quyền');
    try {
      return await this.execute0(job, h0);
    } catch (e: any) {
      // Việc lỗi → biên bản về verified; dòng đã done giữ nguyên, gọi lại chỉ chạy dòng chưa xong (E7)
      await this.db.m.Handover.updateOne({ _id: h0._id, companyId: h0.companyId, status: 'executing' }, { $set: { status: 'verified', 'execution.finishedAt': new Date() } });
      if (e instanceof GoogleError) throw new AppError(502, 'DRIVE_ERROR', `Google trả lỗi khi chuyển quyền: ${e.message}`);
      throw e;
    }
  }

  private async execute0(job: JobContext, h0: any) {
    const cid = this.cid(job.companyId);
    const actor = { companyId: job.companyId, userId: job.userId, requestId: job.requestId };
    const listed = await job.step('Liệt kê lại', () => this.relist(job.companyId, h0, async (_n, fn) => fn()));
    const user = listed.user;
    const items: any[] = listed.items;
    const h = { ...h0, items };
    const receiver = await this.db.m.User.findOne({ companyId: cid, _id: h.receiverId }).lean<any>();
    if (!receiver) throw Errors.rule('BR-25', 'Không tìm thấy người nhận bàn giao');
    const save = () => this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId }, { $set: { items } });
    const todo = (i: any) => ['pending', 'failed'].includes(i.status);
    const run = async (i: any, fn: () => Promise<any>) => {
      const before = { status: i.status };
      try {
        const after = await fn();
        i.status = after === 'skipped' ? 'skipped' : 'done';
        delete i.error;
      } catch (e: any) {
        i.status = 'failed';
        i.error = e?.message ?? String(e);
        this.log.warn(`Bàn giao ${h._id} dòng ${i.key} lỗi: ${i.error}`);
      }
      await this.audit.write(actor, {
        action: `handover.item.${i.action}`,
        objectType: i.objectType ?? 'handover',
        objectId: String(i.objectId ?? h._id),
        before,
        after: { handoverId: h._id, kind: i.kind, name: i.name, status: i.status, error: i.error, toUserId: i.action === 'reassign' ? i.toUserId ?? h.receiverId : undefined },
      });
    };

    for (const i of items) if (todo(i) && i.action === 'keep') i.status = 'skipped';

    await job.step('Đổi người trong VCdocs', async () => {
      for (const i of items.filter((x) => todo(x) && !['my_drive_file', 'group_membership'].includes(x.kind))) {
        await run(i, () => this.applyLocal(job.companyId, h, user, i));
      }
      await save();
    });

    await job.step('Chuyển Drive của tôi sang người nhận', async () => {
      const files = items.filter((x) => todo(x) && x.kind === 'my_drive_file');
      if (!files.length) return;
      // Google chuyển cả Drive của tôi một lần, không chọn từng file (E5)
      let note: string | undefined;
      let error: string | undefined;
      try {
        const t = await this.google.dataTransfer.transferDrive({ fromEmail: user.email, toEmail: receiver.email });
        let status = t.status;
        for (let n = 0; status === 'inProgress' && n < 20 && this.transferPollMs > 0; n++) {
          await new Promise((r) => setTimeout(r, this.transferPollMs));
          status = (await this.google.dataTransfer.getTransfer(t.transferId)).status;
        }
        if (status === 'failed') error = `Google Data Transfer báo lỗi (mã ${t.transferId})`;
        else if (status === 'inProgress') note = `Google đang chuyển (mã ${t.transferId}), có thể mất vài giờ`;
      } catch (e: any) {
        error = e?.message ?? String(e);
      }
      for (const i of files) await run(i, async () => {
        if (error) throw new Error(error);
        if (note) i.note = note;
      });
      await save();
    });

    await job.step('Gỡ khỏi nhóm Google', async () => {
      for (const i of items.filter((x) => todo(x) && x.kind === 'group_membership')) {
        await run(i, () => this.google.directory.removeGroupMember(i.groupEmail, user.email));
      }
      await save();
    });

    const failed = items.filter((i) => i.status === 'failed').length;
    if (failed) {
      throw new AppError(502, 'DRIVE_ERROR', `${failed} dòng chưa chuyển được; biên bản về "HCNS đã kiểm tra", gọi chuyển quyền lại để chạy tiếp các dòng lỗi`);
    }
    await job.step('Hoàn tất biên bản', async () => {
      await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId, status: 'executing' }, { $set: { status: 'done', items, 'execution.finishedAt': new Date() } });
      await this.audit.write(actor, { action: 'handover.done', objectType: 'handover', objectId: String(h._id), before: { status: 'executing' }, after: { status: 'done', counts: this.counts({ items }) } });
      const r3 = await this.usersWithRoles(job.companyId, ['R3']);
      await this.notifications.notify(job.companyId, [...r3, String(h.receiverId)], { type: 'handover_done', title: `Đã chuyển quyền xong bàn giao của ${user.name}`, link: `/ban-giao/${h._id}`, objectType: 'handover', objectId: String(h._id) });
    });
    return { objectType: 'handover', objectId: String(h._id), ...this.counts({ items }) };
  }

  /** Đổi người, gỡ, kết thúc trên một đối tượng trong VCdocs */
  private async applyLocal(companyId: string, h: any, user: any, i: any): Promise<'skipped' | void> {
    const cid = this.cid(companyId);
    const m = this.db.m;
    const u = String(user._id);
    const to = new Types.ObjectId(String(i.toUserId ?? h.receiverId));
    const actor = new Types.ObjectId(String(h.execution?.by ?? h.updatedBy ?? h.createdBy));
    switch (i.kind as Kind) {
      case 'document': {
        const d = await m.Document.findOne({ companyId: cid, _id: i.objectId }).lean<any>();
        if (!d) return 'skipped';
        const set: any = { updatedBy: actor };
        if (String(d.drafterId) === u) set.drafterId = to;
        if (String(d.checkerId) === u) set.checkerId = to;
        if (Object.keys(set).length === 1) return 'skipped';
        await m.Document.updateOne({ _id: d._id, companyId: cid }, { $set: set });
        return;
      }
      case 'record': {
        const r = await m.Record.updateOne({ companyId: cid, _id: i.objectId, createdBy: user._id }, { $set: { createdBy: to, updatedBy: actor } });
        return r.modifiedCount ? undefined : 'skipped';
      }
      case 'approval_to_decide':
      case 'approval_submitted': {
        const a = await m.Approval.findOne({ companyId: cid, _id: i.objectId, status: 'pending' }).lean<any>();
        if (!a) return 'skipped';
        const set: any = {};
        const deptId = (await this.access.deptByDrive(companyId, a.driveId))?.id;
        if (i.kind === 'approval_to_decide') {
          if (String(a.approverId) === u) {
            let approver = String(to);
            // Người nhận chính là người trình → GĐ khối (BR-05)
            if (approver === String(a.submittedBy)) approver = (await this.approvals.blockDirector(companyId, deptId)) ?? approver;
            if (approver === String(a.submittedBy)) throw Errors.rule('BR-05', 'Người nhận là người trình phiếu và không tìm được GĐ khối để duyệt thay');
            set.approverId = new Types.ObjectId(approver);
            set.approverRule = `${a.approverRule ? `${a.approverRule} – ` : ''}chuyển do bàn giao`;
          }
          if (String(a.checkerId) === u && !a.checkedAt) set.checkerId = to;
        } else if (String(a.submittedBy) === u) {
          set.submittedBy = to;
          if (String(a.approverId) === String(to)) {
            const director = await this.approvals.blockDirector(companyId, deptId);
            if (!director || director === String(to)) throw Errors.rule('BR-05', 'Người nhận đang là người duyệt phiếu này, không thể vừa trình vừa duyệt');
            set.approverId = new Types.ObjectId(director);
            set.approverRule = `${a.approverRule ? `${a.approverRule} – ` : ''}chuyển do bàn giao`;
          }
        }
        if (!Object.keys(set).length) return 'skipped';
        await m.Approval.updateOne({ _id: a._id, companyId: cid, status: 'pending' }, { $set: set });
        if (set.approverId) {
          await this.notifications.notify(companyId, [String(set.approverId)], { type: 'approval_pending', title: `Phiếu chờ bạn duyệt (chuyển do bàn giao): ${a.objectTitle ?? ''}`, link: `/phe-duyet/${a._id}`, objectType: 'approval', objectId: String(a._id) });
        }
        return;
      }
      case 'external_share': {
        const s = await m.ExternalShare.findOne({ companyId: cid, _id: i.objectId, status: 'active' }).lean<any>();
        if (!s) return 'skipped';
        if (i.action === 'revoke') {
          if (s.permissionId) await this.google.drive.deletePermission(s.fileId, s.permissionId);
          await m.ExternalShare.updateOne({ _id: s._id, companyId: cid }, { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actor } });
        } else {
          // Giữ quyền và hạn, người chịu trách nhiệm chia sẻ = người nhận (E5)
          await m.ExternalShare.updateOne({ _id: s._id, companyId: cid }, { $set: { sharedBy: to, updatedBy: actor } });
        }
        return;
      }
      case 'delegation': {
        const d = await m.Delegation.findOne({ companyId: cid, _id: i.objectId }).lean<any>();
        if (!d) return 'skipped';
        if (d.to && d.to <= h.lastWorkingDay) return 'skipped';
        await m.Delegation.updateOne({ _id: d._id, companyId: cid }, { $set: { to: h.lastWorkingDay < d.from ? d.from : h.lastWorkingDay, updatedBy: actor } });
        return;
      }
      default:
        return 'skipped';
    }
  }

  // ───── xuất BM-VCPV-08 (E11) ─────
  async template(companyId: string) {
    const t = await this.db.m.Document.findOne({ companyId: this.cid(companyId), code: HANDOVER_TEMPLATE_CODE, status: 'effective' }).lean<any>();
    const fileId = t?.current?.fileId ?? t?.fileId;
    if (!fileId) throw Errors.rule(undefined, `Chưa có biểu mẫu ${HANDOVER_TEMPLATE_CODE} đang hiệu lực để xuất biên bản`);
    return { doc: t, fileId };
  }

  /** Thư mục tháng hiện tại ở drive phòng HCNS (01 Kế hoạch – Báo cáo / năm / tháng) */
  private async exportFolder(companyId: string, userId: string): Promise<string> {
    const cid = this.cid(companyId);
    const hr = await this.db.m.Department.findOne({ companyId: cid, code: { $in: this.cfg.rules.hrDeptCodes } }).lean<any>();
    if (!hr) throw Errors.rule(undefined, 'Chưa khai báo phòng HCNS');
    const base = await this.db.m.Folder.findOne({ companyId: cid, driveId: hr.driveId, kind: 'plan_report', parentId: { $exists: false } }).lean<any>();
    if (!base) return hr.driveId;
    return (await this.folders.ensurePeriod(companyId, base._id, monthVN(), userId)).folder.googleId;
  }

  async runExport(job: JobContext) {
    const h = await this.load(job.companyId, job.payload.handoverId);
    if (!h) throw Errors.notFound('Không tìm thấy biên bản');
    const cid = this.cid(job.companyId);
    const ids = [h.userId, h.receiverId, h.verification?.by, ...(h.items ?? []).map((i: any) => i.toUserId)].filter(Boolean);
    const people = new Map((await this.db.m.User.find({ companyId: cid, _id: { $in: ids } }, { name: 1, email: 1 }).lean<any[]>()).map((u) => [String(u._id), u]));
    const leaver = people.get(String(h.userId));
    const dept = await this.access.deptById(job.companyId, h.departmentId ? String(h.departmentId) : undefined);
    const tpl = await this.template(job.companyId);
    const today = dateVN();
    const name = `${HANDOVER_TEMPLATE_CODE} Biên bản bàn giao – ${leaver?.name ?? ''} – ${today}`;
    const file = await job.step('Sao biểu mẫu BM-VCPV-08', async () => this.google.drive.copyFile({ fileId: tpl.fileId, parentGoogleId: await this.exportFolder(job.companyId, job.userId), name }));
    await job.step('Điền biên bản', async () => {
      const lines = (h.items ?? []).map((i: any, n: number) => {
        const to = i.action === 'reassign' ? people.get(String(i.toUserId ?? h.receiverId))?.name ?? '' : '';
        return `${n + 1}. [${KIND_LABEL[i.kind as Kind]}] ${i.name} – ${ACTION_LABEL[i.action]}${to ? ` → ${to}` : ''} – ${ITEM_STATUS_LABEL[i.status]}${i.note ? ` (${i.note})` : ''}`;
      });
      await this.google.docs.replacePlaceholders(file.fileId, {
        NGUOI_NGHI: leaver?.name ?? '',
        EMAIL_NGUOI_NGHI: leaver?.email ?? '',
        PHONG: dept ? `${dept.number} ${dept.name}` : '',
        NGAY_LAM_VIEC_CUOI: h.lastWorkingDay,
        NGUOI_NHAN: people.get(String(h.receiverId))?.name ?? '',
        TRANG_THAI: STATUS_LABEL[h.status],
        NGAY_NHAN: h.receipt?.at ? dateVN(h.receipt.at) : '',
        HCNS_KIEM_TRA: h.verification?.by ? people.get(String(h.verification.by))?.name ?? '' : '',
        NGAY_KIEM_TRA: h.verification?.at ? dateVN(h.verification.at) : '',
        DANH_SACH: lines.join('\n') || 'Không có việc cần bàn giao',
        NGAY_XUAT: today,
      });
    });
    await job.step('Ghi biên bản', async () => {
      await this.db.m.Handover.updateOne({ _id: h._id, companyId: h.companyId }, { $set: { exportFileId: file.fileId } });
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'handover.exported', objectType: 'handover', objectId: String(h._id), after: { exportFileId: file.fileId } });
    });
    return { fileId: file.fileId, url: file.webViewLink };
  }

  // ───── việc định kỳ (E9) ─────
  /**
   * 00:30 hằng ngày: người có ngày làm việc cuối trước hôm nay → left, huỷ mọi
   * phiên (đăng nhập → loi=locked); biên bản chưa xong → báo đỏ R3, R9.
   */
  async markLeft(today = dateVN()) {
    for (const c of await this.db.m.Company.find({}).lean<any[]>()) {
      const cid = c._id as Types.ObjectId;
      const companyId = String(cid);
      const users = await this.db.m.User.find({ companyId: cid, status: 'leaving', lastWorkingDay: { $lt: today } }).lean<any[]>();
      for (const u of users) {
        await this.db.m.User.updateOne({ _id: u._id, companyId: cid, status: 'leaving' }, { $set: { status: 'left' } });
        await this.db.m.Session.deleteMany({ companyId: cid, userId: u._id });
        await this.audit.write({ companyId }, { action: 'user.left', objectType: 'user', objectId: String(u._id), before: { status: 'leaving' }, after: { status: 'left', lastWorkingDay: u.lastWorkingDay } });
      }
      const overdue = await this.db.m.Handover.find({ companyId: cid, status: { $in: UNFINISHED }, lastWorkingDay: { $lt: today }, overdueNotifiedAt: { $in: [null] } }).lean<any[]>();
      if (!overdue.length) continue;
      const to = await this.usersWithRoles(companyId, ['R3', 'R9']);
      for (const h of overdue) {
        const leaver = await this.db.m.User.findOne({ companyId: cid, _id: h.userId }, { name: 1 }).lean<any>();
        await this.notifications.notify(companyId, to, { type: 'handover_overdue', title: `Quá hạn bàn giao: ${leaver?.name ?? ''} đã qua ngày làm việc cuối ${h.lastWorkingDay} mà biên bản chưa xong`, link: `/ban-giao/${h._id}`, objectType: 'handover', objectId: String(h._id) });
        await this.db.m.Handover.updateOne({ _id: h._id, companyId: cid }, { $set: { overdueNotifiedAt: new Date() } });
      }
    }
  }

  /** Còn ≤ 2 ngày làm việc tới ngày cuối mà chưa kiểm tra → nhắc R3 (handover_verify_due) */
  async remindVerifyDue(today = dateVN()) {
    for (const c of await this.db.m.Company.find({}).lean<any[]>()) {
      const cid = c._id as Types.ObjectId;
      const rows = await this.db.m.Handover.find({ companyId: cid, status: { $in: ['open', 'received'] }, verifyDueNotifiedAt: { $in: [null] } }).lean<any[]>();
      const due = rows.filter((h) => h.lastWorkingDay >= today && workingDaysBetween(today, h.lastWorkingDay) <= 2);
      if (!due.length) continue;
      const r3 = await this.usersWithRoles(String(cid), ['R3']);
      for (const h of due) {
        const leaver = await this.db.m.User.findOne({ companyId: cid, _id: h.userId }, { name: 1 }).lean<any>();
        await this.notifications.notify(String(cid), r3, { type: 'handover_verify_due', title: `Sắp đến ngày làm việc cuối của ${leaver?.name ?? ''} (${h.lastWorkingDay}), biên bản chưa kiểm tra`, link: `/ban-giao/${h._id}`, objectType: 'handover', objectId: String(h._id) });
        await this.db.m.Handover.updateOne({ _id: h._id, companyId: cid }, { $set: { verifyDueNotifiedAt: new Date() } });
      }
    }
  }
}
