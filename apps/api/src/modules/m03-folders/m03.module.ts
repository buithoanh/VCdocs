import { Global, Module, OnModuleInit } from '@nestjs/common';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { Db } from '../../db/db.service';
import { JobsService } from '../../jobs/jobs.service';
import { dateVN, addMonthsToDateStr } from '../../common/util';

@Global()
@Module({ controllers: [FoldersController], providers: [FoldersService], exports: [FoldersService] })
export class M03Module implements OnModuleInit {
  constructor(private readonly scheduler: SchedulerService, private readonly db: Db, private readonly jobs: JobsService) {}

  onModuleInit() {
    // Ngày 25 hằng tháng tự tạo thư mục tháng sau (US-03.2; ngày 25 là đề xuất, chờ chốt)
    this.scheduler.add({ name: 'folders.ensureNextMonth', everyMs: 6 * 3600_000, run: () => this.ensureNextMonth() });
  }

  async ensureNextMonth(today = dateVN()) {
    if (Number(today.slice(8, 10)) < 25) return;
    const month = addMonthsToDateStr(`${today.slice(0, 7)}-01`, 1).slice(0, 7);
    for (const c of await this.db.m.Company.find({}).lean<any[]>()) {
      const exists = await this.db.m.Job.findOne({ companyId: c._id, type: 'folder.ensure_periods', 'payload.month': month, 'payload.auto': true }).lean();
      if (exists) continue;
      const admin = await this.db.m.User.findOne({ companyId: c._id, systemRoles: { $in: ['R9', 'R3'] }, status: { $ne: 'left' } }).lean<any>();
      if (!admin) continue;
      await this.jobs.enqueueSystem(String(c._id), String(admin._id), 'folder.ensure_periods', { month, auto: true });
    }
  }
}
