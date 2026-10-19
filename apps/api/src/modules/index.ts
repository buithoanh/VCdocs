import { M01Module } from './m01-auth/m01.module';
import { M14Module } from './m14-notifications/m14.module';
import { JobsApiModule } from './jobs.module';
import { SeedModule } from '../seed/seed.module';
import { SchedulerModule } from './scheduler/scheduler.module';

/** Mỗi phân hệ là một module (BA 9.1) */
export const FEATURE_MODULES = [M01Module, M14Module, JobsApiModule, SeedModule, SchedulerModule];
