import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../db/db.service';
import { sha256 } from '../common/util';
import type { RequestCtx } from '../common/context';

export interface AuditEntry {
  action: string;
  objectType?: string;
  objectId?: string;
  before?: any;
  after?: any;
  result?: 'ok' | 'denied';
  /** Phòng của đối tượng (E14); bỏ trống thì tự tra theo objectType + objectId */
  departmentId?: string;
}

export interface AuditActor {
  companyId: string;
  userId?: string;
  email?: string;
  requestId?: string;
  ip?: string;
  device?: string;
}

const GENESIS = '0'.repeat(64);
/** Trường không bao giờ ghi vào nhật ký (hợp đồng mục 7: không ghi token, nội dung file) */
const SECRET_KEYS = new Set(['csrfToken', 'sidHash', 'token', 'accessToken', 'refreshToken', 'idToken', 'buffer', 'content']);

function scrub(v: any, depth = 0): any {
  if (v === null || v === undefined || depth > 6) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Types.ObjectId) return v.toHexString();
  if (Buffer.isBuffer(v)) return undefined;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrub(x, depth + 1));
  if (typeof v === 'object') {
    if (v._bsontype === 'ObjectId') return String(v);
    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (SECRET_KEYS.has(k) || k === '__v') continue;
      const s = scrub(val, depth + 1);
      if (s !== undefined) out[k === '_id' ? 'id' : k] = s;
    }
    // Mongo bỏ object rỗng khi lưu (minimize) → bỏ luôn để mã băm khớp khi đọc lại
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

function idOf(v: any): string | undefined {
  return v ? String(v) : undefined;
}

/** JSON có thứ tự khoá cố định để băm ổn định */
export function canonical(v: any): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(',')}}`;
}

export function auditHash(prevHash: string, row: any): string {
  const { hash: _h, _id, __v, ...rest } = row;
  return sha256(
    prevHash +
      canonical({
        ...rest,
        at: new Date(rest.at).toISOString(),
        companyId: String(rest.companyId),
        actorId: rest.actorId ? String(rest.actorId) : undefined,
        departmentId: rest.departmentId ? String(rest.departmentId) : undefined,
      }),
  );
}

/**
 * audit_logs chỉ thêm. Mỗi dòng có seq tăng dần theo công ty và hash nối với
 * dòng trước (prevHash) để phát hiện bị sửa, xoá, chèn.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly db: Db) {}

  actorFromCtx(ctx: RequestCtx): AuditActor {
    return {
      companyId: ctx.companyId!,
      userId: ctx.user?.id,
      email: ctx.user?.email,
      requestId: ctx.requestId,
      ip: ctx.ip,
      device: ctx.device,
    };
  }

  /** Ghi một dòng từ yêu cầu web; id được gắn vào ctx để trả header X-Audit-Id */
  async record(ctx: RequestCtx, e: AuditEntry): Promise<string> {
    const id = await this.write(this.actorFromCtx(ctx), e);
    ctx.auditIds.push(id);
    return id;
  }

  async write(actor: AuditActor, e: AuditEntry): Promise<string> {
    const M = this.db.m.AuditLog;
    const companyId = new Types.ObjectId(actor.companyId);
    const departmentId = e.departmentId ?? (await this.departmentOf(actor.companyId, e.objectType, e.objectId));
    for (let attempt = 0; attempt < 20; attempt++) {
      const last = await M.findOne({ companyId }, { seq: 1, hash: 1 }).sort({ seq: -1 }).lean<any>();
      const prevHash = last?.hash ?? GENESIS;
      const row: any = {
        _id: new Types.ObjectId(),
        companyId,
        seq: (last?.seq ?? 0) + 1,
        at: new Date(),
        actorId: actor.userId ? new Types.ObjectId(actor.userId) : undefined,
        actorEmail: actor.email,
        action: e.action,
        objectType: e.objectType,
        objectId: e.objectId,
        departmentId: departmentId && Types.ObjectId.isValid(departmentId) ? new Types.ObjectId(departmentId) : undefined,
        before: scrub(e.before),
        after: scrub(e.after),
        result: e.result ?? 'ok',
        requestId: actor.requestId,
        ip: actor.ip,
        device: actor.device,
        prevHash,
      };
      for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
      row.hash = auditHash(prevHash, row);
      try {
        await M.create(row);
        return row._id.toHexString();
      } catch (err: any) {
        if (err?.code === 11000) continue; // dòng khác vừa chen vào, đọc lại đầu chuỗi
        throw err;
      }
    }
    this.log.error('Không ghi được audit_logs sau nhiều lần thử');
    throw new Error('audit_logs bận');
  }

  /** Phòng của đối tượng lúc ghi nhật ký (E14); không xác định được thì bỏ trống */
  async departmentOf(companyId: string, objectType?: string, objectId?: string): Promise<string | undefined> {
    if (!objectType || !objectId || !Types.ObjectId.isValid(objectId)) return undefined;
    const cid = new Types.ObjectId(companyId);
    const _id = new Types.ObjectId(objectId);
    const m = this.db.m;
    const viaDrive = async (driveId?: string) => {
      if (!driveId) return undefined;
      const d = await m.Department.findOne({ companyId: cid, driveId }, { _id: 1 }).lean<any>();
      return d ? String(d._id) : undefined;
    };
    try {
      switch (objectType) {
        case 'document':
          return idOf((await m.Document.findOne({ companyId: cid, _id }, { departmentId: 1 }).lean<any>())?.departmentId);
        case 'record': {
          const r = await m.Record.findOne({ companyId: cid, _id }, { departmentId: 1, driveId: 1 }).lean<any>();
          return idOf(r?.departmentId) ?? (await viaDrive(r?.driveId));
        }
        case 'approval':
          return viaDrive((await m.Approval.findOne({ companyId: cid, _id }, { driveId: 1 }).lean<any>())?.driveId);
        case 'external_share': {
          const s = await m.ExternalShare.findOne({ companyId: cid, _id }, { departmentId: 1, driveId: 1 }).lean<any>();
          return idOf(s?.departmentId) ?? (await viaDrive(s?.driveId));
        }
        case 'folder':
          return viaDrive((await m.Folder.findOne({ companyId: cid, _id }, { driveId: 1 }).lean<any>())?.driveId);
        case 'record_type':
        case 'code':
          return idOf((await (objectType === 'code' ? m.Code : m.RecordType).findOne({ companyId: cid, _id }, { departmentId: 1 }).lean<any>())?.departmentId);
        case 'user':
          return idOf((await m.User.findOne({ companyId: cid, _id }, { departmentId: 1 }).lean<any>())?.departmentId);
        case 'handover':
          return idOf((await m.Handover.findOne({ companyId: cid, _id }, { departmentId: 1 }).lean<any>())?.departmentId);
        case 'department':
          return objectId;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /** Kiểm tra lại toàn chuỗi; trả seq đầu tiên bị lệch (nếu có) */
  async verifyChain(companyId: string): Promise<{ ok: boolean; brokenAtSeq?: number; count: number }> {
    const rows = await this.db.m.AuditLog.find({ companyId: new Types.ObjectId(companyId) }).sort({ seq: 1 }).lean<any[]>();
    let prev = GENESIS;
    let expectSeq = 1;
    for (const r of rows) {
      if (r.seq !== expectSeq || r.prevHash !== prev || auditHash(prev, r) !== r.hash) {
        return { ok: false, brokenAtSeq: r.seq, count: rows.length };
      }
      prev = r.hash;
      expectSeq++;
    }
    return { ok: true, count: rows.length };
  }
}
