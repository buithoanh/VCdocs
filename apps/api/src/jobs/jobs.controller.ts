import { Controller, Get, Param } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../common/context';
import { Errors } from '../common/errors';
import { pageResult, parsePage } from '../common/pagination';
import { oid, toApi } from '../common/util';

export function jobToApi(j: any) {
  return toApi(j, ['payload', 'lockedUntil', 'attempts', 'requestId']);
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly db: Db) {}

  /** mine=true (mặc định) chỉ việc của tôi; R9 xem được tất cả */
  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['createdAt', 'updatedAt', 'status', 'type']);
    const filter: any = { companyId: new Types.ObjectId(ctx.companyId) };
    if (q.mine !== false || !ctx.user.systemRoles.includes('R9')) filter.requestedBy = new Types.ObjectId(ctx.user.id);
    const [items, total] = await Promise.all([
      this.db.m.Job.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean(),
      this.db.m.Job.countDocuments(filter),
    ]);
    return pageResult(items.map(jobToApi), p, total);
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const j = await this.db.m.Job.findOne({ _id: oid(id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    if (!j || (String(j.requestedBy) !== ctx.user.id && !ctx.user.systemRoles.includes('R9'))) throw Errors.notFound('Không tìm thấy việc');
    return jobToApi(j);
  }
}
