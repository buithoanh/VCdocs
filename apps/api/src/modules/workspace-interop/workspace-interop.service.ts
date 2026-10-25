import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { basename } from 'path';
import { simpleParser } from 'mailparser';
import { Types } from 'mongoose';
import { AuditService } from '../../audit/audit.service';
import { Errors } from '../../common/errors';
import { Ctx } from '../../common/context';
import { Db } from '../../db/db.service';
import { DriveBasicService } from '../drive-basic/drive-basic.service';
import { officeKind, validOfficePackage } from '../drive-basic/ooxml';
import { MailBasicService } from '../mail-basic/mail-basic.service';
import { APP_CONFIG, AppConfig } from '../../config/config';

const MAX = 10 * 1024 * 1024;
const ALLOWED = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/pdf','text/plain','application/octet-stream']);

@Injectable()
export class WorkspaceInteropService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly drive: DriveBasicService,
    private readonly mail: MailBasicService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}
  private cid(ctx: Ctx) { return new Types.ObjectId(ctx.companyId); }
  private cleanName(value: string) {
    const name = basename(String(value || 'attachment.bin').replace(/\\/g, '/')).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (!name || name === '.' || name === '..' || name.length > 180) throw Errors.validation('Tên attachment không an toàn');
    return name;
  }
  private validate(bytes: Buffer, mimeType: string, name: string) {
    if (!bytes.length || bytes.length > MAX) throw Errors.tooLarge('Attachment tối đa 10 MiB');
    if (!ALLOWED.has(mimeType) || mimeType === 'text/html') throw Errors.unsupportedMedia();
    const kind = officeKind(mimeType, name);
    if (kind && !validOfficePackage(bytes, kind)) throw Errors.validation('Gói Office không hợp lệ');
    if (mimeType === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw Errors.validation('PDF không hợp lệ');
  }
  async saveAttachment(ctx: Ctx, messageId: string, part: number, mailbox: string | undefined, body: any, key: string) {
    if (!Number.isInteger(part) || part < 0) throw Errors.validation('Part attachment không hợp lệ');
    const raw = await this.mail.raw(ctx, messageId, mailbox), parsed = await simpleParser(raw), attachment = parsed.attachments[part];
    if (!attachment) throw Errors.notFound('Không tìm thấy attachment');
    const name = this.cleanName(attachment.filename || `attachment-${part}.bin`), mimeType = String(attachment.contentType || 'application/octet-stream').toLowerCase(), bytes = attachment.content;
    this.validate(bytes, mimeType, name);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (body.expectedSha256 && body.expectedSha256 !== hash) throw Errors.state('Hash attachment đã thay đổi');
    const file: Express.Multer.File = { fieldname:'file', originalname:name, encoding:'7bit', mimetype:mimeType, size:bytes.length, buffer:bytes, destination:'', filename:name, path:'', stream:undefined as any };
    const provenance = { source: 'mail-attachment', messageId, mailbox: mailbox || null, part, sha256: hash };
    const saved: any = await this.drive.upload(ctx, { spaceId: body.spaceId, parentId: body.parentId, provenance }, file, `mail-attachment:${key}`);
    await this.audit.record(ctx, { action:'workspace_interop.attachment.save', objectType:'workspace_drive_item', objectId:saved.id, after:provenance });
    return { ...saved, provenance };
  }
  private async assertRecipientsCanRead(ctx: Ctx, spaceId: string, recipients: string[]) {
    for (const address of recipients) {
      const email = await this.mail.userEmailOf(ctx, address);
      const user = email ? await this.db.m.User.findOne({ companyId:this.cid(ctx), email }).lean<any>() : null;
      if (!user || !await this.db.m.WorkspaceSpaceMember.exists({ companyId:this.cid(ctx), spaceId:new Types.ObjectId(spaceId), userId:user._id })) throw Errors.forbidden('Người nhận chưa có quyền đọc tệp Drive; gửi link không tự cấp quyền');
    }
  }
  async sendDriveFile(ctx: Ctx, body: any, key: string) {
    const mode = body.mode === 'link' ? 'link' : body.mode === 'attachment' ? 'attachment' : undefined;
    if (!mode) throw Errors.validation('Chế độ gửi phải là attachment hoặc link');
    const to = Array.isArray(body.to) ? body.to : [], selected = await this.drive.versionContent(ctx, body.fileId, body.versionId);
    if (body.expectedSha256 && body.expectedSha256 !== selected.version.contentSha256) throw Errors.state('Phiên bản Drive không còn khớp hash đã chọn');
    if (mode === 'attachment') {
      const file: Express.Multer.File = { fieldname:'attachments', originalname:selected.meta.name, encoding:'7bit', mimetype:selected.version.mimeType, size:selected.bytes.length, buffer:selected.bytes, destination:'', filename:selected.meta.name, path:'', stream:undefined as any };
      return this.mail.send(ctx, { to, subject:body.subject, text:body.text, fromIdentity:body.fromIdentity }, `drive-snapshot:${key}`, [file]);
    }
    await this.assertRecipientsCanRead(ctx, selected.meta.spaceId, to);
    const recipients=to.map((x:string)=>String(x).toLowerCase()), fingerprint=createHash('sha256').update(JSON.stringify({fileId:selected.meta.id,versionId:selected.version.id,sha256:selected.version.contentSha256,recipients})).digest('hex');
    let link=await this.db.m.WorkspaceDriveShareLink.findOne({companyId:this.cid(ctx),createdBy:new Types.ObjectId(ctx.user.id),idempotencyKey:key}).lean<any>();
    if(link&&link.fingerprint!==fingerprint)throw Errors.state('Idempotency-Key đã dùng cho tệp, version hoặc người nhận khác');
    if(!link){const token=randomBytes(24).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex');try{link=(await this.db.m.WorkspaceDriveShareLink.create({companyId:this.cid(ctx),fileId:selected.meta.id,versionId:selected.version.id,contentSha256:selected.version.contentSha256,recipients,idempotencyKey:key,fingerprint,token,tokenHash,expiresAt:new Date(Date.now()+7*24*60*60*1000),createdBy:new Types.ObjectId(ctx.user.id),updatedBy:new Types.ObjectId(ctx.user.id)})).toObject();}catch(error:any){if(error?.code!==11000)throw error;link=await this.db.m.WorkspaceDriveShareLink.findOne({companyId:this.cid(ctx),createdBy:new Types.ObjectId(ctx.user.id),idempotencyKey:key}).lean<any>();if(!link)throw Errors.state('Lượt tạo link đồng thời chưa thể đối soát');if(link.fingerprint!==fingerprint)throw Errors.state('Idempotency-Key đã dùng cho tệp, version hoặc người nhận khác');}}
    const url=`${this.cfg.webOrigin}/bo-nho/lien-ket#${link.token}`;
    return this.mail.send(ctx, { to, subject:body.subject, text:`${String(body.text||'')}\n\n${url}`, fromIdentity:body.fromIdentity }, `drive-link:${key}`);
  }
  async downloadLink(ctx: Ctx, token: string) {
    const tokenHash=createHash('sha256').update(String(token)).digest('hex'), row=await this.db.m.WorkspaceDriveShareLink.findOne({ companyId:this.cid(ctx), tokenHash, expiresAt:{$gt:new Date()}, revokedAt:{$exists:false} }).lean<any>();
    if (!row) throw Errors.notFound('Liên kết không tồn tại hoặc đã bị thu hồi');
    const address=await this.mail.mailboxOf(ctx, ctx.user.email);
    if (!address || !row.recipients.includes(address)) throw Errors.forbidden('Liên kết không dành cho tài khoản này');
    const selected=await this.drive.versionContent(ctx,String(row.fileId),String(row.versionId));
    if (selected.version.contentSha256!==row.contentSha256) throw Errors.storageIntegrity();
    return { bytes:selected.bytes, name:selected.meta.name, mimeType:selected.version.mimeType, sha256:row.contentSha256 };
  }
}
