import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Errors } from '../../common/errors';
import type { Ctx } from '../../common/context';
import type { ApprovalObjectType } from '../../common/enums';
import { addDays, toApi } from '../../common/util';

export interface ApproverInfo {
  approverId: string;
  approverRule: string;
  checkerId?: string;
}

/** Mỗi loại đối tượng trình duyệt khai báo cách xử lý khi phiếu đổi trạng thái */
export interface ApprovalHandler {
  load(companyId: string, objectId: string): Promise<any | undefined>;
  driveId(obj: any): string | undefined;
  title(obj: any): string;
  link(obj: any): string;
  /** Người liên quan trực tiếp được xem dù không thuộc drive */
  isParticipant?(ctx: Ctx, obj: any): boolean;
  /** Ai sẽ duyệt (preview, và lúc trình) */
  resolveApprover(ctx: Ctx, obj: any): Promise<ApproverInfo>;
  /** revisionId hiện tại để so với bản chụp (BR-27); không có file thì bỏ qua */
  currentRevision?(obj: any): Promise<string | undefined>;
  onApproved(ctx: Ctx, approval: any, obj: any): Promise<void>;
  onChangesRequested(ctx: Ctx, approval: any, obj: any): Promise<void>;
  onCancelled(ctx: Ctx, approval: any, obj: any): Promise<void>;
  onInvalidated(ctx: Ctx | undefined, approval: any, obj: any): Promise<void>;
}

/**
 * M05 Phê duyệt: phiếu thay luồng email BM-VCPV-05. Người duyệt do máy chủ
 * chọn theo thẩm quyền (BR-03, BR-04, BR-24), không nhận từ giao diện.
 */
@Injectable()
export class ApprovalsService {
  private readonly handlers = new Map<string, ApprovalHandler>();

  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  register(type: ApprovalObjectType, h: ApprovalHandler) {
    this.handlers.set(type, h);
  }
  handler(type: string): ApprovalHandler {
    const h = this.handlers.get(type);
    if (!h) throw Errors.rule(undefined, `Loại phiếu ${type} chưa dùng ở giai đoạn 1`);
    return h;
  }

  // ───── thông tin tổ chức để tính thẩm quyền ─────
  async org(companyId: string) {
    const cid = new Types.ObjectId(companyId);
    const company = await this.db.m.Company.findOne({ _id: cid }).lean<any>();
    const settings = company?.settings ?? {};
    let ceoId: string | undefined = settings.ceoUserId;
    if (!ceoId) ceoId = (await this.access.firstUserWithRole(companyId, 'R1'))?._id?.toString();
    const opsBlock = settings.internalOpsBlockId
      ? await this.db.m.Block.findOne({ companyId: cid, _id: settings.internalOpsBlockId }).lean<any>()
      : await this.db.m.Block.findOne({ companyId: cid, code: this.cfg.rules.internalOpsBlockCode }).lean<any>();
    return {
      ceoId,
      opsDirectorId: opsBlock?.directorId ? String(opsBlock.directorId) : undefined,
      firstR3: (await this.access.firstUserWithRole(companyId, 'R3'))?._id?.toString(),
      firstR8: (await this.access.firstUserWithRole(companyId, 'R8'))?._id?.toString(),
    };
  }

  async blockDirector(companyId: string, departmentId?: string) {
    const d = await this.access.deptById(companyId, departmentId);
    if (!d?.blockId) return undefined;
    const b = await this.db.m.Block.findOne({ companyId: new Types.ObjectId(companyId), _id: new Types.ObjectId(d.blockId) }).lean<any>();
    return b?.directorId ? String(b.directorId) : undefined;
  }

  /** Uỷ quyền còn hiệu lực của khối cho một việc (bảng uỷ quyền khối) */
  async activeDelegation(companyId: string, blockId: string | undefined, tasks: string[], today: string) {
    if (!blockId) return undefined;
    return this.db.m.Delegation.findOne({
      companyId: new Types.ObjectId(companyId),
      blockId: new Types.ObjectId(blockId),
      task: { $in: tasks },
      from: { $lte: today },
      $or: [{ to: { $exists: false } }, { to: null }, { to: { $gte: today } }],
    })
      .sort({ from: -1 })
      .lean<any>();
  }

