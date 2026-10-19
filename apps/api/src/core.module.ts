import { Global, Module } from '@nestjs/common';
import { Db } from './db/db.service';
import { AuditService } from './audit/audit.service';
import { SessionService } from './session/session.service';
import { AccessService } from './access/access.service';
import { JobsService } from './jobs/jobs.service';
import { NotificationsService } from './notifications/notifications.service';
import { GoogleModule } from './google/google.module';

/** Dịch vụ dùng chung mọi phân hệ */
@Global()
@Module({
  imports: [GoogleModule],
  providers: [Db, AuditService, SessionService, AccessService, JobsService, NotificationsService],
  exports: [Db, AuditService, SessionService, AccessService, JobsService, NotificationsService, GoogleModule],
})
export class CoreModule {}
