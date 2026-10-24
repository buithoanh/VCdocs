import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentCtx, Ctx } from '../../common/context';
import { Errors } from '../../common/errors';
import { WorkspaceInteropService } from './workspace-interop.service';

@Controller()
export class WorkspaceInteropController {
  constructor(private readonly interop: WorkspaceInteropService) {}
  @Post('mail/messages/:messageId/attachments/:part/save-to-drive') @HttpCode(201)
  save(@CurrentCtx() ctx: Ctx, @Param('messageId') messageId: string, @Param('part') part: string,
    @Query('mailbox') mailbox: string | undefined, @Body() body: any, @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    return this.interop.saveAttachment(ctx, messageId, Number(part), mailbox, body, key);
  }
  @Post('mail/send-drive-file') @HttpCode(201)
  send(@CurrentCtx() ctx: Ctx, @Body() body: any, @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    return this.interop.sendDriveFile(ctx, body, key);
  }
  @Get('drive/shared-links/:token') @Header('Cache-Control', 'private, no-store')
  async download(@CurrentCtx() ctx: Ctx, @Param('token') token: string, @Res() res: Response) {
    const output = await this.interop.downloadLink(ctx, token);
    res.type(output.mimeType).setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(output.name)}`);
    res.setHeader('X-Content-SHA256', output.sha256); res.send(output.bytes);
  }
}
