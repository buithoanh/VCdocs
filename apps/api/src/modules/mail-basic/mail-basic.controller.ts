import { Body, Controller, Get, Header, Headers, HttpCode, Param, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentCtx, Ctx } from '../../common/context';
import { Errors } from '../../common/errors';
import { Roles } from '../../common/decorators';
import { MailBasicService } from './mail-basic.service';
@Controller('mail')
export class MailBasicController {
  constructor(private readonly service: MailBasicService) {}
  @Get('messages') list(@CurrentCtx() ctx: Ctx, @Query('folder') folder?: string, @Query('mailbox') mailbox?: string, @Query('q') q?: string, @Query('scope') scope?: string, @Query('label') label?: string) { return this.service.list(ctx, { folder, mailbox, q, scope, label }); }
  @Get('threads/:id') thread(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('mailbox') mailbox?: string) { return this.service.thread(ctx, id, mailbox); }
  @Post('drafts') @HttpCode(201) draft(@CurrentCtx() ctx: Ctx, @Body() body: any) { return this.service.createDraft(ctx, body); }
  @Get('drafts/:id') getDraft(@CurrentCtx() ctx: Ctx, @Param('id') id: string) { return this.service.draft(ctx, id); }
  @Patch('drafts/:id') updateDraft(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) { return this.service.updateDraft(ctx, id, body); }
  @Post('send') @HttpCode(201) @UseInterceptors(FilesInterceptor('attachments', 8, { limits: { fileSize: 10 * 1024 * 1024 } }))
  send(@CurrentCtx() ctx: Ctx, @Body() body: any, @UploadedFiles() files: Express.Multer.File[], @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    let to: string[]; let references: string[] | undefined;
    try { to = typeof body.to === 'string' ? JSON.parse(body.to) : body.to; references = typeof body.references === 'string' ? JSON.parse(body.references) : body.references; }
    catch { throw Errors.validation('Danh sách địa chỉ hoặc References không hợp lệ'); }
    const parsed = { ...body, to, references };
    return this.service.send(ctx, parsed, key, files ?? []);
  }
  @Get('messages/:id/raw') @Header('Cache-Control', 'private, no-store') async raw(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('mailbox') mailbox: string | undefined, @Res() res: Response) {
    const raw = await this.service.raw(ctx, id, mailbox); res.type('message/rfc822').setHeader('Content-Disposition', 'attachment; filename="message.eml"'); res.send(raw);
  }
  @Get('labels') labels(@CurrentCtx() ctx: Ctx, @Query('mailbox') mailbox?: string) { return this.service.labels(ctx, mailbox); }
  @Post('labels') @HttpCode(201) createLabel(@CurrentCtx() ctx: Ctx, @Body() body: any, @Query('mailbox') mailbox?: string) { return this.service.createLabel(ctx, body, mailbox); }
  @Patch('messages/:id/labels') setLabels(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('mailbox') mailbox: string | undefined, @Body() body: any) { return this.service.setLabels(ctx, id, body, mailbox); }
  @Get('filters') filters(@CurrentCtx() ctx: Ctx) { return this.service.filters(ctx); }
  @Post('filters') @HttpCode(201) createFilter(@CurrentCtx() ctx: Ctx, @Body() body: any) { return this.service.createFilter(ctx, body); }
  @Patch('filters/:id') updateFilter(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) { return this.service.updateFilter(ctx, id, body); }
  @Get('aliases') aliases(@CurrentCtx() ctx: Ctx) { return this.service.aliases(ctx); }
  @Post('aliases') @HttpCode(201) createAlias(@CurrentCtx() ctx: Ctx, @Body() body: any) { return this.service.createAlias(ctx, body); }
  @Get('shared-mailboxes') sharedMailboxes(@CurrentCtx() ctx: Ctx) { return this.service.sharedMailboxes(ctx); }
  @Post('shared-mailboxes') @HttpCode(201) createSharedMailbox(@CurrentCtx() ctx: Ctx, @Body() body: any) { return this.service.createSharedMailbox(ctx, body); }
  @Patch('shared-mailboxes/:id/members') setSharedMembers(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) { return this.service.setSharedMembers(ctx, id, body); }
  @Post('offboarding/:userId') @Roles('R3','R9') offboardUser(@CurrentCtx() ctx:Ctx,@Param('userId') userId:string){return this.service.offboardUser(ctx,userId);}
}
