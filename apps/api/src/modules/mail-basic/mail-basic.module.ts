import { Module } from '@nestjs/common';
import { MailBasicController } from './mail-basic.controller';
import { MailBasicService } from './mail-basic.service';
import { FakeMailPort, MAIL_PORT } from './mail.port';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { StalwartMailPort } from './stalwart-mail.port';
@Module({ controllers: [MailBasicController], providers: [MailBasicService, FakeMailPort, { provide: MAIL_PORT, inject:[APP_CONFIG,FakeMailPort], useFactory:(cfg:AppConfig,fake:FakeMailPort)=>cfg.mailEngine.mode==='stalwart'?new StalwartMailPort(cfg.mailEngine):fake }], exports: [MailBasicService] })
export class MailBasicModule {}
