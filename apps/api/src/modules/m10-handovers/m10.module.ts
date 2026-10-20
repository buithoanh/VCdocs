import { Global, Module, OnModuleInit } from '@nestjs/common';
import { HandoversController } from './handovers.controller';
import { HandoversService } from './handovers.service';
import { SchedulerService } from '../scheduler/scheduler.service';

@Global()
@Module({ controllers: [HandoversController], providers: [HandoversService], exports: [HandoversService] })
export class M10Module implements OnModuleInit {
  constructor(private readonly scheduler: SchedulerService, private readonly handovers: HandoversService) {}

  onModuleInit() {
    // 00:30 hằng ngày: qua ngày làm việc cuối → left, báo bàn giao quá hạn (E9)
    this.scheduler.addDaily({ name: 'handovers.markLeft', at: '00:30', run: (today) => this.handovers.markLeft(today) });
    this.scheduler.add({ name: 'handovers.remindVerifyDue', everyMs: 6 * 3600_000, run: () => this.handovers.remindVerifyDue() });
  }
}