  /** BR-05: người trình không tự duyệt; người soạn không là người duyệt cùng văn bản */
  assertSeparation(info: ApproverInfo, submitterId: string, drafterId?: string) {
    if (info.approverId === submitterId || (drafterId && info.approverId === String(drafterId))) {
      throw Errors.rule('BR-05', 'Người trình hoặc người soạn không được là người phê duyệt; cần người có thẩm quyền khác', [{ field: 'approverId', issue: 'self_approval' }]);
    }
  }

  // ───── vòng đời phiếu ─────
  async create(
    ctx: Ctx,
    p: { objectType: ApprovalObjectType; objectId: string; objectTitle: string; driveId?: string; approver: ApproverInfo; snapshot?: any; meta?: any; link: string },
  ) {
    const me = new Types.ObjectId(ctx.user.id);
    const row = await this.db.m.Approval.create({
      companyId: new Types.ObjectId(ctx.companyId),
      objectType: p.objectType,
      objectId: new Types.ObjectId(p.objectId),
      objectTitle: p.objectTitle,
      snapshot: p.snapshot,
      submittedBy: me,
      submittedAt: new Date(),
      approverId: new Types.ObjectId(p.approver.approverId),
      approverRule: p.approver.approverRule,
      checkerId: p.approver.checkerId ? new Types.ObjectId(p.approver.checkerId) : undefined,
      status: 'pending',
      dueAt: addDays(new Date(), this.cfg.rules.approvalDueDays),
      meta: p.meta,
      driveId: p.driveId,
      createdBy: me,
      updatedBy: me,
    });
    const a = row.toObject();
    await this.audit.record(ctx, { action: 'approval.submit', objectType: 'approval', objectId: String(a._id), after: { objectType: p.objectType, objectId: p.objectId, approverId: p.approver.approverId, snapshot: p.snapshot } });
    const first = p.approver.checkerId ?? p.approver.approverId;
    await this.notifications.notify(ctx.companyId, [first], {
      type: 'approval_pending',
      title: `${p.approver.checkerId ? 'Chờ bạn kiểm tra' : 'Chờ bạn duyệt'}: ${p.objectTitle}`,
      link: `/phe-duyet/${a._id}`,
      objectType: 'approval',
      objectId: String(a._id),
    });
    return a;
  }

  async get(companyId: string, id: string | Types.ObjectId) {
    return this.db.m.Approval.findOne({ _id: id, companyId: new Types.ObjectId(companyId) }).lean<any>();
  }

  /** Phiếu chờ của một đối tượng */
  async pendingFor(companyId: string, objectType: string, objectId: string | Types.ObjectId) {
    return this.db.m.Approval.findOne({ companyId: new Types.ObjectId(companyId), objectType, objectId: new Types.ObjectId(String(objectId)), status: 'pending' }).lean<any>();
  }

  isRelated(ctx: Ctx, a: any) {
    return [a.submittedBy, a.approverId, a.checkerId].filter(Boolean).map(String).includes(ctx.user.id);
  }

  allowedActions(ctx: Ctx, a: any): string[] {
    const out: string[] = [];
    if (a.status !== 'pending') return out;
    const me = ctx.user.id;
    if (a.checkerId && String(a.checkerId) === me && !a.checkedAt) out.push('check');
    if (String(a.approverId) === me && (!a.checkerId || a.checkedAt)) out.push('decide');
    if (String(a.submittedBy) === me) out.push('cancel');
    if (String(a.submittedBy) === me || this.access.hasRole(ctx, 'R3')) out.push('remind');
    return out;
  }

  toApi(ctx: Ctx, a: any) {
    return { ...toApi(a, ['meta', 'checkComment', 'driveId']), allowedActions: this.allowedActions(ctx, a) };
  }

  private async setStatus(a: any, from: string, set: any) {
    const r = await this.db.m.Approval.updateOne({ _id: a._id, companyId: a.companyId, status: from }, { $set: set });
    if (!r.modifiedCount) throw Errors.state('Phiếu không còn ở trạng thái chờ');
  }

