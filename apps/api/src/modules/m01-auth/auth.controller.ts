import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { Public } from '../../common/decorators';
import { Ctx, CurrentCtx, getCtx } from '../../common/context';
import { randomToken } from '../../common/util';
import { OAUTH_COOKIE, SESSION_COOKIE, SessionService } from '../../session/session.service';
import { AuditService } from '../../audit/audit.service';
import { GoogleSyncService } from './google-sync.service';
import { OidcService } from './oidc.service';

function safeReturnTo(v?: string): string {
  // Chỉ nhận đường dẫn tương đối trong giao diện, chặn chuyển hướng ra ngoài
  if (!v || typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.length > 500) return '/';
  return v;
}

/** M01: đăng nhập Google OAuth, chỉ tài khoản @vcprosperous.com (BR-15) */
@Controller('auth')
export class AuthController {
  private readonly log = new Logger('AuthController');

  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly sync: GoogleSyncService,
    private readonly oidc: OidcService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private get redirectUri() {
    return `${this.cfg.publicApiOrigin}/api/v1/auth/google/callback`;
  }

  private get oidcRedirectUri() {
    return `${this.cfg.publicApiOrigin}/api/v1/auth/oidc/callback`;
  }

  @Public()
  @Get('google')
  async start(@Query('returnTo') returnTo: string | undefined, @Res() res: Response) {
    const state = randomToken(24);
    const nonce = randomToken(16);
    await this.db.m.OAuthState.create({ state, nonce, returnTo: safeReturnTo(returnTo), expiresAt: new Date(Date.now() + 10 * 60_000) });
    // Gắn state vào trình duyệt để chặn giả mạo đăng nhập (login CSRF)
    res.cookie(OAUTH_COOKIE, state, { httpOnly: true, secure: this.cfg.cookieSecure, sameSite: 'lax', path: '/api/v1/auth', maxAge: 10 * 60_000 });
    res.redirect(302, this.google.auth.buildAuthUrl({ state, nonce, redirectUri: this.redirectUri, hd: this.cfg.allowedDomain }));
  }

