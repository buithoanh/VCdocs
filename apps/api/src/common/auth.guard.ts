import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Db } from '../db/db.service';
import { SessionService, SESSION_COOKIE } from '../session/session.service';
import { AccessService } from '../access/access.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Errors } from './errors';
import { AuditService } from '../audit/audit.service';
import { getCtx } from './context';
import { PUBLIC_KEY, RATE_BUCKET_KEY, ROLES_KEY, SKIP_CSRF_KEY } from './decorators';
import { safeEqual } from './util';
import type { SystemRole } from './enums';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
/** Điểm cuối kiểm toán viên được dùng trong các phòng được cấp (E16) */
const AUDITOR_READ = /^\/(documents|records|approvals|audit-logs|evidence-pack)(\/|$)/;

/**
 * Cổng chung cho mọi yêu cầu: phiên cookie vcdocs_sid → người dùng, công ty,
 * quyền drive; kiểm CSRF cho POST/PATCH/DELETE; giới hạn tần suất; vai trò.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly reflector: Reflector,
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ctx = getCtx(req);
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets);

    const sid = (req as any).cookies?.[SESSION_COOKIE];
    const session = sid ? await this.sessions.find(sid) : undefined;
    if (session) {
      const user = await this.db.m.User.findOne({ _id: session.userId, companyId: session.companyId }).lean<any>();
      if (user && user.status !== 'left' && !user.isSuspended) {
        ctx.companyId = String(user.companyId);
        ctx.user = {
          id: String(user._id),
          email: user.email,
          name: user.name,
          departmentId: user.departmentId ? String(user.departmentId) : undefined,
          systemRoles: user.systemRoles || [],
        };
        ctx.sessionId = String(session._id);
        ctx.csrfToken = session.csrfToken;
        ctx.sessionExpiresAt = session.expiresAt;
        await this.access.loadAccess(ctx, user);
        const renewed = await this.sessions.touch(session);
        if (renewed) {
          ctx.sessionExpiresAt = renewed;
          res.cookie(SESSION_COOKIE, sid, this.sessions.cookieOptions());
        }
      }
    }
    if (isPublic) return true;
    if (!ctx.user) throw Errors.unauthenticated();

    this.rateLimit(ctx.user.id, this.reflector.getAllAndOverride<string>(RATE_BUCKET_KEY, targets));

    if (MUTATING.has(req.method) && !this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets)) {
      const token = req.header('x-csrf-token') || '';
      if (!token || !ctx.csrfToken || !safeEqual(token, ctx.csrfToken)) {
        throw Errors.forbidden('Thiếu hoặc sai mã chống giả mạo (X-CSRF-Token), hãy tải lại trang');
      }
    }

    await this.auditorView(req, ctx);

    const roles = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.some((r) => ctx.user!.systemRoles.includes(r))) {
      throw Errors.forbidden(`Thao tác này cần vai trò ${roles.join(', ')}`);
    }
    return true;
  }

  /**
   * Kiểm toán viên (E16): trong các phòng được cấp được đọc tài liệu, hồ sơ, phiếu,
   * nhật ký và tạo, tải gói bằng chứng – không cần là thành viên drive. Mọi lượt
   * gọi các điểm cuối này, kể cả GET, ghi audit_logs action auditor.view.
   */
  private async auditorView(req: Request, ctx: ReturnType<typeof getCtx>) {
    const path = req.originalUrl.split('?')[0].replace(/^\/api\/v1/, '');
    if (!AUDITOR_READ.test(path)) return;
    const scope = await this.access.auditorScope(ctx.companyId!, ctx.user!.id);
    if (!scope) return;
    ctx.auditor = scope;
    if (req.method === 'GET') ctx.visibleDriveIds = [...new Set([...ctx.visibleDriveIds, ...scope.driveIds])];
    const [, objectType, objectId] = path.split('/');
    await this.audit.write(this.audit.actorFromCtx(ctx), {
      action: 'auditor.view',
      objectType: objectType.replace(/-/g, '_').replace(/s$/, ''),
      objectId: objectId && /^[a-f0-9]{24}$/.test(objectId) ? objectId : undefined,
      after: { method: req.method, path, accessIds: scope.accessIds },
    });
    await this.db.m.AuditorAccess.updateMany(
      { companyId: ctx.companyId, _id: { $in: scope.accessIds } },
      { $set: { lastUsedAt: new Date() } },
    );
  }

  /** 600 yêu cầu/phút/người; tìm kiếm 60/phút (hợp đồng mục 7) */
  private rateLimit(userId: string, bucket?: string) {
    const limit = bucket === 'search' ? this.cfg.rateLimit.searchPerMinute : this.cfg.rateLimit.perMinute;
    const key = `${bucket ?? 'all'}:${userId}`;
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < 60_000);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      throw Errors.rateLimited((arr[0] + 60_000 - now) / 1000);
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.hits.clear();
  }
}
