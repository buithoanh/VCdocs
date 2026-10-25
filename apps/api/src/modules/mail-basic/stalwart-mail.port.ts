import * as net from 'net';
import * as tls from 'tls';
import { tlsConnect } from './tls-client';
import { MailDeliveryError, type MailEnvelope, type MailFilterRule, type MailPort } from './mail.port';

type ReadableSocket = net.Socket | tls.TLSSocket;
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
    let outcome:'no'|'unknown'='no';try{
    const id=raw.toString('utf8').match(/^Message-ID:\s*<([^>]+)>/mi)?.[1]; if(!id) throw new Error('MAIL_MESSAGE_ID_MISSING');
    const authOwner=(envelope.authOwner??envelope.from).toLowerCase();const c=this.credential(authOwner); const io=await tlsConnect(this.cfg.host,this.cfg.smtpPort);
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
    }catch(error){if(error instanceof MailDeliveryError)throw error;throw new MailDeliveryError((error as Error)?.message??'MAIL_DELIVERY_FAILED',outcome);}
  }
  private engineFolder(folder?:string,engineMailbox?:string,accessOwner?:string){const logical=folder?.toLowerCase(),value=!logical||logical==='inbox'||logical==='sent'?'INBOX':folder!;if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value))throw new Error('MAIL_FOLDER_INVALID');if(engineMailbox&&accessOwner&&engineMailbox.toLowerCase()!==accessOwner.toLowerCase()){if(!/^[a-z0-9._%+-]+@vcworkspace\.test$/.test(engineMailbox))throw new Error('MAIL_MAILBOX_INVALID');return `Shared Folders/${engineMailbox}/${value}`;}return value;}
  async raw(accessOwner:string, engineId:string, folder?:string,engineMailbox?:string) {
    const io=await this.imap(accessOwner),uid=await this.uid(io,engineId,folder,engineMailbox,accessOwner);
    io.write(`a4 UID FETCH ${uid} BODY.PEEK[]\r\n`);const all=await io.read(/^a4 OK/m);io.end();const marker=all.indexOf('BODY[] {'),start=all.indexOf('\r\n',marker)+2,end=all.lastIndexOf('\r\na4 OK');if(marker<0||end<start)throw new Error('MAIL_FETCH_INVALID');return Buffer.from(all.slice(start,end),'latin1');
  }

  private async imap(owner:string){const c=this.credential(owner),io=await tlsConnect(this.cfg.host,this.cfg.imapPort);await io.read(/^\* OK/m);io.write(`a1 LOGIN "${c.username}" "${c.password}"\r\n`);await io.read(/^a1 OK/m);return io;}
  private async uid(io:Awaited<ReturnType<typeof tlsConnect>>,engineId:string,folder?:string,engineMailbox?:string,accessOwner?:string){io.write(`a2 SELECT "${this.engineFolder(folder,engineMailbox,accessOwner)}"\r\n`);await io.read(/^a2 OK/m);io.write('a3 UID FETCH 1:* (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])\r\n');const found=await io.read(/^a3 OK/m),target=engineId.toLowerCase();for(const match of found.matchAll(/\* \d+ FETCH \(UID (\d+)[\s\S]*?Message-ID:\s*<([^>]+)>[\s\S]*?(?=\r\n\* \d+ FETCH|\r\na3 OK)/gi))if(match[2].toLowerCase()===target)return match[1];throw new Error('MAIL_NOT_FOUND');}
  private keyword(label:string){return `VC-${Buffer.from(label,'utf8').toString('hex')}`;}
  async setLabels(accessOwner:string,engineId:string,labels:string[],previousLabels:string[]=[],folder?:string,engineMailbox?:string){const io=await this.imap(accessOwner),uid=await this.uid(io,engineId,folder,engineMailbox,accessOwner),flags=labels.map(x=>this.keyword(x)),old=previousLabels.map(x=>this.keyword(x));if(old.length){io.write(`a4 UID STORE ${uid} -FLAGS.SILENT (${old.join(' ')})\r\n`);await io.read(/^a4 OK/m);}if(flags.length){io.write(`a5 UID STORE ${uid} +FLAGS.SILENT (${flags.join(' ')})\r\n`);await io.read(/^a5 OK/m);}io.write(`a6 UID FETCH ${uid} FLAGS\r\n`);const read=await io.read(/^a6 OK/m);io.end();if(flags.some(x=>!read.includes(x))||old.filter(x=>!flags.includes(x)).some(x=>read.includes(x)))throw new Error('MAIL_LABEL_READBACK_FAILED');}

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
  private async ensureFilterFolders(owner:string,filters:MailFilterRule[]){const folders=[...new Set(filters.map(x=>x.moveToFolder).filter((x):x is string=>!!x))];if(!folders.length)return;const io=await this.imap(owner);let index=10;for(const folder of folders){const tag=`c${index++}`,safe=this.engineFolder(folder);io.write(`${tag} CREATE "${safe}"\r\n`);const result=await io.read(new RegExp(`^${tag} (?:OK|NO).*$`,'m'));if(new RegExp(`^${tag} NO`,'m').test(result)){const verify=`c${index++}`;io.write(`${verify} SELECT "${safe}"\r\n`);await io.read(new RegExp(`^${verify} OK.*$`,'m'));}}io.end();}
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
  async listFolder(accessOwner:string,folder='inbox',engineMailbox?:string){const io=await this.imap(accessOwner);io.write(`s1 SELECT "${this.engineFolder(folder,engineMailbox,accessOwner)}"\r\n`);await io.read(/^s1 OK/m);io.write('s2 UID SEARCH ALL\r\n');const searched=await io.read(/^s2 OK/m),uids=(searched.match(/^\* SEARCH(.*)$/m)?.[1]??'').trim().split(/\s+/).filter(Boolean),items:{engineId:string;raw:Buffer}[]=[];let index=3;for(const uid of uids){const tag=`s${index++}`;io.write(`${tag} UID FETCH ${uid} BODY.PEEK[]\r\n`);const all=await io.read(new RegExp(`^${tag} OK`,'m')),marker=all.indexOf('BODY[] {'),start=all.indexOf('\r\n',marker)+2,end=all.lastIndexOf(`\r\n${tag} OK`);if(marker<0||end<start)continue;const raw=Buffer.from(all.slice(start,end),'latin1'),engineId=raw.toString('utf8').match(/^Message-ID:\s*<([^>]+)>/mi)?.[1];if(engineId)items.push({engineId,raw});}io.end();return items;}
}
