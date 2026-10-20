import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService, JobContext } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Errors } from '../../common/errors';
import type { Ctx } from '../../common/context';
import { DOC_TYPE_CODE, DocumentStatus } from '../../common/enums';
import { addMonthsToDateStr, dateVN, md5, normalizeText, sha256, toApi } from '../../common/util';
import { FoldersService } from '../m03-folders/folders.service';
import { ApprovalsService, ApproverInfo } from '../m05-approvals/approvals.service';
import { DriveOpsService } from '../shared/drive-ops.service';

/** BM khung theo loại tài liệu (US-04.2) */
export const FRAME_TEMPLATE: Record<string, string | undefined> = { QD: 'BM-VCPV-02', QT: 'BM-VCPV-03', HD: 'BM-VCPV-04', BM: undefined };
const SUBFOLDER_CODE: Record<string, string> = { QD: 'QĐ', QT: 'QT', HD: 'HD', BM: 'BM' };
const PRIVATE = ['searchText', 'headerValues', 'feedback', 'draftVersion', 'revision', 'reviews', 'driveId'];
export const EXPIRED_PREFIX = '[HẾT HIỆU LỰC] ';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly folders: FoldersService,
    private readonly approvals: ApprovalsService,
    private readonly ops: DriveOpsService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }

  async load(companyId: string, id: string | Types.ObjectId) {
    return this.db.m.Document.findOne({ _id: id, companyId: this.cid(companyId) }).lean<any>();
  }

  isParticipant(ctx: Ctx, d: any) {
    return [d.drafterId, d.checkerId, d.approverId].filter(Boolean).map(String).includes(ctx.user.id);
  }

  canSeeFull(ctx: Ctx, d: any) {
    return d.securityLevel !== 'confidential' || this.access.canViewDrive(ctx, d.driveId) || this.isParticipant(ctx, d);
  }

  /** Chi tiết: drive Mật không được xem → 404 */
  async loadVisible(ctx: Ctx, id: string, opts: { type?: 'EXT' | 'internal' } = {}) {
    const d = await this.load(ctx.companyId, id);
    if (!d) throw Errors.notFound('Không tìm thấy tài liệu');
    if (opts.type === 'EXT' && d.type !== 'EXT') throw Errors.notFound('Không tìm thấy tài liệu bên ngoài');
    if (!this.canSeeFull(ctx, d)) throw Errors.notFound('Không tìm thấy tài liệu');
    return d;
  }

  allowedActions(ctx: Ctx, d: any, heads: Set<string>): string[] {
    const me = ctx.user.id;
    const isDrafter = String(d.drafterId) === me;
    const isHead = heads.has(String(d.departmentId));
    const r3 = this.access.hasRole(ctx, 'R3');
    const out: string[] = [];
    if (d.type === 'EXT') {
      if (this.access.hasRole(ctx, 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R8')) out.push('update-external');
      return out;
    }
    const s: DocumentStatus = d.status;
    if (s === 'registered' && r3) out.push('assign-code');
    if (s === 'coded' && isDrafter) out.push('create-draft');
    if ((s === 'drafting' || s === 'revising') && isDrafter) out.push('request-feedback');
    // Xem số nhận xét chưa đóng (D18)
    if (['drafting', 'feedback', 'revising'].includes(s) && d.fileId && (isDrafter || isHead)) out.push('feedback');
    // Người soạn được giao hoặc trưởng phòng soạn được trình (D2)
    if (['drafting', 'feedback', 'revising'].includes(s) && (isDrafter || isHead)) out.push('submit');
    if (s === 'approved' && ((d.level === 'VCPV' && r3) || (d.level === 'DEPT' && isHead))) out.push('issue');
    if (s === 'effective' && isHead) out.push('revise', 'withdraw', 'review');
    if (['effective', 'revising'].includes(s) && (r3 || isHead)) out.push('integrity', 'relock');
    return out;
  }

  /** Bản đầy đủ hoặc bản rút gọn chỉ mã và tên (tài liệu Mật – BR-16) */
  toApi(ctx: Ctx, d: any, heads: Set<string>, opts: { summary?: boolean } = {}) {
    if (d.__restricted || !this.canSeeFull(ctx, d)) {
      return toApi({ _id: d._id, companyId: d.companyId, createdAt: d.createdAt, updatedAt: d.updatedAt, code: d.code, type: d.type, level: d.level, title: d.title, departmentId: d.departmentId, status: d.status, securityLevel: d.securityLevel, isRestricted: true, allowedActions: [] });
    }
    const omit = opts.summary ? [...PRIVATE, 'versions', 'lock', 'external', 'relatedIds', 'replacesId', 'replacedById', 'folderId', 'fileId'] : PRIVATE;
    const o: any = toApi(d, omit);
    if (o.current) delete o.current.pdfMd5;
    return { ...o, isRestricted: false, allowedActions: this.allowedActions(ctx, d, heads) };
  }

  async driveFor(companyId: string, level: string, departmentId: string) {
    if (level === 'VCPV') {
      const depts = await this.access.departments(companyId);
      const chung = depts.filter((d) => d.securityLevel === 'internal').sort((a, b) => a.number.localeCompare(b.number))[0];
      if (chung) return chung;
    }
    const dept = await this.access.deptById(companyId, departmentId);
    if (!dept) throw Errors.validation('Phòng không tồn tại', [{ field: 'departmentId', issue: 'not_found' }]);
    return dept;
  }

  /** Thư mục 00 Tài liệu / 01 QĐ · 02 QT · 03 HD · 04 BM của drive chứa tài liệu */
  async docFolder(companyId: string, driveId: string, type: string) {
    const root = await this.folders.rootOfKind(companyId, driveId, 'docs');
    if (!root) throw Errors.rule(undefined, 'Drive chưa có thư mục 00 Tài liệu');
    const sub = await this.db.m.Folder.findOne({ companyId: this.cid(companyId), parentId: root._id, code: SUBFOLDER_CODE[type], status: 'active' }).lean<any>();
    return sub ?? root;
  }
  async expiredFolder(companyId: string, driveId: string) {
    const root = await this.folders.rootOfKind(companyId, driveId, 'docs');
    if (!root) return undefined;
    return this.db.m.Folder.findOne({ companyId: this.cid(companyId), parentId: root._id, kind: 'archive' }).lean<any>();
  }

  // ───── BR-03, BR-04 ─────
  async resolveApprover(ctx: Ctx, d: any): Promise<ApproverInfo> {
    const org = await this.approvals.org(ctx.companyId);
    let info: Partial<ApproverInfo> = {};
    const t = d.type;
    if (d.level === 'VCPV' && (t === 'QD' || t === 'QT')) {
      info = { approverId: org.ceoId, checkerId: org.opsDirectorId, approverRule: `${t === 'QD' ? 'QĐ' : 'QT'} cấp VCPV → Tổng giám đốc; GĐ khối Vận hành nội bộ kiểm tra (BR-03, BR-04)` };
    } else if (d.level === 'VCPV' && t === 'HD') {
      info = { approverId: org.opsDirectorId, checkerId: org.firstR3, approverRule: 'HD cấp VCPV → GĐ khối Vận hành nội bộ; HCNS kiểm tra (BR-03, BR-04)' };
    } else if (t === 'BM' && d.relatedIds?.length) {
      const main = await this.load(ctx.companyId, d.relatedIds[0]);
      if (main) {
        const mi = await this.resolveApprover(ctx, main);
        info = { ...mi, approverRule: `BM đi kèm → người duyệt tài liệu chính ${main.code ?? main.title} (BR-03)` };
      }
    } else if (d.level === 'VCPV' && t === 'BM') {
      info = { approverId: org.opsDirectorId, approverRule: 'BM cấp VCPV → GĐ khối Vận hành nội bộ (như HD cấp VCPV, BR-03)' };
    } else if (d.level === 'DEPT' && t === 'QT') {
      info = { approverId: await this.approvals.blockDirector(ctx.companyId, String(d.departmentId)), approverRule: 'QT cấp phòng → Giám đốc khối phụ trách (BR-03)' };
    } else if (d.level === 'DEPT') {
      const dept = await this.access.deptById(ctx.companyId, String(d.departmentId));
      info = { approverId: dept?.headId, approverRule: `${t} cấp phòng → Trưởng phòng (BR-03)` };
    }
    if (d.checkerId) info.checkerId = String(d.checkerId);
    if (!info.approverId) throw Errors.rule('BR-03', 'Chưa xác định được người duyệt theo thẩm quyền (thiếu Tổng giám đốc, giám đốc khối hoặc trưởng phòng trong danh mục)');
    if (info.checkerId === info.approverId) delete info.checkerId;
    return info as ApproverInfo;
  }

  async notifyIssued(companyId: string, d: any, n: number, notifyGroupIds: string[] = []) {
    const cid = this.cid(companyId);
    const filter: any = { companyId: cid, status: { $ne: 'left' } };
    if (d.level === 'DEPT') filter.departmentId = d.departmentId;
    const users = await this.db.m.User.find(filter, { _id: 1 }).lean<any[]>();
    await this.notifications.notify(companyId, users.map((u) => String(u._id)), {
      type: 'document_issued',
      title: `Ban hành ${d.code} v${n} ${d.title}`,
      body: `Hiệu lực từ ${d.current?.effectiveFrom ?? ''}`,
      link: `/tai-lieu/${d._id}`,
      objectType: 'document',
      objectId: String(d._id),
    });
    if (notifyGroupIds.length) await this.notifications.sendEmail(notifyGroupIds, `Ban hành ${d.code} v${n} ${d.title}`, `Tài liệu có hiệu lực, xem bản đang hiệu lực trong VCdocs.`, `/tai-lieu/${d._id}`);
  }

  /** Job ban hành: bảng đầu file, đổi tên, chuyển thư mục, khoá, PDF, danh mục, thông báo (US-04.4) */
  async runIssue(job: JobContext) {
    const { documentId, effectiveFrom, notifyGroupIds, approvalId } = job.payload;
    const d = await this.load(job.companyId, documentId);
    if (!d || d.status !== 'approved') throw Errors.state('Tài liệu không ở trạng thái đã duyệt');
    const n = d.revision?.number ?? (d.current?.number ? d.current.number + 1 : 1);
    const approval = await this.approvals.get(job.companyId, approvalId);
    const approver = approval ? await this.db.m.User.findOne({ companyId: d.companyId, _id: approval.approverId }).lean<any>() : undefined;
    const folder = await this.docFolder(job.companyId, d.driveId, d.type);
    const name = `${d.code} v${n} ${d.title}`;
    const link = `${this.cfg.webOrigin}/phe-duyet/${approvalId}`;
    let headerValues = d.headerValues;
    const changeNote = d.revision?.reason ?? 'Ban hành lần đầu';

    await job.step('Điền bảng đầu file', async () => {
      // Bản đang trình bị khoá tạm: mở để điền, khoá lại ở bước sau
      await this.ops.unlock(d.fileId);
      headerValues = await this.ops.updateHeader(d.fileId, headerValues, { MA: d.code, PHIEN_BAN: `v${n}`, TRANG_THAI: 'Hiệu lực', NGAY_HIEU_LUC: effectiveFrom, LINK_DUYET: link });
      await this.google.docs.appendVersionRow(d.fileId, [`v${n}`, effectiveFrom, changeNote, approver?.name ?? '']);
    });
    await job.step('Đổi tên, chuyển vào thư mục chính thức', async () => {
      const meta = await this.google.drive.getFile(d.fileId);
      const moving = meta && !meta.parents.includes(folder.googleId);
      await this.google.drive.updateFile(d.fileId, { name, ...(moving ? { addParents: [folder.googleId], removeParents: meta!.parents } : {}) });
    });
    const sealed = await job.step('Khoá file và lưu bản PDF', async () => {
      const rev = await this.google.drive.latestRevision(d.fileId);
      const pdf = await this.google.drive.exportPdf(d.fileId);
      const pdfFile = await this.google.drive.uploadFile({ parentGoogleId: folder.googleId, name: `${name}.pdf`, mimeType: 'application/pdf', content: pdf, description: `Bản hiệu lực v${n} từ ${effectiveFrom}` });
      await this.ops.lock(d.fileId, `Bản hiệu lực ${d.code} v${n} – VCdocs`);
      await this.ops.lock(pdfFile.fileId, `Bản hiệu lực ${d.code} v${n} – VCdocs`);
      if (d.securityLevel === 'confidential') {
        await this.google.drive.setDownloadRestriction(d.fileId, true);
        await this.google.drive.setDownloadRestriction(pdfFile.fileId, true);
      }
      return { revisionId: rev.revisionId, pdfFileId: pdfFile.fileId, pdfSha256: sha256(pdf), pdfMd5: md5(pdf) };
    });
    if (d.current?.fileId && d.current.fileId !== d.fileId) {
      await job.step('Cho bản cũ hết hiệu lực', async () => {
        const old = await this.google.drive.getFile(d.current.fileId);
        const archive = await this.expiredFolder(job.companyId, d.driveId);
        if (old) {
          await this.ops.unlock(d.current.fileId);
          await this.google.drive.updateFile(d.current.fileId, {
            name: old.name.startsWith(EXPIRED_PREFIX) ? old.name : EXPIRED_PREFIX + old.name,
            ...(archive ? { addParents: [archive.googleId], removeParents: old.parents } : {}),
          });
          await this.ops.lock(d.current.fileId, 'Hết hiệu lực – VCdocs');
        }
      });
    }
    await job.step('Cập nhật danh mục', async () => {
      const current = { number: n, fileId: d.fileId, revisionId: sealed.revisionId, pdfFileId: sealed.pdfFileId, pdfSha256: sealed.pdfSha256, pdfMd5: sealed.pdfMd5, effectiveFrom, issuedBy: new Types.ObjectId(job.userId), approvalId: approvalId ? new Types.ObjectId(approvalId) : undefined };
      const versions = [...(d.versions ?? [])];
      const entry = { number: n, kind: 'major', changeNote, approvedBy: approval?.approverId, effectiveFrom, revisionId: sealed.revisionId, pdfSha256: sealed.pdfSha256 };
      const idx = versions.findIndex((v: any) => v.number === n && v.kind === 'major');
      if (idx >= 0) versions[idx] = { ...versions[idx], ...entry };
      else versions.push(entry);
      const set = {
        status: 'effective',
        current,
        versions,
        headerValues,
        folderId: folder._id,
        reviewDue: addMonthsToDateStr(effectiveFrom, this.cfg.rules.reviewPeriodMonths),
        lock: { isLocked: true, lockedAt: new Date() },
        approverId: approval?.approverId ?? d.approverId,
        updatedBy: new Types.ObjectId(job.userId),
      };
      await this.db.m.Document.updateOne({ _id: d._id, companyId: d.companyId, status: 'approved' }, { $set: set, $unset: { revision: 1 } });
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'document.issued', objectType: 'document', objectId: String(d._id), before: { status: 'approved', current: d.current }, after: { status: 'effective', current } });
    });
    await job.step('Gửi thông báo ban hành', async () => {
      const fresh = await this.load(job.companyId, d._id);
      await this.notifyIssued(job.companyId, fresh, n, notifyGroupIds);
    });
    return { objectType: 'document', objectId: String(d._id), version: n };
  }

  /** Job huỷ bỏ đã duyệt: thêm [HẾT HIỆU LỰC], chuyển 99, không xoá file (BR-08) */
  async runWithdraw(job: JobContext) {
    const { documentId, replacedById } = job.payload;
    const d = await this.load(job.companyId, documentId);
    if (!d || !['effective', 'revising'].includes(d.status)) throw Errors.state('Tài liệu không còn hiệu lực');
    const archive = await this.expiredFolder(job.companyId, d.driveId);
    await job.step('Đổi tên [HẾT HIỆU LỰC] và chuyển vào 99', async () => {
      for (const fileId of [d.current?.fileId, d.current?.pdfFileId, d.fileId !== d.current?.fileId ? d.fileId : undefined].filter(Boolean)) {
        const meta = await this.google.drive.getFile(fileId);
        if (!meta) continue;
        await this.ops.unlock(fileId);
        await this.google.drive.updateFile(fileId, {
          name: meta.name.startsWith(EXPIRED_PREFIX) ? meta.name : EXPIRED_PREFIX + meta.name,
          ...(archive ? { addParents: [archive.googleId], removeParents: meta.parents } : {}),
        });
        await this.ops.lock(fileId, 'Hết hiệu lực – VCdocs');
      }
    });
    await job.step('Cập nhật danh mục', async () => {
      await this.db.m.Document.updateOne(
        { _id: d._id, companyId: d.companyId },
        { $set: { status: 'withdrawn', ...(replacedById ? { replacedById: new Types.ObjectId(replacedById) } : {}), ...(archive ? { folderId: archive._id } : {}), updatedBy: new Types.ObjectId(job.userId) }, $unset: { revision: 1 } },
      );
      if (replacedById) await this.db.m.Document.updateOne({ _id: new Types.ObjectId(replacedById), companyId: d.companyId }, { $set: { replacesId: d._id } });
      await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'document.withdrawn', objectType: 'document', objectId: String(d._id), before: { status: d.status }, after: { status: 'withdrawn', replacedById } });
    });
    return { objectType: 'document', objectId: String(d._id) };
  }

  searchText(d: { code?: string; title: string; external?: any }) {
    return normalizeText([d.code, d.title, d.external?.source, d.external?.number].filter(Boolean).join(' '));
  }

  today() {
    return dateVN();
  }
}