  @Public()
  @Get('oidc')
  async startOidc(@Query('returnTo') returnTo: string | undefined, @Res() res: Response) {
    if (this.cfg.authMode !== 'oidc') return this.fail(res, 'provider');
    try {
      const discovery = await this.oidc.discovery();
      const state = randomToken(24);
      const nonce = randomToken(24);
      const { verifier, challenge } = this.oidc.transaction();
      await this.db.m.OAuthState.create({ state, nonce, provider: 'oidc', codeVerifier: verifier, returnTo: safeReturnTo(returnTo), expiresAt: new Date(Date.now() + 3 * 60_000) });
      res.cookie(OAUTH_COOKIE, state, { httpOnly: true, secure: this.cfg.cookieSecure, sameSite: 'lax', path: '/api/v1/auth', maxAge: 3 * 60_000 });
      res.redirect(302, this.oidc.authorizationUrl(discovery, { state, nonce, challenge, redirectUri: this.oidcRedirectUri }));
    } catch (error) {
      this.log.warn(`OIDC start fail-closed: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
      return this.fail(res, 'provider');
    }
  }

  /** Lỗi đăng nhập: không trả JSON mà về trang đăng nhập của giao diện (D13) */
  // 'setup' chưa có trong hợp đồng – xem DE_NGHI_SUA_HOP_DONG.md N5
  private fail(res: Response, loi: 'domain' | 'locked' | 'expired' | 'state' | 'setup' | 'provider' | 'identity') {
    res.redirect(302, `${this.cfg.webOrigin}/dang-nhap?loi=${loi}`);
  }

  @Public()
  @Get('oidc/callback')
  async oidcCallback(@Req() req: Request, @Res() res: Response, @Query('code') code?: string, @Query('state') state?: string) {
    const ctx = getCtx(req);
    const cookieState = (req as any).cookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/api/v1/auth' });
    if (this.cfg.authMode !== 'oidc' || !code || !state || !cookieState || cookieState !== state) return this.fail(res, 'state');
    const st = await this.db.m.OAuthState.findOneAndDelete({ state, provider: 'oidc' }).lean<any>();
    if (!st || st.expiresAt.getTime() < Date.now() || !st.codeVerifier) return this.fail(res, st ? 'expired' : 'state');
    let claims: { iss: string; sub: string; email: string; email_verified?: boolean; name?: string; groups?: string[] };
    try { claims = await this.oidc.exchange(await this.oidc.discovery(), { code, verifier: st.codeVerifier, nonce: st.nonce, redirectUri: this.oidcRedirectUri }); }
    catch (error) {
      this.log.warn(`OIDC callback fail-closed: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
      return this.fail(res, 'provider');
    }

    const company = await this.db.m.Company.findOne({ domain: this.cfg.oidc.companyDomain }).lean<any>();
    if (!company) return this.fail(res, 'setup');
    const companyId = String(company._id);
    const cid = new Types.ObjectId(companyId);
    const email = claims.email.toLowerCase();
    let binding = await this.db.m.OidcIdentity.findOne({ issuer: claims.iss, subject: claims.sub }, undefined, { skipTenant: true }).lean<any>();
    let user: any;
    if (binding) {
      if (String(binding.companyId) !== companyId) return this.fail(res, 'identity');
      if (binding.active === false || binding.projectionPendingRevision != null) return this.fail(res, 'locked');
      user = await this.db.m.User.findOne({ _id: binding.userId, companyId: cid }).lean<any>();
      if (!user) return this.fail(res, 'identity');
    } else {
      if (claims.email_verified !== true) return this.fail(res, 'identity');
      // Không auto-link theo email, kể cả email đã verified: trùng email phải được admin xử lý tường minh.
      if (await this.db.m.User.exists({ companyId: cid, email })) return this.fail(res, 'identity');
      user = (await this.db.m.User.create({ companyId: cid, email, name: claims.name || email, systemRoles: this.oidc.roles(claims.groups) })).toObject();
      try {
        binding = (await this.db.m.OidcIdentity.create({ companyId: cid, issuer: claims.iss, subject: claims.sub, userId: user._id, email, groups: Array.isArray(claims.groups) ? claims.groups : [], lastSeenAt: new Date() })).toObject();
      } catch {
        await this.db.m.User.deleteOne({ _id: user._id, companyId: cid });
        return this.fail(res, 'identity');
      }
    }
    if (user.status === 'left' || user.isSuspended) return this.fail(res, 'locked');
    const roles = this.oidc.roles(claims.groups);
    const trustedEmail = claims.email_verified === true ? email : binding.email;
    await this.db.m.User.updateOne({ _id: user._id, companyId: cid }, { $set: { email: trustedEmail, name: claims.name || user.name, systemRoles: roles, lastLoginAt: new Date(), isSuspended: false } });
    await this.db.m.OidcIdentity.updateOne({ _id: binding._id, companyId: cid }, { $set: { email: trustedEmail, groups: Array.isArray(claims.groups) ? claims.groups : [], lastSeenAt: new Date() } });

    const oldSid = (req as any).cookies?.[SESSION_COOKIE];
    if (oldSid) await this.sessions.destroy(oldSid);
    const session = await this.sessions.create({ userId: String(user._id), companyId, ip: ctx.ip, device: ctx.device, authProvider: 'oidc', identityId: String(binding._id) });
    await this.audit.write({ companyId, userId: String(user._id), email, requestId: ctx.requestId, ip: ctx.ip, device: ctx.device }, { action: 'auth.oidc.login', objectType: 'user', objectId: String(user._id), after: { issuer: claims.iss, subject: claims.sub } });
    res.cookie(SESSION_COOKIE, session.sid, this.sessions.cookieOptions());
    res.redirect(302, `${this.cfg.webOrigin}${safeReturnTo(st.returnTo)}`);
  }

  @Public()
  @Get('google/callback')
  async callback(@Req() req: Request, @Res() res: Response, @Query('code') code?: string, @Query('state') state?: string) {
    const ctx = getCtx(req);
    const cookieState = (req as any).cookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/api/v1/auth' });
    if (!code || !state || !cookieState || cookieState !== state) return this.fail(res, 'state');
    const st = await this.db.m.OAuthState.findOneAndDelete({ state }).lean<any>();
    if (!st) return this.fail(res, 'state');
    if (st.expiresAt.getTime() < Date.now()) return this.fail(res, 'expired');

    let claims;
    try {
      claims = await this.google.auth.exchangeCode({ code, redirectUri: this.redirectUri });
    } catch {
      return this.fail(res, 'expired');
    }
    const domain = this.cfg.allowedDomain;
    const email = (claims.email || '').toLowerCase();
    // Không tin tham số hd một mình: kiểm lại hd và đuôi email trong id_token
    if (claims.nonce !== st.nonce) return this.fail(res, 'state');
    if (claims.hd !== domain || !email.endsWith(`@${domain}`) || claims.email_verified === false) return this.fail(res, 'domain');
    const company = await this.db.m.Company.findOne({ domain }).lean<any>();
    if (!company) {
      // Tài khoản hợp lệ nhưng CSDL chưa khởi tạo công ty: lỗi cấu hình máy chủ, không phải lỗi người dùng
      this.log.error(
        `Đăng nhập ${email} bị chặn: CSDL chưa có công ty tên miền ${domain}. ` +
          `Chạy: pnpm --filter api run khoi-tao -- --ten "<Tên công ty>" --mien ${domain}`,
      );
      return this.fail(res, 'setup');
    }
    const companyId = String(company._id);
    const dirUser = await this.google.directory.getUser(email);
    if (dirUser?.suspended) return this.fail(res, 'locked');

    const cid = new Types.ObjectId(companyId);
    let user = await this.db.m.User.findOne({ companyId: cid, email }).lean<any>();
    if (!user) {
      user = (await this.db.m.User.create({ companyId: cid, email, name: dirUser?.name ?? claims.name ?? email, title: dirUser?.title })).toObject();
    }
    if (user.status === 'left') return this.fail(res, 'locked');
    // Lần đầu (và mỗi lần) đăng nhập: gán phòng, vai trò theo nhóm Google
    const acc = await this.sync.computeAccess(companyId, email);
    await this.sync.applyAccess(companyId, String(user._id), acc);
    await this.db.m.User.updateOne({ _id: user._id, companyId: cid }, { $set: { lastLoginAt: new Date(), isSuspended: false } });

    const s = await this.sessions.create({ userId: String(user._id), companyId, ip: ctx.ip, device: ctx.device });
    await this.audit.write(
      { companyId, userId: String(user._id), email, requestId: ctx.requestId, ip: ctx.ip, device: ctx.device },
      { action: 'auth.login', objectType: 'user', objectId: String(user._id) },
    );
    res.cookie(SESSION_COOKIE, s.sid, this.sessions.cookieOptions());
    res.redirect(302, `${this.cfg.webOrigin}${safeReturnTo(st.returnTo)}`);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentCtx() ctx: Ctx, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy((req as any).cookies?.[SESSION_COOKIE]);
    await this.audit.record(ctx, { action: 'auth.logout', objectType: 'user', objectId: ctx.user.id });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
