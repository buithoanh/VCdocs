import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/config';
import { LEGACY_WORKSPACE_DRIVE_ITEM_NAME_INDEX, Models, registerModels } from './models';

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
    // Index tên Drive cũ tính cả thùng rác (review O10); autoIndex không tự gỡ index đã bỏ khỏi schema.
    await this.m.WorkspaceDriveItem.collection.dropIndex(LEGACY_WORKSPACE_DRIVE_ITEM_NAME_INDEX).catch((error: any) => {
      if (!['IndexNotFound', 'NamespaceNotFound'].includes(error?.codeName)) throw error;
    });
    await Promise.all(Object.values(this.m).map((model) => model.init()));
  }

  async onModuleDestroy() {
    await this.conn.close();
  }
}
