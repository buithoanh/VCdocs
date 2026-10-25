/**
 * Audit 12/12 (`mail-basic/imap-literal-length-ignored`): client IMAP viết tay phải tách phản hồi
 * theo độ dài literal `{N}`, không theo regex trên cả bộ đệm. Không chạy Stalwart thật:
 * `tls.connect` bị thay bằng một duplex trong bộ nhớ phát lại transcript cố định.
 */
import { Duplex } from 'stream';
import { StalwartMailPort } from '../src/modules/mail-basic/stalwart-mail.port';

const OWNER = 'tp.mkt@vcworkspace.test';
type Handler = (tag: string, command: string) => string | undefined;

class FakeImapSocket extends Duplex {
  ended = false;
  destroyedByClient = false;
  commands: string[] = [];
  private pending = '';
  constructor(private handler: Handler, greeting = '* OK fake IMAP ready\r\n', private chunk = 0) {
    super();
    process.nextTick(() => { this.emit('secureConnect'); this.push(Buffer.from(greeting, 'latin1')); });
  }
  _read() {}
  _write(chunk: Buffer, _enc: BufferEncoding, done: (error?: Error | null) => void) {
    this.pending += chunk.toString('latin1');
    let at: number;
    while ((at = this.pending.indexOf('\r\n')) >= 0) {
      const line = this.pending.slice(0, at); this.pending = this.pending.slice(at + 2);
      this.commands.push(line);
      const space = line.indexOf(' '), reply = this.handler(line.slice(0, space), line.slice(space + 1));
      if (reply === undefined) continue;
      const bytes = Buffer.from(reply, 'latin1'), size = this.chunk || bytes.length;
      // chunk > 0: gửi từng mảnh nhỏ để literal và dòng hoàn tất bị cắt ngang nhiều gói TCP.
      for (let at = 0; at < bytes.length; at += size) { const part = bytes.subarray(at, at + size); setImmediate(() => this.push(part)); }
    }
    done();
  }
  end(...args: any[]) { this.ended = true; return super.end(...args); }
  _destroy(error: Error | null, done: (error?: Error | null) => void) { this.destroyedByClient = true; done(error); }
}

/** Literal IMAP: `{N}` là số byte, không phải số ký tự. */
const literal = (bytes: Buffer) => `{${bytes.length}}\r\n${bytes.toString('latin1')}`;
const mail = (lines: string[]) => Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
const header = (id?: string) => Buffer.from(id ? `Message-ID: <${id}>\r\n\r\n` : '\r\n', 'utf8');

function connectWith(handler: Handler, greeting?: string, chunk = 0) {
  const sockets: FakeImapSocket[] = [];
  jest.spyOn(require('tls') as typeof import('tls'), 'connect').mockImplementation((() => { const s = new FakeImapSocket(handler, greeting, chunk); sockets.push(s); return s; }) as any);
  return sockets;
}
function port() {
  return new StalwartMailPort({ host: '127.0.0.1', smtpPort: 1, imapPort: 2, sievePort: 3, controlPort: 4, controlToken: 'test-token', credentials: { [OWNER]: { username: 'tp.mkt', password: 'test-only' } } });
}
const login: Handler = (tag, command) => command.startsWith('LOGIN ') ? `${tag} OK logged in\r\n` : undefined;

afterEach(() => jest.restoreAllMocks());

