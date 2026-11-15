// Test phần thuần của hai script kiểm tra: node --test deploy/mail/kiem-tra.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { danhGia, inBang, kiemMayPhanGiai, thamSo } from './kiem-tra-dns.mjs';
import { imapQuote, imapXong, smtpXong, thuThu, uidCoMessageId, uidTimThay } from './kiem-tra-gui-nhan.mjs';

const o = { domain: 'vcparts.test', host: 'mail.vcparts.test', ip: '203.0.113.10', dkim: ['v1-rsa-20261114'] };
const dung = () => ({
  a: ['203.0.113.10'],
  mx: [{ exchange: 'mail.vcparts.test', priority: 10 }],
  txtDomain: ['v=spf1 mx -all', 'google-site-verification=abc'],
  txtHost: ['v=spf1 a -all'],
  dmarc: ['v=DMARC1; p=none; rua=mailto:postmaster@vcparts.test'],
  dkim: { 'v1-rsa-20261114': ['v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkq'] },
  ptr: ['mail.vcparts.test'],
  mtaSts: ['v=STSv1; id=1'],
  autoconfig: ['mail.vcparts.test'],
  loi: {},
});
const thieu = (rows) => rows.filter((r) => r.muc === 'bat-buoc' && !r.dat).map((r) => r.ten);
const dong = (rows, ten) => rows.find((r) => r.ten.startsWith(ten));

test('bộ bản ghi đúng: mọi mục bắt buộc và nên có đều đạt', () => {
  const rows = danhGia(dung(), o);
  assert.deepEqual(thieu(rows), []);
  assert.ok(rows.every((r) => r.dat));
  assert.equal(dong(rows, 'DMARC').chiTiet, 'p=none');
});

test('tên miền chưa cấu hình gì: mọi mục bắt buộc đều thiếu', () => {
  const rows = danhGia({ a: [], mx: [], txtDomain: [], txtHost: [], dmarc: [], dkim: {}, ptr: [], mtaSts: [], autoconfig: [], loi: {} }, o);
  assert.deepEqual(thieu(rows), ['A mail.vcparts.test', 'MX vcparts.test', 'SPF vcparts.test', 'DKIM v1-rsa-20261114._domainkey.vcparts.test', 'DMARC _dmarc.vcparts.test', 'PTR 203.0.113.10']);
});

test('A trỏ sai IP bị báo thiếu, kèm IP đang trỏ và IP cần', () => {
  const rows = danhGia({ ...dung(), a: ['198.51.100.7'] }, o);
  assert.equal(dong(rows, 'A ').dat, false);
  assert.match(dong(rows, 'A ').chiTiet, /198\.51\.100\.7.*203\.0\.113\.10/);
});

test('MX: chỉ máy cũ thì thiếu; còn cả máy cũ thì đạt nhưng có cảnh báo; dấu chấm cuối và chữ hoa không ảnh hưởng', () => {
  const cu = danhGia({ ...dung(), mx: [{ exchange: 'aspmx.l.google.com', priority: 1 }] }, o);
  assert.equal(dong(cu, 'MX').dat, false);
  assert.match(dong(cu, 'MX').chiTiet, /aspmx\.l\.google\.com/);
  const caHai = danhGia({ ...dung(), mx: [{ exchange: 'Mail.VCparts.test.', priority: 10 }, { exchange: 'aspmx.l.google.com', priority: 20 }] }, o);
  assert.equal(dong(caHai, 'MX').dat, true);
  assert.match(dong(caHai, 'MX').chiTiet, /còn MX khác: aspmx\.l\.google\.com/);
});

test('SPF: hai bản ghi v=spf1 trên cùng tên bị từ chối', () => {
  const rows = danhGia({ ...dung(), txtDomain: ['v=spf1 mx -all', 'v=spf1 include:amazonses.com ~all'] }, o);
  assert.equal(dong(rows, 'SPF vcparts.test').dat, false);
  assert.match(dong(rows, 'SPF vcparts.test').chiTiet, /2 bản ghi/);
});

test('DKIM: không truyền selector thì chưa kiểm (thiếu); bản ghi rỗng khoá bị từ chối', () => {
  assert.deepEqual(thieu(danhGia(dung(), { ...o, dkim: [] })), ['DKIM']);
  const rong = danhGia({ ...dung(), dkim: { 'v1-rsa-20261114': ['v=DKIM1; k=rsa; p='] } }, o);
  assert.equal(dong(rong, 'DKIM').dat, false);
  assert.match(dong(rong, 'DKIM').chiTiet, /thiếu khoá công khai/);
});

test('DMARC: thiếu p= hoặc hai bản ghi đều không đạt', () => {
  assert.equal(dong(danhGia({ ...dung(), dmarc: ['v=DMARC1; rua=mailto:a@vcparts.test'] }, o), 'DMARC').dat, false);
  assert.equal(dong(danhGia({ ...dung(), dmarc: ['v=DMARC1; p=none', 'v=DMARC1; p=reject'] }, o), 'DMARC').dat, false);
});

test('PTR sai là bắt buộc khi gửi thẳng, chỉ là nên có khi gửi qua trạm chuyển tiếp', () => {
  const tra = { ...dung(), ptr: ['ec2-203-0-113-10.ap-southeast-1.compute.amazonaws.com'] };
  assert.deepEqual(thieu(danhGia(tra, o)), ['PTR 203.0.113.10']);
  const quaTram = danhGia(tra, { ...o, guiQuaTram: true });
  assert.deepEqual(thieu(quaTram), []);
  assert.equal(dong(quaTram, 'PTR').dat, false);
});

