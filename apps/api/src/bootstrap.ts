import 'reflect-metadata';
import { DynamicModule, INestApplication, Module, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { APP_CONFIG, AppConfig } from './config/config';
import { CoreModule } from './core.module';
import { FEATURE_MODULES } from './modules';
import { AuthGuard } from './common/auth.guard';
import { ContractInterceptor } from './common/contract.interceptor';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { AuditInterceptor } from './common/audit.interceptor';
import { PeopleInterceptor } from './common/people.interceptor';
import { ErrorFilter } from './common/error.filter';
import { requestContextMiddleware } from './common/request-id.middleware';
import { Db } from './db/db.service';
import { JobsService } from './jobs/jobs.service';
import { getContract } from './contract/openapi';
import { randomToken } from './common/util';

export const API_PREFIX = 'api/v1';

function rootModule(cfg: AppConfig): DynamicModule {
  @Module({})
  class ConfigHolder {}
  return {
    module: ConfigHolder,
    global: true,
    imports: [CoreModule, ...(FEATURE_MODULES as Type<any>[])],
    providers: [
      { provide: APP_CONFIG, useValue: cfg },
      { provide: APP_GUARD, useClass: AuthGuard },
      // Thứ tự: kiểm hợp đồng → chống lặp → ghi nhật ký → gắn people
      { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
      { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      { provide: APP_INTERCEPTOR, useClass: PeopleInterceptor },
      { provide: APP_FILTER, useClass: ErrorFilter },
    ],
    exports: [APP_CONFIG],
  };
}

/** Dựng app NestJS (dùng chung cho main.ts và test e2e) */
export async function createApp(cfg: AppConfig, opts: { logger?: boolean } = {}): Promise<INestApplication> {
  getContract(); // nạp hợp đồng sớm, sai file thì dừng ngay
  const app = await NestFactory.create<NestExpressApplication>(rootModule(cfg), {
    bodyParser: false,
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.enableCors({
    origin: [cfg.webOrigin],
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'X-Audit-Id', 'Retry-After', 'Idempotent-Replayed'],
  });
  app.use(requestContextMiddleware);
  app.use(cookieParser());
  // Webhook Nextcloud (Flow) gửi JSON không kèm Content-Type: đọc mọi kiểu thân là JSON, tối đa 256 KB
  app.use(`/${API_PREFIX}/flow/nextcloud/webhooks`, express.json({ limit: '256kb', type: () => true }));
  // Thân JSON ≤ 1 MB (hợp đồng mục 7); lỗi đọc thân trả đúng schema Error
  app.use(express.json({ limit: '1mb' }));
  app.use((err: any, req: any, res: any, next: any) => {
    if (!err) return next();
    const tooLarge = err.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION',
        message: tooLarge ? 'Dữ liệu gửi lên quá lớn (thân JSON tối đa 1 MB)' : 'Thân yêu cầu không phải JSON hợp lệ',
        requestId: req.ctx?.requestId ?? randomToken(8),
      },
    });
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.get(Db).ready();
  await app.init();
  app.get(JobsService).start();
  return app;
}
