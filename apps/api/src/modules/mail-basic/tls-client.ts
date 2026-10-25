import tls from 'tls';

/** Một phản hồi IMAP đủ dòng: mỗi literal `{N}` được thay bằng `\0<chỉ số>\0` trong `text` và giữ nguyên byte ở `literals`. */
export type ImapResponse = { text: string; literals: Buffer[] };
export type ImapCompletion = { status: 'OK' | 'NO' | 'BAD'; text: string; untagged: ImapResponse[] };
export const IMAP_LITERAL_MARK = '\u0000';
const MAX_IMAP_LITERAL = 64 * 1024 * 1024;

/**
 * Đọc đúng một phản hồi IMAP từ `from` (RFC 3501 §4.3): dòng kết thúc bằng `{N}` (hoặc `{N+}`) thì
 * N byte kế tiếp là literal, không bao giờ được hiểu là dòng hoàn tất có tag. Trả null khi chưa đủ byte.
 * `buffer` là chuỗi latin1 nên một ký tự đúng bằng một byte.
 */
export function parseImapResponse(buffer: string, from: number): (ImapResponse & { next: number }) | null {
  let text = '', pos = from;
  const literals: Buffer[] = [];
  for (;;) {
    const eol = buffer.indexOf('\r\n', pos);
    if (eol < 0) return null;
    const line = buffer.slice(pos, eol);
    if (line.includes(IMAP_LITERAL_MARK)) throw new Error('MAIL_IMAP_INVALID_RESPONSE');
    const literal = /\{(\d{1,10})\+?\}$/.exec(line);
    if (!literal) return { text: text + line, literals, next: eol + 2 };
    const size = Number(literal[1]);
    if (size > MAX_IMAP_LITERAL) throw new Error('MAIL_IMAP_LITERAL_TOO_LARGE');
    const start = eol + 2, end = start + size;
    if (buffer.length < end) return null;
    text += `${line.slice(0, literal.index)}${IMAP_LITERAL_MARK}${literals.length}${IMAP_LITERAL_MARK}`;
    literals.push(Buffer.from(buffer.slice(start, end), 'latin1'));
    pos = end;
  }
}

export async function tlsConnect(host:string,port:number){
  if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('MAIL_EGRESS_BLOCKED');
  const socket=tls.connect({host,port,servername:'mail.vcworkspace.test',rejectUnauthorized:false});let buffer='',cursor=0,closed=false;
  socket.on('data',d=>{buffer+=d.toString('latin1');});
  socket.on('close',()=>{closed=true;});
  await new Promise<void>((ok,no)=>{socket.once('secureConnect',ok);socket.once('error',no)});
  /** Bỏ phần đã đọc để bộ đệm không phình theo cả phiên. */
  const consume=(to:number)=>{buffer=buffer.slice(to);cursor=0;};
  /** Chờ tới khi `step` trả kết quả; lỗi socket hoặc socket đóng thì báo ngay, không chờ hết hạn. */
  const wait=<T>(step:()=>T|undefined,label:string,timeoutMs:number)=>new Promise<T>((ok,no)=>{
    const check=()=>{let value:T|undefined;try{value=step();}catch(error){fail(error as Error);return;}if(value!==undefined){cleanup();ok(value);}else if(closed)fail(new Error(`MAIL_PROTOCOL_CLOSED:${label}`));};
    const fail=(error:Error)=>{cleanup();no(error);};
    const onClose=()=>{closed=true;check();};
    const cleanup=()=>{clearTimeout(timer);socket.off('data',check);socket.off('error',fail);socket.off('close',onClose);};
    const timer=setTimeout(()=>fail(new Error(`MAIL_PROTOCOL_TIMEOUT:${label}`)),timeoutMs);
    socket.on('data',check);socket.on('error',fail);socket.on('close',onClose);check();
  });
  return {
    /** Đọc tới khớp regex đầu tiên; chỉ dùng cho SMTP (không có literal). */
    read:(re:RegExp,timeoutMs=10000)=>wait(()=>{const match=re.exec(buffer.slice(cursor));if(!match)return undefined;const end=cursor+match.index+match[0].length,text=buffer.slice(cursor,end);consume(end);return text;},re.source,timeoutMs),
    /** Đọc phản hồi chào của IMAP (một phản hồi không tag). */
    readImapGreeting:(timeoutMs=10000)=>wait(()=>{const r=parseImapResponse(buffer,cursor);if(!r)return undefined;consume(r.next);if(!/^\* (?:OK|PREAUTH)\b/i.test(r.text))throw new Error('MAIL_IMAP_GREETING_REJECTED');return r.text;},'greeting',timeoutMs),
    /** Đọc các phản hồi tới dòng hoàn tất của `tag` nằm ngoài mọi literal; trả trạng thái OK/NO/BAD. */
    readImap:(tag:string,timeoutMs=10000)=>{const untagged:ImapResponse[]=[];return wait<ImapCompletion>(()=>{
      for(let r=parseImapResponse(buffer,cursor);r;r=parseImapResponse(buffer,cursor)){
        consume(r.next);
        if(r.text.startsWith('* ')){untagged.push({text:r.text,literals:r.literals});continue;}
        const done=/^(\S+) (OK|NO|BAD)\b/i.exec(r.text);
        if(!done||done[1]!==tag)throw new Error(`MAIL_IMAP_UNEXPECTED_RESPONSE:${tag}`);
        return {status:done[2].toUpperCase() as ImapCompletion['status'],text:r.text,untagged};
      }
      return undefined;
    },tag,timeoutMs);},
    write:(x:string|Buffer)=>socket.write(x),
    end:()=>socket.end(),
    /** Đóng kết nối; dùng trong finally cho cả nhánh lỗi. */
    close:()=>{if(socket.destroyed)return;socket.end();setTimeout(()=>socket.destroy(),1000).unref();},
  };
}
