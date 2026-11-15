#!/usr/bin/env node
// Thử một vòng gửi → nhận trực tiếp với Stalwart, đúng đường mà Outlook/điện thoại dùng:
//   hộp A gửi qua SMTP 465 (TLS, có đăng nhập) → Stalwart → hộp B đọc qua IMAP 993.
// Không qua API/giao diện Email của VCworkspace. Script GỬI MỘT THƯ THẬT giữa hai hộp bạn chỉ định,
// nên chỉ người vận hành chạy, với hai hộp thử của chính mình.
//
// Biến môi trường (mật khẩu không nhận qua tham số dòng lệnh để khỏi lọt vào lịch sử shell):
//   MAIL_HOST            tên máy chủ thư, ví dụ mail.vcparts.vn
//   MAIL_FROM            địa chỉ hộp gửi          MAIL_FROM_PASSWORD   mật khẩu hộp gửi
//   MAIL_TO              địa chỉ hộp nhận         MAIL_TO_PASSWORD     mật khẩu hộp nhận
// Tuỳ chọn: --smtp-port 465  --imap-port 993  --cho 30 (giây chờ thư tới)
//           --khong-kiem-chung-chi   chỉ dùng cho máy thử có chứng chỉ tự ký
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

/** Thư thử tối giản, đủ header để máy nhận không coi là thư hỏng. */
export function thuThu({ from, to, messageId, date = new Date() }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: [kiem-tra] Stalwart gui nhan truc tiep ${messageId.split('@')[0]}`,
    `Message-ID: <${messageId}>`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    'Thư thử tự động: gửi qua SMTP 465, đọc lại qua IMAP 993.',
    '',
  ].join('\r\n');
}

/** Dòng trả lời SMTP cuối cùng (dạng "250 ..." chứ không phải "250-...") đã về đủ chưa. */
export function smtpXong(buffer) {
  const lines = buffer.split('\r\n').filter(Boolean);
  const last = lines[lines.length - 1];
  return buffer.endsWith('\r\n') && /^\d{3} /.test(last ?? '') ? Number(last.slice(0, 3)) : null;
}

/** Kết quả lệnh IMAP có thẻ `tag`: OK / NO / BAD, hoặc null khi chưa về đủ. */
export function imapXong(buffer, tag) {
  const m = new RegExp(`^${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`, 'm').exec(buffer);
  return m ? m[1] : null;
}

/**
 * UID của các thư có đúng Message-ID, đọc từ trả lời `UID FETCH … (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])`.
 * Stalwart không tìm được Message-ID bằng `SEARCH HEADER` (đã thử trên 0.16.27), nên phải đọc header rồi so.
 */
export function uidCoMessageId(buffer, messageId) {
  const can = `<${messageId.toLowerCase()}>`, out = [];
  for (const khoi of buffer.split(/^(?=\* \d+ FETCH \()/m)) {
    if (!/^\* \d+ FETCH \(/.test(khoi)) continue;
    const dongHeader = khoi.split('\r\n').filter((dong) => /^(message-id:|\s)/i.test(dong)).join(' ');
    const ngoaiHeader = khoi.split('\r\n').filter((dong) => !/^(message-id:|\s)/i.test(dong)).join(' ');
    const uid = /\bUID (\d+)\b/.exec(ngoaiHeader)?.[1];
    if (uid && dongHeader.toLowerCase().includes(can)) out.push(Number(uid));
  }
  return out;
}

/** Danh sách UID từ dòng `* SEARCH 1 2 3`. */
export function uidTimThay(buffer) {
  const ids = [];
  for (const m of buffer.matchAll(/^\* SEARCH([0-9 ]*)\r?$/gm)) ids.push(...m[1].split(' ').filter(Boolean).map(Number));
  return ids;
}

/** Chuỗi quoted của IMAP; từ chối xuống dòng để không chèn được lệnh. */
export function imapQuote(value) {
  if (/[\r\n]/.test(value)) throw new Error('Giá trị IMAP không được chứa xuống dòng');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function ketNoi(host, port, kiemChungChi) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, ...(net.isIP(host) ? {} : { servername: host }), rejectUnauthorized: kiemChungChi }, () => resolve(socket));
    socket.setTimeout(30_000, () => socket.destroy(new Error(`Hết thời gian chờ ${host}:${port}`)));
    socket.once('error', reject);
  });
}

/** Gửi `lenh` (nếu có) rồi chờ tới khi `xong(buffer)` khác null. */
function traoDoi(socket, lenh, xong) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const ketQua = xong(buffer);
      if (ketQua !== null) { don(); resolve({ ketQua, buffer }); }
    };
    const onError = (error) => { don(); reject(error); };
    const onClose = () => { don(); reject(new Error('Máy chủ đóng kết nối giữa chừng')); };
    const don = () => { socket.off('data', onData); socket.off('error', onError); socket.off('close', onClose); };
    socket.on('data', onData); socket.on('error', onError); socket.on('close', onClose);
    if (lenh) socket.write(lenh);
  });
}

async function guiSmtp({ host, port, kiemChungChi, from, password, to, raw }) {
  const socket = await ketNoi(host, port, kiemChungChi);
  const buoc = async (lenh, mongDoi, ten) => {
    const { ketQua, buffer } = await traoDoi(socket, lenh, smtpXong);
    if (ketQua !== mongDoi) throw new Error(`SMTP ${ten}: máy chủ trả ${buffer.trim().split('\r\n').pop()}`);
  };
  try {
    await buoc(null, 220, 'chào');
    await buoc('EHLO kiem-tra.local\r\n', 250, 'EHLO');
    await buoc(`AUTH PLAIN ${Buffer.from(`\0${from}\0${password}`).toString('base64')}\r\n`, 235, 'đăng nhập');
    await buoc(`MAIL FROM:<${from}>\r\n`, 250, 'MAIL FROM');
    await buoc(`RCPT TO:<${to}>\r\n`, 250, 'RCPT TO');
    await buoc('DATA\r\n', 354, 'DATA');
    // Dòng bắt đầu bằng dấu chấm phải nhân đôi dấu chấm (RFC 5321 mục 4.5.2).
    await buoc(`${raw.replace(/^\./gm, '..')}\r\n.\r\n`, 250, 'nhận thư');
    socket.write('QUIT\r\n');
  } finally { socket.destroy(); }
}

async function timImap({ host, port, kiemChungChi, user, password, messageId, choGiay }) {
  const socket = await ketNoi(host, port, kiemChungChi);
  let n = 0;
  const lenh = async (text, ten) => {
    const tag = `k${++n}`;
    const { ketQua, buffer } = await traoDoi(socket, `${tag} ${text}\r\n`, (b) => imapXong(b, tag));
    if (ketQua !== 'OK') throw new Error(`IMAP ${ten}: máy chủ trả ${ketQua}`);
    return buffer;
  };
  try {
    await traoDoi(socket, null, (b) => (/^\* (OK|PREAUTH)/m.test(b) && b.endsWith('\r\n') ? 'OK' : null));
    await lenh(`LOGIN ${imapQuote(user)} ${imapQuote(password)}`, 'đăng nhập');
    const han = Date.now() + choGiay * 1000;
    for (;;) {
      await lenh('SELECT INBOX', 'mở Hộp thư đến');
      // Chỉ xét 50 thư mới nhất để hộp lớn không phải tải toàn bộ header.
      const moiNhat = uidTimThay(await lenh('UID SEARCH ALL', 'liệt kê thư')).slice(-50);
      if (moiNhat.length) {
        const uids = uidCoMessageId(await lenh(`UID FETCH ${moiNhat.join(',')} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])`, 'đọc Message-ID'), messageId);
        if (uids.length) return uids;
      }
      if (Date.now() > han) return [];
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } finally { socket.destroy(); }
}

function thamSo(argv) {
  const out = { smtpPort: 465, imapPort: 993, choGiay: 30, kiemChungChi: true };
  for (let i = 0; i < argv.length; i++) {
    const so = () => { const v = Number(argv[++i]); if (!Number.isInteger(v) || v <= 0) throw new Error(`Giá trị không hợp lệ cho ${argv[i - 1]}`); return v; };
    if (argv[i] === '--smtp-port') out.smtpPort = so();
    else if (argv[i] === '--imap-port') out.imapPort = so();
    else if (argv[i] === '--cho') out.choGiay = so();
    else if (argv[i] === '--khong-kiem-chung-chi') out.kiemChungChi = false;
    else throw new Error(`Tham số lạ: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const o = thamSo(process.argv.slice(2));
  const can = ['MAIL_HOST', 'MAIL_FROM', 'MAIL_FROM_PASSWORD', 'MAIL_TO', 'MAIL_TO_PASSWORD'];
  const thieu = can.filter((k) => !process.env[k]);
  if (thieu.length) throw new Error(`Thiếu biến môi trường: ${thieu.join(', ')}`);
  const { MAIL_HOST: host, MAIL_FROM: from, MAIL_FROM_PASSWORD, MAIL_TO: to, MAIL_TO_PASSWORD } = process.env;
  const messageId = `${randomUUID()}@${from.split('@')[1]}`;
  if (!o.kiemChungChi) console.log('CẢNH BÁO: đang bỏ kiểm chứng chỉ TLS (chỉ dùng cho máy thử).');
  await guiSmtp({ host, port: o.smtpPort, kiemChungChi: o.kiemChungChi, from, password: MAIL_FROM_PASSWORD, to, raw: thuThu({ from, to, messageId }) });
  console.log(`ĐÃ GỬI   ${from} → ${to} qua ${host}:${o.smtpPort} (máy chủ trả 250)`);
  const uids = await timImap({ host, port: o.imapPort, kiemChungChi: o.kiemChungChi, user: to, password: MAIL_TO_PASSWORD, messageId, choGiay: o.choGiay });
  if (!uids.length) throw new Error(`Không thấy thư <${messageId}> trong Hộp thư đến của ${to} sau ${o.choGiay} giây`);
  console.log(`ĐÃ NHẬN  thư <${messageId}> trong Hộp thư đến của ${to} (UID ${uids.join(', ')}) qua ${host}:${o.imapPort}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(`THẤT BẠI: ${error.message}`); process.exit(1); });
}
