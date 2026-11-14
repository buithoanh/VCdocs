import { Body, Controller, Get, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Ctx, CurrentCtx } from '../../common/context';
import { oid } from '../../common/util';
import { EvidenceService } from './evidence.service';

/** Gói bằng chứng (E17) */
@Controller('evidence-pack')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post()
  @HttpCode(202)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: { documentId?: string; recordId?: string }) {
    return { jobId: await this.evidence.request(ctx, body) };
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.evidence.toApi(await this.evidence.load(ctx, oid(id)));
  }

  @Get(':id/download')
  async download(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.evidence.load(ctx, oid(id));
    const buf = await this.evidence.download(ctx, p);
    const name: string = p.fileName ?? `evidence-${id}.zip`;
    const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return new StreamableFile(buf);
  }
}
