import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Models, registerModels } from './models';

/** Kết nối MongoDB và toàn bộ model; mỗi app một kết nối riêng (test chạy song song). */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly conn: Connection;
  readonly m: Models;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.conn = mongoose.createConnection(cfg.mongoUri, { autoIndex: true });
    this.m = registerModels(this.conn);
  }

  async ready(): Promise<void> {
    await this.conn.asPromise();
    await Promise.all(Object.values(this.m).map((model) => model.init()));
  }

  async onModuleDestroy() {
    await this.conn.close();
  }
}
