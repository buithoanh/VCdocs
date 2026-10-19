import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DevFakeGoogleController } from './dev-fake-google.controller';
import { DrivesController } from './drives.controller';
import { MeController, UsersController } from './users.controller';
import { GoogleSyncService } from './google-sync.service';

@Module({
  controllers: [AuthController, MeController, UsersController, DrivesController, DevFakeGoogleController],
  providers: [GoogleSyncService],
  exports: [GoogleSyncService],
})
export class M01Module {}
