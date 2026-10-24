import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DevFakeGoogleController } from './dev-fake-google.controller';
import { DrivesController } from './drives.controller';
import { MeController, UsersController } from './users.controller';
import { GoogleSyncService } from './google-sync.service';
import { OidcService } from './oidc.service';
import { IdentityLifecycleController } from './identity-lifecycle.controller';
import { IdentityLifecycleService } from './identity-lifecycle.service';
import { FakeIdentityLifecyclePort, IDENTITY_LIFECYCLE_PORT, LocalIdentityLifecyclePort } from './identity-lifecycle.port';
import { APP_CONFIG, AppConfig } from '../../config/config';

@Module({
  controllers: [AuthController, MeController, UsersController, DrivesController, DevFakeGoogleController, IdentityLifecycleController],
  providers: [GoogleSyncService, OidcService, IdentityLifecycleService, { provide: IDENTITY_LIFECYCLE_PORT, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => cfg.identityLifecycle.mode === 'local' ? new LocalIdentityLifecyclePort(cfg.identityLifecycle) : new FakeIdentityLifecyclePort() }],
  exports: [GoogleSyncService],
})
export class M01Module {}
