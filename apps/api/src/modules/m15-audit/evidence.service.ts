import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import type { Ctx } from '../../common/context';
import { Errors } from '../../common/errors';
import { sha256, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobContext, JobsService } from '../../jobs/jobs.service';
import { GOOGLE, GooglePorts, VAULT, VaultPort } from '../../google/ports';
import { AuditChainService } from './audit-chain.service';
import { buildZip, ZipEntry } from './zip';

const CSV_COLUMNS = ['seq', 'at', 'actorEmail', 'action', 'objectType', 'objectId', 'result', 'requestId', 'ip', 'before', 'after', 'prevHash', 'hash'];

function csvCell(v: any): string {
  const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Tên tệp trong ZIP: bỏ ký tự không hợp lệ trên Windows */
function safe(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}

/**
 * Gói bằng chứng (E17): ZIP gồm manifest.json (SHA-256 từng tệp), PDF trong kho
 * riêng, approvals.json, audit-logs.csv của đối tượng, anchor.json. Lưu ở máy chủ
 * 7 ngày rồi xoá, không ghi lên Drive.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly chain: AuditChainService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(VAULT) private readonly vault: VaultPort,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    jobs.register('evidence_pack.build', {
      title: 'Lập gói bằng chứng',
      steps: ['Lấy bản PDF', 'Lấy phiếu duyệt và nhật ký', 'Đóng gói ZIP'],
      handler: (j) => this.runBuild(j),
    });
  }

  private cid(companyId: string) {
    return new Types.ObjectId(companyId);
  }

  private async target(companyId: string, type: 'document' | 'record', id: string) {
    const M = type === 'document' ? this.db.m.Document : this.db.m.Record;
    return M.findOne({ companyId: this.cid(companyId), _id: new Types.ObjectId(id) }).lean<any>();
  }

  /** R1, R3 trong phạm vi xem được; kiểm toán viên trong các phòng được cấp (E17) */
  async request(ctx: Ctx, body: { documentId?: string; recordId?: string }) {
    if (!!body.documentId === !!body.recordId) {
      throw Errors.validation('Chọn đúng một trong tài liệu (documentId) hoặc hồ sơ (recordId)', [{ field: 'body', issue: 'exactly_one_of:documentId,recordId' }]);
    }
    const targetType = body.documentId ? 'document' : 'record';
    const targetId = (body.documentId ?? body.recordId)!;
    const obj = await this.target(ctx.companyId, targetType, targetId);
    if (!obj) throw Errors.notFound(targetType === 'document' ? 'Không tìm thấy tài liệu' : 'Không tìm thấy hồ sơ');
    const departmentId = obj.departmentId ? String(obj.departmentId) : (await this.access.deptByDrive(ctx.companyId, obj.driveId))?.id;
    const driveId = obj.driveId ?? (await this.access.deptById(ctx.companyId, departmentId))?.driveId;
    if (!this.access.auditorCovers(ctx, { departmentId, driveId })) {
      if (!this.access.hasRole(ctx, 'R1', 'R3')) throw Errors.forbidden('Chỉ Ban Điều hành (R1), HCNS (R3) hoặc kiểm toán viên trong phạm vi được lập gói bằng chứng');
      await this.access.assertVisibleOrR3(ctx, driveId);
    }
    const jobId = await this.jobs.enqueue(ctx, 'evidence_pack.build', { targetType, targetId });
    await this.audit.record(ctx, { action: 'evidence_pack.request', objectType: targetType, objectId: targetId, departmentId, after: { jobId } });
    return jobId;
  }

  async load(ctx: Ctx, id: Types.ObjectId) {
    const p = await this.db.m.EvidencePack.findOne({ companyId: this.cid(ctx.companyId), _id: id }).lean<any>();
    // Hết hạn 7 ngày → 404 (E17)
    if (!p || p.purgedAt || p.expiresAt <= new Date()) throw Errors.notFound('Không tìm thấy gói bằng chứng hoặc gói đã hết hạn');
    if (String(p.createdBy) !== ctx.user.id && !this.access.hasRole(ctx, 'R1', 'R3')) throw Errors.forbidden('Chỉ người tạo, R1, R3 xem được gói bằng chứng');
    return p;
  }

  toApi(p: any) {
    return toApi(p, ['storageKey', 'fileName', 'purgedAt']);
  }

  async download(ctx: Ctx, p: any) {
    const buf = await this.vault.get(p.storageKey);
    if (!buf) throw Errors.notFound('Gói bằng chứng đã bị xoá khỏi máy chủ');
    await this.audit.record(ctx, { action: 'evidence_pack.download', objectType: p.targetType, objectId: String(p.targetId), after: { evidencePackId: p._id, sha256: p.sha256 } });
    return buf;
  }

  private async pdfOf(p: { vaultKey?: string; fileId?: string }): Promise<Buffer | undefined> {
    if (p.vaultKey) {
      const b = await this.vault.get(p.vaultKey);
      if (b) return b;
    }
    if (p.fileId) return this.google.drive.exportPdf(p.fileId);
    return undefined;
  }

  async runBuild(job: JobContext) {
    const { targetType, targetId } = job.payload as { targetType: 'document' | 'record'; targetId: string };
    const cid = this.cid(job.companyId);
    const obj = await this.target(job.companyId, targetType, targetId);
    if (!obj) throw Errors.notFound('Đối tượng không còn');
    const label = safe(targetType === 'document' ? obj.code ?? obj.title : obj.number);
    const objectTypes = targetType === 'document' ? ['document', 'document_withdrawal'] : ['record'];
    const approvals = await this.db.m.Approval.find({ companyId: cid, objectType: { $in: objectTypes }, objectId: obj._id }).sort({ submittedAt: 1 }).lean<any[]>();

    const entries: ZipEntry[] = [];
    await job.step('Lấy bản PDF', async () => {
      if (targetType === 'document') {
        // Mọi phiên bản đã ban hành; bản cũ chưa có trong kho riêng thì lấy PDF hiện hành trên Drive
        const versions = (obj.versions ?? []).filter((v: any) => v.kind === 'major');
        for (const v of versions) {
          const isCurrent = obj.current?.number === v.number;
          const buf = await this.pdfOf({ vaultKey: v.vaultKey, fileId: v.pdfFileId ?? (isCurrent ? obj.current?.pdfFileId : undefined) });
          if (buf) entries.push({ path: `pdf/${label} v${v.number}.pdf`, content: buf });
        }
        if (!versions.length && obj.current?.pdfFileId) {
          const buf = await this.pdfOf({ fileId: obj.current.pdfFileId });
          if (buf) entries.push({ path: `pdf/${label} v${obj.current.number ?? 1}.pdf`, content: buf });
        }
      } else {
        if (obj.finalized?.vaultKey || obj.finalized?.pdfFileId) {
          const buf = await this.pdfOf({ vaultKey: obj.finalized.vaultKey, fileId: obj.finalized.pdfFileId });
          if (buf) entries.push({ path: `pdf/${label} – bản chốt.pdf`, content: buf });
        }
        let n = 0;
        for (const a of approvals) {
          if (!a.snapshot?.pdfFileId) continue;
          const buf = await this.pdfOf({ fileId: a.snapshot.pdfFileId });
          if (buf) entries.push({ path: `pdf/${label} – bản trình ${++n}.pdf`, content: buf });
        }
      }
    });
    await job.step('Lấy phiếu duyệt và nhật ký', async () => {
      entries.push({ path: 'approvals.json', content: Buffer.from(JSON.stringify(approvals.map((a) => toApi(a, ['companyId'])), null, 2)) });
      const ids = [String(obj._id), ...approvals.map((a) => String(a._id))];
      const logs = await this.db.m.AuditLog.find({ companyId: cid, objectId: { $in: ids } }).sort({ seq: 1 }).lean<any[]>();
      const csv = [CSV_COLUMNS.join(','), ...logs.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\r\n');
      // BOM để Excel đọc đúng tiếng Việt
      entries.push({ path: 'audit-logs.csv', content: Buffer.concat([Buffer.from('﻿'), Buffer.from(csv + '\r\n')]) });
      entries.push({ path: 'anchor.json', content: Buffer.from(JSON.stringify(await this.chain.anchorView(job.companyId), null, 2)) });
    });
    const packId = new Types.ObjectId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.cfg.rules.evidencePackDays * 86400_000);
    const files = entries.map((e) => ({ path: e.path, sha256: sha256(e.content), sizeBytes: e.content.length }));
    const zip = await job.step('Đóng gói ZIP', async () => {
      const manifest = {
        evidencePackId: String(packId),
        target: { type: targetType, id: String(obj._id), label },
        createdAt: now.toISOString(),
        createdBy: job.userId,
        expiresAt: expiresAt.toISOString(),
        files,
      };
      const buf = buildZip([{ path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...entries], now);
      await this.vault.put(`evidence/${job.companyId}/${packId}.zip`, buf);
      return buf;
    });
    await this.db.m.EvidencePack.create({
      _id: packId,
      companyId: cid,
      targetType,
      targetId: obj._id,
      files,
      sha256: sha256(zip),
      sizeBytes: zip.length,
      expiresAt,
      storageKey: `evidence/${job.companyId}/${packId}.zip`,
      fileName: `Goi bang chung ${label} ${now.toISOString().slice(0, 10)}.zip`,
      createdBy: new Types.ObjectId(job.userId),
      updatedBy: new Types.ObjectId(job.userId),
    });
    await this.audit.write({ companyId: job.companyId, userId: job.userId, requestId: job.requestId }, { action: 'evidence_pack.built', objectType: targetType, objectId: String(obj._id), after: { evidencePackId: packId, sha256: sha256(zip), files: files.length } });
    return { objectType: 'evidence_pack', objectId: String(packId) };
  }

  /** Xoá gói quá 7 ngày khỏi máy chủ */
  async purgeExpired() {
    const rows = await this.db.m.EvidencePack.find({ expiresAt: { $lte: new Date() }, purgedAt: { $in: [null] } }, undefined, { skipTenant: true }).limit(500).lean<any[]>();
    for (const p of rows) {
      await this.vault.remove(p.storageKey);
      await this.db.m.EvidencePack.updateOne({ _id: p._id, companyId: p.companyId }, { $set: { purgedAt: new Date() } });
    }
  }
}
