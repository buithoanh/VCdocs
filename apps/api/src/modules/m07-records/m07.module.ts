import * as fs from 'fs';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'crypto';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => {
        fs.mkdirSync(cfg.uploadTmpDir, { recursive: true });
        return {
          // Tải file ≤ 100 MB (hợp đồng mục 7); để tạm trên đĩa tới khi việc nền đưa lên Drive
          storage: diskStorage({ destination: cfg.uploadTmpDir, filename: (_req, _f, cb) => cb(null, randomBytes(16).toString('hex')) }),
          limits: { fileSize: 100 * 1024 * 1024, files: 1 },
        };
      },
    }),
  ],
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class M07Module {}
