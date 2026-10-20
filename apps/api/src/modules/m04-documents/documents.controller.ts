import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { DOC_TYPE_CODE } from '../../common/enums';
import { pageResult, parsePage } from '../../common/pagination';
import { addDays, addMonthsToDateStr, dateVN, escapeRegex, normalizeText } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ApprovalsService } from '../m05-approvals/approvals.service';
import { DriveOpsService } from '../shared/drive-ops.service';
import { ExportService } from '../shared/export.service';
import { DocumentsService, FRAME_TEMPLATE } from './documents.service';

const SORTABLE = ['code', 'title', 'createdAt', 'updatedAt', 'status', 'reviewDue', 'dueDate', 'type'];
const R6_UP = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R8'] as const;

@Controller()
export class DocumentsController {
  constructor(
    private readonly db: Db,
    private readonly docs: DocumentsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly approvals: ApprovalsService,
    private readonly ops: DriveOpsService,
    exporter: ExportService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    jobs.register('document.create_draft', {
      title: 'Tạo file nháp từ biểu mẫu khung',
      steps: ['Sao chép biểu mẫu khung', 'Điền bảng nhận diện', 'Ghi sổ VCdocs'],
      handler: (job) => this.runCreateDraft(job),
    });
    jobs.register('document.issue', {
      title: 'Ban hành tài liệu',
      steps: ['Điền bảng đầu file', 'Đổi tên, chuyển vào thư mục chính thức', 'Khoá file và lưu bản PDF', 'Cập nhật danh mục', 'Gửi thông báo ban hành'],
      handler: (job) => this.docs.runIssue(job),
    });
    jobs.register('document.withdraw', {
      title: 'Huỷ bỏ tài liệu',
      steps: ['Đổi tên [HẾT HIỆU LỰC] và chuyển vào 99', 'Cập nhật danh mục'],
      handler: (job) => this.docs.runWithdraw(job),
    });
    jobs.register('external_document.import', {
      title: 'Nhập tài liệu bên ngoài',
      steps: ['Sao chép vào 00 Tài liệu', 'Ghi sổ VCdocs'],
      handler: (job) => this.runImportExternal(job),
    });
    jobs.register('documents.catalog_export', {
      title: 'Xuất Danh mục tài liệu VCPV',
      steps: ['Đọc danh mục', 'Tạo Google Sheets'],
      handler: async (job) => {
        const rows = await job.step('Đọc danh mục', () =>
          this.db.m.Document.find({ companyId: new Types.ObjectId(job.companyId), status: { $in: ['effective', 'revising'] } }).sort({ code: 1 }).lean<any[]>(),
        );
        const depts = await this.access.departments(job.companyId);
        return job.step('Tạo Google Sheets', () =>
          exporter.toSheet(
            job.companyId,
            'Danh mục tài liệu VCPV',
            ['Mã', 'Tên tài liệu', 'Loại', 'Cấp', 'Phòng soạn', 'Phiên bản', 'Ngày hiệu lực', 'Kỳ rà soát', 'Mức bảo mật'],
            rows.map((r) => [r.code ?? `${r.external?.source ?? ''} ${r.external?.number ?? ''}`.trim(), r.title, r.type, r.level, depts.find((x) => x.id === String(r.departmentId))?.code ?? '', r.current?.number ? `v${r.current.number}` : '', r.current?.effectiveFrom ?? '', r.reviewDue ?? '', r.securityLevel === 'confidential' ? 'Mật' : r.securityLevel === 'internal' ? 'Nội bộ' : 'Phòng ban']),
          ),
        );
      },
    });

    // Phiếu duyệt ban hành tài liệu
    approvals.register('document', {
      load: (c, id) => this.docs.load(c, id),
      driveId: (d) => d.driveId,
      title: (d) => `${d.code ?? ''} ${d.title}`.trim(),
      link: (d) => `/tai-lieu/${d._id}`,
      isParticipant: (ctx, d) => this.docs.isParticipant(ctx, d),
      resolveApprover: (ctx, d) => this.docs.resolveApprover(ctx, d),
      currentRevision: async (d) => (d.fileId ? (await this.google.drive.latestRevision(d.fileId)).revisionId : undefined),
      onApproved: async (ctx, a, d) => {
        await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId, status: 'submitted' }, { $set: { status: 'approved', approverId: a.approverId, updatedBy: new Types.ObjectId(ctx.user.id) } });
      },
      onChangesRequested: (ctx, a, d) => this.backToDraft(d, a.meta?.prevStatus === 'revising' || d.revision ? 'revising' : 'drafting'),
      onCancelled: (ctx, a, d) => this.backToDraft(d, a.meta?.prevStatus ?? 'drafting'),
      onInvalidated: (ctx, a, d) => this.backToDraft(d, d.revision ? 'revising' : 'drafting'),
    });
    // Phiếu trình huỷ bỏ (BR-08)
    approvals.register('document_withdrawal', {
      load: (c, id) => this.docs.load(c, id),
      driveId: (d) => d.driveId,
      title: (d) => `Huỷ bỏ ${d.code ?? ''} ${d.title}`.trim(),
      link: (d) => `/tai-lieu/${d._id}`,
      isParticipant: (ctx, d) => this.docs.isParticipant(ctx, d),
      resolveApprover: (ctx, d) => this.docs.resolveApprover(ctx, d),
      // Duyệt xong trả 200 ngay, việc nền document.withdraw đổi tên, chuyển 99; phiếu ghi jobId (D15)
      onApproved: async (ctx, a, d) => {
        const jobId = await this.jobs.enqueue(ctx, 'document.withdraw', { documentId: String(d._id), replacedById: a.meta?.replacedById });
        await this.db.m.Approval.updateOne({ _id: a._id, companyId: a.companyId }, { $set: { jobId: new Types.ObjectId(jobId) } });
      },
      onChangesRequested: async () => undefined,
      onCancelled: async () => undefined,
      onInvalidated: async () => undefined,
    });
  }

  private async backToDraft(d: any, status: string) {
    if (d.fileId) await this.ops.unlock(d.fileId).catch(() => undefined);
    await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId, status: { $in: ['submitted', 'approved'] } }, { $set: { status, lock: { isLocked: false } } });
  }

  private async view(ctx: Ctx, d: any, summary = false) {
    return this.docs.toApi(ctx, d, await this.access.headDeptIds(ctx), { summary });
  }

  // ───────────── Danh mục ─────────────
  @Get('documents')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, SORTABLE, 'code');
    const cid = new Types.ObjectId(ctx.companyId);
    const filter: any = { companyId: cid };
    for (const k of ['type', 'level', 'status']) if (q[k]) filter[k] = q[k];
    if (q.departmentId) filter.departmentId = new Types.ObjectId(q.departmentId);
    if (q.q) filter.searchText = new RegExp(escapeRegex(normalizeText(q.q)));
    if (q.reviewDueBefore) filter.reviewDue = { $lte: q.reviewDueBefore };
    const me = new Types.ObjectId(ctx.user.id);
    // Drive Mật lọc ngay ở CSDL: người không có quyền chỉ nhận mã và tên
    const full = { $or: [{ $ne: ['$securityLevel', 'confidential'] }, { $in: ['$driveId', ctx.visibleDriveIds] }, { $eq: ['$drafterId', me] }, { $eq: ['$checkerId', me] }, { $eq: ['$approverId', me] }] };
    const [items, total] = await Promise.all([
      this.db.m.Document.aggregate([
        { $match: filter },
        { $sort: p.sort },
        { $skip: p.skip },
        { $limit: p.limit },
        {
          $replaceWith: {
            $cond: [full, '$$ROOT', { _id: '$_id', companyId: '$companyId', createdAt: '$createdAt', updatedAt: '$updatedAt', code: '$code', type: '$type', level: '$level', title: '$title', departmentId: '$departmentId', status: '$status', securityLevel: '$securityLevel', __restricted: true }],
          },
        },
      ]),
      this.db.m.Document.countDocuments(filter),
    ]);
    const heads = await this.access.headDeptIds(ctx);
    return pageResult(items.map((d) => this.docs.toApi(ctx, d, heads, { summary: true })), p, total);
  }

  @Post('documents')
  @Roles('R4')
  async register(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    await this.access.requireHeadOf(ctx, body.departmentId);
    if (body.type === 'EXT') throw Errors.rule('BR-31', 'Tài liệu bên ngoài nhập qua "Nhập tài liệu bên ngoài", không cấp mã nội bộ');
    if (body.type === 'QD' && body.level !== 'VCPV') {
      throw Errors.rule('BR-02', 'Quy định chỉ được đăng ký ở cấp VCPV', [{ field: 'level', issue: 'must_be_VCPV' }]);
    }
    const cid = new Types.ObjectId(ctx.companyId);
    for (const f of ['drafterId', 'checkerId']) {
      if (body[f] && !(await this.db.m.User.findOne({ companyId: cid, _id: new Types.ObjectId(body[f]), status: { $ne: 'left' } }).lean())) {
        throw Errors.validation(`${f === 'drafterId' ? 'Người soạn' : 'Người kiểm tra'} không tồn tại`, [{ field: f, issue: 'not_found' }]);
      }
    }
    const drive = await this.docs.driveFor(ctx.companyId, body.level, body.departmentId);
    const me = new Types.ObjectId(ctx.user.id);
    const row = (
      await this.db.m.Document.create({
        companyId: cid,
        type: body.type,
        level: body.level,
        title: body.title.trim(),
        departmentId: new Types.ObjectId(body.departmentId),
        status: 'registered',
        driveId: drive.driveId,
        securityLevel: drive.securityLevel,
        drafterId: new Types.ObjectId(body.drafterId),
        checkerId: body.checkerId ? new Types.ObjectId(body.checkerId) : undefined,
        dueDate: body.dueDate,
        searchText: this.docs.searchText({ title: body.title }),
        createdBy: me,
        updatedBy: me,
      })
    ).toObject();
    await this.audit.record(ctx, { action: 'document.register', objectType: 'document', objectId: String(row._id), after: { type: row.type, level: row.level, title: row.title, status: 'registered' } });
    const r3 = await this.db.m.User.find({ companyId: cid, systemRoles: 'R3', status: { $ne: 'left' } }, { _id: 1 }).lean<any[]>();
    await this.notifications.notify(ctx.companyId, r3.map((u) => String(u._id)), { type: 'document_registered', title: `Cần cấp mã: ${row.title}`, link: `/tai-lieu/${row._id}`, objectType: 'document', objectId: String(row._id) });
    return this.view(ctx, row);
  }

  /** Tên gần giống – tránh soạn trùng */
  @Get('documents/similar')
  @Roles('R4')
  async similar(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const words = normalizeText(q.title).split(' ').filter((w) => w.length >= 2);
    if (!words.length) return { items: [] };
    const rows = await this.db.m.Document.find({ companyId: new Types.ObjectId(ctx.companyId), status: { $ne: 'withdrawn' }, searchText: { $in: words.map((w) => new RegExp(`(^| )${escapeRegex(w)}( |$)`)) } })
      .limit(200)
      .lean<any[]>();
    const set = new Set(words);
    const scored = rows
      .map((d) => {
        const dw = new Set(normalizeText(d.title).split(' '));
        const inter = [...set].filter((w) => dw.has(w)).length;
        return { d, score: inter / Math.max(1, new Set([...set, ...dw]).size) };
      })
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const heads = await this.access.headDeptIds(ctx);
    return { items: scored.map((x) => this.docs.toApi(ctx, x.d, heads, { summary: true })) };
  }

  /** Mở bản hiệu lực theo mã; bản cũ chỉ qua versions (US-08.2) */
  @Get('documents/by-code/:code')
  async byCode(@CurrentCtx() ctx: Ctx, @Param('code') code: string) {
    const d = await this.db.m.Document.findOne({ companyId: new Types.ObjectId(ctx.companyId), code: code.trim().toUpperCase().replace(/^QD-/, 'QĐ-'), status: { $in: ['effective', 'revising'] } }).lean<any>();
    if (!d || !this.docs.canSeeFull(ctx, d)) throw Errors.notFound('Không có bản hiệu lực của mã này');
    return this.view(ctx, d);
  }

  @Post('documents/catalog/export')
  @Roles('R3')
  @HttpCode(202)
  async exportCatalog(@CurrentCtx() ctx: Ctx) {
    const jobId = await this.jobs.enqueue(ctx, 'documents.catalog_export', {});
    await this.audit.record(ctx, { action: 'document.catalog_export', objectType: 'job', objectId: jobId });
    return { jobId };
  }

  @Get('documents/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.view(ctx, await this.docs.loadVisible(ctx, id));
  }

  // ───────────── Vòng đời ─────────────
  private async setStatus(ctx: Ctx, d: any, from: string[], set: any, action: string) {
    const r = await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId, status: { $in: from } }, { $set: { ...set, updatedBy: new Types.ObjectId(ctx.user.id) } });
    if (!r.modifiedCount) throw Errors.state('Tài liệu không còn ở trạng thái cho phép thao tác này');
    const after = await this.docs.load(ctx.companyId, d._id);
    await this.audit.record(ctx, { action, objectType: 'document', objectId: String(d._id), before: { status: d.status }, after: { status: after.status, ...set } });
    return after;
  }

  private assertStatus(d: any, ...st: string[]) {
    if (!st.includes(d.status)) throw Errors.state(`Thao tác này chỉ làm khi tài liệu ở trạng thái ${st.join(', ')} (hiện tại: ${d.status})`);
  }

  /** R3 cấp mã kế tiếp theo Loại-Mã phòng; mã đã dùng không cấp lại (BR-01) */
  @Post('documents/:id/assign-code')
  @Roles('R3')
  @HttpCode(200)
  async assignCode(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const d = await this.docs.loadVisible(ctx, id);
    this.assertStatus(d, 'registered');
    const dept = await this.access.deptById(ctx.companyId, String(d.departmentId));
    const prefix = `${DOC_TYPE_CODE[d.type as 'QD']}-${d.level === 'VCPV' ? 'VCPV' : dept!.code}`;
    const cid = d.companyId;
    const key = `doc:${prefix}`;
    if (!(await this.db.m.Counter.findOne({ companyId: cid, key }).lean())) {
      const used = await this.db.m.Document.find({ companyId: cid, code: new RegExp(`^${escapeRegex(prefix)}-\\d+$`) }, { code: 1 }).lean<any[]>();
      const max = used.reduce((m, x) => Math.max(m, Number(x.code.split('-').pop())), 0);
      await this.db.m.Counter.create({ companyId: cid, key, seq: max }).catch((e: any) => {
        if (e?.code !== 11000) throw e;
      });
    }
    const c = await this.db.m.Counter.findOneAndUpdate({ companyId: cid, key }, { $inc: { seq: 1 } }, { new: true }).lean<any>();
    const code = `${prefix}-${String(c.seq).padStart(2, '0')}`;
    const after = await this.setStatus(ctx, d, ['registered'], { status: 'coded', code, searchText: this.docs.searchText({ code, title: d.title }) }, 'document.assign_code');
    await this.notifications.notify(ctx.companyId, [String(d.drafterId)], { type: 'document_coded', title: `Đã cấp mã ${code}: ${d.title}`, body: 'Bạn là người soạn, hãy tạo file nháp', link: `/tai-lieu/${d._id}`, objectType: 'document', objectId: String(d._id) });
    return this.view(ctx, after);
  }

  @Post('documents/:id/create-draft')
  @HttpCode(202)
  async createDraft(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const d = await this.docs.loadVisible(ctx, id);
    if (String(d.drafterId) !== ctx.user.id) throw Errors.forbidden('Chỉ người soạn được giao tạo file nháp');
    this.assertStatus(d, 'coded');
    await this.frameTemplate(ctx.companyId, d.type);
    await this.docs.docFolder(ctx.companyId, d.driveId, d.type);
    const running = await this.db.m.Job.findOne({ companyId: d.companyId, type: 'document.create_draft', status: { $in: ['queued', 'running'] }, 'payload.documentId': id }).lean();
    if (running) throw Errors.state('Đang tạo file nháp cho tài liệu này');
    const jobId = await this.jobs.enqueue(ctx, 'document.create_draft', { documentId: id });
    await this.audit.record(ctx, { action: 'document.create_draft', objectType: 'document', objectId: id, after: { jobId } });
    return { jobId };
  }

  /** BM khung bản hiệu lực (QĐ ← BM-VCPV-02, QT ← 03, HD ← 04); BM không có khung → file trống */
  private async frameTemplate(companyId: string, type: string) {
    const code = FRAME_TEMPLATE[type];
    if (!code) return undefined;
    const t = await this.db.m.Document.findOne({ companyId: new Types.ObjectId(companyId), code, status: { $in: ['effective', 'revising'] } }).lean<any>();
    if (!t?.current?.fileId) throw Errors.rule(undefined, `Chưa có biểu mẫu khung ${code} bản hiệu lực để tạo file nháp`);
    return t;
  }

  private async runCreateDraft(job: any) {
    const d = await this.docs.load(job.companyId, job.payload.documentId);
    if (!d || d.status !== 'coded') throw Errors.state('Tài liệu không ở trạng thái đã cấp mã');
    const folder = await this.docs.docFolder(job.companyId, d.driveId, d.type);
    const name = `${d.code} v1 ${d.title}`;
    const file = await job.step('Sao chép biểu mẫu khung', async () => {
      const t = await this.frameTemplate(job.companyId, d.type);
      return t ? this.google.drive.copyFile({ fileId: t.current.fileId, parentGoogleId: folder.googleId, name }) : this.google.drive.createEmptyDoc({ parentGoogleId: folder.googleId, name });
    });
    const drafter = await this.db.m.User.findOne({ companyId: d.companyId, _id: d.drafterId }).lean<any>();
    const headerValues = await job.step('Điền bảng nhận diện', () =>
      this.ops.updateHeader(file.fileId, undefined, { MA: d.code, PHIEN_BAN: 'v1 (nháp)', TRANG_THAI: 'Nháp – chưa hiệu lực', NGUOI_SOAN: drafter?.name ?? '' }),
    );
    await job.step('Ghi sổ VCdocs', async () => {
      await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId, status: 'coded' }, { $set: { status: 'drafting', fileId: file.fileId, folderId: folder._id, headerValues, draftVersion: 1, lock: { isLocked: false }, updatedBy: new Types.ObjectId(job.userId) } });
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'document.draft_created', objectType: 'document', objectId: String(d._id), before: { status: 'coded' }, after: { status: 'drafting', fileId: file.fileId } });
    });
    return { objectType: 'document', objectId: String(d._id), fileId: file.fileId };
  }

  /** Lấy góp ý: cấp quyền Nhận xét cho người ngoài drive, thông báo (US-04.3) */
  @Post('documents/:id/request-feedback')
  @HttpCode(200)
  async requestFeedback(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { reviewerIds?: string[]; departmentIds?: string[]; dueDate: string }) {
    const d = await this.docs.loadVisible(ctx, id);
    if (String(d.drafterId) !== ctx.user.id) throw Errors.forbidden('Chỉ người soạn được gửi lấy góp ý');
    this.assertStatus(d, 'drafting', 'revising');
    if (body.dueDate < dateVN()) throw Errors.validation('Hạn góp ý phải từ hôm nay trở đi', [{ field: 'dueDate', issue: 'in_past' }]);
    const cid = d.companyId;
    const ids = new Set((body.reviewerIds ?? []).map(String));
    if (body.departmentIds?.length) {
      const us = await this.db.m.User.find({ companyId: cid, departmentId: { $in: body.departmentIds.map((x) => new Types.ObjectId(x)) }, status: 'active' }, { _id: 1 }).lean<any[]>();
      us.forEach((u) => ids.add(String(u._id)));
    }
    ids.delete(ctx.user.id);
    if (!ids.size) throw Errors.validation('Chọn ít nhất một người hoặc một phòng góp ý', [{ field: 'reviewerIds', issue: 'required' }]);
    const users = await this.db.m.User.find({ companyId: cid, _id: { $in: [...ids].map((x) => new Types.ObjectId(x)) } }).lean<any[]>();
    if (users.length !== ids.size) throw Errors.validation('Có người góp ý không tồn tại', [{ field: 'reviewerIds', issue: 'not_found' }]);
    const permissions: any[] = [...(d.feedback?.permissions ?? [])];
    for (const u of users) {
      const onDrive = (u.driveRoles ?? []).some((r: any) => r.driveId === d.driveId && ['commenter', 'writer', 'fileOrganizer', 'organizer'].includes(r.role));
      if (onDrive || permissions.some((p) => String(p.userId) === String(u._id))) continue;
      const p = await this.google.drive.createPermission(d.fileId, { email: u.email, role: 'commenter', sendNotification: false });
      permissions.push({ userId: u._id, permissionId: p.permissionId });
    }
    const feedback = { dueDate: body.dueDate, reviewerIds: users.map((u) => u._id), permissions, requestedAt: new Date() };
    const after = await this.setStatus(ctx, d, ['drafting', 'revising'], { status: 'feedback', feedback, ...(d.status === 'revising' ? { revision: { ...d.revision, viaFeedback: true } } : {}) }, 'document.request_feedback');
    await this.notifications.notify(ctx.companyId, users.map((u) => String(u._id)), { type: 'feedback_requested', title: `Mời góp ý ${d.code} ${d.title}`, body: `Hạn góp ý ${body.dueDate}`, link: `/tai-lieu/${d._id}`, objectType: 'document', objectId: String(d._id) });
    return this.view(ctx, after);
  }

  @Get('documents/:id/feedback')
  async feedback(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const d = await this.docs.loadVisible(ctx, id);
    const heads = await this.access.headDeptIds(ctx);
    if (String(d.drafterId) !== ctx.user.id && !heads.has(String(d.departmentId))) throw Errors.forbidden('Chỉ người soạn hoặc trưởng phòng xem được góp ý');
    const openComments = d.fileId ? await this.google.drive.countOpenComments(d.fileId) : 0;
    return { openComments, checkedAt: new Date().toISOString() };
  }

  /** Trình duyệt: tạo phiếu, khoá tạm, chụp phiên bản (BR-05, BR-27) */
  @Post('documents/:id/submit')
  @HttpCode(200)
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { overrideOpenComments?: boolean; reason?: string }) {
    const d = await this.docs.loadVisible(ctx, id);
    // Người soạn được giao hoặc trưởng phòng phòng soạn (D2)
    if (String(d.drafterId) !== ctx.user.id) await this.access.requireHeadOf(ctx, String(d.departmentId));
    this.assertStatus(d, 'drafting', 'feedback', 'revising');
    if (await this.approvals.pendingFor(ctx.companyId, 'document', d._id)) throw Errors.state('Tài liệu đang có phiếu chờ duyệt');
    if (!d.fileId) throw Errors.state('Tài liệu chưa có file nháp');
    const open = await this.google.drive.countOpenComments(d.fileId);
    if (open > 0) {
      if (!body?.overrideOpenComments) throw Errors.rule(undefined, `File còn ${open} nhận xét chưa đóng; đóng hết hoặc trưởng phòng bỏ qua kèm lý do`, [{ field: 'overrideOpenComments', issue: 'open_comments' }]);
      if (!(await this.access.isHeadOf(ctx, String(d.departmentId)))) throw Errors.forbidden('Chỉ trưởng phòng được bỏ qua nhận xét chưa đóng');
      if (!body.reason?.trim()) throw Errors.validation('Bỏ qua nhận xét mở thì phải ghi lý do', [{ field: 'reason', issue: 'required' }]);
    }
    const approver = await this.docs.resolveApprover(ctx, d);
    this.approvals.assertSeparation(approver, ctx.user.id, String(d.drafterId));
    // Thu quyền Nhận xét tạm thời của người ngoài drive (hết vòng góp ý)
    for (const p of d.feedback?.permissions ?? []) await this.google.drive.deletePermission(d.fileId, p.permissionId).catch(() => undefined);
    const folder = await this.db.m.Folder.findOne({ companyId: d.companyId, _id: d.folderId }).lean<any>();
    await this.ops.lock(d.fileId, 'Đang trình duyệt – VCdocs');
    const meta = await this.google.drive.getFile(d.fileId);
    const snapshot = await this.ops.snapshot(d.fileId, folder?.googleId ?? meta!.parents[0], meta?.name ?? d.code);
    const prevStatus = d.status === 'feedback' ? (d.revision ? 'revising' : 'drafting') : d.status;
    const a = await this.approvals.create(ctx, {
      objectType: 'document',
      objectId: String(d._id),
      objectTitle: `${d.code} ${d.title}`,
      driveId: d.driveId,
      approver,
      snapshot,
      link: `/tai-lieu/${d._id}`,
      meta: { prevStatus, overrideOpenComments: open > 0 ? { count: open, reason: body.reason } : undefined },
    });
    const after = await this.setStatus(
      ctx,
      d,
      ['drafting', 'feedback', 'revising'],
      { status: 'submitted', approverId: a.approverId, checkerId: a.checkerId, lock: { isLocked: true, lockedAt: new Date(), unlockReason: 'Đang trình duyệt' }, 'feedback.permissions': [] },
      'document.submit',
    );
    return this.view(ctx, after);
  }

  @Post('documents/:id/issue')
  @HttpCode(202)
  async issue(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { effectiveFrom: string; notifyGroupIds?: string[] }) {
    const d = await this.docs.loadVisible(ctx, id);
    if (d.level === 'VCPV') this.access.requireRole(ctx, 'R3');
    else await this.access.requireHeadOf(ctx, String(d.departmentId));
    this.assertStatus(d, 'approved');
    const approval = await this.db.m.Approval.findOne({ companyId: d.companyId, objectType: 'document', objectId: d._id, status: 'approved' }).sort({ updatedAt: -1 }).lean<any>();
    if (!approval) throw Errors.rule('BR-27', 'Chưa có phiếu duyệt đã đồng ý cho phiên bản này');
    const other = await this.db.m.Document.findOne({ companyId: d.companyId, code: d.code, _id: { $ne: d._id }, status: { $in: ['effective', 'revising'] } }).lean();
    if (other) throw Errors.rule('BR-06', `Mã ${d.code} đã có một bản hiệu lực khác`);
    if (body.effectiveFrom < addMonthsToDateStr(dateVN(), -1)) throw Errors.validation('Ngày hiệu lực không được lùi quá 1 tháng', [{ field: 'effectiveFrom', issue: 'too_early' }]);
    const running = await this.db.m.Job.findOne({ companyId: d.companyId, type: 'document.issue', status: { $in: ['queued', 'running'] }, 'payload.documentId': id }).lean();
    if (running) throw Errors.state('Tài liệu đang được ban hành');
    const jobId = await this.jobs.enqueue(ctx, 'document.issue', { documentId: id, effectiveFrom: body.effectiveFrom, notifyGroupIds: body.notifyGroupIds ?? [], approvalId: String(approval._id) });
    await this.audit.record(ctx, { action: 'document.issue', objectType: 'document', objectId: id, after: { effectiveFrom: body.effectiveFrom, jobId } });
    return { jobId };
  }

  /** Sửa nhỏ: mở khoá có hạn, ghi dòng lịch sử; sửa lớn: bản sao vN+1, bản cũ vẫn hiệu lực (BR-06, BR-07) */
  @Post('documents/:id/revise')
  @HttpCode(200)
  async revise(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { kind: 'minor' | 'major'; reason: string; unlockDays?: number }) {
    const d = await this.docs.loadVisible(ctx, id);
    await this.access.requireHeadOf(ctx, String(d.departmentId));
    this.assertStatus(d, 'effective');
    if (!body.reason.trim()) throw Errors.validation('Ghi lý do sửa', [{ field: 'reason', issue: 'required' }]);
    const n = d.current?.number ?? 1;
    const me = await this.db.m.User.findOne({ companyId: d.companyId, _id: new Types.ObjectId(ctx.user.id) }).lean<any>();
    if (body.kind === 'minor') {
      const days = body.unlockDays ?? this.cfg.rules.minorUnlockDays;
      const until = addDays(new Date(), days);
      await this.ops.unlock(d.current.fileId);
      await this.google.docs.appendVersionRow(d.current.fileId, [`v${n}`, dateVN(), `Sửa nhỏ: ${body.reason}`, me?.name ?? '']);
      const versions = [...(d.versions ?? []), { number: n, kind: 'minor', changeNote: body.reason, approvedBy: new Types.ObjectId(ctx.user.id), effectiveFrom: dateVN() }];
      const after = await this.setStatus(ctx, d, ['effective'], { versions, lock: { isLocked: false, lockedAt: d.lock?.lockedAt, unlockedUntil: until, unlockReason: `Sửa nhỏ: ${body.reason}` } }, 'document.revise_minor');
      return this.view(ctx, after);
    }
    if (body.unlockDays !== undefined) throw Errors.validation('unlockDays chỉ dùng với sửa nhỏ', [{ field: 'unlockDays', issue: 'minor_only' }]);
    const folder = await this.docs.docFolder(ctx.companyId, d.driveId, d.type);
    const copy = await this.google.drive.copyFile({ fileId: d.current.fileId, parentGoogleId: folder.googleId, name: `${d.code} v${n + 1} ${d.title}` });
    const headerValues = await this.ops.updateHeader(copy.fileId, d.headerValues, { PHIEN_BAN: `v${n + 1} (nháp)`, TRANG_THAI: 'Nháp – chưa hiệu lực' });
    const versions = [...(d.versions ?? []), { number: n + 1, kind: 'major', changeNote: body.reason }];
    const after = await this.setStatus(ctx, d, ['effective'], { status: 'revising', fileId: copy.fileId, headerValues, versions, revision: { kind: 'major', number: n + 1, reason: body.reason, startedAt: new Date() } }, 'document.revise_major');
    await this.notifications.notify(ctx.companyId, [String(d.drafterId)], { type: 'document_revising', title: `Mở sửa lớn ${d.code} lên v${n + 1}`, body: body.reason, link: `/tai-lieu/${d._id}`, objectType: 'document', objectId: String(d._id) });
    return this.view(ctx, after);
  }

  /** Trình huỷ bỏ – cùng người duyệt như khi ban hành (BR-08) */
  @Post('documents/:id/withdraw')
  async withdraw(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { reason: string; replacedById?: string }) {
    const d = await this.docs.loadVisible(ctx, id);
    await this.access.requireHeadOf(ctx, String(d.departmentId));
    this.assertStatus(d, 'effective');
    if (await this.approvals.pendingFor(ctx.companyId, 'document_withdrawal', d._id)) throw Errors.state('Đã có phiếu trình huỷ bỏ đang chờ');
    if (body.replacedById) {
      if (body.replacedById === id) throw Errors.validation('Tài liệu không thay thế chính nó', [{ field: 'replacedById', issue: 'self' }]);
      if (!(await this.docs.load(ctx.companyId, body.replacedById))) throw Errors.notFound('Không tìm thấy tài liệu thay thế');
    }
    const approver = await this.docs.resolveApprover(ctx, d);
    this.approvals.assertSeparation(approver, ctx.user.id);
    const a = await this.approvals.create(ctx, {
      objectType: 'document_withdrawal',
      objectId: id,
      objectTitle: `Huỷ bỏ ${d.code} ${d.title}`,
      driveId: d.driveId,
      approver,
      link: `/tai-lieu/${d._id}`,
      meta: { reason: body.reason, replacedById: body.replacedById },
    });
    return this.approvals.toApi(ctx, a);
  }

  @Post('documents/:id/review')
  @HttpCode(200)
  async review(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { result: 'keep' | 'revise' | 'withdraw'; note?: string }) {
    const d = await this.docs.loadVisible(ctx, id);
    await this.access.requireHeadOf(ctx, String(d.departmentId));
    this.assertStatus(d, 'effective');
    const reviewDue = addMonthsToDateStr(dateVN(), this.cfg.rules.reviewPeriodMonths);
    const reviews = [...(d.reviews ?? []), { result: body.result, note: body.note, at: new Date(), by: new Types.ObjectId(ctx.user.id) }];
    const after = await this.setStatus(ctx, d, ['effective'], { reviews, reviewDue }, 'document.review');
    return this.view(ctx, after);
  }

  @Get('documents/:id/integrity')
  async integrity(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const d = await this.docs.loadVisible(ctx, id);
    if (!this.access.hasRole(ctx, 'R3')) await this.access.requireHeadOf(ctx, String(d.departmentId));
    const fileId = d.current?.fileId ?? d.fileId;
    const out: any = { isLocked: false, isRevisionMatching: false, checkedAt: new Date().toISOString() };
    if (!fileId) return out;
    const meta = await this.google.drive.getFile(fileId);
    const rev = meta ? await this.google.drive.latestRevision(fileId) : undefined;
    out.isLocked = !!meta?.contentRestriction?.readOnly;
    out.currentRevisionId = rev?.revisionId;
    if (d.current?.revisionId) out.expectedRevisionId = d.current.revisionId;
    out.isRevisionMatching = !!rev && rev.revisionId === d.current?.revisionId;
    if (d.current?.pdfFileId) {
      const pdf = await this.google.drive.getFile(d.current.pdfFileId);
      out.isHashMatching = !!pdf && (!d.current.pdfMd5 || pdf.md5Checksum === d.current.pdfMd5);
    }
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }

  @Post('documents/:id/relock')
  @HttpCode(200)
  async relock(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const d = await this.docs.loadVisible(ctx, id);
    if (!this.access.hasRole(ctx, 'R3')) await this.access.requireHeadOf(ctx, String(d.departmentId));
    this.assertStatus(d, 'effective', 'revising');
    await this.ops.lock(d.current.fileId, `Bản hiệu lực ${d.code} – VCdocs`);
    if (d.current.pdfFileId) await this.ops.lock(d.current.pdfFileId, `Bản hiệu lực ${d.code} – VCdocs`);
    const after = await this.setStatus(ctx, d, ['effective', 'revising'], { lock: { isLocked: true, lockedAt: new Date() } }, 'document.relock');
    return this.view(ctx, after);
  }

  /** Việc định kỳ: hết hạn mở khoá sửa nhỏ thì khoá lại (BR-26) */
  async relockExpired() {
    const rows = await this.db.m.Document.find({ 'lock.isLocked': false, 'lock.unlockedUntil': { $lt: new Date() }, status: 'effective' }, undefined, { skipTenant: true }).limit(200).lean<any[]>();
    for (const d of rows) {
      await this.ops.lock(d.current.fileId, `Bản hiệu lực ${d.code} – VCdocs`).catch(() => undefined);
      await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId }, { $set: { lock: { isLocked: true, lockedAt: new Date() } } });
      await this.audit.write({ companyId: String(d.companyId) }, { action: 'document.relock_auto', objectType: 'document', objectId: String(d._id) });
    }
  }

  // ───────────── Tài liệu bên ngoài ─────────────
  @Post('external-documents')
  @Roles(...R6_UP)
  @HttpCode(202)
  async importExternal(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    if (!!body.fileId === !!body.url) throw Errors.validation('Chọn một trong fileId hoặc url', [{ field: 'fileId', issue: 'one_of_fileId_url' }]);
    const dept = await this.access.deptById(ctx.companyId, body.departmentId);
    if (!dept) throw Errors.validation('Phòng không tồn tại', [{ field: 'departmentId', issue: 'not_found' }]);
    if (body.url && !/^https:\/\//i.test(body.url)) throw Errors.validation('Chỉ nhận đường dẫn https', [{ field: 'url', issue: 'https_only' }]);
    if (body.fileId && !(await this.google.drive.getFile(body.fileId))) throw Errors.validation('Không đọc được file Google này', [{ field: 'fileId', issue: 'not_found' }]);
    await this.docs.docFolder(ctx.companyId, dept.driveId, 'BM');
    const jobId = await this.jobs.enqueue(ctx, 'external_document.import', body);
    await this.audit.record(ctx, { action: 'external_document.import', objectType: 'document', after: { ...body, jobId } });
    return { jobId };
  }

  private async runImportExternal(job: any) {
    const p = job.payload;
    const dept = await this.access.deptById(job.companyId, p.departmentId);
    const root = await this.docs.docFolder(job.companyId, dept!.driveId, 'EXT');
    const name = `${p.source} ${p.number} ${p.title}`.replace(/\s+/g, ' ').trim();
    const file = await job.step('Sao chép vào 00 Tài liệu', async () => {
      if (p.fileId) return this.google.drive.copyFile({ fileId: p.fileId, parentGoogleId: root.googleId, name });
      const got = await this.google.urls.fetch(p.url);
      return this.google.drive.uploadFile({ parentGoogleId: root.googleId, name, mimeType: got.mimeType, content: got.content, description: `Nguồn: ${p.source}, số ${p.number}, ban hành ${p.issuedAt}` });
    });
    return job.step('Ghi sổ VCdocs', async () => {
      const by = new Types.ObjectId(job.userId);
      const row = await this.db.m.Document.create({
        companyId: new Types.ObjectId(job.companyId),
        type: 'EXT',
        level: 'DEPT',
        title: p.title,
        departmentId: new Types.ObjectId(p.departmentId),
        status: 'effective',
        driveId: dept!.driveId,
        securityLevel: dept!.securityLevel,
        folderId: root._id,
        fileId: file.fileId,
        external: { source: p.source, number: p.number, issuedAt: p.issuedAt, lastCheckedAt: new Date(), isSuperseded: false, originalUrl: p.url },
        searchText: this.docs.searchText({ title: p.title, external: p }),
        createdBy: by,
        updatedBy: by,
      });
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'external_document.created', objectType: 'document', objectId: String(row._id), after: { source: p.source, number: p.number, fileId: file.fileId } });
      return { objectType: 'document', objectId: String(row._id), fileId: file.fileId };
    });
  }

  /** isSuperseded → trả relatedIds = tài liệu nội bộ đang dẫn chiếu (US-04.8) */
  @Patch('external-documents/:id')
  @Roles(...R6_UP)
  async patchExternal(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { isSuperseded?: boolean; lastCheckedAt?: string }) {
    const d = await this.docs.loadVisible(ctx, id, { type: 'EXT' });
    const external = { ...d.external };
    if (body.isSuperseded !== undefined) external.isSuperseded = body.isSuperseded;
    external.lastCheckedAt = body.lastCheckedAt ? new Date(body.lastCheckedAt) : new Date();
    await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId }, { $set: { external, updatedBy: new Types.ObjectId(ctx.user.id) } });
    await this.audit.record(ctx, { action: 'external_document.update', objectType: 'document', objectId: id, before: { external: d.external }, after: { external } });
    const refs = await this.db.m.Document.find({ companyId: d.companyId, relatedIds: d._id, status: { $ne: 'withdrawn' } }).lean<any[]>();
    if (body.isSuperseded && !d.external?.isSuperseded && refs.length) {
      const people = refs.flatMap((r) => [r.drafterId]).filter(Boolean).map(String);
      const r3 = await this.db.m.User.find({ companyId: d.companyId, systemRoles: 'R3', status: { $ne: 'left' } }, { _id: 1 }).lean<any[]>();
      await this.notifications.notify(ctx.companyId, [...people, ...r3.map((u) => String(u._id))], {
        type: 'external_superseded',
        title: `${d.external.source} ${d.external.number} đã bị thay thế`,
        body: `${refs.length} tài liệu nội bộ đang dẫn chiếu cần rà soát`,
        link: `/tai-lieu/${id}`,
        objectType: 'document',
        objectId: id,
      });
    }
    const after = await this.docs.load(ctx.companyId, d._id);
    return { ...(await this.view(ctx, after)), relatedIds: refs.map((r) => String(r._id)) };
  }
}