  async check(ctx: Ctx, a: any, comment?: string) {
    if (!a.checkerId || String(a.checkerId) !== ctx.user.id) throw Errors.forbidden('Chỉ người kiểm tra của phiếu được xác nhận');
    if (a.status !== 'pending' || a.checkedAt) throw Errors.state('Phiếu không ở bước chờ kiểm tra');
    await this.setStatus(a, 'pending', { checkedAt: new Date(), checkComment: comment, updatedBy: new Types.ObjectId(ctx.user.id) });
    await this.audit.record(ctx, { action: 'approval.check', objectType: 'approval', objectId: String(a._id), after: { comment } });
    await this.notifications.notify(ctx.companyId, [String(a.approverId)], { type: 'approval_pending', title: `Chờ bạn duyệt: ${a.objectTitle}`, link: `/phe-duyet/${a._id}`, objectType: 'approval', objectId: String(a._id) });
    return this.get(ctx.companyId, a._id);
  }

  async decide(ctx: Ctx, a: any, result: 'approve' | 'changes_requested', comment?: string) {
    if (String(a.approverId) !== ctx.user.id) throw Errors.forbidden('Chỉ người duyệt của phiếu được quyết định');
    if (a.status !== 'pending') throw Errors.state('Phiếu không còn chờ duyệt');
    if (result === 'changes_requested' && !comment?.trim()) throw Errors.validation('Yêu cầu sửa thì phải ghi nội dung cần sửa', [{ field: 'comment', issue: 'required' }]);
    if (a.checkerId && !a.checkedAt) throw Errors.rule('BR-04', 'Phiếu chưa được người kiểm tra xác nhận');
    const h = this.handler(a.objectType);
    const obj = await h.load(ctx.companyId, String(a.objectId));
    if (!obj) throw Errors.notFound('Đối tượng của phiếu không còn');
    if (result === 'approve' && a.snapshot?.revisionId && h.currentRevision) {
      const cur = await h.currentRevision(obj);
      if (cur && cur !== a.snapshot.revisionId) {
        await this.invalidate(ctx, a, obj, `revision đổi từ ${a.snapshot.revisionId} sang ${cur} lúc ${new Date().toISOString()}`);
        throw Errors.state('File đã bị sửa sau khi trình nên phiếu hết giá trị (BR-27); hãy trình lại');
      }
    }
    const decision = { by: new Types.ObjectId(ctx.user.id), at: new Date(), result, comment, device: ctx.device || undefined, ip: ctx.ip || undefined };
    const status = result === 'approve' ? 'approved' : 'changes_requested';
    await this.setStatus(a, 'pending', { status, decision, updatedBy: decision.by });
    const after = await this.get(ctx.companyId, a._id);
    try {
      if (result === 'approve') await h.onApproved(ctx, after, obj);
      else await h.onChangesRequested(ctx, after, obj);
    } catch (e) {
      // Bước kèm theo (vd tạo quyền trên Drive) lỗi → trả phiếu về chờ, không để nửa vời
      await this.db.m.Approval.updateOne({ _id: a._id, companyId: a.companyId }, { $set: { status: 'pending' }, $unset: { decision: 1 } });
      throw e;
    }
    await this.audit.record(ctx, { action: `approval.${status}`, objectType: 'approval', objectId: String(a._id), before: { status: 'pending' }, after: { status, decision } });
    await this.notifications.notify(ctx.companyId, [String(a.submittedBy)], {
      type: 'approval_decided',
      title: `${a.objectTitle}: ${result === 'approve' ? 'đã được duyệt' : 'cần sửa'}`,
      body: comment,
      link: h.link(obj),
      objectType: a.objectType,
      objectId: String(a.objectId),
    });
    return this.get(ctx.companyId, a._id);
  }

