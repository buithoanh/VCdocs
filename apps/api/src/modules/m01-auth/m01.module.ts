import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DevFakeGoogleController } from './dev-fake-google.controller';
import { DrivesController } from './drives.controller';
import { MeController, UsersController } from './users.controller';
import { GoogleSyncService } from './google-sync.service';
import { OidcService } from './oidc.service';
import { IdentityLifecycleController } from './identity-lifecycle.controller';
import { IdentityLifecycleService } from './identity-lifecycle.service';
import { DisabledIdentityLifecyclePort, FakeIdentityLifecyclePort, IDENTITY_LIFECYCLE_PORT, IdentityLifecyclePort, LocalIdentityLifecyclePort } from './identity-lifecycle.port';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { MailBasicModule } from '../mail-basic/mail-basic.module';

function lifecyclePort(cfg: AppConfig): IdentityLifecyclePort {
  if (cfg.identityLifecycle.mode === 'local') return new LocalIdentityLifecyclePort(cfg.identityLifecycle);
  if (cfg.identityLifecycle.mode === 'fake' && cfg.nodeEnv !== 'production') return new FakeIdentityLifecyclePort();
  return new DisabledIdentityLifecyclePort();
}

@Module({
  imports: [MailBasicModule],
  controllers: [AuthController, MeController, UsersController, DrivesController, DevFakeGoogleController, IdentityLifecycleController],
  providers: [GoogleSyncService, OidcService, IdentityLifecycleService, { provide: IDENTITY_LIFECYCLE_PORT, inject: [APP_CONFIG], useFactory: lifecyclePort }],
  exports: [GoogleSyncService],
})
export class M01Module {}
