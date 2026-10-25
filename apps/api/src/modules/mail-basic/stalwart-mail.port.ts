import * as net from 'net';
import * as tls from 'tls';
import { simpleParser } from 'mailparser';
import { IMAP_LITERAL_MARK, tlsConnect, type ImapResponse } from './tls-client';
import { MailDeliveryError, type MailEnvelope, type MailFilterRule, type MailPort } from './mail.port';

type ReadableSocket = net.Socket | tls.TLSSocket;
type MailIo = Awaited<ReturnType<typeof tlsConnect>>;
/** Chuỗi quoted IMAP (RFC 3501): thoát `\` và `"`; không cho CR/LF. */
function imapQuote(value: string) { if (/[\r\n]/.test(value)) throw new Error('MAIL_IMAP_VALUE_INVALID'); return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
/** Literal của mục `section` trong các phản hồi `* n FETCH (...)`, kèm UID của phản hồi đó. */
function fetchedLiterals(untagged: ImapResponse[], section: RegExp) {
  const rows: { uid: string; literal: Buffer }[] = [];
  const target = new RegExp(`[( ]${section.source} ${IMAP_LITERAL_MARK}(\\d+)${IMAP_LITERAL_MARK}`, 'i');
  for (const response of untagged) {
    if (!/^\* \d+ FETCH \(/i.test(response.text)) continue;
    const uid = /[( ]UID (\d+)[ )]/i.exec(response.text)?.[1], index = target.exec(response.text)?.[1];
    if (uid && index !== undefined) rows.push({ uid, literal: response.literals[Number(index)] });
  }
  return rows;
}
/**
 * Message-ID làm engineId đọc bằng cùng parser với metadata (mailparser, chỉ phần header):
 * dòng giống header trong thân thư không được tính, thư thiếu Message-ID trả undefined.
 */
export async function headerMessageId(raw: Buffer) {
  const text = raw.toString('latin1'), blank = /\r?\n\r?\n/.exec(text);
  const head = Buffer.from(blank ? text.slice(0, blank.index + blank[0].length) : text, 'latin1');
  const parsed = await simpleParser(head, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true });
  const id = String(parsed.messageId ?? '').replace(/[<>]/g, '').trim();
  return id || undefined;
}
function bufferedReader(socket: ReadableSocket) {
  let buffer = '', cursor = 0;
  socket.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8'); });
  return (target: RegExp, timeoutMs = 10_000) => new Promise<string>((resolve, reject) => {
    const start = cursor;
    const check = () => {
      const part = buffer.slice(start), match = target.exec(part);
      if (!match) return;
      cleanup();
      cursor = start + match.index + match[0].length;
      resolve(part.slice(0, match.index + match[0].length));
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); socket.off('data', check); socket.off('error', fail); };
    const timer = setTimeout(() => fail(new Error('MAIL_PROTOCOL_TIMEOUT')), timeoutMs);
    socket.on('data', check); socket.on('error', fail); check();
  });
}

