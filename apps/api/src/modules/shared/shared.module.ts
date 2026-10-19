import { Global, Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { DriveOpsService } from './drive-ops.service';

@Global()
@Module({ providers: [ExportService, DriveOpsService], exports: [ExportService, DriveOpsService] })
export class SharedModule {}
