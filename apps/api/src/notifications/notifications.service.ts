import { Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../db/db.service';
import { GOOGLE, GooglePorts } from '../google/ports';
import { APP_CONFIG, AppConfig } from '../config/config';

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  objectType?: string;
  objectId?: string;
}

export const DEFAULT_SETTINGS = { channels: ['email', 'inapp'], digest: 'instant' };

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** M14: thông báo trong ứng dụng + email (Gmail API). Zalo từ giai đoạn 3. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notify');
  constructor(
    private readonly db: Db,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async notify(companyId: string, userIds: (string | undefined)[], n: NotifyInput) {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    if (!ids.length) return;
    const users = await this.db.m.User.find({ companyId: new Types.ObjectId(companyId), _id: { $in: ids.map((x) => new Types.ObjectId(x)) }, status: { $ne: 'left' } }).lean<any[]>();
    const instantEmails: string[] = [];
    for (const u of users) {
      const s = u.notificationSettings ?? DEFAULT_SETTINGS;
      const wantsEmail = s.channels?.includes('email');
      await this.db.m.Notification.create({
        companyId: new Types.ObjectId(companyId),
        userId: u._id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        objectType: n.objectType,
        objectId: n.objectId ? new Types.ObjectId(n.objectId) : undefined,
        // Kênh inapp tắt thì vẫn lưu nhưng đánh dấu đã đọc để không làm phiền
        isRead: !(s.channels ?? []).includes('inapp'),
        emailState: wantsEmail ? (s.digest === 'daily' ? 'pending' : 'sent') : 'none',
      });
      if (wantsEmail && s.digest !== 'daily') instantEmails.push(u.email);
    }
    if (instantEmails.length) await this.sendEmail(instantEmails, n.title, n.body, n.link);
  }

  async sendEmail(to: string[], title: string, body?: string, link?: string) {
    const url = link ? `${this.cfg.webOrigin}${link}` : undefined;
    const html = `<p>${esc(title)}</p>${body ? `<p>${esc(body)}</p>` : ''}${url ? `<p><a href="${esc(url)}">Mở trong VCdocs</a></p>` : ''}<p style="color:#888">Thư tự động từ VCdocs – VC Phồn Vinh</p>`;
    try {
      await this.google.gmail.send({ to, subject: `[VCdocs] ${title}`, html });
    } catch (e: any) {
      // Gửi thư lỗi không làm hỏng nghiệp vụ; thông báo trong ứng dụng vẫn còn
      this.log.warn(`Không gửi được email: ${e?.message}`);
    }
  }

  /** Gửi thư tổng hợp hằng ngày cho người chọn digest = daily */
  async sendDailyDigests() {
    const pending = await this.db.m.Notification.find({ emailState: 'pending' }, undefined, { skipTenant: true }).sort({ createdAt: 1 }).limit(5000).lean<any[]>();
    const byUser = new Map<string, any[]>();
    for (const n of pending) {
      const k = `${n.companyId}:${n.userId}`;
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k)!.push(n);
    }
    for (const [k, list] of byUser) {
      const [companyId, userId] = k.split(':');
      const u = await this.db.m.User.findOne({ companyId: new Types.ObjectId(companyId), _id: new Types.ObjectId(userId) }).lean<any>();
      if (u) await this.sendEmail([u.email], `${list.length} thông báo trong ngày`, list.map((n) => `• ${n.title}`).join(' '));
      await this.db.m.Notification.updateMany({ companyId: new Types.ObjectId(companyId), _id: { $in: list.map((n) => n._id) } }, { $set: { emailState: 'sent' } });
    }
  }
}
