import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { oid } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { HandoversService } from './handovers.service';

/** M10 Bàn giao (hợp đồng mục 10.3) */
@Controller('handovers')
export class HandoversController {
  constructor(private readonly db: Db, private readonly handovers: HandoversService, private readonly access: AccessService) {}

  /** R1, R3, R9 tất cả; R2 khối mình; người nghỉ, người nhận biên bản của mình (E12) */
  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['createdAt', 'updatedAt', 'lastWorkingDay', 'status']);
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (!this.access.hasRole(ctx, 'R1', 'R3', 'R9')) {
      const me = new Types.ObjectId(ctx.user.id);
      const depts = [...(await this.access.blockDeptIds(ctx))].map((x) => new Types.ObjectId(x));
      filter.$or = [{ userId: me }, { receiverId: me }, ...(depts.length ? [{ departmentId: { $in: depts } }] : [])];
    }
    for (const k of ['userId', 'receiverId', 'departmentId']) if (q[k]) filter[k] = new Types.ObjectId(q[k]);
    if (q.status) filter.status = q.status;
    const [items, total] = await Promise.all([
      this.db.m.Handover.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean<any[]>(),
      this.db.m.Handover.countDocuments(filter),
    ]);
    return pageResult(items.map((h) => this.handovers.toApi(ctx, h, false)), p, total);
  }

  @Post()
  @Roles('R3')
  @HttpCode(202)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: { userId: string; lastWorkingDay: string; receiverId?: string; note?: string }) {
    const r = await this.handovers.createManual(ctx, body);
    return { jobId: r.jobId, handoverId: String(r.handover._id) };
  }

  private async load(ctx: Ctx, id: string) {
    const h = await this.handovers.load(ctx.companyId, oid(id));
    if (!h) throw Errors.notFound('Không tìm thấy biên bản bàn giao');
    if (!(await this.handovers.canView(ctx, h))) throw Errors.forbidden('Bạn không được xem biên bản bàn giao này');
    return h;
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.handovers.toApi(ctx, await this.load(ctx, id), true);
  }

  @Patch(':id')
  async update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { receiverId?: string; note?: string }) {
    return this.handovers.toApi(ctx, await this.handovers.update(ctx, await this.load(ctx, id), body), true);
  }

  @Patch(':id/items/:itemId')
  async updateItem(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: { action?: string; toUserId?: string; note?: string }) {
    return this.handovers.toApi(ctx, await this.handovers.updateItem(ctx, await this.load(ctx, id), itemId, body), true);
  }

  @Post(':id/refresh')
  @HttpCode(202)
  async refresh(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return { jobId: await this.handovers.refresh(ctx, await this.load(ctx, id)) };
  }

  @Post(':id/confirm-receiver')
  @HttpCode(200)
  async confirm(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.handovers.toApi(ctx, await this.handovers.confirmReceiver(ctx, await this.load(ctx, id), body?.note), true);
  }

  @Post(':id/verify')
  @HttpCode(200)
  async verify(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { note?: string; lateReason?: string }) {
    return this.handovers.toApi(ctx, await this.handovers.verify(ctx, await this.load(ctx, id), body ?? {}), true);
  }

  @Post(':id/execute')
  @HttpCode(202)
  async execute(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return { jobId: await this.handovers.execute(ctx, await this.load(ctx, id)) };
  }

  @Post(':id/export')
  @HttpCode(202)
  async export(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return { jobId: await this.handovers.export(ctx, await this.load(ctx, id)) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.handovers.toApi(ctx, await this.handovers.cancel(ctx, await this.load(ctx, id), body.reason), true);
  }
}
