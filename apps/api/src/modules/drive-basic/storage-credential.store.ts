import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Db } from '../../db/db.service';
import { Errors } from '../../common/errors';
import { open, seal } from '../../common/credential-cipher';
import { StorageActor } from './storage.port';

export interface StorageCredential { username: string; password: string }

/**
 * Cấp app password mới / xoá app password cũ phía Nextcloud. Chưa có bản production: cần chế độ
 * production của identity lifecycle (câu hỏi mở 3 trong docs/ke-hoach/vcworkspace-21-...).
 */
export interface AppPasswordIssuer {
  issue(ncUid: string, current: StorageCredential): Promise<string>;
  revoke(ncUid: string, old: StorageCredential): Promise<void>;
}

const CACHE_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const aad = (companyId: string, userId: string, ncUid: string) => `${companyId}|${userId}|${ncUid}`;

/**
 * Nguồn credential Nextcloud theo người dùng (P1). Không ghi bí mật vào log, audit hay lỗi.
 * Bản giải mã được cache trong bộ nhớ tối đa 5 phút; thu hồi ở tiến trình khác có hiệu lực sau
 * tối đa 5 phút, còn Nextcloud xoá token thì có hiệu lực ngay.
 */
@Injectable()
export class StorageCredentialStore {
  private readonly cache = new Map<string, { value: StorageCredential; until: number }>();
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly db: Db) {}

  private get s() { return this.cfg.workspaceStorage; }
  private keys() { return this.s.credentialKeys || []; }
  private rotateAfter(now: Date) { return new Date(now.getTime() + (this.s.credentialRotateDays ?? 90) * DAY_MS); }
  private cacheKey(companyId: string, email: string) { return `${companyId}|${email.toLowerCase()}`; }

  async resolve(actor: StorageActor, now = new Date()): Promise<StorageCredential> {
    if ((this.s.credentialSource || 'env') === 'env') {
      const credential = this.s.credentials[actor.email.toLowerCase()];
      if (!credential) throw Errors.forbidden('Không có danh tính kho riêng cho người dùng');
      return credential;
    }
    if (!actor.companyId) throw Errors.forbidden('Không có danh tính kho riêng cho người dùng');
    const key = this.cacheKey(actor.companyId, actor.email);
    const hit = this.cache.get(key);
    if (hit && hit.until > now.getTime()) return hit.value;
    const row = await this.db.m.WorkspaceStorageCredential.findOne({ companyId: new Types.ObjectId(actor.companyId),
      email: actor.email.toLowerCase(), status: 'active' }).lean<any>();
    if (!row?.ciphertext) throw Errors.forbidden('Không có danh tính kho riêng cho người dùng');
    let password: string;
    try { password = open(this.keys(), row, aad(actor.companyId, String(row.userId), row.ncUid)); }
    catch { throw Errors.storageUnavailable('Không giải mã được danh tính kho'); }
    const value = { username: row.ncUid, password };
    this.cache.set(key, { value, until: now.getTime() + CACHE_MS });
    await this.db.m.WorkspaceStorageCredential.updateOne({ companyId: row.companyId, _id: row._id }, { $set: { lastUsedAt: now } });
    return value;
  }

  /** Nextcloud từ chối (401): bỏ cache để lần sau đọc lại bản mới nhất. */
  forget(actor: StorageActor) { if (actor.companyId) this.cache.delete(this.cacheKey(actor.companyId, actor.email)); }

  /** Nạp hoặc thay app password của một người; tính lại hạn xoay. */
  async save(input: { companyId: string; userId: string; email: string; ncUid: string; password: string }, now = new Date()) {
    if (!/^[A-Za-z0-9._@-]{1,64}$/.test(input.ncUid)) throw new Error('uid Nextcloud không hợp lệ');
    if (!input.password) throw new Error('Thiếu app password');
    const sealed = seal(this.keys(), input.password, aad(input.companyId, input.userId, input.ncUid));
    const companyId = new Types.ObjectId(input.companyId);
    await this.db.m.WorkspaceStorageCredential.updateOne({ companyId, userId: new Types.ObjectId(input.userId) }, {
      $set: { email: input.email.toLowerCase(), ncUid: input.ncUid, status: 'active', ...sealed, rotateAfter: this.rotateAfter(now) },
      $unset: { revokedAt: 1 },
    }, { upsert: true });
    this.cache.delete(this.cacheKey(input.companyId, input.email));
  }

  /** Thu hồi: xoá bản mã, giữ dòng (trạng thái, thời điểm) để đối soát. */
  async revoke(companyId: string, userId: string, now = new Date()) {
    const row = await this.db.m.WorkspaceStorageCredential.findOneAndUpdate(
      { companyId: new Types.ObjectId(companyId), userId: new Types.ObjectId(userId) },
      { $set: { status: 'revoked', revokedAt: now }, $unset: { kid: 1, iv: 1, ciphertext: 1, tag: 1, rotateAfter: 1 } }).lean<any>();
    if (row) this.cache.delete(this.cacheKey(companyId, row.email));
    return Boolean(row);
  }

  /** Credential đã tới hạn xoay (không trả bí mật). */
  async dueForRotation(companyId: string, now = new Date()) {
    const rows = await this.db.m.WorkspaceStorageCredential.find({ companyId: new Types.ObjectId(companyId), status: 'active',
      rotateAfter: { $lte: now } }).sort({ rotateAfter: 1 }).lean<any[]>();
    return rows.map((r) => ({ userId: String(r.userId), email: r.email, ncUid: r.ncUid, rotateAfter: r.rotateAfter as Date }));
  }

  /**
   * Xoay app password: cấp mới → lưu → xoá cũ. Cấp mới lỗi thì giữ nguyên bản cũ. Xoá cũ lỗi thì bản
   * mới đã dùng được; trả `oldRevoked: false` để người vận hành xoá tay token cũ phía Nextcloud.
   */
  async rotate(companyId: string, userId: string, issuer: AppPasswordIssuer, now = new Date()) {
    const row = await this.db.m.WorkspaceStorageCredential.findOne({ companyId: new Types.ObjectId(companyId),
      userId: new Types.ObjectId(userId), status: 'active' }).lean<any>();
    if (!row?.ciphertext) throw new Error('Không có credential đang dùng');
    const old = { username: row.ncUid, password: open(this.keys(), row, aad(companyId, userId, row.ncUid)) };
    const password = await issuer.issue(row.ncUid, old);
    await this.save({ companyId, userId, email: row.email, ncUid: row.ncUid, password }, now);
    try { await issuer.revoke(row.ncUid, old); return { oldRevoked: true }; }
    catch { return { oldRevoked: false }; }
  }

  /** Xoay khoá chủ: mã hoá lại mọi bản mã chưa dùng khoá đầu keyring. Không đổi hạn xoay app password. */
  async reencrypt(companyId: string) {
    const active = this.keys()[0];
    if (!active) throw new Error('Chưa cấu hình khoá mã hoá credential');
    const rows = await this.db.m.WorkspaceStorageCredential.find({ companyId: new Types.ObjectId(companyId), status: 'active',
      kid: { $ne: active.kid } }).lean<any[]>();
    for (const row of rows) {
      const data = aad(companyId, String(row.userId), row.ncUid);
      const sealed = seal(this.keys(), open(this.keys(), row, data), data);
      await this.db.m.WorkspaceStorageCredential.updateOne({ companyId: row.companyId, _id: row._id, kid: row.kid }, { $set: sealed });
    }
    return rows.length;
  }
}
