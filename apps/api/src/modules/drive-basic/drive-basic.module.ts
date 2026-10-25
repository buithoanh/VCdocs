import { Module } from '@nestjs/common';
import { DriveBasicController } from './drive-basic.controller';
import { DriveBasicService } from './drive-basic.service';
import { FakeWorkspaceStorage, WORKSPACE_STORAGE } from './storage.port';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { NextcloudWorkspaceStorage } from './nextcloud-storage';

@Module({
  controllers: [DriveBasicController],
  providers: [DriveBasicService, FakeWorkspaceStorage,
    { provide: WORKSPACE_STORAGE, inject: [APP_CONFIG, FakeWorkspaceStorage],
      useFactory: (cfg: AppConfig, fake: FakeWorkspaceStorage) => cfg.workspaceStorage.mode === 'nextcloud'
        ? new NextcloudWorkspaceStorage(cfg.workspaceStorage) : fake }],
  exports: [DriveBasicService],
})
export class DriveBasicModule {}
