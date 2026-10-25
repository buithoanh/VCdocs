import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, getCtx, VQuery } from '../../common/context';
import { Public, Roles, SkipCsrf } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { oid } from '../../common/util';
import { FlowService } from './flow.service';

export const FLOW_TOKEN_HEADER = 'x-vcw-flow-token';

/** Xác thực header bí mật trước mọi bước đọc payload (guard chạy trước kiểm hợp đồng) */
@Injectable()
export class FlowWebhookGuard implements CanActivate {
  private readonly log = new Logger('FlowWebhook');
  private lastWarn = 0;
  constructor(private readonly flow: FlowService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (this.flow.authenticate(req.header(FLOW_TOKEN_HEADER) ?? undefined)) return true;
    // Không ghi audit cho request chưa xác thực (tránh làm đầy chuỗi audit); chỉ log có giới hạn
    if (Date.now() - this.lastWarn > 10_000) {
      this.lastWarn = Date.now();
      this.log.warn(`Từ chối webhook Flow không có/sai header bí mật từ ${req.ip}`);
    }
    throw Errors.unauthenticated('Thiếu hoặc sai header bí mật Flow');
  }
}

/** Chat14 Flow: receiver webhook Nextcloud và journal cho R9 */
@Controller('flow')
export class FlowController {
  constructor(private readonly flow: FlowService, private readonly db: Db) {}

  @Post('nextcloud/webhooks')
  @Public()
  @SkipCsrf()
  @UseGuards(FlowWebhookGuard)
  @HttpCode(202)
  receive(@Req() req: Request, @Body() body: any) {
    return this.flow.ingest(getCtx(req), body);
  }

  @Get('events')
  @Roles('R9')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['receivedAt', 'eventTime'], '-receivedAt');
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.status) filter.status = q.status;
    if (q.ruleId) filter.ruleIds = q.ruleId;
    if (q.resourceKey) filter.resourceKey = q.resourceKey;
    const [items, total] = await Promise.all([
      this.db.m.FlowEvent.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean<any[]>(),
      this.db.m.FlowEvent.countDocuments(filter),
    ]);
    return pageResult(items.map((e) => this.flow.toApi(e)), p, total);
  }

  @Get('events/:id')
  @Roles('R9')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const ev = await this.db.m.FlowEvent.findOne({ companyId: new Types.ObjectId(ctx.companyId), _id: oid(id) }).lean<any>();
    if (!ev) throw Errors.notFound('Không tìm thấy event Flow');
    return this.flow.toApi(ev);
  }
}