export class StalwartMailPort implements MailPort {
  constructor(private cfg: { host: string; smtpPort: number; imapPort: number; sievePort: number; controlPort: number; controlToken: string; credentials: Record<string,{username:string;password:string}>; management?: {baseUrl:string;username:string;password:string} }) {if(!cfg.controlToken)throw new Error('MAIL_CONTROL_TOKEN_MISSING');}
  private credential(owner:string){ const c=this.cfg.credentials[owner.toLowerCase()]; if(!c) throw new Error('MAIL_CREDENTIAL_MISSING'); return c; }
  async deliver(envelope: MailEnvelope, raw: Buffer) {
    let outcome:'no'|'unknown'='no',opened:MailIo|undefined;try{
    const id=raw.toString('utf8').match(/^Message-ID:\s*<([^>]+)>/mi)?.[1]; if(!id) throw new Error('MAIL_MESSAGE_ID_MISSING');
    const authOwner=(envelope.authOwner??envelope.from).toLowerCase();const c=this.credential(authOwner); const io=await tlsConnect(this.cfg.host,this.cfg.smtpPort);opened=io;
    const read=(pattern:RegExp)=>io.read(pattern,30_000);
    await read(/^220/m); io.write('EHLO vcworkspace.test\r\n'); await read(/250[ -].*AUTH.*PLAIN/im);
    io.write(`AUTH PLAIN ${Buffer.from(`\0${c.username}\0${c.password}`).toString('base64')}\r\n`); await read(/^235/m);
    // SMTP envelope dùng mailbox đã AUTH để không đòi credential riêng cho alias/shared;
    // MIME From vẫn là identity đã được API kiểm ACL, nên client nhận/reply đúng danh tính.
    io.write(`MAIL FROM:<${envelope.from.toLowerCase()}>\r\n`); if(!/^250/m.test(await read(/^[245]\d\d.*$/m)))throw new Error('MAIL_SMTP_FROM_REJECTED');
    const sentMailbox=(envelope.sentMailbox??authOwner).toLowerCase();
    for(const to of [...new Set([...envelope.to,sentMailbox])]){io.write(`RCPT TO:<${to}>\r\n`);const response=await read(/^[245]\d\d.*$/m);if(!/^250/m.test(response))throw new Error(`MAIL_SMTP_RCPT_REJECTED:${response.trim().slice(-120)}`);}
    io.write('DATA\r\n');await read(/^354/m).catch(()=>{throw new Error('MAIL_SMTP_DATA_TIMEOUT');});outcome='unknown';io.write(Buffer.concat([raw,Buffer.from('\r\n.\r\n')]));await read(/^250/m).catch(()=>{throw new Error('MAIL_SMTP_ACCEPT_TIMEOUT');});io.end();
    return {accepted:[...envelope.to],engineIds:Object.fromEntries([sentMailbox,...envelope.to].map(x=>[x.toLowerCase(),id]))};
    }catch(error){if(error instanceof MailDeliveryError)throw error;throw new MailDeliveryError((error as Error)?.message??'MAIL_DELIVERY_FAILED',outcome);}finally{opened?.close();}
  }
  private engineFolder(folder?:string,engineMailbox?:string,accessOwner?:string){const logical=folder?.toLowerCase(),value=!logical||logical==='inbox'||logical==='sent'?'INBOX':folder!;if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value))throw new Error('MAIL_FOLDER_INVALID');if(engineMailbox&&accessOwner&&engineMailbox.toLowerCase()!==accessOwner.toLowerCase()){if(!/^[a-z0-9._%+-]+@vcworkspace\.test$/.test(engineMailbox))throw new Error('MAIL_MAILBOX_INVALID');return `Shared Folders/${engineMailbox}/${value}`;}return value;}
  async raw(accessOwner:string, engineId:string, folder?:string,engineMailbox?:string) {
    return this.withImap(accessOwner,async io=>{
      const uid=await this.uid(io,engineId,folder,engineMailbox,accessOwner);
      const fetched=fetchedLiterals(await this.imapCommand(io,'a4',`UID FETCH ${uid} BODY.PEEK[]`),/BODY\[\]/).find(x=>x.uid===uid);
      if(!fetched)throw new Error('MAIL_FETCH_INVALID');
      return fetched.literal;
    });
  }

  /** Lệnh IMAP có tag: chỉ dòng hoàn tất nằm ngoài literal được tính; NO/BAD báo lỗi ngay. */
  private async imapCommand(io:MailIo,tag:string,command:string){io.write(`${tag} ${command}\r\n`);const done=await io.readImap(tag);if(done.status!=='OK')throw new Error(`MAIL_IMAP_${done.status}:${tag}`);return done.untagged;}
  /** Mở phiên IMAP đã LOGIN và luôn đóng socket, kể cả khi lỗi. */
  private async withImap<T>(owner:string,work:(io:MailIo)=>Promise<T>){const c=this.credential(owner),io=await tlsConnect(this.cfg.host,this.cfg.imapPort);try{await io.readImapGreeting();await this.imapCommand(io,'a1',`LOGIN ${imapQuote(c.username)} ${imapQuote(c.password)}`);return await work(io);}finally{io.close();}}
  /** UID của thư có Message-ID (đọc bằng parser header) đúng engineId; thư thiếu Message-ID không khớp thư nào. */
  private async uid(io:MailIo,engineId:string,folder?:string,engineMailbox?:string,accessOwner?:string){
    await this.imapCommand(io,'a2',`SELECT "${this.engineFolder(folder,engineMailbox,accessOwner)}"`);
    const rows=fetchedLiterals(await this.imapCommand(io,'a3','UID FETCH 1:* (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])'),/BODY\[HEADER\.FIELDS \([^\]]*\)\]/),target=engineId.toLowerCase();
    for(const row of rows)if((await headerMessageId(row.literal))?.toLowerCase()===target)return row.uid;
    throw new Error('MAIL_NOT_FOUND');
  }
  private keyword(label:string){return `VC-${Buffer.from(label,'utf8').toString('hex')}`;}
  async setLabels(accessOwner:string,engineId:string,labels:string[],previousLabels:string[]=[],folder?:string,engineMailbox?:string){await this.withImap(accessOwner,async io=>{const uid=await this.uid(io,engineId,folder,engineMailbox,accessOwner),flags=labels.map(x=>this.keyword(x)),old=previousLabels.map(x=>this.keyword(x));if(old.length)await this.imapCommand(io,'a4',`UID STORE ${uid} -FLAGS.SILENT (${old.join(' ')})`);if(flags.length)await this.imapCommand(io,'a5',`UID STORE ${uid} +FLAGS.SILENT (${flags.join(' ')})`);const read=(await this.imapCommand(io,'a6',`UID FETCH ${uid} FLAGS`)).filter(x=>/^\* \d+ FETCH \(/i.test(x.text)&&new RegExp(`[( ]UID ${uid}[ )]`,'i').test(x.text)).map(x=>x.text).join('\n');const has=(flag:string)=>new RegExp(`[( ]${flag}[ )]`,'i').test(read);if(flags.some(x=>!has(x))||old.filter(x=>!flags.includes(x)).some(has))throw new Error('MAIL_LABEL_READBACK_FAILED');});}

  private sieveScript(filters:MailFilterRule[]){const quote=(x:string)=>`"${x.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;const lines=['require ["fileinto", "imap4flags", "body"];'];for(const f of filters){const match=f.operator==='equals'?':is':':contains',header=f.field==='body'?undefined:f.field==='to'?'To':f.field==='from'?'From':'Subject';const test=header?`header ${match} ${quote(header)} ${quote(f.value)}`:`body ${match} ${quote(f.value)}`;const actions=[...f.addLabels.map(x=>`addflag ${quote(this.keyword(x))};`),...(f.moveToFolder?[`fileinto ${quote(f.moveToFolder)};`]:[]),...(f.stop?['stop;']:[])];lines.push(`if ${test} { ${actions.join(' ')} }`);}return `${lines.join('\r\n')}\r\n`;}
  private async sieveConnection(owner:string){
    const ok=/^(?:OK(?: .*)?|.*"\s+OK)\r?$/m;
    const credential=this.credential(owner),socket=net.connect({host:this.cfg.host,port:this.cfg.sievePort}),read=bufferedReader(socket);
    await read(ok);socket.write('STARTTLS\r\n');await read(ok);
    const secure=tls.connect({socket,servername:'mail.vcworkspace.test',rejectUnauthorized:false});
    await new Promise<void>((ok,no)=>{secure.once('secureConnect',()=>ok());secure.once('error',no);});
    const wait=bufferedReader(secure);
    secure.write('CAPABILITY\r\n');await wait(ok);
    secure.write(`AUTHENTICATE "PLAIN" "${Buffer.from(`\0${credential.username}\0${credential.password}`).toString('base64')}"\r\n`);await wait(/^OK "Authentication successful"\r?$/m);
    return {secure,wait,ok};
  }
  private async closeSieve(secure:tls.TLSSocket){await new Promise<void>((resolve)=>{secure.once('close',()=>resolve());secure.end();});}
  private async sieve(owner:string,script:string){
    const installed=await this.sieveConnection(owner);
    const {secure,wait,ok}=installed;
    secure.write(`PUTSCRIPT "vcworkspace" {${Buffer.byteLength(script)}+}\r\n${script}\r\n`);await wait(ok);
    secure.write('SETACTIVE "vcworkspace"\r\n');await wait(ok);
    await this.closeSieve(secure);
    const verified=await this.sieveConnection(owner);
    verified.secure.write('LISTSCRIPTS\r\n');const readback=await verified.wait(verified.ok);
    verified.secure.write('GETSCRIPT "vcworkspace"\r\n');const content=await verified.wait(verified.ok);
    await this.closeSieve(verified.secure);
    if(!/"vcworkspace"\s+ACTIVE/i.test(readback)||!content.includes(script.trim()))throw new Error('MAIL_SIEVE_READBACK_FAILED');
  }
  private async ensureFilterFolders(owner:string,filters:MailFilterRule[]){const folders=[...new Set(filters.map(x=>x.moveToFolder).filter((x):x is string=>!!x))];if(!folders.length)return;await this.withImap(owner,async io=>{let index=10;for(const folder of folders){const tag=`c${index++}`,safe=this.engineFolder(folder);io.write(`${tag} CREATE "${safe}"\r\n`);const result=await io.readImap(tag);if(result.status==='BAD')throw new Error(`MAIL_IMAP_BAD:${tag}`);if(result.status==='NO')await this.imapCommand(io,`c${index++}`,`SELECT "${safe}"`);}});}
  async installFilters(owner:string,filters:MailFilterRule[]){await this.ensureFilterFolders(owner,filters);await this.sieve(owner,this.sieveScript(filters));}

  private async jmap(calls:any[]){const m=this.cfg.management;if(!m)throw new Error('MAIL_MANAGEMENT_CREDENTIAL_MISSING');const auth=`Basic ${Buffer.from(`${m.username}:${m.password}`).toString('base64')}`,base=m.baseUrl.replace(/\/$/,'');const session=await fetch(`${base}/jmap/session`,{headers:{Authorization:auth}});if(!session.ok)throw new Error('MAIL_MANAGEMENT_SESSION_FAILED');const data:any=await session.json(),apiUrl=`${base}${new URL(data.apiUrl,base).pathname}`;const response=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'content-type':'application/json'},body:JSON.stringify({using:Object.keys(data.capabilities),methodCalls:calls})});if(!response.ok)throw new Error('MAIL_MANAGEMENT_REQUEST_FAILED');const json:any=await response.json();if(json.methodResponses?.some((x:any[])=>x[0]==='error'||x[1]?.notCreated||x[1]?.notUpdated))throw new Error(`MAIL_MANAGEMENT_REJECTED:${JSON.stringify(json.methodResponses).slice(0,600)}`);return json.methodResponses;}
  private local(address:string){return address.toLowerCase().split('@')[0];}
  private async account(address:string){const result=await this.jmap([['x:Account/query',{filter:{name:this.local(address)}},'q'],['x:Account/get',{'#ids':{resultOf:'q',name:'x:Account/query',path:'/ids'}},'g']]);const row=result.find((x:any[])=>x[0]==='x:Account/get')?.[1]?.list?.[0];if(!row)throw new Error('MAIL_ACCOUNT_NOT_FOUND');return row;}
  async provisionAlias(owner:string,address:string){const row=await this.account(owner),aliases={...(row.aliases??{})},name=this.local(address),values=Object.values(aliases) as any[];if(!values.some(x=>x.name===name&&x.domainId===row.domainId))aliases[String(Math.max(-1,...Object.keys(aliases).map(Number).filter(Number.isFinite))+1)]={name,domainId:row.domainId,enabled:true};await this.jmap([['x:Account/set',{update:{[row.id]:{aliases}}},'u']]);const verified=await this.account(owner);if(!(Object.values(verified.aliases??{}) as any[]).some(x=>x.name===name&&x.domainId===row.domainId&&x.enabled!==false))throw new Error('MAIL_ALIAS_READBACK_FAILED');}
  async releaseAlias(owner:string,address:string){const row=await this.account(owner),name=this.local(address),match=(x:any)=>x.name===name&&x.domainId===row.domainId,aliases=Object.fromEntries(Object.entries(row.aliases??{}).filter(([,x])=>!match(x)));await this.jmap([['x:Account/set',{update:{[row.id]:{aliases}}},'u']]);const verified=await this.account(owner);if((Object.values(verified.aliases??{}) as any[]).some(match))throw new Error('MAIL_ALIAS_RELEASE_READBACK_FAILED');}
  async provisionShared(address:string){try{await this.account(address);return;}catch{}const owner=await this.account(Object.keys(this.cfg.credentials)[0]??''),local=this.local(address);await this.jmap([['x:Account/set',{create:{shared:{'@type':'Group',name:local,domainId:owner.domainId,description:'VCworkspace shared mailbox',roles:{'@type':'Default'},permissions:{'@type':'Inherit'},quotas:{},aliases:[]}}},'c']]);await this.account(address);}
  private async kickImapSessions(principal:string){if(!/^[a-z0-9._%+-]+@vcworkspace\.test$/.test(principal.toLowerCase()))throw new Error('MAIL_PRINCIPAL_INVALID');const socket=net.connect({host:this.cfg.host,port:this.cfg.controlPort}),read=bufferedReader(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});socket.write(`AUTH ${this.cfg.controlToken} KICK IMAP ${principal.toLowerCase()}\n`);await read(/^OK \d+$/m);socket.end();}
  async setSharedMember(address:string,member:string,enabled:boolean){const [group,user]=await Promise.all([this.account(address),this.account(member)]),ids={...(user.memberGroupIds??{})};if(enabled)ids[group.id]=true;else delete ids[group.id];await this.jmap([['x:Account/set',{update:{[user.id]:{memberGroupIds:ids}}},'u']]);const verified=await this.account(member);if((verified.memberGroupIds?.[group.id]===true)!==enabled)throw new Error('MAIL_GROUP_READBACK_FAILED');if(!enabled)await this.kickImapSessions(member);}
  async offboardUser(address:string){const user=await this.account(address),aliases=Object.fromEntries(Object.entries(user.aliases??{}).map(([key,value]:[string,any])=>[key,{...value,enabled:false}]));await this.jmap([['x:Account/set',{update:{[user.id]:{memberGroupIds:{},aliases,secrets:[]}}},'u']]);const verified=await this.account(address);if(Object.keys(verified.memberGroupIds??{}).length||Object.values(verified.aliases??{}).some((x:any)=>x.enabled!==false)||(verified.secrets??[]).length)throw new Error('MAIL_OFFBOARD_READBACK_FAILED');await this.kickImapSessions(address);}
  async listFolder(accessOwner:string,folder='inbox',engineMailbox?:string){
    return this.withImap(accessOwner,async io=>{
      await this.imapCommand(io,'s1',`SELECT "${this.engineFolder(folder,engineMailbox,accessOwner)}"`);
      const searched=await this.imapCommand(io,'s2','UID SEARCH ALL'),uids=searched.flatMap(x=>/^\* SEARCH((?: \d+)*)\s*$/i.exec(x.text)?.[1].trim().split(/\s+/).filter(Boolean)??[]),items:{engineId:string;raw:Buffer}[]=[];
      let index=3;
      for(const uid of uids){
        const fetched=fetchedLiterals(await this.imapCommand(io,`s${index++}`,`UID FETCH ${uid} BODY.PEEK[]`),/BODY\[\]/).find(x=>x.uid===uid);
        if(!fetched)continue;
        // Thư thiếu Message-ID ở header không có khoá engine ổn định nên bị bỏ qua, không làm hỏng cả danh sách.
        const engineId=await headerMessageId(fetched.literal);
        if(engineId)items.push({engineId,raw:fetched.literal});
      }
      return items;
    });
  }
}