  async invalidate(ctx: Ctx | undefined, a: any, obj: any, reason: string) {
    const r = await this.db.m.Approval.updateOne({ _id: a._id, companyId: a.companyId, status: { $in: ['pending', 'approved'] } }, { $set: { status: 'invalidated', invalidatedReason: reason } });
    if (!r.modifiedCount) return;
    await this.handler(a.objectType).onInvalidated(ctx, a, obj);
    const actor = ctx ? this.audit.actorFromCtx(ctx) : { companyId: String(a.companyId) };
    await this.audit.write(actor, { action: 'approval.invalidated', objectType: 'approval', objectId: String(a._id), after: { reason } });
    await this.notifications.notify(String(a.companyId), [String(a.submittedBy), String(a.approverId)], {
      type: 'approval_invalidated',
      title: `Phiếu hết giá trị: ${a.objectTitle}`,
      body: 'File đã đổi sau khi trình (BR-27), cần trình lại',
      link: `/phe-duyet/${a._id}`,
      objectType: 'approval',
      objectId: String(a._id),
    });
  }

  async cancel(ctx: Ctx, a: any) {
    if (String(a.submittedBy) !== ctx.user.id) throw Errors.forbidden('Chỉ người trình được rút phiếu');
    if (a.status !== 'pending') throw Errors.state('Phiếu không còn chờ duyệt');
    await this.setStatus(a, 'pending', { status: 'cancelled', updatedBy: new Types.ObjectId(ctx.user.id) });
    const h = this.handler(a.objectType);
    const obj = await h.load(ctx.companyId, String(a.objectId));
    if (obj) await h.onCancelled(ctx, a, obj);
    await this.audit.record(ctx, { action: 'approval.cancel', objectType: 'approval', objectId: String(a._id), before: { status: 'pending' }, after: { status: 'cancelled' } });
    return this.get(ctx.companyId, a._id);
  }

  async remind(ctx: Ctx, a: any) {
    if (String(a.submittedBy) !== ctx.user.id && !this.access.hasRole(ctx, 'R3')) throw Errors.forbidden('Chỉ người trình hoặc R3 được nhắc');
    if (a.status !== 'pending') throw Errors.state('Phiếu không còn chờ duyệt');
    const last = [a.submittedAt, ...(a.reminders ?? [])].map((d: any) => new Date(d).getTime()).sort().pop()!;
    const wait = last + this.cfg.rules.remindMinHours * 3600_000 - Date.now();
    if (wait > 0) throw Errors.rateLimited(wait / 1000, `Vừa nhắc gần đây, nhắc lại sau ${Math.ceil(wait / 3600_000)} giờ`);
    await this.db.m.Approval.updateOne({ _id: a._id, companyId: a.companyId }, { $push: { reminders: new Date() } });
    await this.remindNotify(a);
    await this.audit.record(ctx, { action: 'approval.remind', objectType: 'approval', objectId: String(a._id) });
    return this.get(ctx.companyId, a._id);
  }

  async remindNotify(a: any) {
    const who = a.checkerId && !a.checkedAt ? a.checkerId : a.approverId;
    await this.notifications.notify(String(a.companyId), [String(who)], {
      type: 'approval_reminder',
      title: `Nhắc: ${a.objectTitle} đang chờ bạn`,
      link: `/phe-duyet/${a._id}`,
      objectType: 'approval',
      objectId: String(a._id),
    });
  }

  /** Việc định kỳ: quá hạn trả lời thì nhắc người duyệt và báo người trình */
  async autoRemind() {
    const now = new Date();
    const dueOnes = await this.db.m.Approval.find({ status: 'pending', dueAt: { $lt: now } }, undefined, { skipTenant: true }).limit(500).lean<any[]>();
    for (const a of dueOnes) {
      const last = (a.reminders ?? []).map((d: any) => new Date(d).getTime()).sort().pop() ?? 0;
      if (now.getTime() - last < 24 * 3600_000) continue;
      await this.db.m.Approval.updateOne({ _id: a._id, companyId: a.companyId }, { $push: { reminders: now } });
      await this.remindNotify(a);
      await this.notifications.notify(String(a.companyId), [String(a.submittedBy)], {
        type: 'approval_overdue',
        title: `Quá hạn duyệt: ${a.objectTitle}`,
        link: `/phe-duyet/${a._id}`,
        objectType: 'approval',
        objectId: String(a._id),
      });
    }
  }
}
