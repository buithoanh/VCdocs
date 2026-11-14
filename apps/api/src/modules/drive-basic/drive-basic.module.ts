import { Module } from '@nestjs/common';
import { DriveBasicController } from './drive-basic.controller';
import { DriveBasicService } from './drive-basic.service';
import { FakeWorkspaceStorage, WORKSPACE_STORAGE, WorkspaceStoragePort } from './storage.port';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { NextcloudWorkspaceStorage } from './nextcloud-storage';
import { StorageCredentialStore } from './storage-credential.store';
import { disabledPort } from '../../common/workspace-modules';

@Module({
  controllers: [DriveBasicController],
  providers: [DriveBasicService, FakeWorkspaceStorage, StorageCredentialStore,
    { provide: WORKSPACE_STORAGE, inject: [APP_CONFIG, FakeWorkspaceStorage, StorageCredentialStore],
      useFactory: (cfg: AppConfig, fake: FakeWorkspaceStorage, credentials: StorageCredentialStore) => cfg.workspaceStorage.mode === 'nextcloud'
        ? new NextcloudWorkspaceStorage(cfg.workspaceStorage, { production: cfg.nodeEnv === 'production', credentials })
        : cfg.workspaceStorage.mode === 'disabled' ? disabledPort<WorkspaceStoragePort>('drive') : fake }],
  exports: [DriveBasicService, StorageCredentialStore],
})
export class DriveBasicModule {}
