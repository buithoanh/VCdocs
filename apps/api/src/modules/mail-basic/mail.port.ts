import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

export type MailAttachment = { filename: string; contentType: string; bytes: Buffer; sha256: string };
export type MailEnvelope = { from: string; to: string[]; authOwner?: string; sentMailbox?: string };
export type StoredMail = { engineId: string; owner: string; raw: Buffer; acceptedAt: Date; folder: string; visibleAfterList?: number };
export type EngineMail = { engineId: string; raw: Buffer };
export class MailDeliveryError extends Error { constructor(message:string,public readonly accepted:'no'|'unknown'){super(message);} }
export interface MailPort {
  deliver(envelope: MailEnvelope, raw: Buffer): Promise<{ accepted: string[]; engineIds: Record<string, string> }>;
  raw(accessOwner: string, engineId: string, folder?: string, engineMailbox?: string): Promise<Buffer>;
  setLabels(accessOwner: string, engineId: string, labels: string[], previousLabels?: string[], folder?: string, engineMailbox?: string): Promise<void>;
  installFilters(owner: string, filters: MailFilterRule[]): Promise<void>;
  provisionAlias(owner: string, address: string): Promise<void>;
  provisionShared(address: string): Promise<void>;
  setSharedMember(address: string, member: string, enabled: boolean): Promise<void>;
  offboardUser(address: string): Promise<void>;
  listFolder(accessOwner: string, folder?: string, engineMailbox?: string): Promise<EngineMail[]>;
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
      this.messages.set(`${owner}:${id}`, { engineId: id, owner, raw: Buffer.from(raw), acceptedAt: new Date(), folder: 'inbox' });
    }
    const sentOwner=(envelope.sentMailbox??envelope.authOwner??envelope.from).toLowerCase();const sentId = randomUUID(); engineIds[sentOwner] = sentId;
    const visibleAfterList=this.listFolderCount+this.sentVisibilityDelayOnce;this.sentVisibilityDelayOnce=0;
    this.messages.set(`${sentOwner}:${sentId}`, { engineId: sentId, owner: sentOwner, raw: Buffer.from(raw), acceptedAt: new Date(), folder: 'sent', visibleAfterList });
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
  async provisionShared() {}
  async setSharedMember() {}
  async offboardUser() {}
  async listFolder(accessOwner:string,folder='inbox',engineMailbox?:string){this.listFolderCount++;const owner=(engineMailbox??accessOwner).toLowerCase();return [...this.messages.values()].filter(x=>x.owner===owner&&x.folder===folder&&(x.visibleAfterList??0)<=this.listFolderCount).map(x=>({engineId:x.engineId,raw:Buffer.from(x.raw)}));}
  inject(owner:string,folder:string,raw:Buffer,engineId:string=randomUUID()){const keyOwner=owner.toLowerCase();this.messages.set(`${keyOwner}:${engineId}`,{engineId,owner:keyOwner,raw:Buffer.from(raw),acceptedAt:new Date(),folder});return engineId;}
}
export const attachmentHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
