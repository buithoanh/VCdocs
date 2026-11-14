import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Db } from '../../db/db.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { MAIL_NEW_NOTIFICATION, MailBasicService, mailboxAddress } from './mail-basic.service';

/** Thư có ngày gửi cũ hơn mức này không báo (lần đồng bộ đầu của hộp thư có sẵn thư cũ không dội thông báo). */
const NEW_MAIL_MAX_AGE_MS = 24 * 3600_000;
const NOTIFY_BATCH = 500;

type Reader = { id: string; mailbox: string };

/**
 * Việc nền báo thư mới: đồng bộ INBOX của hộp cá nhân đang hoạt động và hộp nhóm mà không cần ai mở hộp thư,
 * rồi tạo thông báo trong ứng dụng cho người có quyền đọc. Không có Ctx HTTP: mỗi truy vấn mang `companyId`
 * tường minh của công ty đang xử lý (mẫu flow.service.ts).
 *
 * Credential engine (giới hạn PoC): hộp cá nhân đọc bằng credential của chính hộp đó; hộp nhóm đọc bằng
 * credential của một thành viên có quyền đọc. Hộp không có credential bị bỏ qua, không chặn hộp khác.
 */
@Injectable()
export class MailSyncService implements OnModuleInit {
  private readonly log = new Logger('MailSync');
  private running = false;
  /** Hộp thư đang lỗi đồng bộ: chỉ ghi log lần đầu cho tới khi đồng bộ lại được. */
  private readonly failing = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly mail: MailBasicService,
    private readonly notifications: NotificationsService,
    private readonly scheduler: SchedulerService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    const everyMs = this.cfg.mailEngine.syncIntervalMs ?? 60_000;
    // Email tắt (MAIL_ENGINE_MODE=disabled) hoặc nhịp 0: không đăng ký việc nền.
    if (String(this.cfg.mailEngine.mode) === 'disabled' || !(everyMs > 0)) return;
    this.scheduler.add({ name: 'mail.syncInbox', everyMs, run: async () => { await this.runOnce(); } });
  }

  /** Một lượt cho mọi công ty; lượt trước chưa xong thì bỏ qua lượt này. */
  async runOnce() {
    const total = { mailboxes: 0, failed: 0, notified: 0 };
    if (this.running) return total;
    this.running = true;
    try {
      const companies = await this.db.m.Company.find({}, { domain: 1 }).lean<any[]>();
      for (const company of companies) await this.runCompany(String(company._id), String(company.domain ?? '').trim().toLowerCase(), total);
    } finally {
      this.running = false;
    }
    return total;
  }

  private async runCompany(companyId: string, domain: string, total: { mailboxes: number; failed: number; notified: number }) {
    const cid = new Types.ObjectId(companyId);
    const users = await this.db.m.User.find({ companyId: cid, status: { $ne: 'left' }, isSuspended: { $ne: true } }, { email: 1 }).lean<any[]>();
    const people = new Map<string, Reader>();
    for (const user of users) { const mailbox = mailboxAddress(user.email, domain); if (mailbox) people.set(mailbox, { id: String(user._id), mailbox }); }

    for (const person of people.values()) {
      total.mailboxes++;
      if (!await this.sync(companyId, person.mailbox, [person])) total.failed++;
      total.notified += await this.notifyNew(companyId, person.mailbox, [person]);
    }
    const shared = await this.db.m.WorkspaceSharedMailbox.find({ companyId: cid }).lean<any[]>();
    for (const box of shared) {
      const address = String(box.address).toLowerCase();
      // Hộp thư cá nhân luôn thắng hộp nhóm trùng địa chỉ (audit 7/12): không đọc hộp nhóm đó.
      if (people.has(address)) continue;
      const readers = (box.members ?? []).filter((m: any) => (m.roles ?? []).includes('read')).map((m: any) => people.get(String(m.email).toLowerCase())).filter(Boolean) as Reader[];
      if (!readers.length) continue;
      total.mailboxes++;
      if (!await this.sync(companyId, address, readers)) total.failed++;
      total.notified += await this.notifyNew(companyId, address, readers);
    }
  }

  /** Đồng bộ INBOX bằng credential của người đọc đầu tiên dùng được; lỗi chỉ ghi tên hộp và mã lỗi, không ghi nội dung thư. */
  private async sync(companyId: string, mailboxOwner: string, readers: Reader[]) {
    const key = `${companyId}:${mailboxOwner}`;
    let last: unknown;
    for (const reader of readers) {
      try {
        await this.mail.syncMailbox({ companyId, actorId: reader.id, accessOwner: reader.mailbox }, mailboxOwner, 'inbox');
        this.failing.delete(key);
        return true;
      } catch (error) { last = error; }
    }
    if (!this.failing.has(key)) { this.failing.add(key); this.log.warn(`Không đồng bộ được hộp thư ${mailboxOwner}: ${(last as any)?.code ?? (last as Error)?.message ?? 'lỗi không rõ'}`); }
    return false;
  }

  /**
   * Báo các thư đến chưa báo của một hộp thư. Mỗi dòng chỉ mục được "nhận" bằng cập nhật nguyên tử `notifiedAt`
   * nên hai tiến trình/lượt chạy không báo lặp; thư nội bộ đã ghi chỉ mục lúc gửi cũng đi qua đây.
   * Người gửi (theo journal gửi hoặc danh tính/alias của chính họ) không nhận thông báo về thư của mình.
   */
  private async notifyNew(companyId: string, mailboxOwner: string, readers: Reader[]) {
    const cid = new Types.ObjectId(companyId);
    const rows = await this.db.m.WorkspaceMailMessage.find({ companyId: cid, mailboxOwner, folder: { $ne: 'sent' }, notifiedAt: { $exists: false } }).sort({ sentAt: 1 }).limit(NOTIFY_BATCH).lean<any[]>();
    let notified = 0;
    for (const row of rows) {
      const claimed = await this.db.m.WorkspaceMailMessage.findOneAndUpdate({ _id: row._id, companyId: cid, notifiedAt: { $exists: false } }, { $set: { notifiedAt: new Date() } }).lean<any>();
      if (!claimed) continue;
      if (Date.now() - new Date(row.sentAt).getTime() > NEW_MAIL_MAX_AGE_MS) continue;
      const journal = await this.db.m.WorkspaceMailSend.findOne({ companyId: cid, internetMessageId: row.internetMessageId }, { ownerEmail: 1 }).lean<any>();
      const targets: string[] = [];
      for (const reader of readers) {
        if (journal?.ownerEmail === reader.mailbox) continue;
        if (await this.mail.ownIdentity({ companyId }, reader.mailbox, String(row.from))) continue;
        targets.push(reader.id);
      }
      if (!targets.length) continue;
      await this.notifications.notify(companyId, targets, {
        type: MAIL_NEW_NOTIFICATION,
        title: `Thư mới từ ${row.from}`,
        body: String(row.subject || '(Không có tiêu đề)').slice(0, 200),
        link: '/email',
        objectType: 'workspace_mail_message',
        objectId: String(row._id),
      }, { inAppOnly: true });
      notified += targets.length;
    }
    return notified;
  }
}
