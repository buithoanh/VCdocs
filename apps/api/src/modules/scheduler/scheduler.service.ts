import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { dateVN, TZ } from '../../common/util';

export type ScheduledTask = { name: string; everyMs: number; run: () => Promise<void> };

/** Giờ:phút và thứ (0 = Chủ nhật) theo giờ Việt Nam */
export function clockVN(d = new Date()): { hhmm: string; weekday: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { hhmm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, weekday, date: dateVN(d) };
}

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

  /**
   * Việc chạy mỗi ngày một lần từ giờ `at` (giờ Việt Nam), tuỳ chọn chỉ vào một
   * thứ trong tuần. Kiểm 5 phút một lần; `run` phải tự chống chạy trùng trong
   * ngày (nhiều tiến trình, khởi động lại) – vd tra việc nền đã tạo hôm nay.
   */
  addDaily(task: { name: string; at: string; weekday?: number; run: (today: string) => Promise<void> }) {
    let lastDate = '';
    this.add({
      name: task.name,
      everyMs: 5 * 60_000,
      run: async () => {
        const c = clockVN();
        if (c.hhmm < task.at || lastDate === c.date) return;
        if (task.weekday !== undefined && c.weekday !== task.weekday) return;
        lastDate = c.date;
        await task.run(c.date);
      },
    });
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
