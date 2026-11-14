// Chat07 backup/restore helpers. Phần thuần (băm, phân tích IMAP, so manifest, chặn tên tài nguyên
// nguy hiểm) được test bằng mail07-lib.test.mjs; phần IMAP/docker chỉ chạy khi có stack thật.
// Không đọc file secret: mật khẩu hộp thư thử đến từ biến môi trường do run-with-secrets.mjs nạp.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const root = dirname(fileURLToPath(import.meta.url));
export const backupDir = join(root, 'backup');
export const live = {
  container: 'vcworkspace-mail-chat07',
  volumes: { etc: 'vcworkspace_mail_chat07_etc', data: 'vcworkspace_mail_chat07_data' },
};
export const restoreVolumes = { etc: 'vcworkspace_mail07_restore_etc', data: 'vcworkspace_mail07_restore_data' };
export const restoreProject = 'vcworkspace-mail07-restore';
export const restoreNetwork = `${restoreProject}_restore_internal`;
export const alpine = 'alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412';
export const archives = ['mail07-etc.tgz', 'mail07-data.tgz'];
export const execFileAsync = promisify(execFile);
export const docker = (...args) => execFileAsync('docker', args, { maxBuffer: 64 * 1024 * 1024 });
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- phần thuần ----------
export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const FORBIDDEN = /pilot|ses|vcparts/i;
/** Chỉ cho phép đụng tài nguyên có tiền tố mail07 của chính script này; không bao giờ pilot/ses/vcparts. */
export function assertOwnResource(name) {
  if (!/^vcworkspace[-_]mail07[-_]/.test(name) || FORBIDDEN.test(name)) throw new Error(`REFUSED_RESOURCE:${name}`);
  return name;
}

/** Tên thư mục từ các dòng `* LIST (...) "/" "name"`; bỏ \Noselect. */
export function parseList(text) {
  const out = [];
  for (const line of text.split('\r\n')) {
    const m = /^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))$/.exec(line);
    if (!m || /\\Noselect/i.test(m[1])) continue;
    out.push((m[2] ?? m[3]).replace(/\\(["\\])/g, '$1'));
  }
  return out;
}
/** Danh sách UID từ `* SEARCH 1 2 3`. */
export function parseSearch(text) {
  const ids = [];
  for (const m of text.matchAll(/^\* SEARCH([0-9 ]*)\r?$/gm)) ids.push(...m[1].split(' ').filter(Boolean).map(Number));
  return ids;
}
export function parseUidValidity(text) {
  const m = /\[UIDVALIDITY (\d+)\]/i.exec(text);
  return m ? Number(m[1]) : null;
}
/**
 * Duyệt phản hồi IMAP (Buffer) tới dòng hoàn tất có thẻ `tag`, bỏ qua nội dung literal {n}
 * để chuỗi "tag OK" trong thân thư không đánh lừa. Trả {done, status?, end?}.
 */
export function scanResponse(buf, tag) {
  let pos = 0;
  for (;;) {
    const eol = buf.indexOf('\r\n', pos, 'latin1');
    if (eol < 0) return { done: false };
    const line = buf.toString('latin1', pos, eol);
    if (line.startsWith(`${tag} `)) return { done: true, status: line.slice(tag.length + 1).split(' ')[0], end: eol + 2 };
    const lit = /\{(\d+)\}$/.exec(line);
    if (lit) {
      const next = eol + 2 + Number(lit[1]);
      if (buf.length < next) return { done: false };
      pos = next;
    } else pos = eol + 2;
  }
}
/** Literal đầu tiên (đúng n byte) trong phản hồi FETCH; null nếu không có/không đủ. */
export function extractFirstLiteral(buf) {
  const m = /\{(\d+)\}\r\n/.exec(buf.toString('latin1'));
  if (!m) return null;
  const start = m.index + m[0].length;
  const n = Number(m[1]);
  return buf.length >= start + n ? buf.subarray(start, start + n) : null;
}
export function messageId(mime) {
  const head = mime.toString('latin1').split('\r\n\r\n', 1)[0].replace(/\r\n[ \t]+/g, ' ');
  return /^Message-ID:\s*(.+)$/im.exec(head)?.[1].trim() ?? null;
}

/**
 * So manifest tham chiếu (bản gốc) với bản đọc lại từ khôi phục. Khoá = tài khoản|thư mục|UID.
 * Trả {ok, empty, rows, problems}; mỗi dòng bảng là một tài khoản+thư mục.
 */
export function compareManifests(reference, restored) {
  const index = (m) => new Map(m.messages.map((x) => [`${x.account}|${x.folder}|${x.uid}`, x]));
  const ref = index(reference); const got = index(restored);
  const groups = new Map();
  const row = (x) => { const k = `${x.account} / ${x.folder}`; if (!groups.has(k)) groups.set(k, { group: k, reference: 0, restored: 0, matched: 0, hashDiff: 0, missing: 0, extra: 0 }); return groups.get(k); };
  const problems = [];
  for (const [key, r] of ref) {
    const g = row(r); g.reference += 1;
    const o = got.get(key);
    if (!o) { g.missing += 1; problems.push(`thiếu ${key}`); } else if (o.sha256 !== r.sha256) { g.hashDiff += 1; problems.push(`lệch hash ${key}`); } else g.matched += 1;
  }
  for (const [key, o] of got) {
    const g = row(o); g.restored += 1;
    if (!ref.has(key)) { g.extra += 1; problems.push(`thừa ${key} (thư tới sau thời điểm lấy mốc?)`); }
  }
  return { ok: problems.length === 0 && ref.size > 0, empty: ref.size === 0, rows: [...groups.values()], problems };
}
export function formatTable(rows) {
  const cols = ['group', 'reference', 'restored', 'matched', 'hashDiff', 'missing', 'extra'];
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(width[i])).join('  ');
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}

// ---------- IMAP (TLS tự ký, như run-integration.mjs) ----------
export class Imap {
  constructor(host, port) { this.host = host; this.port = port; this.buf = Buffer.alloc(0); this.n = 0; }
  async open() {
    this.socket = tls.connect({ host: this.host, port: this.port, servername: 'mail.vcworkspace.test', rejectUnauthorized: false });
    this.socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.wake?.(); });
    this.socket.on('error', (e) => { this.error = e; this.wake?.(); });
    this.socket.on('close', () => { this.closed = true; this.wake?.(); });
    await this.until(() => this.buf.includes('\r\n'), 'greeting');
    this.buf = Buffer.alloc(0);
  }
  until(ready, what, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wake = null; reject(new Error(`IMAP_TIMEOUT:${what}`)); }, timeoutMs);
      const check = () => {
        if (this.error) { clearTimeout(timer); this.wake = null; reject(this.error); return; }
        const value = ready();
        if (value) { clearTimeout(timer); this.wake = null; resolve(value); } else if (this.closed) { clearTimeout(timer); this.wake = null; reject(new Error(`IMAP_CLOSED:${what}`)); } else this.wake = check;
      };
      check();
    });
  }
  /** Gửi lệnh, trả {status, raw:Buffer} (raw gồm cả dòng hoàn tất). */
  async cmd(text) {
    const tag = `m07x${(this.n += 1)}`;
    this.buf = Buffer.alloc(0);
    this.socket.write(`${tag} ${text}\r\n`);
    const done = await this.until(() => { const s = scanResponse(this.buf, tag); return s.done ? s : null; }, text.split(' ')[0]);
    return { status: done.status, raw: this.buf.subarray(0, done.end) };
  }
  async login(user, pass) {
    const r = await this.cmd(`LOGIN "${user}" "${pass.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`);
    if (r.status !== 'OK') throw new Error(`IMAP_LOGIN_FAILED:${user}`);
  }
  close() { try { this.socket.write('z LOGOUT\r\n'); this.socket.end(); } catch { /* đã đóng */ } }
}

