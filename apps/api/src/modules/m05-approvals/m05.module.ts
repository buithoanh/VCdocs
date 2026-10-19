import { Global, Module } from '@nestjs/common';
import { ApprovalsController, DelegationsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Global()
@Module({ controllers: [ApprovalsController, DelegationsController], providers: [ApprovalsService], exports: [ApprovalsService] })
export class M05Module {}
