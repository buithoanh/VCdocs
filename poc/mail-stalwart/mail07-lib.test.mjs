import assert from 'node:assert/strict';
import test from 'node:test';
import { assertOwnResource, compareManifests, extractFirstLiteral, formatTable, messageId, parseList, parseSearch, parseUidValidity, scanResponse, sha256 } from './mail07-lib.mjs';

const msg = (account, folder, uid, body) => ({ account, folder, uid, sha256: sha256(Buffer.from(body)) });

test('sha256 của chuỗi rỗng', () => {
  assert.equal(sha256(Buffer.alloc(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('parseList lấy tên thư mục, bỏ Noselect, giải escape', () => {
  const text = '* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\Noselect) "/" "Root"\r\n* LIST () "/" "A \\"B\\""\r\n* LIST () "/" Sent\r\nx OK done\r\n';
  assert.deepEqual(parseList(text), ['INBOX', 'A "B"', 'Sent']);
});

test('parseSearch và UIDVALIDITY', () => {
  assert.deepEqual(parseSearch('* SEARCH 3 5 9\r\nx OK\r\n'), [3, 5, 9]);
  assert.deepEqual(parseSearch('* SEARCH\r\nx OK\r\n'), []);
  assert.equal(parseUidValidity('* OK [UIDVALIDITY 1234] ok\r\n'), 1234);
});

test('literal tính theo byte (UTF-8 nhiều byte) và scanResponse không bị đánh lừa bởi "tag OK" trong thân thư', () => {
  const body = Buffer.from('Subject: Thư thử\r\n\r\nm07x1 OK giả\r\nxin chào\r\n', 'utf8');
  const raw = Buffer.concat([Buffer.from(`* 1 FETCH (UID 7 BODY[] {${body.length}}\r\n`), body, Buffer.from(')\r\nm07x1 OK Fetch completed\r\n')]);
  const scan = scanResponse(raw, 'm07x1');
  assert.equal(scan.done, true);
  assert.equal(scan.status, 'OK');
  assert.equal(scan.end, raw.length);
  assert.deepEqual(extractFirstLiteral(raw), body);
});

test('scanResponse chưa xong khi literal chưa đủ byte', () => {
  const partial = Buffer.from('* 1 FETCH (BODY[] {100}\r\nabc');
  assert.equal(scanResponse(partial, 'm07x1').done, false);
  assert.equal(extractFirstLiteral(partial), null);
});

test('messageId đọc cả header gập dòng', () => {
  assert.equal(messageId(Buffer.from('From: a\r\nMessage-ID:\r\n <abc@vcworkspace.test>\r\n\r\nbody')), '<abc@vcworkspace.test>');
  assert.equal(messageId(Buffer.from('From: a\r\n\r\nMessage-ID: <x>')), null);
});

test('compareManifests: khớp hoàn toàn', () => {
  const ref = { messages: [msg('a', 'INBOX', 1, 'x'), msg('a', 'Sent', 1, 'y')] };
  const r = compareManifests(ref, { messages: [...ref.messages] });
  assert.equal(r.ok, true);
  assert.equal(r.rows.reduce((n, x) => n + x.matched, 0), 2);
  assert.match(formatTable(r.rows), /a \/ INBOX/);
});

test('compareManifests: phát hiện lệch hash, thiếu, thừa', () => {
  const ref = { messages: [msg('a', 'INBOX', 1, 'x'), msg('a', 'INBOX', 2, 'y'), msg('a', 'INBOX', 3, 'z')] };
  const got = { messages: [msg('a', 'INBOX', 1, 'x'), msg('a', 'INBOX', 2, 'KHAC'), msg('a', 'INBOX', 4, 'moi')] };
  const r = compareManifests(ref, got);
  assert.equal(r.ok, false);
  const row = r.rows[0];
  assert.deepEqual([row.matched, row.hashDiff, row.missing, row.extra], [1, 1, 1, 1]);
});

test('compareManifests: mốc rỗng không được coi là đạt', () => {
  const r = compareManifests({ messages: [] }, { messages: [] });
  assert.equal(r.ok, false);
  assert.equal(r.empty, true);
});

test('assertOwnResource chỉ nhận tiền tố mail07 và chặn pilot/ses/vcparts/volume gốc', () => {
  assert.equal(assertOwnResource('vcworkspace_mail07_restore_data'), 'vcworkspace_mail07_restore_data');
  for (const bad of ['vcworkspace_mail_pilot_data', 'vcworkspace-mail-pilot-mail-1', 'vcworkspace_mail_chat07_data', 'vcworkspace_mail07_ses', 'vcworkspace_mail07_vcparts', 'other'])
    assert.throws(() => assertOwnResource(bad), /REFUSED_RESOURCE/);
});
