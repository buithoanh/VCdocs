import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { simpleParser } from 'mailparser';

export type MailAttachment = { filename: string; contentType: string; bytes: Buffer; sha256: string };
/** `to` là danh sách RCPT TO của SMTP envelope (To ∪ Cc ∪ Bcc), không phải header To. */
export type MailEnvelope = { from: string; to: string[]; authOwner?: string; sentMailbox?: string };
export type StoredMail = { engineId: string; owner: string; raw: Buffer; acceptedAt: Date; folder: string; uid: number; visibleAfterList?: number };
export type EngineMail = { engineId: string; raw: Buffer; uid?: number };
/** Con trỏ đồng bộ một thư mục IMAP: UID chỉ có nghĩa trong cùng UIDVALIDITY (RFC 3501 §2.3.1.1). */
export type FolderCursor = { uidValidity: string; lastUid: number };
/** Trạng thái đồng bộ gia tăng: người gọi đưa `cursor` đã lưu, adapter ghi `next` khi đọc xong thư mục. */
export type FolderSyncState = { cursor?: FolderCursor; next?: FolderCursor };
/**
 * Khoá ổn định cho thư thiếu Message-ID: băm nguyên văn thư. Cùng một thư luôn ra cùng khoá qua mọi lượt đồng bộ,
 * kể cả khi UIDVALIDITY đổi (khoá theo UID thì không). Hai thư giống nhau từng byte gộp làm một.
 */
export const syntheticMessageId = (raw: Buffer) => `nomid-${createHash('sha256').update(raw).digest('hex')}@vcworkspace.invalid`;
export const isSyntheticMessageId = (id: string) => /^nomid-[0-9a-f]{64}@vcworkspace\.invalid$/i.test(id);
/**
 * Message-ID đọc bằng cùng parser với metadata (mailparser, chỉ phần header):
 * dòng giống header trong thân thư không được tính, thư thiếu Message-ID trả undefined.
 * Message-ID tự khai theo dạng khoá băm cũng coi như thiếu, để người gửi không mạo khoá của thư khác.
 */
export async function headerMessageId(raw: Buffer) {
  const text = raw.toString('latin1'), blank = /\r?\n\r?\n/.exec(text);
  const head = Buffer.from(blank ? text.slice(0, blank.index + blank[0].length) : text, 'latin1');
  const parsed = await simpleParser(head, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true });
  const id = String(parsed.messageId ?? '').replace(/[<>]/g, '').trim();
  return id && !isSyntheticMessageId(id) ? id : undefined;
}
export class MailDeliveryError extends Error { constructor(message:string,public readonly accepted:'no'|'unknown'){super(message);} }
export interface MailPort {
  deliver(envelope: MailEnvelope, raw: Buffer): Promise<{ accepted: string[]; engineIds: Record<string, string> }>;
  raw(accessOwner: string, engineId: string, folder?: string, engineMailbox?: string): Promise<Buffer>;
  setLabels(accessOwner: string, engineId: string, labels: string[], previousLabels?: string[], folder?: string, engineMailbox?: string): Promise<void>;
  installFilters(owner: string, filters: MailFilterRule[]): Promise<void>;
  provisionAlias(owner: string, address: string): Promise<void>;
  /** Gỡ alias khỏi tài khoản owner ở engine (địa chỉ được trả cho người dùng thật). */
  releaseAlias(owner: string, address: string): Promise<void>;
  provisionShared(address: string): Promise<void>;
  setSharedMember(address: string, member: string, enabled: boolean): Promise<void>;
  offboardUser(address: string): Promise<void>;
  /**
   * Thư của một thư mục. `known(engineId)` đúng thì bỏ qua thư đó (đã có trong CSDL), không tải lại nội dung.
   * Có `state.cursor` cùng UIDVALIDITY thì chỉ đọc thư có UID lớn hơn `lastUid`; UIDVALIDITY khác thì đọc lại từ đầu.
   * Adapter ghi `state.next` (UIDVALIDITY hiện tại + UID lớn nhất đã đọc) để người gọi lưu sau khi xử lý xong.
   */
  listFolder(accessOwner: string, folder?: string, engineMailbox?: string, known?: (engineId: string) => Promise<boolean>, state?: FolderSyncState): Promise<EngineMail[]>;
  /** engineId của thư có đúng Message-ID trong thư mục, chỉ đọc header (đối soát sau gửi không tải nội dung). */
  findByMessageId(accessOwner: string, internetMessageId: string, folder?: string, engineMailbox?: string): Promise<string | undefined>;
}
export type MailFilterRule = { field: 'from'|'to'|'subject'|'body'; operator: 'equals'|'contains'; value: string; addLabels: string[]; moveToFolder?: string; stop: boolean };
export const MAIL_PORT = Symbol('MAIL_PORT');

