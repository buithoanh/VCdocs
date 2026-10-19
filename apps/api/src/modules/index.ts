import { M01Module } from './m01-auth/m01.module';
import { M02Module } from './m02-catalog/m02.module';
import { M03Module } from './m03-folders/m03.module';
import { M04Module } from './m04-documents/m04.module';
import { M05Module } from './m05-approvals/m05.module';
import { M06Module } from './m06-record-types/m06.module';
import { M07Module } from './m07-records/m07.module';
import { SharedModule } from './shared/shared.module';
import { M14Module } from './m14-notifications/m14.module';
import { JobsApiModule } from './jobs.module';
import { SeedModule } from '../seed/seed.module';
import { SchedulerModule } from './scheduler/scheduler.module';

/** Mỗi phân hệ là một module (BA 9.1) */
export const FEATURE_MODULES = [SharedModule, M01Module, M02Module, M03Module, M04Module, M05Module, M06Module, M07Module, M14Module, JobsApiModule, SeedModule, SchedulerModule];
