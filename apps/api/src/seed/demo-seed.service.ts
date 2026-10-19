import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db } from '../db/db.service';
import { GOOGLE, GooglePorts } from '../google/ports';
import { FakeGoogle } from '../google/fake/fake-google';
import { seedDemo } from './demo-seed';

/** Chạy local với Google giả: CSDL trống thì nạp dữ liệu mẫu (SEED_DEMO=true) */
@Injectable()
export class DemoSeedService {
  private readonly log = new Logger('Seed');
  constructor(private readonly db: Db, @Inject(GOOGLE) private readonly google: GooglePorts) {}

  async seedIfEmpty() {
    if (this.google.mode !== 'fake') return;
    if ((await this.db.m.Company.countDocuments({})) > 0) return;
    const fake = this.google as FakeGoogle;
    if (!fake.isEmpty()) fake.world = { seq: 1000, users: [], groups: [], drives: [], files: {}, activities: [], outbox: [] };
    await seedDemo(this.db.m, fake);
    fake.flush();
    this.log.log('Đã nạp dữ liệu mẫu (Google giả). Đăng nhập tại /api/v1/auth/google');
  }
}
