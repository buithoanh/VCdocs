// Chat15 sync semantics without desktop/mobile clients: exercise WebDAV the way
// the Nextcloud sync clients do, with two "devices" (two app passwords) of the
// same user: PROPFIND depth/props, ETag propagation, If-Match / If-None-Match
// (offline edit with a stale ETag), concurrent conflicting edits, chunked
// upload v2 (resume listing, checksum, abort, foreign user denied), device
// revoke (admin and self) and offboard. Runs on the home storage and on the
// NAS mount. Real client behaviour (conflict copies, selective sync, virtual
// files) is NOT_TESTED here.
import { createHash, randomBytes } from 'node:crypto';
import { davPath, docker, nasContainer, occ, personas, propfind, resetBruteforce, sleep, smb, stats, writeEvidence } from './lib.mjs';
import { deviceClient, listTokens, mintDevice, revokeDevice } from './tokens.mjs';
import { client } from './lib.mjs';

await resetBruteforce();
const people = await personas();
const memberA = people['member-a'].nextcloudUserId;
const memberB = people['member-b'].nextcloudUserId;
const m = `sync15-${Date.now()}`;
const base = 'http://nc13.localtest.me:18130';
await mintDevice(memberA, 'sync15-desktop-1');
await mintDevice(memberA, 'sync15-desktop-2');
const d1 = await deviceClient(memberA, 'sync15-desktop-1');
const d2 = await deviceClient(memberA, 'sync15-desktop-2');
const out = { marker: m };
const must = (label, r, ok) => { if (!ok.includes(r.status)) throw new Error(`${label}: ${r.status} ${String(r.data ?? '').slice(0, 300)}`); return r; };
const etagOf = (r) => r.headers.get('etag')?.replace(/"/g, '');

for (const [area, root] of [['home', `Chat15-${m}`], ['nas', `NAS-TeamA/Chat15-${m}`]]) {
  const res = {};
  must(`${area} mkcol`, await d1.request('MKCOL', davPath(d1, root)), [201]);
  must(`${area} mkcol sub`, await d1.request('MKCOL', davPath(d1, `${root}/a`)), [201]);
  must(`${area} mkcol sub2`, await d1.request('MKCOL', davPath(d1, `${root}/a/b`)), [201]);
  must(`${area} put`, await d1.request('PUT', davPath(d1, `${root}/a/b/doc.txt`), { body: 'v1\n' }), [201]);

  // PROPFIND như client: Depth 0/1/infinity, các thuộc tính client dùng
  const p0 = await propfind(d1, root, '0');
  const p1 = await propfind(d1, `${root}/a`, '1');
  const pInf = await d1.request('PROPFIND', davPath(d1, root), { headers: { Depth: 'infinity' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' });
  const leaf = (await propfind(d1, `${root}/a/b/doc.txt`, '0')).entries[0];
  res.propfind = { depth0: { status: p0.status, entries: p0.entries.length }, depth1: { status: p1.status, entries: p1.entries.length }, depthInfinity: pInf.status, leafProps: { etag: !!leaf.etag, fileId: leaf.fileId, permissions: leaf.permissions, size: leaf.size } };

  // Lan truyền ETag lên thư mục cha và gốc home (client chỉ đi xuống nhánh có ETag đổi)
  const before = { root: (await propfind(d1, root, '0')).entries[0].etag, a: (await propfind(d1, `${root}/a`, '0')).entries[0].etag, home: (await propfind(d1, '', '0')).entries[0].etag };
  must(`${area} put v2`, await d1.request('PUT', davPath(d1, `${root}/a/b/doc.txt`), { body: 'v2\n' }), [204]);
  const after = { root: (await propfind(d1, root, '0')).entries[0].etag, a: (await propfind(d1, `${root}/a`, '0')).entries[0].etag, home: (await propfind(d1, '', '0')).entries[0].etag };
  res.etagPropagation = { folderA: before.a !== after.a, root: before.root !== after.root, home: before.home !== after.home };

  // ETag có đổi khi ghi đè cùng kích thước trong cùng giây? (etag tính từ mtime giây + size)
  const path = davPath(d1, `${root}/a/b/doc.txt`);
  {
    const q = davPath(d1, `${root}/same-second.txt`);
    const c0 = await d1.request('PUT', q, { body: 'AAAA' });
    const c1 = await d1.request('PUT', q, { body: 'BBBB' });
    await sleep(1100);
    const c2 = await d1.request('PUT', q, { body: 'CCCC' });
    res.etagSameSecondSameSize = { createEtag: etagOf(c0), overwriteSameSecondEtag: etagOf(c1), unchangedWithinSecond: etagOf(c0) === etagOf(c1), changedNextSecond: etagOf(c2) !== etagOf(c1) };
  }

  // Sửa offline bằng ETag cũ: If-Match lỗi thời → 412, nội dung giữ bản của máy kia
  await sleep(1100);
  const g1 = await d1.request('GET', path, { raw: true });
  const g2 = await d2.request('GET', path, { raw: true });
  const e = etagOf(g1);
  await sleep(1100);
  const w1 = await d1.request('PUT', path, { body: 'desktop-1 edit\n', headers: { 'If-Match': `"${e}"` } });
  const w2 = await d2.request('PUT', path, { body: 'desktop-2 offline edit (dài hơn)\n', headers: { 'If-Match': `"${etagOf(g2)}"` } });
  const now = (await d2.request('GET', path, { raw: true })).bytes.toString();
  const createOnly = await d2.request('PUT', path, { body: 'x', headers: { 'If-None-Match': '*' } });
  const staleDelete = await d2.request('DELETE', path, { headers: { 'If-Match': `"${e}"` } });
  const staleMove = await d2.request('MOVE', path, { headers: { 'If-Match': `"${e}"`, Destination: `${base}${davPath(d1, `${root}/a/b/moved.txt`)}` } });
  res.conditional = { sameEtagSeenByBoth: etagOf(g1) === etagOf(g2), d1PutIfMatch: w1.status, d2PutStaleIfMatch: w2.status, contentAfter: now.trim(), ifNoneMatchStarOnExisting: createOnly.status, deleteStaleIfMatch: staleDelete.status, moveStaleIfMatch: staleMove.status, stillExists: (await d1.request('GET', path, { raw: true })).status };

  // Hai thiết bị sửa đồng thời cùng ETag: đúng một bên thắng? (nội dung khác/cùng kích thước)
  res.concurrentEdits = {};
  for (const variant of ['differentSize', 'sameSize']) {
    const rounds = [];
    for (let i = 0; i < 10; i++) {
      await sleep(1100);
      const cur = etagOf(await d1.request('GET', path, { raw: true }));
      const body1 = `round ${i} d1\n`;
      const body2 = variant === 'sameSize' ? `round ${i} d2\n` : `round ${i} d2 longer\n`;
      // Như client sync: 423 Locked → chờ ngẫu nhiên rồi thử lại cùng If-Match (tối đa 6 lần)
      const attempt = async (dev, body) => {
        const statuses = [];
        for (let k = 0; k < 6; k++) {
          const r = await dev.request('PUT', path, { body, headers: { 'If-Match': `"${cur}"` } });
          statuses.push(r.status);
          if (r.status !== 423) break;
          await sleep(100 + Math.floor(Math.random() * 500));
        }
        return statuses;
      };
      const [a1, a2] = await Promise.all([attempt(d1, body1), attempt(d2, body2)]);
      const final1 = a1.at(-1);
      const final2 = a2.at(-1);
      const content = `${(await d1.request('GET', path, { raw: true })).bytes.toString()}`;
      const winners = [final1, final2].filter((st) => st >= 200 && st < 300).length;
      const lastWriter = content === body1 ? 'd1' : content === body2 ? 'd2' : 'other';
      const winnerIsLastWriter = winners !== 1 || (final1 < 300 ? lastWriter === 'd1' : lastWriter === 'd2');
      rounds.push({ first: [a1[0], a2[0]], final: [final1, final2], tries: [a1.length, a2.length], winners, lastWriter, winnerIsLastWriter });
    }
    res.concurrentEdits[variant] = {
      rounds: rounds.length,
      exactlyOneWinner: rounds.filter((r) => r.winners === 1 && r.winnerIsLastWriter).length,
      bothWon: rounds.filter((r) => r.winners === 2).length,
      noneWon: rounds.filter((r) => r.winners === 0).length,
      firstAttemptStatuses: [...new Set(rounds.flatMap((r) => r.first))].sort(),
      finalStatuses: [...new Set(rounds.flatMap((r) => r.final))].sort(),
      bothLockedOnFirstAttempt: rounds.filter((r) => r.first.every((st) => st === 423)).length,
    };
  }

  // Chunked upload v2: tiếp tục (liệt kê chunk), checksum, huỷ, người khác không ghi được
  const dest = `${base}${davPath(d1, `${root}/chunked.bin`)}`;
  const up = `/remote.php/dav/uploads/${encodeURIComponent(memberA)}/${m}-${area}`;
  const parts = [randomBytes(5 * 1024 * 1024), randomBytes(5 * 1024 * 1024), randomBytes(1024 * 1024)];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const sha1 = createHash('sha1');
  parts.forEach((p) => sha1.update(p));
  const checksum = `SHA1:${sha1.digest('hex')}`;
  const chunked = { mkcol: (await d1.request('MKCOL', up, { headers: { Destination: dest } })).status };
  chunked.put1 = (await d1.request('PUT', `${up}/00001`, { body: parts[0], headers: { Destination: dest, 'OC-Total-Length': String(totalLen) } })).status;
  // "Máy 2" tiếp tục upload dở: liệt kê chunk đã có
  const listing = await d2.request('PROPFIND', up, { headers: { Depth: '1' } });
  chunked.resumeListingFromOtherDevice = { status: listing.status, chunksListed: (String(listing.data).match(/<d:href>[^<]*\/0000\d<\/d:href>/g) ?? []).length };
  const outsider = await client('member-b');
  chunked.foreignUserPutChunk = (await outsider.request('PUT', `${up}/00002`, { body: 'evil', headers: { Destination: dest } })).status;
  chunked.foreignUserMove = (await outsider.request('MOVE', `${up}/.file`, { headers: { Destination: `${base}${davPath(outsider, 'stolen.bin')}` } })).status;
  chunked.put2 = (await d2.request('PUT', `${up}/00002`, { body: parts[1], headers: { Destination: dest, 'OC-Total-Length': String(totalLen) } })).status;
  chunked.put3 = (await d1.request('PUT', `${up}/00003`, { body: parts[2], headers: { Destination: dest, 'OC-Total-Length': String(totalLen) } })).status;
  chunked.wrongTotalLengthMove = (await d1.request('MOVE', `${up}/.file`, { headers: { Destination: dest, 'OC-Total-Length': String(totalLen + 1) } })).status;
  const moved = await d1.request('MOVE', `${up}/.file`, { headers: { Destination: dest, 'OC-Total-Length': String(totalLen), 'OC-Checksum': checksum, 'X-OC-Mtime': '1761350400' } });
  chunked.move = moved.status;
  chunked.ocFileId = !!moved.headers.get('oc-fileid');
  const got = await d1.request('GET', davPath(d1, `${root}/chunked.bin`), { raw: true });
  chunked.downloadMatches = got.bytes.equals(Buffer.concat(parts));
  const ck = await d1.request('PROPFIND', davPath(d1, `${root}/chunked.bin`), { headers: { Depth: '0' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:checksums/><d:getlastmodified/></d:prop></d:propfind>' });
  chunked.checksumStored = String(ck.data).includes(checksum);
  chunked.mtimeKept = /Sat, 25 Oct 2025 00:00:00 GMT/.test(String(ck.data));
  const abort = `${up}-abort`;
  await d1.request('MKCOL', abort, { headers: { Destination: dest } });
  await d1.request('PUT', `${abort}/00001`, { body: parts[2], headers: { Destination: dest } });
  chunked.abortDelete = (await d1.request('DELETE', abort)).status;
  chunked.abortGone = (await d1.request('PROPFIND', abort, { headers: { Depth: '0' } })).status;
  res.chunkedUploadV2 = chunked;
  out[area] = res;
}

// Thu hồi thiết bị: admin xoá token của máy 2; người dùng tự đăng xuất máy 1 (DELETE apppassword)
await resetBruteforce();
const revoke = {};
{
  const t0 = Date.now();
  revoke.tokensBefore = (await listTokens(memberA)).filter((t) => t.name.startsWith('sync15-desktop')).length;
  await revokeDevice(memberA, 'sync15-desktop-2');
  const t1 = Date.now();
  const firstRequestAfter = (await d2.request('PROPFIND', davPath(d2, ''), { headers: { Depth: '0' } })).status;
  let deniedAfterMs = null;
  while (Date.now() - t1 < 30_000) {
    if ((await d2.request('PROPFIND', davPath(d2, ''), { headers: { Depth: '0' } })).status === 401) { deniedAfterMs = Date.now() - t1; break; }
    await sleep(200);
  }
  revoke.adminRevoke = { occMs: t1 - t0, firstRequestAfter, deniedAfterMs, note: 'cache token APCu (TTL 10 s) của tiến trình web không bị occ (CLI) xoá', otherDeviceStillWorks: (await d1.request('PROPFIND', davPath(d1, ''), { headers: { Depth: '0' } })).status };
  const self = await d1.request('DELETE', '/ocs/v2.php/core/apppassword?format=json');
  revoke.selfLogout = { status: self.status, nextRequest: (await d1.request('PROPFIND', davPath(d1, ''), { headers: { Depth: '0' } })).status, nasMountNextRequest: (await d1.request('PROPFIND', davPath(d1, 'NAS-TeamA'), { headers: { Depth: '0' } })).status };
  revoke.tokensAfter = (await listTokens(memberA)).filter((t) => t.name.startsWith('sync15-desktop')).length;
}

// Offboard member-b (Team B): đang đồng bộ (1 chunk dở) → disable → mọi thiết bị 401 ngay,
// kể cả NAS-TeamB; NAS là danh tính riêng → phải khoá tài khoản NAS riêng.
await resetBruteforce();
const offboard = {};
await mintDevice(memberB, 'sync15-desktop-b1');
await mintDevice(memberB, 'sync15-laptop-b2');
const b1 = await deviceClient(memberB, 'sync15-desktop-b1');
const b2 = await deviceClient(memberB, 'sync15-laptop-b2');
const legacy = await client('member-b'); // app password chat13 (work13-api-test)
try {
  offboard.before = { b1Home: (await propfind(b1, '', '0')).status, b2NasTeamB: (await propfind(b2, 'NAS-TeamB', '1')).status, smbDirect: (await smb('nas-manager-b', 'team-b', 'ls')).ok ? 'ALLOWED' : 'DENIED' };
  const upB = `/remote.php/dav/uploads/${encodeURIComponent(memberB)}/${m}-offboard`;
  const destB = `${base}${davPath(b1, `NAS-TeamB/${m}-in-progress.bin`)}`;
  offboard.before.chunkStart = (await b1.request('MKCOL', upB, { headers: { Destination: destB } })).status;
  offboard.before.chunk1 = (await b1.request('PUT', `${upB}/00001`, { body: randomBytes(1024 * 1024), headers: { Destination: destB } })).status;
  const t0 = Date.now();
  await occ('user:disable', memberB);
  const t1 = Date.now();
  offboard.disableOccMs = t1 - t0;
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    statuses.push([(await propfind(b1, '', '0')).status, (await propfind(b2, 'NAS-TeamB', '1')).status, (await b1.request('PUT', `${upB}/0000${i + 2}`, { body: 'x', headers: { Destination: destB } })).status, (await b1.request('MOVE', `${upB}/.file`, { headers: { Destination: destB } })).status]);
  }
  offboard.afterDisable = { firstRequestMs: Date.now() - t1, statusesHomeNasChunkMove: statuses, allDenied: statuses.flat().every((s) => s === 401 || s === 503), note: 'token còn hiệu lực + tài khoản disabled → Nextcloud trả 503 (DisabledUserException), không phải 401' };
  offboard.smbDirectAfterNextcloudDisable = (await smb('nas-manager-b', 'team-b', 'ls')).ok ? 'ALLOWED (danh tính NAS riêng)' : 'DENIED';
  await docker('exec', nasContainer, 'smbpasswd', '-d', 'nas-manager-b');
  offboard.smbDirectAfterNasDisable = (await smb('nas-manager-b', 'team-b', 'ls')).status;
  offboard.tokensRevoked = (await revokeDevice(memberB, 'sync15-desktop-b1')) + (await revokeDevice(memberB, 'sync15-laptop-b2'));
  offboard.inProgressFileOnNas = (await docker('exec', nasContainer, 'ls', '/srv/nas/team-b')).stdout.includes(`${m}-in-progress.bin`);
} finally {
  // Khôi phục persona thử cho các chat sau
  await occ('user:enable', memberB);
  await docker('exec', nasContainer, 'smbpasswd', '-e', 'nas-manager-b');
}
await sleep(21_000); // > 2 × TTL cache token APCu
await resetBruteforce();
offboard.afterReEnable = {
  revokedDevices: [(await propfind(b1, '', '0')).status, (await propfind(b2, '', '0')).status],
  legacyChat13TokenNotDeleted: (await propfind(legacy, '', '0')).status,
  note: 'disable không xoá token: bật lại tài khoản thì token chưa xoá dùng lại được → offboard phải xoá token (chat13 đã làm)',
};

const checks = {
  ifMatchStale412: ['home', 'nas'].every((a) => out[a].conditional.d2PutStaleIfMatch === 412 && out[a].conditional.contentAfter === 'desktop-1 edit'),
  ifNoneMatchStar412: ['home', 'nas'].every((a) => out[a].conditional.ifNoneMatchStarOnExisting === 412),
  staleDeleteMove412: ['home', 'nas'].every((a) => out[a].conditional.deleteStaleIfMatch === 412 && out[a].conditional.moveStaleIfMatch === 412 && out[a].conditional.stillExists === 200),
  concurrentNoLostUpdate: ['home', 'nas'].every((a) => ['differentSize', 'sameSize'].every((v) => out[a].concurrentEdits[v].bothWon === 0 && out[a].concurrentEdits[v].exactlyOneWinner + out[a].concurrentEdits[v].noneWon === 10)),
  etagPropagates: ['home', 'nas'].every((a) => Object.values(out[a].etagPropagation).every(Boolean)),
  chunked: ['home', 'nas'].every((a) => { const c = out[a].chunkedUploadV2; return c.move === 201 && c.downloadMatches && c.checksumStored && c.foreignUserPutChunk >= 400 && c.foreignUserMove >= 400 && c.resumeListingFromOtherDevice.chunksListed === 1 && c.abortGone === 404; }),
  revokeWithin10s: revoke.adminRevoke.deniedAfterMs !== null && revoke.adminRevoke.deniedAfterMs <= 11_000 && revoke.adminRevoke.otherDeviceStillWorks === 207,
  selfLogoutImmediate: revoke.selfLogout.nextRequest === 401 && revoke.selfLogout.nasMountNextRequest === 401,
  offboardImmediate: offboard.afterDisable.allDenied && offboard.afterReEnable.revokedDevices.every((s) => s === 401),
  smbNeedsSeparateOffboard: offboard.smbDirectAfterNextcloudDisable.startsWith('ALLOWED') && offboard.smbDirectAfterNasDisable !== 'OK',
};
await writeEvidence('acceptance-sync-webdav.json', { ...out, revoke, offboard, checks, notTested: ['Nextcloud Desktop/Android/iOS thật', 'conflict copy phía client', 'selective sync / virtual files', 'Login Flow v2 + OIDC trên thiết bị'], result: Object.values(checks).every(Boolean) ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify({ ...out, revoke, offboard, checks }, null, 1));
if (!Object.values(checks).every(Boolean)) throw new Error('SYNC_WEBDAV_FAILED');
