import { Module, OnModuleInit } from '@nestjs/common';
import { SchedulerService } from '../scheduler/scheduler.service';
import { AuditChainService } from './audit-chain.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditorAccessController } from './auditor-access.controller';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';

/** M15 Nhật ký (hợp đồng mục 10.4): xem nhật ký, kiểm chuỗi, mỏ neo, kiểm toán viên, gói bằng chứng */
@Module({ controllers: [AuditLogsController, AuditorAccessController, EvidenceController], providers: [AuditChainService, EvidenceService] })
export class M15Module implements OnModuleInit {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly chain: AuditChainService,
    private readonly evidence: EvidenceService,
  ) {}

  onModuleInit() {
    // E15: kiểm toàn chuỗi 01:00 hằng đêm; neo mã băm 07:00 thứ Hai
    this.scheduler.addDaily({ name: 'audit.verify', at: '01:00', run: (today) => this.chain.enqueueScheduled('audit.verify', today) });
    this.scheduler.addDaily({ name: 'audit.anchor', at: '07:00', weekday: 1, run: (today) => this.chain.enqueueScheduled('audit.anchor', today) });
    // E16, E17: quyền xem tạm hết hạn → expired; gói bằng chứng quá 7 ngày → xoá
    this.scheduler.add({ name: 'auditorAccess.expire', everyMs: 10 * 60_000, run: () => this.chain.expireAuditorAccess() });
    this.scheduler.add({ name: 'evidencePack.purge', everyMs: 3600_000, run: () => this.evidence.purgeExpired() });
  }
}
