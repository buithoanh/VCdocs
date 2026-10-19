import { Module, OnModuleInit } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../../notifications/notifications.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { dateVN } from '../../common/util';

@Module({ controllers: [NotificationsController] })
export class M14Module implements OnModuleInit {
  private lastDigest = '';
  constructor(private readonly scheduler: SchedulerService, private readonly notifications: NotificationsService) {}
  onModuleInit() {
    // Thư tổng hợp hằng ngày (digest = daily), gửi một lần mỗi ngày sau 7 giờ sáng giờ Việt Nam
    this.scheduler.add({
      name: 'notifications.dailyDigest',
      everyMs: 30 * 60_000,
      run: async () => {
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hour12: false }).format(new Date()));
        if (hour < 7 || this.lastDigest === dateVN()) return;
        this.lastDigest = dateVN();
        await this.notifications.sendDailyDigests();
      },
    });
  }
}
