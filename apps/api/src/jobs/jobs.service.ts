import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../db/db.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AppError, GoogleError } from '../common/errors';
import type { RequestCtx } from '../common/context';
import { NotificationsService } from '../notifications/notifications.service';

export interface JobContext {
  jobId: string;
  companyId: string;
  userId: string;
  requestId?: string;
  payload: any;
  /** Chạy một bước có tên; lỗi thì dừng cả việc, các bước sau không chạy */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
}
export type JobHandler = (job: JobContext) => Promise<Record<string, any> | void>;

/** Tên bước hiển thị cho người dùng theo loại việc */
export type JobDef = { handler: JobHandler; steps: string[]; title: string };

/**
 * Hàng đợi việc chạy lâu trên chính MongoDB (BA 9.1). Việc gọi Google nhiều
 * bước trả 202 + jobId; GET /jobs/{id} theo dõi; kết quả ghi vào đối tượng.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private readonly defs = new Map<string, JobDef>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  register(type: string, def: JobDef) {
    this.defs.set(type, def);
  }

  async enqueue(ctx: RequestCtx, type: string, payload: any): Promise<string> {
    const def = this.defs.get(type);
    if (!def) throw new Error(`Chưa đăng ký loại việc ${type}`);
    const job = await this.db.m.Job.create({
      companyId: new Types.ObjectId(ctx.companyId),
      type,
      status: 'queued',
      progress: 0,
      steps: def.steps.map((name) => ({ name, status: 'queued' })),
      payload,
      requestedBy: new Types.ObjectId(ctx.user!.id),
      createdBy: new Types.ObjectId(ctx.user!.id),
      requestId: ctx.requestId,
    });
    this.kick();
    return String(job._id);
  }

  start() {
    if (this.cfg.jobsPollMs > 0 && !this.timer) {
      this.timer = setInterval(() => this.kick(), this.cfg.jobsPollMs);
      this.timer.unref?.();
    }
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private kick() {
    if (this.cfg.jobsPollMs <= 0 || this.running || this.stopped) return;
    this.running = true;
    this.drain()
      .catch((e) => this.log.error(e?.stack ?? e))
      .finally(() => (this.running = false));
  }

  /** Chạy hết việc đang chờ (test gọi trực tiếp) */
  async drain(max = 100): Promise<number> {
    let n = 0;
    while (n < max && !this.stopped) {
      const ok = await this.runOne();
      if (!ok) break;
      n++;
    }
    return n;
  }

  private async runOne(): Promise<boolean> {
    const now = new Date();
    const job = await this.db.m.Job.findOneAndUpdate(
      { $or: [{ status: 'queued' }, { status: 'running', lockedUntil: { $lt: now } }], attempts: { $lt: 3 } },
      { $set: { status: 'running', startedAt: now, lockedUntil: new Date(now.getTime() + 10 * 60_000) }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true, skipTenant: true },
    ).lean<any>();
    if (!job) return false;
    const def = this.defs.get(job.type);
    const companyId = String(job.companyId);
    const filter = { _id: job._id, companyId: job.companyId };
    const steps: any[] = job.steps.map((s: any) => ({ ...s, status: s.status === 'done' ? 'done' : 'queued', error: undefined }));
    const save = (extra: any = {}) => {
      const done = steps.filter((s) => s.status === 'done').length;
      return this.db.m.Job.updateOne(filter, { $set: { steps, progress: steps.length ? Math.round((done / steps.length) * 100) : 0, ...extra } });
    };
    const jc: JobContext = {
      jobId: String(job._id),
      companyId,
      userId: String(job.requestedBy),
      requestId: job.requestId,
      payload: job.payload,
      step: async (name, fn) => {
        let s = steps.find((x) => x.name === name);
        if (!s) {
          s = { name, status: 'queued' };
          steps.push(s);
        }
        s.status = 'running';
        await save();
        try {
          const r = await fn();
          s.status = 'done';
          await save();
          return r;
        } catch (e: any) {
          s.status = 'failed';
          s.error = e?.message ?? String(e);
          throw e;
        }
      },
    };
    try {
      if (!def) throw new Error(`Loại việc ${job.type} không có bộ xử lý`);
      const result = (await def.handler(jc)) ?? {};
      for (const s of steps) if (s.status !== 'done') s.status = 'done';
      await save({ status: 'done', progress: 100, result, finishedAt: new Date(), lockedUntil: null });
      await this.notifications.notify(companyId, [jc.userId], {
        type: 'job_done',
        title: `Đã xong: ${def.title}`,
        link: `/viec-nen/${job._id}`,
        objectType: result?.objectType,
        objectId: result?.objectId,
      });
    } catch (e: any) {
      const err =
        e instanceof AppError
          ? { code: e.code, message: e.message, rule: e.rule, details: e.details }
          : e instanceof GoogleError
            ? { code: 'DRIVE_ERROR', message: 'Google Drive trả lỗi, việc đã dừng ở bước đang làm' }
            : { code: 'INTERNAL', message: 'Lỗi hệ thống khi chạy việc nền' };
      if (!(e instanceof AppError)) this.log.error(`Job ${job._id} (${job.type}) lỗi: ${e?.stack ?? e}`);
      for (const k of Object.keys(err)) if ((err as any)[k] === undefined) delete (err as any)[k];
      await save({ status: 'failed', error: { error: { ...err, requestId: job.requestId ?? String(job._id) } }, finishedAt: new Date(), lockedUntil: null, attempts: 99 });
      await this.notifications.notify(companyId, [jc.userId], {
        type: 'job_failed',
        title: `Chưa xong: ${def?.title ?? job.type}`,
        body: err.message,
        link: `/viec-nen/${job._id}`,
      });
    }
    return true;
  }
}
