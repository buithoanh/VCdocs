import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { driveRoleAtLeast } from '../../common/enums';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { dateVN, escapeRegex, normalizeText } from '../../common/util';
import { operationOf } from '../../common/contract.interceptor';
import { getContract } from '../../contract/openapi';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { ApprovalsService } from '../m05-approvals/approvals.service';
import { DriveOpsService } from '../shared/drive-ops.service';
import { FoldersService } from '../m03-folders/folders.service';
import { recordFileName, RecordsService } from './records.service';

const SORTABLE = ['createdAt', 'updatedAt', 'number', 'workMonth', 'createdDate', 'subject', 'status'];

@Controller()
export class RecordsController {
  constructor(
    private readonly db: Db,
    private readonly records: RecordsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
    private readonly ops: DriveOpsService,
    private readonly folders: FoldersService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
  ) {
    const steps = ['Tìm thư mục tháng', 'Tạo file từ biểu mẫu', 'Ghi sổ VCdocs'];
    jobs.register('record.create', { title: 'Lập hồ sơ từ biểu mẫu', steps, handler: (j) => this.records.runCreate(j) });
    jobs.register('record.upload', { title: 'Tải hồ sơ lên', steps: ['Tìm thư mục tháng', 'Tải file lên Drive', 'Ghi sổ VCdocs'], handler: (j) => this.records.runUpload(j) });
    jobs.register('record.claim', { title: 'Đăng ký ngược file trên Drive', steps: ['Tìm thư mục tháng', 'Đổi tên, chuyển đúng chỗ', 'Ghi sổ VCdocs'], handler: (j) => this.records.runClaim(j) });
    jobs.register('record.finalize', {
      title: 'Chốt hồ sơ',
      steps: ['Xuất PDF và đóng dấu chốt', 'Khoá file gốc và PDF', 'Lưu bản PDF vào kho riêng', 'Cập nhật sổ VCdocs'],
      handler: (j) => this.records.runFinalize(j),
    });
    jobs.register('record.scan', { title: 'Gắn bản scan', steps: ['Tải bản scan lên Drive', 'Ghi vị trí bản giấy vào Mô tả file'], handler: (j) => this.records.runScan(j) });

    approvals.register('record', {
      load: (c, id) => this.records.load(c, id),
      driveId: (r) => r.driveId,
      title: (r) => `${r.number} ${r.fileName ?? r.subject}`,
      link: (r) => `/ho-so/${r._id}`,
      isParticipant: (ctx, r) => this.records.isCreator(ctx, r),
      resolveApprover: (ctx, r) => this.records.resolveApprover(ctx, r),
      currentRevision: async (r) => (await this.google.drive.latestRevision(r.fileId)).revisionId,
      // Duyệt xong vẫn giữ khoá tạm tới khi người lập chốt (mục 5.2)
      onApproved: async (ctx, a, r) => {
        await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId, status: 'submitted' }, { $set: { status: 'drafting', isApproved: true, approvalId: a._id } });
      },
      onChangesRequested: (ctx, a, r) => this.backToDraft(r),
      onCancelled: (ctx, a, r) => this.backToDraft(r),
      onInvalidated: (ctx, a, r) => this.backToDraft(r),
    });
  }

  private async backToDraft(r: any) {
    await this.ops.unlock(r.fileId).catch(() => undefined);
    await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId, status: { $in: ['submitted', 'drafting'] } }, { $set: { status: 'drafting', isApproved: false, lock: { isLocked: false } } });
  }

  private async view(ctx: Ctx, r: any, summary = false) {
    const rt = await this.records.recordType(ctx.companyId, r.recordTypeId);
    return this.records.toApi(ctx, r, rt, await this.access.headDeptIds(ctx), summary);
  }

  @Get('records')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, SORTABLE, '-createdAt');
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId), ...this.access.visibleFilter(ctx, 'driveId', ['createdBy']) };
    for (const k of ['workMonth', 'status', 'kind']) if (q[k]) filter[k] = q[k];
    for (const k of ['recordTypeId', 'departmentId', 'createdBy']) if (q[k]) filter[k] = new Types.ObjectId(q[k]);
    if (q.identifier) filter.identifier = new RegExp(`^${escapeRegex(q.identifier)}`, 'i');
    if (q.q) filter.searchText = new RegExp(escapeRegex(normalizeText(q.q)));
    const [rows, total] = await Promise.all([this.db.m.Record.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean<any[]>(), this.db.m.Record.countDocuments(filter)]);
    const rts = await this.db.m.RecordType.find({ companyId: filter.companyId, _id: { $in: [...new Set(rows.map((r) => String(r.recordTypeId)))].map((x) => new Types.ObjectId(x)) } }).lean<any[]>();
    const heads = await this.access.headDeptIds(ctx);
    return pageResult(rows.map((r) => this.records.toApi(ctx, r, rts.find((t) => String(t._id) === String(r.recordTypeId)), heads, true)), p, total);
  }

  @Post('records')
  @Roles('R4', 'R5', 'R6', 'R8')
  @HttpCode(202)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    const { createdDate } = await this.records.validateInput(ctx, body);
    const payload = { ...body, createdDate };
    const jobId = await this.jobs.enqueue(ctx, 'record.create', payload);
    await this.audit.record(ctx, { action: 'record.create', objectType: 'record', after: { ...payload, fileName: recordFileName(payload), jobId } });
    return { jobId };
  }

  /** Thân multipart kiểm theo hợp đồng sau khi multer đọc xong */
  private validateMultipart(req: Request, body: any) {
    const info = operationOf(req)!;
    body.file = 'tệp';
    const r = getContract().validateBody(info, body, 'multipart/form-data');
    delete body.file;
    if (!r.ok) throw Errors.validation('Dữ liệu gửi lên không hợp lệ', r.errors);
  }

  @Post('records/upload')
  @Roles('R4', 'R5', 'R6', 'R8')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    try {
      if (!file) throw Errors.validation('Thiếu file tải lên', [{ field: 'body.file', issue: 'required' }]);
      for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
      this.validateMultipart(req, body);
      const { createdDate } = await this.records.validateInput(ctx, body);
      const payload = { ...body, createdDate, tmpPath: file.path, mimeType: file.mimetype, originalName: file.originalname, size: file.size };
      const jobId = await this.jobs.enqueue(ctx, 'record.upload', payload);
      await this.audit.record(ctx, { action: 'record.upload', objectType: 'record', after: { ...body, fileName: recordFileName(payload), originalName: file.originalname, mimeType: file.mimetype, jobId } });
      return { jobId };
    } catch (e) {
      if (file?.path) await fs.promises.rm(file.path, { force: true });
      throw e;
    }
  }

  /** File trên Drive chưa đăng ký (R4, R5) */
  @Get('records/unregistered')
  @Roles('R4', 'R5')
  async unregistered(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const heads = await this.access.headDeptIds(ctx);
    const depts = await this.access.departments(ctx.companyId);
    const mine = depts.filter((d) => heads.has(d.id) || (this.access.hasRole(ctx, 'R5') && ['fileOrganizer', 'organizer'].includes(this.access.driveRole(ctx, d.driveId) ?? '')));
    const drives = q.driveId ? mine.filter((d) => d.driveId === q.driveId) : mine;
    if (q.driveId && !drives.length) throw Errors.forbidden('Bạn không quản lý drive này');
    const cid = new Types.ObjectId(ctx.companyId);
    const known = new Set<string>();
    const add = (xs: any[]) => xs.filter(Boolean).forEach((x) => known.add(String(x)));
    add(await this.db.m.Record.distinct('fileId', { companyId: cid }));
    add(await this.db.m.Record.distinct('finalized.pdfFileId', { companyId: cid }));
    add(await this.db.m.Record.distinct('scanFileId', { companyId: cid }));
    add(await this.db.m.Document.distinct('fileId', { companyId: cid }));
    add(await this.db.m.Document.distinct('current.fileId', { companyId: cid }));
    add(await this.db.m.Document.distinct('current.pdfFileId', { companyId: cid }));
    add(await this.db.m.Approval.distinct('snapshot.pdfFileId', { companyId: cid }));
    const items: any[] = [];
    for (const d of drives) {
      for (const f of await this.google.drive.listFiles(d.driveId)) {
        if (known.has(f.fileId)) continue;
        const ownerEmail = await this.google.drive.getCreatorEmail(f.fileId);
        items.push({ fileId: f.fileId, name: f.name, mimeType: f.mimeType, driveId: f.driveId ?? d.driveId, parentGoogleId: f.parents[0], createdTime: f.createdTime, ownerEmail, webViewLink: f.webViewLink });
      }
    }
    return { items: items.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined))) };
  }

  /** Đăng ký ngược file tạo thẳng trên Drive (người tạo file, R4); tên sai thì đổi đúng */
  @Post('records/claim')
  @HttpCode(202)
  async claim(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    const cid = new Types.ObjectId(ctx.companyId);
    const meta = await this.google.drive.getFile(body.fileId);
    if (!meta || meta.trashed) throw Errors.validation('Không tìm thấy file trên Drive', [{ field: 'fileId', issue: 'not_found' }]);
    const dept = await this.access.deptByDrive(ctx.companyId, meta.driveId);
    if (!dept) throw Errors.validation('File không nằm trong drive của VCdocs', [{ field: 'fileId', issue: 'outside_vcdocs' }]);
    await this.access.assertVisible(ctx, meta.driveId);
    // Người tạo lấy từ nguồn riêng; người sửa cuối (lastModifierEmail) không phải người tạo
    const creator = (await this.google.drive.getCreatorEmail(body.fileId)) === ctx.user.email;
    const head = await this.access.isHeadOf(ctx, dept.id);
    if (!creator && !head) throw Errors.forbidden('Chỉ người tạo file hoặc trưởng phòng được đăng ký ngược');
    if (await this.db.m.Record.findOne({ companyId: cid, $or: [{ fileId: body.fileId }, { 'finalized.pdfFileId': body.fileId }] }).lean()) {
      throw Errors.duplicate('File này đã được đăng ký', [{ field: 'fileId', issue: 'already_registered' }]);
    }
    if (await this.db.m.Document.findOne({ companyId: cid, $or: [{ fileId: body.fileId }, { 'current.fileId': body.fileId }] }).lean()) throw Errors.duplicate('File này là tài liệu hệ thống');
    const fileCreatedDate = dateVN(new Date(meta.createdTime));
    const subject = body.subject ?? meta.name.replace(/\.[a-z0-9]{2,4}$/i, '');
    const { createdDate, folder } = await this.records.validateInput(ctx, { ...body, subject }, { fileCreatedDate });
    // Tài khoản máy sẽ chuyển file ra khỏi drive nguồn: người gọi phải tự làm được việc đó (Quản lý drive nguồn) hoặc là trưởng phòng nguồn
    if (folder.driveId !== meta.driveId && !head && !driveRoleAtLeast(this.access.driveRole(ctx, meta.driveId), 'organizer')) {
      throw Errors.forbidden('Chuyển file sang drive khác cần trưởng phòng hoặc quyền Quản lý trên drive đang chứa file');
    }
    const payload = { ...body, subject, createdDate, originalName: meta.name };
    const jobId = await this.jobs.enqueue(ctx, 'record.claim', payload);
    await this.audit.record(ctx, { action: 'record.claim', objectType: 'record', after: { ...payload, fileName: recordFileName(payload), jobId } });
    return { jobId };
  }

  @Get('records/:id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.view(ctx, await this.records.loadVisible(ctx, id));
  }

  private assertCreator(ctx: Ctx, r: any) {
    if (!this.records.isCreator(ctx, r)) throw Errors.forbidden('Chỉ người lập hồ sơ được làm');
  }

  /** Sửa khi còn đang lập; đổi tên/thư mục trên Drive cho khớp (BR-09, BR-10) */
  @Patch('records/:id')
  async patch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    const r = await this.records.loadVisible(ctx, id);
    this.assertCreator(ctx, r);
    if (r.status !== 'drafting' || r.isApproved) throw Errors.state('Hồ sơ đã trình hoặc đã duyệt, không sửa được');
    const next = { ...r, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
    if (next.kind === 'OPS' && !String(next.identifier ?? '').trim()) throw Errors.rule('BR-09', 'Hồ sơ vận hành phải có số định danh', [{ field: 'identifier', issue: 'required' }]);
    if (body.subject !== undefined && !body.subject.trim()) throw Errors.validation('Thiếu nội dung ngắn', [{ field: 'subject', issue: 'required' }]);
    const fileName = recordFileName(next);
    const set: any = { updatedBy: new Types.ObjectId(ctx.user.id) };
    for (const k of ['subject', 'identifier', 'workMonth', 'paperLocation']) if (body[k] !== undefined) set[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
    const upd: any = {};
    if (fileName !== r.fileName) {
      upd.name = fileName;
      set.fileName = fileName;
    }
    if (body.workMonth && body.workMonth !== r.workMonth) {
      const rt = await this.records.recordType(ctx.companyId, r.recordTypeId);
      const month = (await this.folders.ensurePeriod(ctx.companyId, rt.folderId, body.workMonth, ctx.user.id)).folder;
      const meta = await this.google.drive.getFile(r.fileId);
      upd.addParents = [month.googleId];
      upd.removeParents = meta?.parents ?? [];
      set.folderId = month._id;
    }
    if (body.paperLocation !== undefined) upd.description = `Vị trí bản giấy: ${body.paperLocation}`;
    if (Object.keys(upd).length) await this.google.drive.updateFile(r.fileId, upd);
    set.searchText = this.records.searchText({ ...next, fileName });
    await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId, status: 'drafting' }, { $set: set });
    const after = await this.records.load(ctx.companyId, r._id);
    await this.audit.record(ctx, { action: 'record.update', objectType: 'record', objectId: id, before: { subject: r.subject, identifier: r.identifier, workMonth: r.workMonth, fileName: r.fileName, paperLocation: r.paperLocation }, after: { subject: after.subject, identifier: after.identifier, workMonth: after.workMonth, fileName: after.fileName, paperLocation: after.paperLocation } });
    return this.view(ctx, after);
  }

  @Post('records/:id/submit')
  @HttpCode(200)
  async submit(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.records.loadVisible(ctx, id);
    this.assertCreator(ctx, r);
    if (r.status !== 'drafting' || r.isApproved) throw Errors.state('Hồ sơ không ở trạng thái đang lập');
    const rt = await this.records.recordType(ctx.companyId, r.recordTypeId);
    if (!rt?.requiresApproval) throw Errors.rule(undefined, 'Loại hồ sơ này không cần duyệt, người lập chốt luôn');
    if (await this.approvals.pendingFor(ctx.companyId, 'record', r._id)) throw Errors.state('Hồ sơ đang có phiếu chờ duyệt');
    const approver = await this.records.resolveApprover(ctx, r);
    this.approvals.assertSeparation(approver, ctx.user.id);
    const folder = await this.folders.get(ctx.companyId, r.folderId);
    await this.ops.lock(r.fileId, 'Đang trình duyệt – VCdocs');
    const snapshot = await this.ops.snapshot(r.fileId, folder!.googleId, r.fileName);
    const a = await this.approvals.create(ctx, { objectType: 'record', objectId: id, objectTitle: `${r.number} ${r.fileName}`, driveId: r.driveId, approver, snapshot, link: `/ho-so/${id}` });
    await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId, status: 'drafting' }, { $set: { status: 'submitted', approvalId: a._id, lock: { isLocked: true, lockedAt: new Date(), unlockReason: 'Đang trình duyệt' }, updatedBy: new Types.ObjectId(ctx.user.id) } });
    const after = await this.records.load(ctx.companyId, r._id);
    await this.audit.record(ctx, { action: 'record.submit', objectType: 'record', objectId: id, before: { status: 'drafting' }, after: { status: 'submitted', approvalId: String(a._id) } });
    return this.view(ctx, after);
  }

  @Post('records/:id/finalize')
  @HttpCode(202)
  async finalize(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.records.loadVisible(ctx, id);
    if (!this.records.isCreator(ctx, r) && !(await this.access.isHeadOf(ctx, String(r.departmentId)))) throw Errors.forbidden('Chỉ người lập hoặc trưởng phòng được chốt');
    if (r.status !== 'drafting') throw Errors.state('Chỉ chốt được hồ sơ đang lập');
    const rt = await this.records.recordType(ctx.companyId, r.recordTypeId);
    if (rt?.requiresApproval) {
      if (!r.isApproved) throw Errors.rule('BR-27', 'Loại hồ sơ này cần được duyệt trước khi chốt');
      const a = r.approvalId ? await this.approvals.get(ctx.companyId, r.approvalId) : undefined;
      const cur = (await this.google.drive.latestRevision(r.fileId)).revisionId;
      if (!a || a.status !== 'approved' || a.snapshot?.revisionId !== cur) {
        if (a) await this.approvals.invalidate(ctx, a, r, `revision đổi từ ${a.snapshot?.revisionId} sang ${cur} trước khi chốt`);
        throw Errors.rule('BR-27', 'File đã đổi sau khi được duyệt nên phiếu hết giá trị; hãy trình lại');
      }
    }
    const running = await this.db.m.Job.findOne({ companyId: r.companyId, type: 'record.finalize', status: { $in: ['queued', 'running'] }, 'payload.recordId': id }).lean();
    if (running) throw Errors.state('Hồ sơ đang được chốt');
    const jobId = await this.jobs.enqueue(ctx, 'record.finalize', { recordId: id });
    await this.audit.record(ctx, { action: 'record.finalize', objectType: 'record', objectId: id, after: { jobId } });
    return { jobId };
  }

  /** Hồ sơ Điều chỉnh: hồ sơ gốc không đổi, hồ sơ mới trỏ về gốc (BR-13) */
  @Post('records/:id/adjust')
  @Roles('R5', 'R6')
  async adjust(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { reason: string }) {
    const r = await this.records.loadVisible(ctx, id);
    if (r.status !== 'finalized') throw Errors.state('Chỉ lập hồ sơ Điều chỉnh cho hồ sơ đã chốt');
    if (!body.reason.trim()) throw Errors.validation('Ghi lý do điều chỉnh', [{ field: 'reason', issue: 'required' }]);
    const rt = await this.records.recordType(ctx.companyId, r.recordTypeId);
    if (!driveRoleAtLeastWriter(this.access.driveRole(ctx, r.driveId))) throw Errors.forbidden('Bạn cần quyền Đóng góp trên drive của hồ sơ');
    const createdDate = dateVN();
    const p = { functionCode: r.functionCode, kind: r.kind, subject: `Điều chỉnh ${r.subject}`, identifier: r.identifier, workMonth: r.workMonth, createdDate };
    const folder = await this.folders.get(ctx.companyId, r.folderId);
    const fileName = recordFileName(p);
    const copy = await this.google.drive.copyFile({ fileId: r.fileId, parentGoogleId: folder!.googleId, name: fileName });
    await this.ops.unlock(copy.fileId).catch(() => undefined);
    const number = await this.records.nextNumber(ctx.companyId);
    const row = await this.records.insertRecord(ctx.companyId, ctx.user.id, {
      ...this.records.recordFields(p, rt, { number, fileName, folderId: r.folderId, fileId: copy.fileId, mimeType: copy.mimeType, driveId: r.driveId }),
      adjustsId: r._id,
      adjustReason: body.reason,
    });
    await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId }, { $addToSet: { adjustedByIds: row._id } });
    await this.audit.record(ctx, { action: 'record.adjust', objectType: 'record', objectId: String(row._id), after: { adjustsId: id, reason: body.reason, number } });
    return this.view(ctx, row);
  }

  @Post('records/:id/scan')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async scan(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Param('id') id: string, @Body() body: any, @UploadedFile() file?: Express.Multer.File) {
    try {
      if (!file) throw Errors.validation('Thiếu file scan', [{ field: 'body.file', issue: 'required' }]);
      this.validateMultipart(req, body);
      const r = await this.records.loadVisible(ctx, id);
      this.assertCreator(ctx, r);
      if (r.status === 'disposed') throw Errors.state('Hồ sơ đã huỷ');
      if (!/^(application\/pdf|image\/)/.test(file.mimetype)) throw Errors.validation('Bản scan phải là PDF hoặc ảnh', [{ field: 'body.file', issue: 'pdf_or_image' }]);
      const jobId = await this.jobs.enqueue(ctx, 'record.scan', { recordId: id, paperLocation: body.paperLocation, tmpPath: file.path, mimeType: file.mimetype });
      await this.audit.record(ctx, { action: 'record.scan', objectType: 'record', objectId: id, after: { paperLocation: body.paperLocation, jobId } });
      return { jobId };
    } catch (e) {
      if (file?.path) await fs.promises.rm(file.path, { force: true });
      throw e;
    }
  }

  private async assertHolder(ctx: Ctx, r: any) {
    if (!this.access.hasRole(ctx, 'R1', 'R8') && !(await this.access.isHeadOf(ctx, String(r.departmentId)))) {
      throw Errors.forbidden('Chỉ trưởng phòng, Ban Điều hành hoặc kế toán trưởng được giữ lại hồ sơ');
    }
  }

  /** Giữ lại, không được huỷ (BR-22) */
  @Post('records/:id/hold')
  @HttpCode(200)
  async hold(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { reasonType: string; reason: string }) {
    const r = await this.records.loadVisible(ctx, id);
    await this.assertHolder(ctx, r);
    if (r.status !== 'finalized') throw Errors.state('Chỉ giữ lại được hồ sơ đã chốt');
    // reasonType là enum HoldReasonType (BR-22, D5) – hợp đồng đã kiểm giá trị
    if (!body.reason.trim()) throw Errors.validation('Ghi diễn giải lý do giữ lại', [{ field: 'reason', issue: 'required' }]);
    const hold = { isActive: true, reasonType: body.reasonType, reason: body.reason.trim(), by: new Types.ObjectId(ctx.user.id), at: new Date() };
    await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId, status: 'finalized' }, { $set: { status: 'held', hold, updatedBy: hold.by } });
    await this.audit.record(ctx, { action: 'record.hold', objectType: 'record', objectId: id, before: { status: r.status }, after: { status: 'held', hold } });
    return this.view(ctx, await this.records.load(ctx.companyId, r._id));
  }

  @Post('records/:id/release-hold')
  @HttpCode(200)
  async releaseHold(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.records.loadVisible(ctx, id);
    await this.assertHolder(ctx, r);
    if (r.status !== 'held') throw Errors.state('Hồ sơ không ở trạng thái giữ lại');
    const hold = { ...r.hold, isActive: false };
    await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId, status: 'held' }, { $set: { status: 'finalized', hold, updatedBy: new Types.ObjectId(ctx.user.id) } });
    await this.audit.record(ctx, { action: 'record.release_hold', objectType: 'record', objectId: id, before: { status: 'held' }, after: { status: 'finalized' } });
    return this.view(ctx, await this.records.load(ctx.companyId, r._id));
  }

  @Get('records/:id/integrity')
  async integrity(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.records.load(ctx.companyId, id);
    if (!r) throw Errors.notFound('Không tìm thấy hồ sơ');
    await this.access.assertVisibleOrR3(ctx, r.driveId, this.records.isCreator(ctx, r));
    if (!this.access.hasRole(ctx, 'R3') && !(await this.access.isHeadOf(ctx, String(r.departmentId)))) throw Errors.forbidden('Chỉ R3 hoặc trưởng phòng kiểm tra được');
    const meta = await this.google.drive.getFile(r.fileId);
    const rev = meta ? await this.google.drive.latestRevision(r.fileId) : undefined;
    const out: any = { isLocked: !!meta?.contentRestriction?.readOnly, isRevisionMatching: !!rev && rev.revisionId === r.finalized?.revisionId, checkedAt: new Date().toISOString() };
    if (rev) out.currentRevisionId = rev.revisionId;
    if (r.finalized?.revisionId) out.expectedRevisionId = r.finalized.revisionId;
    if (r.finalized?.pdfFileId) {
      const pdf = await this.google.drive.getFile(r.finalized.pdfFileId);
      out.isHashMatching = !!pdf && pdf.md5Checksum === r.finalized.pdfMd5;
      out.isLocked = out.isLocked && !!pdf?.contentRestriction?.readOnly;
    }
    return out;
  }

  /** Tra mã trên dấu chốt (QR): không cần quyền drive, không trả nội dung (US-07.4) */
  @Get('verify/:verifyCode')
  async verify(@CurrentCtx() ctx: Ctx, @Param('verifyCode') code: string) {
    const r = await this.db.m.Record.findOne({ companyId: new Types.ObjectId(ctx.companyId), 'finalized.verifyCode': code.trim().toUpperCase() }).lean<any>();
    if (!r) throw Errors.notFound('Mã kiểm tra không khớp hồ sơ nào đã chốt');
    await this.audit.record(ctx, { action: 'record.verify', objectType: 'record', objectId: String(r._id) }).catch(() => undefined);
    return { number: r.number, status: r.status, finalizedAt: r.finalized.at.toISOString(), pdfSha256: r.finalized.pdfSha256 };
  }
}

function driveRoleAtLeastWriter(role?: string) {
  return ['writer', 'fileOrganizer', 'organizer'].includes(role ?? '');
}
