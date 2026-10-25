import { Module } from '@nestjs/common';
import { FlowController, FlowWebhookGuard } from './flow.controller';
import { FlowService } from './flow.service';

/** Chat14 Flow: receiver webhook Nextcloud, journal/idempotency, worker nền */
@Module({ controllers: [FlowController], providers: [FlowService, FlowWebhookGuard], exports: [FlowService] })
export class FlowModule {}
