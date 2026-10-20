import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { dateVN, toApi } from '../../common/util';
import { AuditService } from '../../audit/audit.service';
import { JobContext, JobsService } from '../../jobs/jobs.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import type { Ctx } from '../../common/context';
import { AccessService } from '../../access/access.service';

export const ANCHOR_FILE_TITLE = 'Mỏ neo nhật ký VCdocs';

/**
 * M15: kiểm toàn chuỗi audit_logs (audit.verify, 01:00 hằng đêm) và neo mã băm
 * cuối chuỗi ra ngoài (audit.anchor, 07:00 thứ Hai) – hợp đồng E15.
 */
@Injectable()
export class AuditChainService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
  ) {
    jobs.register('audit.verify', { title: 'Kiểm toàn chuỗi nhật ký', steps: ['Kiểm mã băm từng dòng', 'Ghi kết quả'], handler: (j) => this.runVerify(j) });
    jobs.register('audit.anchor', { title: 'Neo mã băm nhật ký', steps: ['Đọc đầu chuỗi', 'Gửi email cho Ban Điều hành', 'Ghi file Sheets mỏ neo'], handler: (j) => this.runAnchor(j) });
  }

  private cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }

  async state(companyId: string) {
    return this.db.m.AuditState.findOne({ companyId: this.cid(companyId) }).lean<any>();
  }
  private async saveState(companyId: string, set: any) {
    await this.db.m.AuditState.updateOne({ companyId: this.cid(companyId) }, { $set: set }, { upsert: true });
  }

  /** AuditAnchor theo lần kiểm gần nhất – không kiểm lại khi gọi (E15) */
  async anchorView(companyId: string) {
    const last = await this.db.m.AuditLog.findOne({ companyId: this.cid(companyId) }, { seq: 1, hash: 1, at: 1 }).sort({ seq: -1 }).lean<any>();
    const st = await this.state(companyId);
    return toApi({
      lastSeq: last?.seq ?? 0,
      lastHash: last?.hash,
      lastAt: last?.at,
      verification: st?.verification ?? { status: 'never' },
      latestAnchor: st?.latestAnchor,
    });
  }

  async userIdsWithRoles(companyId: string, roles: string[]) {
    return (await this.db.m.User.find({ companyId: this.cid(companyId), systemRoles: { $in: roles }, status: { $ne: 'left' } }, { _id: 1, email: 1 }).lean<any[]>());
  }

  async runVerify(job: JobContext) {
    const r = await job.step('Kiểm mã băm từng dòng', () => this.audit.verifyChain(job.companyId));
    await job.step('Ghi kết quả', async () => {
      const verification = { status: r.ok ? 'ok' : 'broken', checkedAt: new Date(), count: r.count, ...(r.ok ? {} : { brokenAtSeq: r.brokenAtSeq }), jobId: new Types.ObjectId(job.jobId) };
      await this.saveState(job.companyId, { verification });
      if (!r.ok) {
        const to = await this.userIdsWithRoles(job.companyId, ['R1', 'R3', 'R9']);
        await this.notifications.notify(job.companyId, to.map((u) => String(u._id)), {
          type: 'audit_chain_broken',
          title: `Chuỗi nhật ký VCdocs bị lệch từ dòng ${r.brokenAtSeq}`,
          body: 'Có dòng nhật ký bị sửa, xoá hoặc chèn. Kiểm tra ngay và đối chiếu với mỏ neo gần nhất.',
          link: '/nhat-ky',
        });
      }
    });
    // Không có result (E18); summary ghi số dòng đã kiểm
    return { count: r.count, status: r.ok ? 'ok' : 'broken', ...(r.ok ? {} : { brokenAtSeq: r.brokenAtSeq }) };
  }

  /** File Sheets khoá "Mỏ neo nhật ký VCdocs" ở drive 01 BĐH; chưa có thì tạo */
  private async anchorFile(companyId: string, st: any): Promise<string> {
    if (st?.anchorFileId && (await this.google.drive.getFile(st.anchorFileId))) return st.anchorFileId;
    const cid = this.cid(companyId);
    const bdh = (await this.db.m.Department.findOne({ companyId: cid, number: '01' }).lean<any>()) ?? (await this.db.m.Department.findOne({ companyId: cid, code: 'BDH' }).lean<any>());
    const folder = bdh ? await this.db.m.Folder.findOne({ companyId: cid, driveId: bdh.driveId, kind: 'plan_report', parentId: { $exists: false } }).lean<any>() : undefined;
    const fileId = await this.google.sheets.createSheet({ parentGoogleId: folder?.googleId ?? bdh?.driveId, title: ANCHOR_FILE_TITLE, header: ['Thời điểm neo', 'Số dòng (seq)', 'Mã băm cuối chuỗi (SHA-256)', 'Thời điểm dòng cuối', 'Đã gửi email tới'], rows: [] });
    await this.google.drive.setLock(fileId, { locked: true, reason: 'Mỏ neo nhật ký VCdocs – chỉ máy chủ ghi' });
    await this.saveState(companyId, { anchorFileId: fileId });
    return fileId;
  }

  async runAnchor(job: JobContext) {
    const last = await job.step('Đọc đầu chuỗi', () => this.db.m.AuditLog.findOne({ companyId: this.cid(job.companyId) }, { seq: 1, hash: 1, at: 1 }).sort({ seq: -1 }).lean<any>());
    if (!last) return { seq: 0 };
    const r1 = await this.userIdsWithRoles(job.companyId, ['R1']);
    const sentTo = r1.map((u) => u.email);
    const at = new Date();
    await job.step('Gửi email cho Ban Điều hành', async () => {
      if (!sentTo.length) return;
      await this.notifications.sendEmail(
        sentTo,
        `Mỏ neo nhật ký VCdocs tuần ${dateVN(at)}`,
        `Dòng cuối: ${last.seq} · Mã băm: ${last.hash} · Lúc: ${new Date(last.at).toISOString()}. Giữ thư này để đối chiếu khi cần chứng minh nhật ký không bị sửa.`,
      );
    });
    const fileId = await job.step('Ghi file Sheets mỏ neo', async () => {
      const id = await this.anchorFile(job.companyId, await this.state(job.companyId));
      // File khoá: mở – ghi một dòng – khoá lại
      await this.google.drive.setLock(id, { locked: false });
      try {
        await this.google.sheets.appendRows(id, [[at.toISOString(), last.seq, last.hash, new Date(last.at).toISOString(), sentTo.join(', ')]]);
      } finally {
        await this.google.drive.setLock(id, { locked: true, reason: 'Mỏ neo nhật ký VCdocs – chỉ máy chủ ghi' });
      }
      return id;
    });
    await this.saveState(job.companyId, { latestAnchor: { at, seq: last.seq, hash: last.hash, sentTo, fileId } });
    await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'audit.anchor', objectType: 'audit_log', objectId: String(last._id), after: { seq: last.seq, hash: last.hash, sentTo, fileId } });
    return { seq: last.seq };
  }

  /** Quyền xem tạm quá hạn → expired (E16); companyId trống = mọi công ty (việc định kỳ) */
  async expireAuditorAccess(companyId?: string) {
    const filter: any = { status: 'active', expiresAt: { $lte: new Date() } };
    if (companyId) filter.companyId = new Types.ObjectId(companyId);
    await this.db.m.AuditorAccess.updateMany(filter, { $set: { status: 'expired' } }, (companyId ? {} : { skipTenant: true }) as any);
  }

  async enqueueVerify(ctx: Ctx) {
    return this.jobs.enqueue(ctx, 'audit.verify', { manual: true });
  }

  /** Việc định kỳ: mỗi công ty một việc mỗi ngày (chống chạy trùng khi nhiều tiến trình) */
  async enqueueScheduled(type: 'audit.verify' | 'audit.anchor', today = dateVN()) {
    for (const c of await this.db.m.Company.find({}).lean<any[]>()) {
      const exists = await this.db.m.Job.findOne({ companyId: c._id, type, 'payload.auto': true, 'payload.date': today }).lean();
      if (exists) continue;
      const admin = (await this.access.firstUserWithRole(String(c._id), 'R9')) ?? (await this.access.firstUserWithRole(String(c._id), 'R1'));
      if (!admin) continue;
      await this.jobs.enqueueSystem(String(c._id), String(admin._id), type, { auto: true, date: today });
    }
  }
}
