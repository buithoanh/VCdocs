import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { Public } from '../../common/decorators';
import { Ctx, CurrentCtx, getCtx } from '../../common/context';
import { Errors } from '../../common/errors';
import { randomToken } from '../../common/util';
import { OAUTH_COOKIE, SESSION_COOKIE, SessionService } from '../../session/session.service';
import { AuditService } from '../../audit/audit.service';
import { GoogleSyncService } from './google-sync.service';

function safeReturnTo(v?: string): string {
  // Chỉ nhận đường dẫn tương đối trong giao diện, chặn chuyển hướng ra ngoài
  if (!v || typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.length > 500) return '/';
  return v;
}

/** M01: đăng nhập Google OAuth, chỉ tài khoản @vcprosperous.com (BR-15) */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: Db,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly sync: GoogleSyncService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private get redirectUri() {
    return `${this.cfg.publicApiOrigin}/api/v1/auth/google/callback`;
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
  @Get('google/callback')
  async callback(@Req() req: Request, @Res() res: Response, @Query('code') code?: string, @Query('state') state?: string) {
    const ctx = getCtx(req);
    const cookieState = (req as any).cookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/api/v1/auth' });
    if (!code || !state || !cookieState || cookieState !== state) throw Errors.forbidden('Phiên đăng nhập không hợp lệ hoặc đã hết hạn, hãy đăng nhập lại');
    const st = await this.db.m.OAuthState.findOneAndDelete({ state }).lean<any>();
    if (!st || st.expiresAt.getTime() < Date.now()) throw Errors.forbidden('Phiên đăng nhập không hợp lệ hoặc đã hết hạn, hãy đăng nhập lại');

    const claims = await this.google.auth.exchangeCode({ code, redirectUri: this.redirectUri });
    const domain = this.cfg.allowedDomain;
    const email = (claims.email || '').toLowerCase();
    // Không tin tham số hd một mình: kiểm lại hd và đuôi email trong id_token
    if (claims.nonce !== st.nonce) throw Errors.forbidden('Phiên đăng nhập không hợp lệ, hãy đăng nhập lại');
    if (claims.hd !== domain || !email.endsWith(`@${domain}`) || claims.email_verified === false) {
      throw Errors.forbidden(`Không có quyền: chỉ tài khoản @${domain} được đăng nhập VCdocs`);
    }
    const company = await this.db.m.Company.findOne({ domain }).lean<any>();
    if (!company) throw Errors.forbidden('Công ty chưa được cấu hình trong VCdocs');
    const companyId = String(company._id);
    const dirUser = await this.google.directory.getUser(email);
    if (dirUser?.suspended) throw Errors.forbidden('Tài khoản Google đã bị khoá');

    const cid = new Types.ObjectId(companyId);
    let user = await this.db.m.User.findOne({ companyId: cid, email }).lean<any>();
    if (!user) {
      user = (await this.db.m.User.create({ companyId: cid, email, name: dirUser?.name ?? claims.name ?? email, title: dirUser?.title })).toObject();
    }
    if (user.status === 'left') throw Errors.forbidden('Tài khoản đã nghỉ việc, không vào được VCdocs');
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
