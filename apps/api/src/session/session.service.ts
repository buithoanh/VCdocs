import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Db } from '../db/db.service';
import { randomToken, sha256 } from '../common/util';

export const SESSION_COOKIE = 'vcdocs_sid';
export const OAUTH_COOKIE = 'vcdocs_oauth';

/** Phiên đăng nhập lưu MongoDB; cookie chỉ giữ chuỗi ngẫu nhiên, DB giữ mã băm. */
@Injectable()
export class SessionService {
  constructor(private readonly db: Db, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  get ttlMs() {
    return this.cfg.sessionHours * 3600_000;
  }

  cookieOptions(maxAgeMs = this.ttlMs) {
    return { httpOnly: true, secure: this.cfg.cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: maxAgeMs };
  }

  async create(p: { userId: string; companyId: string; ip: string; device: string; authProvider?: 'google' | 'oidc'; identityId?: string }) {
    const sid = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db.m.Session.create({
      sidHash: sha256(sid),
      userId: new Types.ObjectId(p.userId),
      companyId: new Types.ObjectId(p.companyId),
      csrfToken,
      expiresAt,
      ip: p.ip,
      device: p.device,
      authProvider: p.authProvider ?? 'google',
      ...(p.identityId ? { identityId: new Types.ObjectId(p.identityId) } : {}),
    });
    return { sid, csrfToken, expiresAt };
  }

  async find(sid: string) {
    if (!sid || sid.length > 200) return undefined;
    const s = await this.db.m.Session.findOne({ sidHash: sha256(sid) }, undefined, { skipTenant: true }).lean<any>();
    if (!s || s.expiresAt.getTime() <= Date.now()) return undefined;
    return s;
  }

  /** Tự gia hạn khi đang dùng (hợp đồng Q4): đẩy hạn về 8 giờ kể từ lần dùng gần nhất */
  async touch(session: any): Promise<Date | undefined> {
    const newExp = new Date(Date.now() + this.ttlMs);
    if (newExp.getTime() - session.expiresAt.getTime() < 5 * 60_000) return undefined;
    await this.db.m.Session.updateOne({ _id: session._id, companyId: session.companyId }, { $set: { expiresAt: newExp } });
    return newExp;
  }

  async destroy(sid: string) {
    await this.db.m.Session.deleteOne({ sidHash: sha256(sid) }, { skipTenant: true });
  }

  async destroyAllForUser(companyId: string, userId: string) {
    await this.db.m.Session.deleteMany({ companyId: new Types.ObjectId(companyId), userId: new Types.ObjectId(userId) });
  }
}
