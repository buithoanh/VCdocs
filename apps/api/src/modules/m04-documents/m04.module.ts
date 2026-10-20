import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SchedulerService } from '../scheduler/scheduler.service';

@Module({ controllers: [DocumentsController], providers: [DocumentsService], exports: [DocumentsService] })
export class M04Module implements OnModuleInit {
  constructor(private readonly ref: ModuleRef, private readonly scheduler: SchedulerService) {}
  onModuleInit() {
    const ctrl = this.ref.get(DocumentsController);
    this.scheduler.add({ name: 'documents.relockExpired', everyMs: 15 * 60_000, run: () => ctrl.relockExpired() });
  }
}