/** Đọc mọi thư (EXAMINE: không đổi cờ; BODY.PEEK) của các tài khoản, trả manifest băm MIME. */
export async function snapshotMailboxes({ host, port, accounts }) {
  const messages = []; const folders = {};
  for (const { email, pass } of accounts) {
    const c = new Imap(host, port);
    await c.open();
    try {
      await c.login(email, pass);
      const names = parseList((await c.cmd('LIST "" "*"')).raw.toString('latin1'));
      for (const folder of names) {
        const ex = await c.cmd(`EXAMINE "${folder.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`);
        if (ex.status !== 'OK') continue;
        folders[`${email} / ${folder}`] = parseUidValidity(ex.raw.toString('latin1'));
        for (const uid of parseSearch((await c.cmd('UID SEARCH ALL')).raw.toString('latin1'))) {
          const fetched = await c.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
          const mime = extractFirstLiteral(fetched.raw);
          if (!mime) throw new Error(`IMAP_FETCH_EMPTY:${email}/${folder}/${uid}`);
          messages.push({ account: email, folder, uid, messageId: messageId(mime), bytes: mime.length, sha256: sha256(mime) });
        }
      }
    } finally { c.close(); }
  }
  return { messages, uidValidity: folders };
}

export function accountsFromEnv() {
  const a = process.env.MAIL_TEST_A_PASSWORD; const b = process.env.MAIL_TEST_B_PASSWORD;
  if (!a || !b) throw new Error('Thiếu MAIL_TEST_A/B_PASSWORD: chạy qua run-with-secrets.mjs <file-credential-thử-trong-/private/tmp> poc/mail-stalwart/<script>');
  return [{ email: 'tp.mkt@vcworkspace.test', pass: a }, { email: 'nv.mkt@vcworkspace.test', pass: b }];
}
export async function writePrivate(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
