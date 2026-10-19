import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { isObjectId, oid, toApi } from '../../common/util';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';

type Kind = 'Block' | 'Department' | 'Division';
const LABEL: Record<Kind, string> = { Block: 'khối', Department: 'phòng', Division: 'division' };
const UNIQUE: Record<Kind, string[]> = { Block: ['code'], Department: ['code', 'number', 'driveId'], Division: ['prefix'] };
const REFS: Record<Kind, string[]> = { Block: ['directorId'], Department: ['blockId', 'headId'], Division: [] };
const FIELDS: Record<Kind, string[]> = {
  Block: ['code', 'name', 'directorId'],
  Department: ['code', 'number', 'name', 'blockId', 'driveId', 'securityLevel', 'headId', 'groupEmails'],
  Division: ['prefix', 'name'],
};

/** M02 Danh mục nền: khối, phòng – drive, division. Xem: đã đăng nhập; sửa: R9, R3 */
@Controller()
export class CatalogController {
  constructor(private readonly db: Db, private readonly access: AccessService, private readonly audit: AuditService) {}

  private async list(ctx: Ctx, kind: Kind, sort: Record<string, 1>) {
    const rows = await this.db.m[kind].find({ companyId: new Types.ObjectId(ctx.companyId) }).sort(sort).lean();
    return { items: rows.map((r) => toApi(r)) };
  }

  private async check(ctx: Ctx, kind: Kind, body: any, selfId?: Types.ObjectId) {
    const cid = new Types.ObjectId(ctx.companyId);
    for (const f of UNIQUE[kind]) {
      if (body[f] === undefined) continue;
      const dup = await this.db.m[kind].findOne({ companyId: cid, [f]: body[f], ...(selfId ? { _id: { $ne: selfId } } : {}) }).lean();
      if (dup) throw Errors.duplicate(`Đã có ${LABEL[kind]} với ${f} = ${body[f]}`, [{ field: f, issue: 'duplicate' }]);
    }
    for (const f of REFS[kind]) {
      if (body[f] === undefined) continue;
      const model = f === 'blockId' ? this.db.m.Block : this.db.m.User;
      if (!isObjectId(body[f]) || !(await model.findOne({ companyId: cid, _id: body[f] }).lean())) {
        throw Errors.validation(`${f} không tồn tại`, [{ field: f, issue: 'not_found' }]);
      }
    }
  }

  private async create(ctx: Ctx, kind: Kind, body: any) {
    await this.check(ctx, kind, body);
    const me = new Types.ObjectId(ctx.user.id);
    const data: any = { companyId: new Types.ObjectId(ctx.companyId), createdBy: me, updatedBy: me };
    for (const f of FIELDS[kind]) if (body[f] !== undefined) data[f] = body[f];
    const row = (await this.db.m[kind].create(data)).toObject();
    this.access.invalidate(ctx.companyId);
    await this.audit.record(ctx, { action: `${kind.toLowerCase()}.create`, objectType: kind.toLowerCase(), objectId: String(row._id), after: data });
    return toApi(row);
  }

  private async update(ctx: Ctx, kind: Kind, id: string, body: any) {
    const filter = { _id: oid(id), companyId: new Types.ObjectId(ctx.companyId) };
    const before = await this.db.m[kind].findOne(filter).lean<any>();
    if (!before) throw Errors.notFound(`Không tìm thấy ${LABEL[kind]}`);
    await this.check(ctx, kind, body, before._id);
    const set: any = { updatedBy: new Types.ObjectId(ctx.user.id) };
    const unset: any = {};
    for (const f of FIELDS[kind]) {
      if (body[f] !== undefined) set[f] = body[f];
      else if (before[f] !== undefined && !['code', 'name', 'number', 'driveId', 'securityLevel', 'prefix'].includes(f)) unset[f] = 1;
    }
    await this.db.m[kind].updateOne(filter, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    const after = await this.db.m[kind].findOne(filter).lean<any>();
    this.access.invalidate(ctx.companyId);
    await this.audit.record(ctx, { action: `${kind.toLowerCase()}.update`, objectType: kind.toLowerCase(), objectId: id, before, after });
    return toApi(after);
  }

  @Get('blocks')
  blocks(@CurrentCtx() ctx: Ctx) {
    return this.list(ctx, 'Block', { code: 1 });
  }
  @Post('blocks')
  @Roles('R9', 'R3')
  createBlock(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.create(ctx, 'Block', body);
  }
  @Patch('blocks/:id')
  @Roles('R9', 'R3')
  updateBlock(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.update(ctx, 'Block', id, body);
  }

  @Get('departments')
  departments(@CurrentCtx() ctx: Ctx) {
    return this.list(ctx, 'Department', { number: 1 });
  }
  @Post('departments')
  @Roles('R9', 'R3')
  createDepartment(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.create(ctx, 'Department', body);
  }
  @Patch('departments/:id')
  @Roles('R9', 'R3')
  updateDepartment(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.update(ctx, 'Department', id, body);
  }

  @Get('divisions')
  divisions(@CurrentCtx() ctx: Ctx) {
    return this.list(ctx, 'Division', { prefix: 1 });
  }
  @Post('divisions')
  @Roles('R9', 'R3')
  createDivision(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    return this.create(ctx, 'Division', body);
  }
  @Patch('divisions/:id')
  @Roles('R9', 'R3')
  updateDivision(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: any) {
    return this.update(ctx, 'Division', id, body);
  }
}