test('lỗi tra cứu (hết giờ) không bị nhầm thành "chưa có bản ghi"', () => {
  const rows = danhGia({ ...dung(), mx: [], loi: { mx: 'ETIMEOUT' } }, o);
  assert.equal(dong(rows, 'MX').dat, false);
  assert.match(dong(rows, 'MX').chiTiet, /không tra được: ETIMEOUT/);
});

test('inBang gắn nhãn ĐẠT / THIẾU / NÊN CÓ', () => {
  const text = inBang(danhGia({ ...dung(), a: [], mtaSts: [] }, o));
  assert.match(text, /THIẾU\s+A mail\.vcparts\.test/);
  assert.match(text, /NÊN CÓ\s+MTA-STS/);
  assert.match(text, /ĐẠT\s+MX vcparts\.test/);
});

test('thamSo: bắt buộc --domain và --host, từ chối tham số lạ và giá trị thiếu', () => {
  assert.deepEqual(thamSo(['--domain', 'VCparts.vn.', '--host', 'mail.vcparts.vn', '--dkim', 'a, b', '--gui-qua-tram']), { domain: 'vcparts.vn', host: 'mail.vcparts.vn', dkim: ['a', 'b'], guiQuaTram: true });
  assert.throws(() => thamSo(['--domain', 'vcparts.vn']), /Cần --domain/);
  assert.throws(() => thamSo(['--domain', '--host', 'x']), /Thiếu giá trị/);
  assert.throws(() => thamSo(['--xoa']), /Tham số lạ/);
});

test('kiemMayPhanGiai: SOA ở chính tên miền hoặc vùng cha là đủ; không có SOA nào thì dừng', async () => {
  const hoi = (co) => async (name) => { if (!co.includes(name)) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' }); return {}; };
  await kiemMayPhanGiai(hoi(['vcparts.vn']), 'vcparts.vn');
  await kiemMayPhanGiai(hoi(['vcparts.vn']), 'thu.vcparts.vn');
  await assert.rejects(kiemMayPhanGiai(hoi([]), 'vcparts.vn'), /Không lấy được SOA/);
  // Không leo lên tận tên miền cấp cao nhất: SOA của "vn" không chứng minh được gì về vcparts.vn.
  await assert.rejects(kiemMayPhanGiai(hoi(['vn']), 'vcparts.vn'), /Không lấy được SOA/);
});

test('thuThu có đủ header bắt buộc và kết thúc bằng CRLF', () => {
  const raw = thuThu({ from: 'a@vcparts.test', to: 'b@vcparts.test', messageId: 'abc@vcparts.test', date: new Date(0) });
  assert.match(raw, /^From: a@vcparts\.test\r\nTo: b@vcparts\.test\r\n/);
  assert.match(raw, /\r\nMessage-ID: <abc@vcparts\.test>\r\n/);
  assert.match(raw, /\r\nDate: Thu, 01 Jan 1970 00:00:00 GMT\r\n/);
  assert.ok(raw.endsWith('\r\n'));
});

test('smtpXong chỉ nhận dòng cuối dạng "mã + dấu cách", bỏ qua trả lời nhiều dòng còn dở', () => {
  assert.equal(smtpXong('250-mail.vcparts.test\r\n250-AUTH PLAIN\r\n'), null);
  assert.equal(smtpXong('250-mail.vcparts.test\r\n250 SIZE 100\r\n'), 250);
  assert.equal(smtpXong('535 5.7.8 Authentication credentials invalid.\r\n'), 535);
  assert.equal(smtpXong('250 OK'), null);
});

test('imapXong đọc đúng thẻ; uidTimThay đọc dòng SEARCH', () => {
  assert.equal(imapXong('* 1 EXISTS\r\nk2 OK done\r\n', 'k2'), 'OK');
  assert.equal(imapXong('* 1 EXISTS\r\nk2 OK done\r\n', 'k3'), null);
  assert.equal(imapXong('k1 NO [AUTHENTICATIONFAILED] x\r\n', 'k1'), 'NO');
  assert.deepEqual(uidTimThay('* SEARCH 3 7 12\r\nk3 OK\r\n'), [3, 7, 12]);
  assert.deepEqual(uidTimThay('* SEARCH\r\nk3 OK\r\n'), []);
});

test('uidCoMessageId so đúng Message-ID, không phân biệt hoa thường, không nhầm thư khác', () => {
  const tra = [
    '* 1 FETCH (UID 4 BODY[HEADER.FIELDS (MESSAGE-ID)] {40}',
    'Message-ID: <khac@vcparts.test>',
    '',
    ')',
    '* 2 FETCH (UID 9 BODY[HEADER.FIELDS (MESSAGE-ID)] {60}',
    'Message-Id:',
    ' <ABC-123@VCparts.test>',
    '',
    ')',
    'k4 OK UID FETCH completed',
    '',
  ].join('\r\n');
  assert.deepEqual(uidCoMessageId(tra, 'abc-123@vcparts.test'), [9]);
  assert.deepEqual(uidCoMessageId(tra, 'khong-co@vcparts.test'), []);
  // Message-ID là chuỗi con của một Message-ID khác thì không khớp.
  assert.deepEqual(uidCoMessageId(tra, '123@vcparts.test'), []);
});

test('imapQuote thoát dấu nháy và từ chối xuống dòng', () => {
  assert.equal(imapQuote('a"b\\c'), '"a\\"b\\\\c"');
  assert.throws(() => imapQuote('a\r\nk9 LOGOUT'), /xuống dòng/);
});
