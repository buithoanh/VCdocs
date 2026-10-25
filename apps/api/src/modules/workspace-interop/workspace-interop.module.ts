import { Module } from '@nestjs/common';
import { DriveBasicModule } from '../drive-basic/drive-basic.module';
import { MailBasicModule } from '../mail-basic/mail-basic.module';
import { WorkspaceInteropController } from './workspace-interop.controller';
import { WorkspaceInteropService } from './workspace-interop.service';

@Module({ imports: [DriveBasicModule, MailBasicModule], controllers: [WorkspaceInteropController], providers: [WorkspaceInteropService] })
export class WorkspaceInteropModule {}
