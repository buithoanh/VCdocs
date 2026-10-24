import { Body, Controller, Get, Header, Headers, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentCtx, Ctx, VQuery } from '../../common/context';
import { Errors } from '../../common/errors';
import { DriveBasicService } from './drive-basic.service';
import { Public, SkipCsrf } from '../../common/decorators';

@Controller()
export class DriveBasicController {
  constructor(private readonly drive: DriveBasicService) {}
  @Get('spaces') spaces(@CurrentCtx() ctx: Ctx) { return this.drive.spaces(ctx); }
  @Get('drive/items') items(@CurrentCtx() ctx: Ctx, @VQuery() query: any) {
    return this.drive.items(ctx, query.spaceId, query.parentId);
  }
  @Post('drive/folders') @HttpCode(201)
  createFolder(@CurrentCtx() ctx: Ctx, @Body() body: any) { return this.drive.createFolder(ctx, body); }
  @Post('drive/files') @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@CurrentCtx() ctx: Ctx, @Body() body: any, @UploadedFile() file: Express.Multer.File,
    @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    return this.drive.upload(ctx, body, file, key);
  }
  @Post('drive/documents') @HttpCode(201)
  createDocument(@CurrentCtx() ctx: Ctx, @Body() body: any, @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    return this.drive.createDocument(ctx, body, key);
  }
  @Post('drive/spreadsheets') @HttpCode(201)
  createSpreadsheet(@CurrentCtx() ctx: Ctx, @Body() body: any, @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    return this.drive.createSpreadsheet(ctx, body, key);
  }
  @Post('drive/presentations') @HttpCode(201)
  createPresentation(@CurrentCtx() ctx: Ctx, @Body() body: any, @Headers('idempotency-key') key?: string) {
    if (!key) throw Errors.validation('Thiếu Idempotency-Key');
    return this.drive.createPresentation(ctx, body, key);
  }
  @Get('drive/files/:fileId') file(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string) {
    return this.drive.file(ctx, id);
  }
  @Get('drive/files/:fileId/content') @Header('Cache-Control', 'private, no-store')
  async content(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string, @Res() response: Response) {
    const { meta, bytes } = await this.drive.content(ctx, id);
    const name = String(meta.name).replace(/["\r\n]/g, '_');
    response.setHeader('Content-Type', meta.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    response.setHeader('X-Content-SHA256', meta.contentSha256);
    response.send(bytes);
  }
  @Patch('drive/items/:itemId')
  updateItem(@CurrentCtx() ctx: Ctx, @Param('itemId') id: string, @Body() body: any) {
    return this.drive.updateItem(ctx, id, body);
  }
  @Post('drive/files/:fileId/versions') @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadVersion(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.drive.uploadVersion(ctx, id, file);
  }
  @Get('drive/files/:fileId/versions')
  versions(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string) { return this.drive.versions(ctx, id); }
  @Post('drive/files/:fileId/versions/:versionId/restore') @HttpCode(200)
  restoreVersion(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string, @Param('versionId') versionId: string) {
    return this.drive.restoreVersion(ctx, id, versionId);
  }
  @Post('drive/items/:itemId/trash') @HttpCode(200)
  trash(@CurrentCtx() ctx: Ctx, @Param('itemId') id: string) { return this.drive.trash(ctx, id); }
  @Get('drive/trash')
  trashItems(@CurrentCtx() ctx: Ctx, @VQuery() query: any) { return this.drive.trashItems(ctx, query.spaceId); }
  @Post('drive/items/:itemId/restore') @HttpCode(200)
  restoreItem(@CurrentCtx() ctx: Ctx, @Param('itemId') id: string) { return this.drive.restoreItem(ctx, id); }

  @Get('drive/files/:fileId/editor-config')
  editorConfig(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string) { return this.drive.editorConfig(ctx, id); }

  @Get('drive/files/:fileId/export') @Header('Cache-Control', 'private, no-store')
  async exportDocument(@CurrentCtx() ctx: Ctx, @Param('fileId') id: string, @VQuery() query: any, @Res() response: Response) {
    const output = await this.drive.exportDocument(ctx, id, query.format);
    response.setHeader('Content-Type', output.mimeType);
    const ascii = output.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_');
    response.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(output.name)}`);
    response.send(output.bytes);
  }

  @Public() @Get('drive/editor/content') @Header('Cache-Control', 'private, no-store')
  async editorContent(@Query('ticket') ticket: string, @Res() response: Response) {
    const { row, bytes } = await this.drive.editorContent(ticket);
    response.setHeader('Content-Type', row.mimeType);
    response.setHeader('Content-Length', bytes.length);
    response.send(bytes);
  }

  @Public() @SkipCsrf() @Post('drive/editor/callback') @HttpCode(200)
  async editorCallback(@Query('ticket') ticket: string, @Body() body: any, @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response) {
    const result: any = await this.drive.editorCallback(ticket, body, authorization);
    if (result.auditId) response.setHeader('X-Audit-Id', result.auditId);
    return { error: result.error };
  }
}
