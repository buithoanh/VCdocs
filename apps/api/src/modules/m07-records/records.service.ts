import { Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts, VAULT, VaultPort, GDOC_MIME, GSHEET_MIME, GSLIDE_MIME } from '../../google/ports';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { Errors } from '../../common/errors';
import type { Ctx } from '../../common/context';
import { driveRoleAtLeast } from '../../common/enums';
import { addMonthsToDateStr, dateVN, endOfMonth, md5, normalizeText, sha256, toApi, workingDaysBetween } from '../../common/util';
import { FoldersService } from '../m03-folders/folders.service';
import { ApprovalsService, ApproverInfo } from '../m05-approvals/approvals.service';
import { DriveOpsService } from '../shared/drive-ops.service';
import { stampFinalized } from '../../google/pdf-stamp';
import type { JobContext } from '../../jobs/jobs.service';

/** Định dạng Office được Drive chuyển sang Google (BR-14); PDF, XML, ảnh scan giữ nguyên */
const CONVERT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': GDOC_MIME,
  'application/msword': GDOC_MIME,
  'application/vnd.oasis.opendocument.text': GDOC_MIME,
  'application/rtf': GDOC_MIME,
  'text/plain': GDOC_MIME,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': GSHEET_MIME,
  'application/vnd.ms-excel': GSHEET_MIME,
  'text/csv': GSHEET_MIME,
  'application/vnd.oasis.opendocument.spreadsheet': GSHEET_MIME,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': GSLIDE_MIME,
  'application/vnd.ms-powerpoint': GSLIDE_MIME,
};
const PRIVATE = ['searchText', 'driveId', 'scanFileId', 'adjustReason'];
const HOLD_REASONS = ['tranh chap', 'thanh tra', 'bao hanh', 'cong no', 'hop dong chua thanh ly', 'bdh yeu cau', 'ban dieu hanh yeu cau', 'kiem toan', 'dieu tra'];

export function convertTarget(mime: string): string | undefined {
  return CONVERT[mime];
}

/** Tên hồ sơ = "[Mã] [Loại] Nội dung – YYYY-MM-DD"; hồ sơ vận hành bắt đầu bằng số định danh (BR-09) */
export function recordFileName(p: { functionCode: string; kind: string; subject: string; identifier?: string; createdDate: string }) {
  const subject = p.subject.replace(/\s+/g, ' ').trim();
  if (p.kind === 'OPS') return `${p.identifier!.trim()} ${p.functionCode} ${subject} – ${p.createdDate}`;
  return `${p.functionCode} ${p.kind} ${subject} – ${p.createdDate}`;
}

