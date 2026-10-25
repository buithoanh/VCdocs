// Chat15: one representative large file each way on the NAS mount (bounded by
// SYNC15_LARGE_MIB, default 1024 MiB = 1 GiB):
//  (a) chunked upload v2 through Nextcloud (as sync clients do) into NAS-TeamA,
//      then compare SHA-256 on the NAS itself and on a streamed WebDAV download;
//  (b) the same size written directly on the NAS filesystem, then time until
//      Nextcloud lists it with the full size, scan time, streamed download hash.
// Bytes are random; nothing is kept in memory beyond one chunk.
import { createHash, randomBytes } from 'node:crypto';
import { client, davPath, docker, nasContainer, nasExec, occ, personas, propfind, resetBruteforce, sleep, waitUntil, writeEvidence } from './lib.mjs';
import { secret } from '../flow/lib.mjs';

await resetBruteforce();
const MiB = 1024 * 1024;
const totalMiB = Number(process.env.SYNC15_LARGE_MIB || 1024);
if (!(totalMiB > 0 && totalMiB <= 1024)) throw new Error('SYNC15_LARGE_MIB must be 1..1024');
const chunkMiB = 64;
const total = totalMiB * MiB;
const m = `big15-${Date.now()}`;
const owner = await client('successor-a');
const binding = (await personas())['successor-a'];
const auth = `Basic ${Buffer.from(`${binding.nextcloudUserId}:${await secret('app_password_successor-a')}`).toString('base64')}`;
const base = 'http://nc13.localtest.me:18130';
const raw = (method, path, { headers = {}, body } = {}) => fetch(`${base}${path}`, { method, headers: { Authorization: auth, ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(30 * 60_000) });
const dir = `Chat15-${m}`;
await owner.request('MKCOL', davPath(owner, `NAS-TeamA/${dir}`));
const nasPath = (name) => `/srv/nas/team-a/${dir}/${name}`;
const nasSha = async (name) => (await nasExec('sha256sum', nasPath(name))).stdout.split(/\s+/)[0];
async function streamedSha(path) {
  const t0 = Date.now();
  const response = await raw('GET', davPath(owner, path));
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.length; }
  return { status: response.status, bytes, sha256: hash.digest('hex'), ms: Date.now() - t0 };
}
const mibps = (bytes, ms) => Math.round((bytes / MiB / (ms / 1000)) * 10) / 10;

// (a) chunked upload v2
const upload = { chunkMiB, chunks: Math.ceil(totalMiB / chunkMiB) };
{
  const name = 'upload-chunked.bin';
  const destination = `${base}${davPath(owner, `NAS-TeamA/${dir}/${name}`)}`;
  const uploadDir = `/remote.php/dav/uploads/${encodeURIComponent(owner.uid)}/${m}`;
  const hash = createHash('sha256');
  const t0 = Date.now();
  const mk = await raw('MKCOL', uploadDir, { headers: { Destination: destination } });
  upload.mkcol = mk.status;
  const chunkTimes = [];
  for (let i = 0; i < upload.chunks; i++) {
    const size = Math.min(chunkMiB * MiB, total - i * chunkMiB * MiB);
    const data = randomBytes(size);
    hash.update(data);
    const c0 = Date.now();
    const put = await raw('PUT', `${uploadDir}/${String(i + 1).padStart(5, '0')}`, { headers: { Destination: destination, 'OC-Total-Length': String(total), 'Content-Length': String(size) }, body: data });
    if (put.status !== 201) throw new Error(`CHUNK_${i + 1}_${put.status}`);
    chunkTimes.push(Date.now() - c0);
  }
  const putDone = Date.now();
  const move = await raw('MOVE', `${uploadDir}/.file`, { headers: { Destination: destination, 'OC-Total-Length': String(total), 'X-OC-Mtime': '1761350400' } });
  const moveDone = Date.now();
  upload.moveStatus = move.status;
  upload.etag = move.headers.get('etag');
  upload.fileId = move.headers.get('oc-fileid');
  upload.chunkPutMs = { total: putDone - t0, perChunkMax: Math.max(...chunkTimes), throughputMiBps: mibps(total, putDone - t0) };
  upload.assembleMoveMs = moveDone - putDone;
  upload.endToEndMiBps = mibps(total, moveDone - t0);
  upload.sha256Client = hash.digest('hex');
  upload.sha256OnNas = await nasSha(name);
  upload.sizeOnNas = Number((await nasExec('stat', '-c', '%s', nasPath(name))).stdout.trim());
  upload.mtimeOnNas = Number((await nasExec('stat', '-c', '%Y', nasPath(name))).stdout.trim());
  const listed = (await propfind(owner, `NAS-TeamA/${dir}/${name}`, '0')).entries[0];
  upload.listedSize = listed?.size;
  upload.requestedMtime = 1761350400;
  upload.listedLastModified = listed?.lastModified;
  upload.mtimeKeptInNextcloud = Date.parse(listed?.lastModified ?? '') / 1000 === 1761350400;
  upload.mtimeKeptOnNas = upload.mtimeOnNas === 1761350400;
  upload.download = await streamedSha(`NAS-TeamA/${dir}/${name}`);
  upload.download.throughputMiBps = mibps(upload.download.bytes, upload.download.ms);
  upload.uploadDirGoneAfterMove = (await raw('PROPFIND', uploadDir, { headers: { Depth: '0' } })).status;
  upload.pass = upload.moveStatus >= 200 && upload.moveStatus < 300 && upload.sha256OnNas === upload.sha256Client && upload.download.sha256 === upload.sha256Client && upload.sizeOnNas === total;
}

// (b) ghi trực tiếp trên NAS
const direct = {};
{
  const name = 'nas-direct.bin';
  const t0 = Date.now();
  await docker('exec', '-u', 'nas-member-a', nasContainer, 'dd', 'if=/dev/urandom', `of=${nasPath(name)}`, 'bs=1M', `count=${totalMiB}`, 'status=none');
  direct.nasWriteMs = Date.now() - t0;
  direct.sha256OnNas = await nasSha(name);
  const full = await waitUntil('full size listed', async () => {
    const e = (await propfind(owner, `NAS-TeamA/${dir}`, '1')).entries.find((x) => x.path.endsWith(`/${name}`));
    return e && e.size === total ? e : null;
  }, { timeoutMs: 60_000, intervalMs: 500 });
  direct.listedFullSizeAfterWriteMs = full.ms;
  if (full.ms === null) {
    const e = (await propfind(owner, `NAS-TeamA/${dir}`, '1')).entries.find((x) => x.path.endsWith(`/${name}`));
    direct.listedSizeBeforeScan = e?.size ?? 'not listed';
  }
  const s0 = Date.now();
  await occ('files:scan', `--path=/${owner.uid}/files/NAS-TeamA/${dir}`);
  direct.scanFolderMs = Date.now() - s0;
  direct.listedSizeAfterScan = (await propfind(owner, `NAS-TeamA/${dir}/${name}`, '0')).entries[0]?.size;
  direct.download = await streamedSha(`NAS-TeamA/${dir}/${name}`);
  direct.download.throughputMiBps = mibps(direct.download.bytes, direct.download.ms);
  direct.pass = direct.download.sha256 === direct.sha256OnNas && direct.listedSizeAfterScan === total;
}
await sleep(100);
await writeEvidence('acceptance-nas-large.json', { marker: m, folder: `NAS-TeamA/${dir}`, sizeMiB: totalMiB, upload, direct, result: upload.pass && direct.pass ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify({ upload, direct }, null, 1));
if (!upload.pass || !direct.pass) throw new Error('LARGE_FILE_FAILED');
