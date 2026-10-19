import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

export type ScheduledTask = { name: string; everyMs: number; run: () => Promise<void> };

/**
 * Việc định kỳ chạy trong tiến trình (giai đoạn 1): gỡ chia sẻ hết hạn, nhắc
 * hạn, tạo thư mục tháng, thư tổng hợp. Các phân hệ tự đăng ký việc của mình.
 */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly log = new Logger('Scheduler');
  private readonly tasks: ScheduledTask[] = [];
  private timers: NodeJS.Timeout[] = [];

  add(task: ScheduledTask) {
    this.tasks.push(task);
  }
  list() {
    return this.tasks.map((t) => t.name);
  }

  /** Chạy ngay một lượt mọi việc (test dùng) */
  async runAll() {
    for (const t of this.tasks) await this.safe(t);
  }

  private async safe(t: ScheduledTask) {
    try {
      await t.run();
    } catch (e: any) {
      this.log.error(`${t.name}: ${e?.stack ?? e}`);
    }
  }

  start() {
    for (const t of this.tasks) {
      const h = setInterval(() => this.safe(t), t.everyMs);
      h.unref?.();
      this.timers.push(h);
    }
    this.log.log(`Đã bật ${this.tasks.length} việc định kỳ`);
  }
  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }
}