/** Mail engine bộ nhớ chỉ dành unit/e2e; adapter Stalwart nằm ở stalwart-mail.port.ts. */
@Injectable()
export class FakeMailPort implements MailPort {
  private messages = new Map<string, StoredMail>();
  private aliases = new Map<string, string>();
  failAfterDeliveryAckOnce=false;
  failBeforeDeliveryAckOnce=false;
  deliveryCount=0;
  listFolderCount=0;
  /** engineId của từng lần listFolder trả nguyên văn thư (test chứng minh không tải lại thư cũ). */
  bodyFetches:string[]=[];
  private nextUid=1;
  private uidValidity=new Map<string,number>();
  sentVisibilityDelayOnce=0;
  beforeDeliveryHook?:()=>Promise<void>;
  filterInstallHook?:()=>Promise<void>;
  installedFilters:MailFilterRule[]=[];
  async deliver(envelope: MailEnvelope, raw: Buffer) {
    if(this.beforeDeliveryHook)await this.beforeDeliveryHook();
    if(this.failBeforeDeliveryAckOnce){this.failBeforeDeliveryAckOnce=false;throw new MailDeliveryError('FAULT_BEFORE_DELIVERY_ACK','no');}
    const engineIds: Record<string, string> = {};
    for (const recipient of envelope.to) {
      const owner = this.aliases.get(recipient.toLowerCase()) ?? recipient.toLowerCase();
      const id = randomUUID(); engineIds[recipient.toLowerCase()] = id;
      this.messages.set(`${owner}:${id}`, { engineId: id, owner, raw: Buffer.from(raw), acceptedAt: new Date(), folder: 'inbox', uid: this.nextUid++ });
    }
    const sentOwner=(envelope.sentMailbox??envelope.authOwner??envelope.from).toLowerCase();const sentId = randomUUID(); engineIds[sentOwner] = sentId;
    const visibleAfterList=this.listFolderCount+this.sentVisibilityDelayOnce;this.sentVisibilityDelayOnce=0;
    this.messages.set(`${sentOwner}:${sentId}`, { engineId: sentId, owner: sentOwner, raw: Buffer.from(raw), acceptedAt: new Date(), folder: 'sent', uid: this.nextUid++, visibleAfterList });
    this.deliveryCount++;
    if(this.failAfterDeliveryAckOnce){this.failAfterDeliveryAckOnce=false;throw new MailDeliveryError('FAULT_AFTER_DELIVERY_ACK','unknown');}
    return { accepted: [...envelope.to], engineIds };
  }
  async raw(accessOwner: string, engineId: string, _folder?: string, engineMailbox?: string) {
    const row = this.messages.get(`${(engineMailbox??accessOwner).toLowerCase()}:${engineId}`);
    if (!row) throw new Error('MAIL_NOT_FOUND');
    return Buffer.from(row.raw);
  }
  async setLabels() {}
  async installFilters(_owner:string,filters:MailFilterRule[]) {if(this.filterInstallHook)await this.filterInstallHook();this.installedFilters=structuredClone(filters);}
  async provisionAlias(owner: string, address: string) { this.aliases.set(address.toLowerCase(), owner.toLowerCase()); }
  async releaseAlias(owner: string, address: string) { if (this.aliases.get(address.toLowerCase()) === owner.toLowerCase()) this.aliases.delete(address.toLowerCase()); }
  async provisionShared() {}
  async setSharedMember() {}
  async offboardUser() {}
  private validityOf(owner:string,folder:string){return String(this.uidValidity.get(`${owner}:${folder}`)??1);}
  /** Giả lập máy chủ đánh lại UID của một thư mục (UIDVALIDITY đổi): mọi thư nhận UID mới. */
  resetUidValidity(owner:string,folder='inbox'){const key=`${owner.toLowerCase()}:${folder}`;this.uidValidity.set(key,Number(this.uidValidity.get(key)??1)+1);for(const row of [...this.messages.values()].filter(x=>x.owner===owner.toLowerCase()&&x.folder===folder).sort((a,b)=>a.uid-b.uid))row.uid=this.nextUid++;}
  private visible(owner:string,folder:string){const rows=[...this.messages.values()].filter(x=>x.owner===owner&&x.folder===folder).sort((a,b)=>a.uid-b.uid);return{shown:rows.filter(x=>(x.visibleAfterList??0)<=this.listFolderCount),hidden:rows.filter(x=>(x.visibleAfterList??0)>this.listFolderCount)};}
  async listFolder(accessOwner:string,folder='inbox',engineMailbox?:string,known?:(engineId:string)=>Promise<boolean>,state?:FolderSyncState){
    this.listFolderCount++;
    const owner=(engineMailbox??accessOwner).toLowerCase(),validity=this.validityOf(owner,folder),{shown,hidden}=this.visible(owner,folder),items:EngineMail[]=[];
    // Con trỏ chỉ dùng được khi cùng UIDVALIDITY; khác thì đọc lại từ đầu như IMAP thật.
    const from=state?.cursor&&state.cursor.uidValidity===validity?state.cursor.lastUid:0;
    for(const x of shown){if(x.uid<=from)continue;if(known&&await known(x.engineId))continue;this.bodyFetches.push(x.engineId);items.push({engineId:x.engineId,raw:Buffer.from(x.raw),uid:x.uid});}
    // Thư chưa hiện (trễ hiển thị) có UID nhỏ hơn thì con trỏ dừng trước nó để lượt sau còn đọc được.
    if(state){const ceiling=hidden.length?Math.min(...hidden.map(x=>x.uid))-1:Infinity;state.next={uidValidity:validity,lastUid:Math.max(from,0,...shown.map(x=>x.uid).filter(uid=>uid<=ceiling))};}
    return items;
  }
  async findByMessageId(accessOwner:string,internetMessageId:string,folder='inbox',engineMailbox?:string){this.listFolderCount++;const owner=(engineMailbox??accessOwner).toLowerCase();for(const x of this.visible(owner,folder).shown)if(await headerMessageId(x.raw)===internetMessageId)return x.engineId;return undefined;}
  inject(owner:string,folder:string,raw:Buffer,engineId:string=randomUUID()){const keyOwner=owner.toLowerCase();this.messages.set(`${keyOwner}:${engineId}`,{engineId,owner:keyOwner,raw:Buffer.from(raw),acceptedAt:new Date(),folder,uid:this.nextUid++});return engineId;}
}
export const attachmentHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
