import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { FakeGoogle } from '../../google/fake/fake-google';
import { Public } from '../../common/decorators';
import { Errors } from '../../common/errors';

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * CHỈ CHẠY VỚI GOOGLE_MODE=fake, không thuộc hợp đồng: trang "đăng nhập Google
 * giả" để chọn người dùng mẫu khi chạy local.
 */
@Controller('dev')
export class DevFakeGoogleController {
  constructor(@Inject(GOOGLE) private readonly google: GooglePorts, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Public()
  @Get('fake-google')
  page(@Query() q: Record<string, string>, @Res() res: Response) {
    if (this.google.mode !== 'fake') throw Errors.notFound();
    const fake = this.google as FakeGoogle;
    const cb = q.redirect_uri || `${this.cfg.publicApiOrigin}/api/v1/auth/google/callback`;
    const link = (email: string) => `${cb}?state=${encodeURIComponent(q.state || '')}&code=${encodeURIComponent(`fake|${email}|${q.nonce || ''}`)}`;
    const rows = fake.world.users
      .map((u) => `<li><a href="${esc(link(u.email))}">${esc(u.name)}</a> <small>${esc(u.email)}</small></li>`)
      .join('');
    res.type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Đăng nhập Google giả</title>` +
        `<body style="font-family:sans-serif;max-width:560px;margin:40px auto">` +
        `<h2>Đăng nhập Google (giả lập)</h2><p>Chỉ dùng khi chạy local, không phải Google thật.</p><ul>${rows}</ul>` +
        `<p>Thử tài khoản ngoài tên miền: <a href="${esc(link('nguoila@gmail.com'))}">nguoila@gmail.com</a></p></body>`,
    );
  }
}