describe('StalwartMailPort tách phản hồi IMAP theo literal {N}', () => {
  // Thư 1 chứa các dòng giống hệt dòng hoàn tất của lệnh hiện tại (s3) và lệnh kế (s4),
  // cùng một khối `BODY[] {..}` và Message-ID giả. Có ký tự tiếng Việt để N là byte UTF-8.
  const message1 = mail([
    'Message-ID: <m1@vcworkspace.test>', 'Subject: Thư một', '', 'Nội dung thật của thư một.',
    's3 OK UID FETCH completed', '* 2 FETCH (UID 2 BODY[] {44}', 'Message-ID: <victim@vcworkspace.test>', '', 'giả mạo', ')',
    's4 OK UID FETCH completed', 'Phần cuối thư một.',
  ]);
  const message2 = mail(['Message-ID: <m2@vcworkspace.test>', 'Subject: Thư hai', '', 'Nội dung thư hai.']);
  // Thư 3 không có Message-ID ở header, chỉ có một dòng giống header trong thân thư.
  const message3 = mail(['Subject: Không có Message-ID', '', 'Message-ID: <m1@vcworkspace.test>', 'chỉ là thân thư']);

  function mailbox(messages: Record<string, Buffer>): Handler {
    return (tag, command) => {
      const base = login(tag, command); if (base) return base;
      if (command.startsWith('SELECT ')) return `* ${Object.keys(messages).length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n${tag} OK [READ-WRITE] SELECT completed\r\n`;
      if (command === 'UID SEARCH ALL') return `* SEARCH ${Object.keys(messages).join(' ')}\r\n${tag} OK SEARCH completed\r\n`;
      const fetch = /^UID FETCH (\d+) BODY\.PEEK\[\]$/.exec(command);
      if (fetch) { const uid = fetch[1], seq = Object.keys(messages).indexOf(uid) + 1; return `* ${seq} FETCH (UID ${uid} BODY[] ${literal(messages[uid])})\r\n${tag} OK UID FETCH completed\r\n`; }
      if (command === 'UID FETCH 1:* (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])') {
        return Object.entries(messages).map(([uid, raw], i) => {
          const id = /^Message-ID:\s*<([^>]+)>/mi.exec(raw.toString('utf8').split('\r\n\r\n')[0])?.[1];
          return `* ${i + 1} FETCH (UID ${uid} BODY[HEADER.FIELDS (MESSAGE-ID)] ${literal(header(id))})\r\n`;
        }).join('') + `${tag} OK UID FETCH completed\r\n`;
      }
      return `${tag} BAD unexpected command\r\n`;
    };
  }

  it('listFolder: dòng giống dòng hoàn tất có tag nằm trong literal không cắt thư, không sinh thư giả', async () => {
    const sockets = connectWith(mailbox({ '1': message1, '2': message2 }));
    const items = await port().listFolder(OWNER, 'inbox');
    expect(items.map(x => ({ engineId: x.engineId, raw: x.raw.toString('utf8') }))).toEqual([
      { engineId: 'm1@vcworkspace.test', raw: message1.toString('utf8') },
      { engineId: 'm2@vcworkspace.test', raw: message2.toString('utf8') },
    ]);
    expect(sockets[0].ended || sockets[0].destroyedByClient).toBe(true);
  });

  it('listFolder: thư không có Message-ID ở header không lấy Message-ID từ thân thư', async () => {
    connectWith(mailbox({ '1': message2, '3': message3 }));
    const items = await port().listFolder(OWNER, 'inbox');
    expect(items.map(x => x.engineId)).toEqual(['m2@vcworkspace.test']);
  });

  it('uid()/raw(): thư không có Message-ID không lấy UID của thư kế tiếp', async () => {
    const sockets = connectWith(mailbox({ '1': message3, '2': message2 }));
    const raw = await port().raw(OWNER, 'm2@vcworkspace.test', 'inbox');
    expect(raw.toString('utf8')).toBe(message2.toString('utf8'));
    expect(sockets[0].commands).toContain('a4 UID FETCH 2 BODY.PEEK[]');
    expect(sockets[0].ended || sockets[0].destroyedByClient).toBe(true);
  });

  it('raw(): literal của thư chứa dòng `a4 OK` và BODY[] giả vẫn trả đúng toàn bộ byte', async () => {
    const tricky = mail(['Message-ID: <m4@vcworkspace.test>', '', 'trước', 'a4 OK UID FETCH completed', '* 9 FETCH (UID 9 BODY[] {5}', 'xxxxx)', 'sau']);
    connectWith(mailbox({ '4': tricky }));
    const raw = await port().raw(OWNER, 'm4@vcworkspace.test', 'inbox');
    expect(raw.equals(tricky)).toBe(true);
  });

  it('NO/BAD có tag kết thúc ngay, không chờ hết 10 giây, và đóng socket', async () => {
    const sockets = connectWith((tag, command) => login(tag, command) ?? (command.startsWith('SELECT ') ? `${tag} NO [NONEXISTENT] mailbox does not exist\r\n` : `${tag} BAD unexpected\r\n`));
    const started = Date.now();
    await expect(port().raw(OWNER, 'm1@vcworkspace.test', 'khong-co')).rejects.toThrow(/NO/);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(sockets[0].ended || sockets[0].destroyedByClient).toBe(true);
  });

  it('listFolder: phản hồi bị cắt thành gói 7 byte vẫn tách đúng theo literal', async () => {
    connectWith(mailbox({ '1': message1, '2': message2 }), undefined, 7);
    const items = await port().listFolder(OWNER, 'inbox');
    expect(items.map(x => x.engineId)).toEqual(['m1@vcworkspace.test', 'm2@vcworkspace.test']);
    expect(items[0].raw.equals(message1)).toBe(true);
    expect(items[1].raw.equals(message2)).toBe(true);
  });

  it('LOGIN bị từ chối thì báo lỗi ngay và đóng socket', async () => {
    const sockets = connectWith((tag) => `${tag} NO [AUTHENTICATIONFAILED] invalid credentials\r\n`);
    const started = Date.now();
    await expect(port().listFolder(OWNER, 'inbox')).rejects.toThrow(/NO/);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(sockets[0].ended || sockets[0].destroyedByClient).toBe(true);
  });
});
