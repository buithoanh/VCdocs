import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Errors } from '../../common/errors';
import { pageResult, parsePage } from '../../common/pagination';
import { oid, toApi } from '../../common/util';
import { DEFAULT_SETTINGS } from '../../notifications/notifications.service';
import { AuditService } from '../../audit/audit.service';

function notifToApi(n: any) {
  const o: any = toApi(n, ['companyId', 'userId', 'emailState', 'updatedAt', 'createdBy', 'updatedBy']);
  return o;
}

/** M14 Thông báo trong ứng dụng và kênh nhận */
@Controller()
export class NotificationsController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private mine(ctx: Ctx) {
    return { companyId: new Types.ObjectId(ctx.companyId), userId: new Types.ObjectId(ctx.user.id) };
  }

  @Get('notifications')
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const p = parsePage(q, ['createdAt']);
    const filter: any = this.mine(ctx);
    if (q.unread === true) filter.isRead = false;
    const [items, total, unreadCount] = await Promise.all([
      this.db.m.Notification.find(filter).sort(p.sort).skip(p.skip).limit(p.limit).lean(),
      this.db.m.Notification.countDocuments(filter),
      this.db.m.Notification.countDocuments({ ...this.mine(ctx), isRead: false }),
    ]);
    return { ...pageResult(items.map(notifToApi), p, total), unreadCount };
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentCtx() ctx: Ctx) {
    const r = await this.db.m.Notification.updateMany({ ...this.mine(ctx), isRead: false }, { $set: { isRead: true } });
    await this.audit.record(ctx, { action: 'notification.read_all', objectType: 'notification', after: { count: r.modifiedCount } });
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const r = await this.db.m.Notification.updateOne({ ...this.mine(ctx), _id: oid(id) }, { $set: { isRead: true } });
    if (!r.matchedCount) throw Errors.notFound('Không tìm thấy thông báo');
    await this.audit.record(ctx, { action: 'notification.read', objectType: 'notification', objectId: id });
  }

  @Get('notification-settings')
  async getSettings(@CurrentCtx() ctx: Ctx) {
    const u = await this.db.m.User.findOne({ _id: new Types.ObjectId(ctx.user.id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    return u?.notificationSettings ?? DEFAULT_SETTINGS;
  }

  @Patch('notification-settings')
  async patchSettings(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    if (body.channels?.includes('zalo')) {
      throw Errors.rule(undefined, 'Kênh Zalo chưa dùng được (từ giai đoạn 3)', [{ field: 'channels', issue: 'zalo_not_available' }]);
    }
    const filter = { _id: new Types.ObjectId(ctx.user.id), companyId: new Types.ObjectId(ctx.companyId) };
    const before = (await this.db.m.User.findOne(filter).lean<any>())?.notificationSettings ?? DEFAULT_SETTINGS;
    const settings = { channels: [...new Set<string>(body.channels)], digest: body.digest };
    await this.db.m.User.updateOne(filter, { $set: { notificationSettings: settings } });
    await this.audit.record(ctx, { action: 'notification_settings.update', objectType: 'user', objectId: ctx.user.id, before, after: settings });
    return settings;
  }
}