@Injectable()
export class RecordsService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly folders: FoldersService,
    private readonly approvals: ApprovalsService,
    private readonly ops: DriveOpsService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(VAULT) private readonly vault: VaultPort,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }
  async load(companyId: string, id: string | Types.ObjectId) {
    return this.db.m.Record.findOne({ _id: id, companyId: this.cid(companyId) }).lean<any>();
  }
  async recordType(companyId: string, id: string | Types.ObjectId) {
    return this.db.m.RecordType.findOne({ _id: id, companyId: this.cid(companyId) }).lean<any>();
  }
  isCreator(ctx: Ctx, r: any) {
    return String(r.createdBy) === ctx.user.id;
  }

  async loadVisible(ctx: Ctx, id: string) {
    const r = await this.load(ctx.companyId, id);
    if (!r) throw Errors.notFound('Không tìm thấy hồ sơ');
    await this.access.assertVisible(ctx, r.driveId, this.isCreator(ctx, r));
    return r;
  }

  allowedActions(ctx: Ctx, r: any, rt: any, heads: Set<string>): string[] {
    const out: string[] = [];
    const creator = this.isCreator(ctx, r);
    const head = heads.has(String(r.departmentId));
    const canDraft = r.status === 'drafting' && !r.isApproved;
    if (creator && canDraft) out.push('edit');
    if (creator && canDraft && rt?.requiresApproval) out.push('submit');
    if ((creator || head) && r.status === 'drafting' && (r.isApproved || !rt?.requiresApproval)) out.push('finalize');
    if (r.status === 'finalized' && this.access.hasRole(ctx, 'R5', 'R6')) out.push('adjust');
    if (creator && r.status !== 'disposed') out.push('scan');
    const holder = head || this.access.hasRole(ctx, 'R1', 'R8');
    if (holder && r.status === 'finalized') out.push('hold');
    if (holder && r.status === 'held') out.push('release-hold');
    if ((this.access.hasRole(ctx, 'R3') || head) && ['finalized', 'held'].includes(r.status)) out.push('integrity');
    if (this.access.hasRole(ctx, 'R5', 'R6', 'R8') && r.fileId && r.status !== 'disposed') out.push('share');
    return out;
  }

  toApi(ctx: Ctx, r: any, rt: any, heads: Set<string>, summary = false) {
    const omit = summary ? [...PRIVATE, 'approvalId', 'finalized', 'lock', 'paperLocation', 'hold', 'retention', 'adjustsId', 'adjustedByIds', 'backdateReason'] : PRIVATE;
    const o: any = toApi(r, omit);
    if (o.finalized) delete o.finalized.pdfMd5;
    return { ...o, allowedActions: this.allowedActions(ctx, r, rt, heads) };
  }

  /** Kiểm chung khi lập/tải lên/đăng ký ngược: BR-20, BR-12, BR-09, BR-28, quyền drive */
  async validateInput(ctx: Ctx, body: any, opts: { fileCreatedDate?: string; isScan?: boolean } = {}) {
    const rt = await this.recordType(ctx.companyId, body.recordTypeId);
    if (!rt) throw Errors.validation('Loại hồ sơ không tồn tại', [{ field: 'recordTypeId', issue: 'not_found' }]);
    if (rt.retentionStatus !== 'approved') throw Errors.rule('BR-20', 'Thời hạn lưu của loại hồ sơ này chưa được Ban Điều hành duyệt, chưa lập được hồ sơ');
    const dept = await this.access.deptById(ctx.companyId, String(rt.departmentId));
    const folder = rt.folderId ? await this.folders.get(ctx.companyId, rt.folderId) : undefined;
    if (!dept || !folder) throw Errors.rule('BR-10', 'Loại hồ sơ chưa khai báo thư mục lưu');
    await this.access.assertVisible(ctx, folder.driveId);
    if (!driveRoleAtLeast(this.access.driveRole(ctx, folder.driveId), 'writer')) throw Errors.forbidden('Bạn cần quyền Đóng góp trên drive của loại hồ sơ này');
    if (body.kind !== rt.kind) throw Errors.rule('BR-09', `Loại hồ sơ này dùng loại ${rt.kind}`, [{ field: 'kind', issue: 'mismatch_record_type' }]);
    const code = await this.db.m.Code.findOne({ companyId: this.cid(ctx.companyId), code: body.functionCode, status: 'approved' }).lean();
    if (!code) throw Errors.rule('BR-12', `Mã ${body.functionCode} chưa được duyệt trong Bảng mã`, [{ field: 'functionCode', issue: 'not_approved' }]);
    if (body.kind === 'OPS' && !String(body.identifier ?? '').trim()) {
      throw Errors.rule('BR-09', 'Hồ sơ vận hành phải có số định danh (biển số, số PO, mã lớp)', [{ field: 'identifier', issue: 'required' }]);
    }
    if (!String(body.subject ?? '').trim()) throw Errors.validation('Thiếu nội dung ngắn', [{ field: 'subject', issue: 'required' }]);
    const today = dateVN();
    const createdDate = body.createdDate ?? opts.fileCreatedDate ?? today;
    const reference = opts.fileCreatedDate ?? today;
    if (createdDate > reference) throw Errors.rule('BR-28', 'Ngày lập không được sau ngày tạo file', [{ field: 'createdDate', issue: 'in_future' }]);
    if (workingDaysBetween(createdDate, reference) > this.cfg.rules.backdateMaxWorkingDays && !String(body.backdateReason ?? '').trim()) {
      throw Errors.rule('BR-28', `Ngày lập sớm hơn ngày tạo file quá ${this.cfg.rules.backdateMaxWorkingDays} ngày làm việc, cần ghi lý do (bản scan hồ sơ giấy)`, [{ field: 'backdateReason', issue: 'required' }]);
    }
    return { rt, dept, folder, createdDate };
  }

  async nextNumber(companyId: string): Promise<string> {
    const year = dateVN().slice(0, 4);
    const c = await this.db.m.Counter.findOneAndUpdate({ companyId: this.cid(companyId), key: `record:${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean<any>();
    return `HS-${year}-${String(c.seq).padStart(6, '0')}`;
  }

  searchText(r: any) {
    return normalizeText([r.number, r.functionCode, r.subject, r.identifier, r.fileName].filter(Boolean).join(' '));
  }

  /** Ghi sổ hồ sơ sau khi Drive làm xong */
  async insertRecord(companyId: string, userId: string, p: any) {
    const by = new Types.ObjectId(userId);
    const row = await this.db.m.Record.create({ ...p, companyId: this.cid(companyId), status: 'drafting', isApproved: false, searchText: this.searchText(p), createdBy: by, updatedBy: by });
    return row.toObject();
  }

  async monthFolder(job: { companyId: string; userId: string }, rt: any, workMonth: string) {
    return (await this.folders.ensurePeriod(job.companyId, rt.folderId, workMonth, job.userId)).folder;
  }

  async runCreate(job: JobContext) {
    const p = job.payload;
    const rt = await this.recordType(job.companyId, p.recordTypeId);
    const folder = await job.step('Tìm thư mục tháng', () => this.monthFolder(job, rt, p.workMonth));
    const number = await this.nextNumber(job.companyId);
    const fileName = recordFileName(p);
    const file = await job.step('Tạo file từ biểu mẫu', async () => {
      const f = rt.templateId
        ? await this.google.drive.copyFile({ fileId: rt.templateId, parentGoogleId: folder.googleId, name: fileName })
        : await this.google.drive.createEmptyDoc({ parentGoogleId: folder.googleId, name: fileName });
      const creator = await this.db.m.User.findOne({ companyId: this.cid(job.companyId), _id: new Types.ObjectId(job.userId) }).lean<any>();
      if (f.mimeType === GDOC_MIME || f.mimeType === GSHEET_MIME) {
        await this.google.docs.replacePlaceholders(f.fileId, { MA: p.functionCode, SO_HO_SO: number, NGUOI_SOAN: creator?.name ?? '', NGAY_LAP: p.createdDate, TRANG_THAI: 'Đang lập' });
      }
      return f;
    });
    const r = await job.step('Ghi sổ VCdocs', () =>
      this.insertRecord(job.companyId, job.userId, this.recordFields(p, rt, { number, fileName, folderId: folder._id, fileId: file.fileId, mimeType: file.mimeType, driveId: folder.driveId })),
    );
    await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'record.created', objectType: 'record', objectId: String(r._id), after: { number, fileName, fileId: file.fileId } });
    return { objectType: 'record', objectId: String(r._id), fileId: file.fileId };
  }

  recordFields(p: any, rt: any, extra: any) {
    return {
      functionCode: p.functionCode,
      kind: p.kind,
      subject: p.subject.trim(),
      identifier: p.identifier?.trim() || undefined,
      recordTypeId: rt._id,
      departmentId: rt.departmentId,
      workMonth: p.workMonth,
      createdDate: p.createdDate,
      backdateReason: p.backdateReason || undefined,
      ...extra,
    };
  }

  async runUpload(job: JobContext) {
    const p = job.payload;
    const rt = await this.recordType(job.companyId, p.recordTypeId);
    try {
      const folder = await job.step('Tìm thư mục tháng', () => this.monthFolder(job, rt, p.workMonth));
      const number = await this.nextNumber(job.companyId);
      const fileName = recordFileName(p);
      const file = await job.step('Tải file lên Drive', async () => {
        const content = await fs.promises.readFile(p.tmpPath);
        const convertTo = convertTarget(p.mimeType);
        return this.google.drive.uploadFile({ parentGoogleId: folder.googleId, name: fileName, mimeType: p.mimeType, content, convertTo, description: `Tải lên qua VCdocs từ ${p.originalName}` });
      });
      const r = await job.step('Ghi sổ VCdocs', () =>
        this.insertRecord(job.companyId, job.userId, this.recordFields(p, rt, { number, fileName, folderId: folder._id, fileId: file.fileId, mimeType: file.mimeType, driveId: folder.driveId })),
      );
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'record.uploaded', objectType: 'record', objectId: String(r._id), after: { number, fileName, mimeType: file.mimeType, converted: !!convertTarget(p.mimeType) } });
      return { objectType: 'record', objectId: String(r._id), fileId: file.fileId };
    } finally {
      await fs.promises.rm(p.tmpPath, { force: true });
    }
  }

  async runClaim(job: JobContext) {
    const p = job.payload;
    const rt = await this.recordType(job.companyId, p.recordTypeId);
    const folder = await job.step('Tìm thư mục tháng', () => this.monthFolder(job, rt, p.workMonth));
    const fileName = recordFileName(p);
    const file = await job.step('Đổi tên, chuyển đúng chỗ', async () => {
      const meta = await this.google.drive.getFile(p.fileId);
      if (!meta) throw Errors.notFound('File không còn trên Drive');
      const moving = !meta.parents.includes(folder.googleId);
      return this.google.drive.updateFile(p.fileId, { ...(meta.name !== fileName ? { name: fileName } : {}), ...(moving ? { addParents: [folder.googleId], removeParents: meta.parents } : {}) });
    });
    const number = await this.nextNumber(job.companyId);
    const r = await job.step('Ghi sổ VCdocs', () =>
      this.insertRecord(job.companyId, job.userId, this.recordFields(p, rt, { number, fileName, folderId: folder._id, fileId: file.fileId, mimeType: file.mimeType, driveId: folder.driveId, isClaimed: true })),
    );
    await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'record.claimed', objectType: 'record', objectId: String(r._id), after: { number, fileName, fileId: p.fileId, renamedFrom: p.originalName } });
    return { objectType: 'record', objectId: String(r._id), fileId: p.fileId };
  }

  /** Người duyệt hồ sơ nghiệp vụ: uỷ quyền khối còn hiệu lực, không thì trưởng phòng (QĐ-VCPV-03) */
  async resolveApprover(ctx: Ctx, r: any): Promise<ApproverInfo> {
    const rt = await this.recordType(ctx.companyId, r.recordTypeId);
    const dept = await this.access.deptById(ctx.companyId, String(r.departmentId));
    const del = await this.approvals.activeDelegation(ctx.companyId, dept?.blockId, [String(r.recordTypeId), rt?.name, `record:${r.kind}`].filter(Boolean), dateVN());
    const candidates: ApproverInfo[] = [];
    if (del) candidates.push({ approverId: String(del.delegateId), approverRule: `Hồ sơ ${rt?.name} → người được uỷ quyền theo bảng uỷ quyền khối (${del.task})` });
    if (dept?.headId) candidates.push({ approverId: dept.headId, approverRule: `Hồ sơ ${rt?.name} → Trưởng phòng ${dept.code}` });
    const director = await this.approvals.blockDirector(ctx.companyId, String(r.departmentId));
    if (director) candidates.push({ approverId: director, approverRule: `Hồ sơ ${rt?.name} → Giám đốc khối (người lập là trưởng phòng)` });
    const pick = candidates.find((c) => c.approverId !== String(r.createdBy));
    if (!pick) {
      if (candidates.length) throw Errors.rule('BR-05', 'Không có người duyệt khác người lập');
      throw Errors.rule('BR-03', 'Chưa xác định được người duyệt hồ sơ (thiếu trưởng phòng)');
    }
    return pick;
  }

  verifyCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.randomBytes(10)).map((b) => alphabet[b % alphabet.length]).join('');
  }

  /** Chốt: PDF + dấu chốt + QR, khoá gốc và PDF, mã băm, kho riêng, hạn lưu (BR-13, BR-21, BR-26, BR-29) */
  async runFinalize(job: JobContext) {
    const r = await this.load(job.companyId, job.payload.recordId);
    if (!r || r.status !== 'drafting') throw Errors.state('Hồ sơ không còn ở trạng thái đang lập');
    const rt = await this.recordType(job.companyId, r.recordTypeId);
    const folder = await this.folders.get(job.companyId, r.folderId);
    const verifyCode = this.verifyCode();
    const date = dateVN();
    const sealed = await job.step('Xuất PDF và đóng dấu chốt', async () => {
      const rev = await this.google.drive.latestRevision(r.fileId);
      const raw = await this.google.drive.exportPdf(r.fileId);
      const pdf = await stampFinalized(raw, { number: r.number, date, verifyCode, verifyUrl: `${this.cfg.webOrigin}/tra-cuu/xac-minh/${verifyCode}`, fontPath: this.cfg.stampFontPath });
      const base = r.fileName.replace(/\.pdf$/i, '');
      const file = await this.google.drive.uploadFile({ parentGoogleId: folder!.googleId, name: `${base}.pdf`, mimeType: 'application/pdf', content: pdf, description: `ĐÃ CHỐT ${r.number} ngày ${date} – mã kiểm tra ${verifyCode}` });
      return { revisionId: rev.revisionId, pdfFileId: file.fileId, pdfSha256: sha256(pdf), pdfMd5: md5(pdf), pdf };
    });
    await job.step('Khoá file gốc và PDF', async () => {
      for (const id of [r.fileId, sealed.pdfFileId]) {
        await this.ops.lock(id, `Hồ sơ đã chốt ${r.number} – VCdocs`);
        await this.google.drive.setDownloadRestriction(id, true);
      }
    });
    const vaultKey = `records/${job.companyId}/${r.number}.pdf`;
    await job.step('Lưu bản PDF vào kho riêng', () => this.vault.put(vaultKey, sealed.pdf));
    await job.step('Cập nhật sổ VCdocs', async () => {
      const years = rt?.retentionYears;
      const retention: any = { years, basis: rt?.retentionBasis };
      // BR-21 (giả định): hạn lưu đến = ngày cuối tháng công việc + số năm; 0 = vĩnh viễn
      if (years) retention.until = addMonthsToDateStr(endOfMonth(r.workMonth), years * 12);
      const finalized = { at: new Date(), by: new Types.ObjectId(job.userId), revisionId: sealed.revisionId, pdfFileId: sealed.pdfFileId, pdfSha256: sealed.pdfSha256, pdfMd5: sealed.pdfMd5, vaultKey, verifyCode };
      const u = await this.db.m.Record.updateOne(
        { _id: r._id, companyId: r.companyId, status: 'drafting' },
        { $set: { status: 'finalized', finalized, retention, lock: { isLocked: true, lockedAt: new Date() }, updatedBy: new Types.ObjectId(job.userId) } },
      );
      if (!u.modifiedCount) throw Errors.state('Hồ sơ đã đổi trạng thái trong lúc chốt');
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'record.finalized', objectType: 'record', objectId: String(r._id), before: { status: 'drafting' }, after: { status: 'finalized', finalized, retention } });
    });
    return { objectType: 'record', objectId: String(r._id), pdfFileId: sealed.pdfFileId, verifyCode };
  }

  async runScan(job: JobContext) {
    const p = job.payload;
    const r = await this.load(job.companyId, p.recordId);
    if (!r) throw Errors.notFound('Không tìm thấy hồ sơ');
    try {
      const folder = await this.folders.get(job.companyId, r.folderId);
      const scan = await job.step('Tải bản scan lên Drive', async () => {
        const content = await fs.promises.readFile(p.tmpPath);
        return this.google.drive.uploadFile({ parentGoogleId: folder!.googleId, name: `${r.fileName} – bản scan`, mimeType: p.mimeType, content, description: `Bản scan hồ sơ giấy. Vị trí bản giấy: ${p.paperLocation}` });
      });
      await job.step('Ghi vị trí bản giấy vào Mô tả file', async () => {
        const meta = await this.google.drive.getFile(r.fileId);
        const desc = [meta?.description?.replace(/\n?Vị trí bản giấy: .*/g, ''), `Vị trí bản giấy: ${p.paperLocation}`].filter(Boolean).join('\n');
        await this.google.drive.updateFile(r.fileId, { description: desc });
        await this.db.m.Record.updateOne({ _id: r._id, companyId: r.companyId }, { $set: { paperLocation: p.paperLocation, scanFileId: scan.fileId, updatedBy: new Types.ObjectId(job.userId) } });
        await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'record.scan_attached', objectType: 'record', objectId: String(r._id), before: { paperLocation: r.paperLocation }, after: { paperLocation: p.paperLocation, scanFileId: scan.fileId } });
      });
      return { objectType: 'record', objectId: String(r._id), fileId: scan.fileId };
    } finally {
      await fs.promises.rm(p.tmpPath, { force: true });
    }
  }

  isHoldReason(reason: string) {
    const n = normalizeText(reason);
    return HOLD_REASONS.some((k) => n.includes(k));
  }
}
