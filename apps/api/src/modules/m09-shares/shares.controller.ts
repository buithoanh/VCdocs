import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts, FOLDER_MIME } from '../../google/ports';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { driveRoleAtLeast } from '../../common/enums';
import { pageResult, parsePage } from '../../common/pagination';
import { addDays, oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ApprovalsService, ApproverInfo } from '../m05-approvals/approvals.service';
import { SchedulerService } from '../scheduler/scheduler.service';

/**
 * M09 Chia sẻ ngoài thay Sổ chia sẻ ngoài BM-VCPV-07: từng file, Xem hoặc Nhận
 * xét, đúng email, có hạn, ghi sổ; tài khoản máy của VCdocs thực hiện (BR-17).
 */
@Controller('external-shares')
export class SharesController {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
    scheduler: SchedulerService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    jobs.register('share.revoke_all', {
      title: 'Gỡ hết chia sẻ ngoài của phòng',
      steps: ['Gỡ quyền trên Drive', 'Cập nhật sổ chia sẻ'],
      handler: async (job) => {
        const cid = new Types.ObjectId(job.companyId);
        const rows = await this.db.m.ExternalShare.find({ companyId: cid, departmentId: new Types.ObjectId(job.payload.departmentId), status: { $in: ['active', 'pending_approval'] } }).lean<any[]>();
        let revoked = 0;
        await job.step('Gỡ quyền trên Drive', async () => {
          for (const s of rows) if (s.permissionId) await this.google.drive.deletePermission(s.fileId, s.permissionId).catch((e) => (String(e?.status) === '404' ? undefined : Promise.reject(e)));
        });
        await job.step('Cập nhật sổ chia sẻ', async () => {
          for (const s of rows) {
            await this.markRevoked(s, job.userId);
            revoked++;
          }
          await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'external_share.revoke_all', objectType: 'department', objectId: job.payload.departmentId, after: { revoked } });
        });
        return { revoked };
      },
    });

    approvals.register('external_share', {
      load: (c, id) => this.db.m.ExternalShare.findOne({ companyId: new Types.ObjectId(c), _id: new Types.ObjectId(id) }).lean(),
      driveId: (s) => s.driveId,
      title: (s) => `Chia sẻ ${s.fileName ?? s.fileId} cho ${s.email}`,
      link: (s) => `/chia-se-ngoai/${s._id}`,
      isParticipant: (ctx, s) => String(s.sharedBy) === ctx.user.id,
      resolveApprover: (ctx, s) => this.resolveApprover(ctx, s),
      onApproved: async (ctx, a, s) => {
        await this.grant(s);
      },
      onChangesRequested: async (ctx, a, s) => this.markRevoked(s, ctx.user.id),
      onCancelled: async (ctx, a, s) => this.markRevoked(s, ctx.user.id),
      onInvalidated: async (ctx, a, s) => this.markRevoked(s, ctx?.user.id),
    });

    scheduler.add({ name: 'shares.expire', everyMs: 10 * 60_000, run: () => this.expireDue() });
    scheduler.add({ name: 'shares.autoRevokeDetected', everyMs: 10 * 60_000, run: () => this.autoRevokeDetected() });
  }

  private async markRevoked(s: any, userId?: string) {
    await this.db.m.ExternalShare.updateOne(
      { _id: s._id, companyId: s.companyId, status: { $in: ['active', 'pending_approval'] } },
      { $set: { status: 'revoked', revokedAt: new Date(), ...(userId ? { revokedBy: new Types.ObjectId(userId) } : {}) } },
    );
  }

  /** File Mật: trưởng phòng của drive duyệt; người chia sẻ là trưởng phòng thì GĐ khối duyệt (BR-05) */
  private async resolveApprover(ctx: Ctx, s: any): Promise<ApproverInfo> {
    const dept = await this.access.deptById(ctx.companyId, String(s.departmentId));
    if (dept?.headId && dept.headId !== String(s.sharedBy)) return { approverId: dept.headId, approverRule: `File Mật → Trưởng phòng ${dept.code} duyệt chia sẻ ngoài` };
    const director = await this.approvals.blockDirector(ctx.companyId, String(s.departmentId));
    if (director) return { approverId: director, approverRule: 'File Mật, người chia sẻ là trưởng phòng → Giám đốc khối duyệt' };
    throw Errors.rule('BR-03', 'Chưa xác định được người duyệt chia sẻ file Mật');
  }

  /** Tạo quyền bằng tài khoản máy; Google không nhận hạn với file nào thì VCdocs tự gỡ */
  private async grant(s: any) {
    const p = await this.google.drive.createPermission(s.fileId, { email: s.email, role: s.role, expirationTime: new Date(s.expiresAt).toISOString(), sendNotification: true });
    await this.db.m.ExternalShare.updateOne({ _id: s._id, companyId: s.companyId }, { $set: { status: 'active', permissionId: p.permissionId, isExpiryManaged: !p.expirationApplied } });
  }

  /** Tìm đối tượng VCdocs của file (hồ sơ hoặc tài liệu đã đăng ký) */
  private async owner(companyId: string, fileId: string) {
    const cid = new Types.ObjectId(companyId);
    const r = await this.db.m.Record.findOne({ companyId: cid, $or: [{ fileId }, { 'finalized.pdfFileId': fileId }, { scanFileId: fileId }] }).lean<any>();
    if (r) return { recordId: r._id, departmentId: r.departmentId, driveId: r.driveId, fileName: r.fileName };
    const d = await this.db.m.Document.findOne({ companyId: cid, $or: [{ fileId }, { 'current.fileId': fileId }, { 'current.pdfFileId': fileId }] }).lean<any>();
    if (d) return { documentId: d._id, departmentId: d.departmentId, driveId: d.driveId, fileName: d.code ? `${d.code} ${d.title}` : d.title };
    return undefined;
  }

  private checkExpiry(expiresAt: string) {
    const t = new Date(expiresAt).getTime();
    const max = addDays(new Date(), this.cfg.rules.shareMaxDays).getTime();
    if (!(t > Date.now())) throw Errors.rule('BR-17', 'Ngày hết hạn phải sau thời điểm hiện tại', [{ field: 'expiresAt', issue: 'in_past' }]);
    if (t > max + 60_000) throw Errors.rule('BR-17', `Chia sẻ ngoài tối đa ${this.cfg.rules.shareMaxDays} ngày`, [{ field: 'expiresAt', issue: 'too_long' }]);
  }

  private async view(ctx: Ctx, s: any, heads?: Set<string>) {
    heads ??= await this.access.headDeptIds(ctx);
    const mine = String(s.sharedBy) === ctx.user.id;
    const head = heads.has(String(s.departmentId));
    const actions: string[] = [];
    if ((mine || head) && ['active', 'pending_approval'].includes(s.status)) actions.push('revoke');
    if ((mine || head) && s.status === 'active' && s.source === 'vcdocs') actions.push('extend');
    return { ...toApi(s, ['driveId', 'remindedAt', 'isExpiryManaged']), allowedActions: actions };
  }

  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['createdAt', 'expiresAt', 'status', 'updatedAt'], '-createdAt');
    const cid = new Types.ObjectId(ctx.companyId);
    const filter: any = { companyId: cid };
    const heads = await this.access.headDeptIds(ctx);
    if (!this.access.hasRole(ctx, 'R3')) {
      if (q.departmentId && !heads.has(q.departmentId)) throw Errors.forbidden('Chỉ xem được sổ chia sẻ của phòng mình');
      filter.$or = [{ sharedBy: new Types.ObjectId(ctx.user.id) }, { departmentId: { $in: [...heads].map((x) => new Types.ObjectId(x)) } }];
    }
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    if (q.status) filter.status = q.status;
    if (q.fileId) filter.fileId = q.fileId;
    const [rows, total] = await Promise.all([this.db.m.ExternalShare.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean<any[]>(), this.db.m.ExternalShare.countDocuments(filter)]);
    return pageResult(await Promise.all(rows.map((s) => this.view(ctx, s, heads))), p, total);
  }

  @Post()
  @Roles('R5', 'R6', 'R8')
  async create(@CurrentCtx() ctx: Ctx, @Body() body: { fileId: string; email: string; role: 'reader' | 'commenter'; reason: string; expiresAt: string }) {
    const email = body.email.trim().toLowerCase();
    if (email.endsWith(`@${this.cfg.allowedDomain}`)) throw Errors.rule('BR-17', 'Người trong công ty không cần chia sẻ ngoài', [{ field: 'email', issue: 'internal_domain' }]);
    if (!body.reason.trim()) throw Errors.validation('Ghi lý do chia sẻ', [{ field: 'reason', issue: 'required' }]);
    this.checkExpiry(body.expiresAt);
    const meta = await this.google.drive.getFile(body.fileId);
    if (!meta) throw Errors.rule('BR-17', 'Không tìm thấy file trên Drive', [{ field: 'fileId', issue: 'not_found' }]);
    if (meta.mimeType === FOLDER_MIME) throw Errors.rule('BR-17', 'Chỉ chia sẻ từng file, không chia sẻ thư mục', [{ field: 'fileId', issue: 'folder' }]);
    const own = await this.owner(ctx.companyId, body.fileId);
    if (!own) throw Errors.rule('BR-17', 'Chỉ chia sẻ được file đã đăng ký trong VCdocs', [{ field: 'fileId', issue: 'not_registered' }]);
    await this.access.assertVisible(ctx, own.driveId);
    if (!driveRoleAtLeast(this.access.driveRole(ctx, own.driveId), 'writer')) throw Errors.forbidden('Bạn cần quyền Đóng góp trên drive chứa file');
    const dup = await this.db.m.ExternalShare.findOne({ companyId: new Types.ObjectId(ctx.companyId), fileId: body.fileId, email, status: { $in: ['active', 'pending_approval'] } }).lean();
    if (dup) throw Errors.rule('BR-17', 'Email này đang được chia sẻ file này; hãy gia hạn thay vì chia sẻ lại', [{ field: 'email', issue: 'already_shared' }]);
    const security = await this.access.securityOfDrive(ctx.companyId, own.driveId);
    const me = new Types.ObjectId(ctx.user.id);
    const row = (
      await this.db.m.ExternalShare.create({
        companyId: new Types.ObjectId(ctx.companyId),
        fileId: body.fileId,
        fileName: own.fileName ?? meta.name,
        recordId: own.recordId,
        documentId: own.documentId,
        departmentId: own.departmentId,
        driveId: own.driveId,
        email,
        role: body.role,
        reason: body.reason.trim(),
        expiresAt: new Date(body.expiresAt),
        sharedBy: me,
        status: security === 'confidential' ? 'pending_approval' : 'active',
        source: 'vcdocs',
        createdBy: me,
        updatedBy: me,
      })
    ).toObject();
    if (security === 'confidential') {
      const approver = await this.resolveApprover(ctx, row);
      const a = await this.approvals.create(ctx, { objectType: 'external_share', objectId: String(row._id), objectTitle: `Chia sẻ ${row.fileName} cho ${email}`, driveId: own.driveId, approver, link: `/chia-se-ngoai/${row._id}`, meta: { reason: row.reason } });
      await this.db.m.ExternalShare.updateOne({ _id: row._id, companyId: row.companyId }, { $set: { approvalId: a._id } });
    } else {
      try {
        await this.grant(row);
      } catch (e) {
        await this.db.m.ExternalShare.deleteOne({ _id: row._id, companyId: row.companyId });
        throw e;
      }
    }
    const after = await this.db.m.ExternalShare.findOne({ _id: row._id, companyId: row.companyId }).lean<any>();
    await this.audit.record(ctx, { action: 'external_share.create', objectType: 'external_share', objectId: String(row._id), after: { fileId: row.fileId, email, role: row.role, expiresAt: row.expiresAt, status: after.status } });
    return this.view(ctx, after);
  }

  @Post('revoke-all')
  @Roles('R4')
  @HttpCode(202)
  async revokeAll(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    await this.access.requireHeadOf(ctx, q.departmentId);
    const jobId = await this.jobs.enqueue(ctx, 'share.revoke_all', { departmentId: q.departmentId });
    await this.audit.record(ctx, { action: 'external_share.revoke_all', objectType: 'department', objectId: q.departmentId, after: { jobId } });
    return { jobId };
  }

  /** Chia sẻ trong nhật ký Google không có trong sổ (R4 phòng mình, R3) */
  @Get('anomalies')
  @Roles('R4', 'R3')
  async anomalies(@CurrentCtx() ctx: Ctx) {
    await this.detect(ctx.companyId);
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId), source: 'detected', status: 'active' };
    if (!this.access.hasRole(ctx, 'R3')) filter.departmentId = { $in: [...(await this.access.headDeptIds(ctx))].map((x) => new Types.ObjectId(x)) };
    const rows = await this.db.m.ExternalShare.find(filter).sort({ createdAt: -1 }).limit(500).lean<any[]>();
    const heads = await this.access.headDeptIds(ctx);
    return { items: await Promise.all(rows.map((s) => this.view(ctx, s, heads))) };
  }

  /** Đọc nhật ký kiểm tra Google, ghi lượt chia sẻ ngoài không qua VCdocs (source = detected) */
  async detect(companyId: string) {
    const cid = new Types.ObjectId(companyId);
    const acts = await this.google.reports.listExternalShares(addDays(new Date(), -30));
    for (const a of acts) {
      const email = a.email.toLowerCase();
      const known = await this.db.m.ExternalShare.findOne({
        companyId: cid,
        fileId: a.fileId,
        email,
        $or: [{ status: { $in: ['active', 'pending_approval'] } }, { source: 'detected', detectedAt: new Date(a.at) }],
      }).lean();
      if (known) continue;
      const own = await this.owner(companyId, a.fileId);
      let driveId = own?.driveId;
      if (!driveId) driveId = (await this.google.drive.getFile(a.fileId))?.driveId;
      const dept = await this.access.deptByDrive(companyId, driveId);
      if (!dept) continue;
      const actor = a.actorEmail ? await this.db.m.User.findOne({ companyId: cid, email: a.actorEmail.toLowerCase() }).lean<any>() : undefined;
      await this.db.m.ExternalShare.create({
        companyId: cid,
        fileId: a.fileId,
        fileName: own?.fileName ?? a.fileName,
        recordId: own?.recordId,
        documentId: own?.documentId,
        departmentId: new Types.ObjectId(dept.id),
        driveId: dept.driveId,
        email,
        role: a.role === 'commenter' ? 'commenter' : 'reader',
        sharedBy: actor?._id,
        permissionId: a.permissionId,
        status: 'active',
        source: 'detected',
        detectedAt: new Date(a.at),
      });
      await this.notifications.notify(companyId, [dept.headId], {
        type: 'share_detected',
        title: `Chia sẻ ngoài không qua VCdocs: ${a.fileName ?? a.fileId} → ${email}`,
        link: '/chia-se-ngoai?status=active',
      });
    }
  }

  /** Việc định kỳ: gỡ lượt chia sẻ phát hiện ngoài sổ (US-09.1 bổ sung 11.3) */
  async autoRevokeDetected() {
    const rows = await this.db.m.ExternalShare.find({ source: 'detected', status: 'active' }, undefined, { skipTenant: true }).limit(200).lean<any[]>();
    for (const s of rows) {
      try {
        const perms = await this.google.drive.listFilePermissions(s.fileId);
        for (const p of perms.filter((x) => x.emailAddress?.toLowerCase() === s.email)) await this.google.drive.deletePermission(s.fileId, p.permissionId);
        await this.markRevoked(s);
        await this.audit.write({ companyId: String(s.companyId) }, { action: 'external_share.auto_revoke', objectType: 'external_share', objectId: String(s._id), after: { email: s.email } });
      } catch {
        /* lần sau thử lại */
      }
    }
  }

  /** Việc định kỳ: đến hạn thì gỡ quyền, trước 3 ngày nhắc người chia sẻ */
  async expireDue() {
    const now = new Date();
    const due = await this.db.m.ExternalShare.find({ status: 'active', source: 'vcdocs', expiresAt: { $lte: now } }, undefined, { skipTenant: true }).limit(500).lean<any[]>();
    for (const s of due) {
      if (s.permissionId) await this.google.drive.deletePermission(s.fileId, s.permissionId).catch(() => undefined);
      await this.db.m.ExternalShare.updateOne({ _id: s._id, companyId: s.companyId, status: 'active' }, { $set: { status: 'expired', revokedAt: now } });
      await this.audit.write({ companyId: String(s.companyId) }, { action: 'external_share.expired', objectType: 'external_share', objectId: String(s._id) });
    }
    const soon = await this.db.m.ExternalShare.find({ status: 'active', source: 'vcdocs', remindedAt: { $exists: false }, expiresAt: { $lte: addDays(now, this.cfg.rules.shareRemindDays) } }, undefined, { skipTenant: true }).limit(500).lean<any[]>();
    for (const s of soon) {
      await this.notifications.notify(String(s.companyId), [String(s.sharedBy)], { type: 'share_expiring', title: `Sắp hết hạn chia sẻ ${s.fileName} cho ${s.email}`, body: `Hết hạn ${new Date(s.expiresAt).toISOString().slice(0, 10)}; gia hạn nếu cần`, link: `/chia-se-ngoai/${s._id}`, objectType: 'external_share', objectId: String(s._id) });
      await this.db.m.ExternalShare.updateOne({ _id: s._id, companyId: s.companyId }, { $set: { remindedAt: now } });
    }
  }

  private async loadOwned(ctx: Ctx, id: string) {
    const s = await this.db.m.ExternalShare.findOne({ companyId: new Types.ObjectId(ctx.companyId), _id: oid(id) }).lean<any>();
    if (!s) throw Errors.notFound('Không tìm thấy lượt chia sẻ');
    if (String(s.sharedBy) !== ctx.user.id && !(await this.access.isHeadOf(ctx, String(s.departmentId)))) {
      await this.access.assertVisible(ctx, s.driveId);
      throw Errors.forbidden('Chỉ người chia sẻ hoặc trưởng phòng được làm');
    }
    return s;
  }

  @Post(':id/revoke')
  @HttpCode(200)
  async revoke(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const s = await this.loadOwned(ctx, id);
    if (!['active', 'pending_approval'].includes(s.status)) throw Errors.state('Lượt chia sẻ không còn hiệu lực');
    if (s.permissionId) {
      await this.google.drive.deletePermission(s.fileId, s.permissionId).catch((e) => (String(e?.status) === '404' ? undefined : Promise.reject(e)));
    } else if (s.source === 'detected') {
      const perms = await this.google.drive.listFilePermissions(s.fileId);
      for (const p of perms.filter((x) => x.emailAddress?.toLowerCase() === s.email)) await this.google.drive.deletePermission(s.fileId, p.permissionId);
    }
    if (s.status === 'pending_approval' && s.approvalId) {
      await this.db.m.Approval.updateOne({ _id: s.approvalId, companyId: s.companyId, status: 'pending' }, { $set: { status: 'cancelled' } });
    }
    await this.markRevoked(s, ctx.user.id);
    const after = await this.db.m.ExternalShare.findOne({ _id: s._id, companyId: s.companyId }).lean<any>();
    await this.audit.record(ctx, { action: 'external_share.revoke', objectType: 'external_share', objectId: id, before: { status: s.status }, after: { status: 'revoked' } });
    return this.view(ctx, after);
  }

  @Post(':id/extend')
  @HttpCode(200)
  async extend(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { expiresAt: string }) {
    const s = await this.loadOwned(ctx, id);
    if (s.status !== 'active') throw Errors.state('Chỉ gia hạn được lượt chia sẻ đang hiệu lực');
    this.checkExpiry(body.expiresAt);
    const expiresAt = new Date(body.expiresAt);
    let managed = s.isExpiryManaged;
    if (s.permissionId) managed = !(await this.google.drive.updatePermissionExpiry(s.fileId, s.permissionId, expiresAt.toISOString()));
    await this.db.m.ExternalShare.updateOne({ _id: s._id, companyId: s.companyId }, { $set: { expiresAt, isExpiryManaged: managed, updatedBy: new Types.ObjectId(ctx.user.id) }, $unset: { remindedAt: 1 } });
    const after = await this.db.m.ExternalShare.findOne({ _id: s._id, companyId: s.companyId }).lean<any>();
    await this.audit.record(ctx, { action: 'external_share.extend', objectType: 'external_share', objectId: id, before: { expiresAt: s.expiresAt }, after: { expiresAt } });
    return this.view(ctx, after);
  }
}
