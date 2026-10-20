import { Controller, Get } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { RateBucket } from '../../common/decorators';
import { escapeRegex, normalizeText } from '../../common/util';
import { AccessService } from '../../access/access.service';

function hitOfDoc(d: any) {
  return clean({ objectType: 'document', id: String(d._id), code: d.code, title: d.title, status: d.status, departmentId: d.departmentId ? String(d.departmentId) : undefined });
}
function hitOfRecord(r: any) {
  return clean({ objectType: 'record', id: String(r._id), code: r.number, title: r.fileName ?? r.subject, status: r.status, departmentId: r.departmentId ? String(r.departmentId) : undefined, workMonth: r.workMonth, identifier: r.identifier });
}
function clean(o: any) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/**
 * M08 Tra cứu: một ô tìm theo mã, chữ trong tên, số định danh. Không bao giờ
 * trả thứ người tìm không được xem, kể cả tên file thuộc drive Mật (US-08.1).
 */
@Controller('search')
export class SearchController {
  constructor(private readonly db: Db, private readonly access: AccessService) {}

  private filters(ctx: Ctx, q: any) {
    const cid = new Types.ObjectId(ctx.companyId);
    const me = new Types.ObjectId(ctx.user.id);
    const text = normalizeText(q.q);
    const re = new RegExp(escapeRegex(text));
    const docF: any = {
      companyId: cid,
      searchText: re,
      $or: [{ securityLevel: { $ne: 'confidential' } }, { driveId: { $in: ctx.visibleDriveIds } }, { drafterId: me }, { approverId: me }, { checkerId: me }],
    };
    const recF: any = { companyId: cid, searchText: re, ...this.access.visibleFilter(ctx, 'driveId', ['createdBy']) };
    for (const f of [docF, recF]) {
      if (q.departmentId) f.departmentId = new Types.ObjectId(q.departmentId);
      if (q.status) f.status = q.status;
      if (q.createdBy) f.createdBy = new Types.ObjectId(q.createdBy);
    }
    if (q.workMonth) recF.workMonth = q.workMonth;
    return { docF, recF, text };
  }

  /** Khớp đúng mã/số lên đầu, rồi theo ngày cập nhật */
  private rank(text: string, hits: { hit: any; updatedAt: Date }[]) {
    const exact = (h: any) => (normalizeText(h.code ?? '') === text || normalizeText(h.identifier ?? '') === text ? 0 : normalizeText(h.code ?? '').startsWith(text) ? 1 : 2);
    return hits.sort((a, b) => exact(a.hit) - exact(b.hit) || b.updatedAt.getTime() - a.updatedAt.getTime()).map((x) => x.hit);
  }

  @Get()
  @RateBucket('search')
  async search(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const page = q.page ?? 1;
    const limit = Math.min(200, q.limit ?? 50);
    const { docF, recF, text } = this.filters(ctx, q);
    const wantDocs = q.scope !== 'records' && !q.workMonth;
    const wantRecs = q.scope !== 'documents';
    const take = page * limit;
    const [docs, recs, docTotal, recTotal] = await Promise.all([
      wantDocs ? this.db.m.Document.find(docF).sort({ updatedAt: -1 }).limit(take).lean<any[]>() : [],
      wantRecs ? this.db.m.Record.find(recF).sort({ updatedAt: -1 }).limit(take).lean<any[]>() : [],
      wantDocs ? this.db.m.Document.countDocuments(docF) : 0,
      wantRecs ? this.db.m.Record.countDocuments(recF) : 0,
    ]);
    const merged = this.rank(text, [...docs.map((d) => ({ hit: hitOfDoc(d), updatedAt: d.updatedAt })), ...recs.map((r) => ({ hit: hitOfRecord(r), updatedAt: r.updatedAt }))]);
    return { items: merged.slice((page - 1) * limit, page * limit), page, limit, total: docTotal + recTotal };
  }

  @Get('suggest')
  @RateBucket('search')
  async suggest(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const { docF, recF, text } = this.filters(ctx, q);
    const [docs, recs] = await Promise.all([
      this.db.m.Document.find(docF).sort({ updatedAt: -1 }).limit(10).lean<any[]>(),
      this.db.m.Record.find(recF).sort({ updatedAt: -1 }).limit(10).lean<any[]>(),
    ]);
    const merged = this.rank(text, [...docs.map((d) => ({ hit: hitOfDoc(d), updatedAt: d.updatedAt })), ...recs.map((r) => ({ hit: hitOfRecord(r), updatedAt: r.updatedAt }))]);
    return { items: merged.slice(0, 10) };
  }
}
