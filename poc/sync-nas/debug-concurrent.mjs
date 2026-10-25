// Chat15 debug helper: two concurrent PUTs with the same If-Match from two
// app passwords of the same user. Usage: node debug-concurrent.mjs [home|nas] [rounds]
import { davPath, personas, sleep } from './lib.mjs';
import { deviceClient, mintDevice } from './tokens.mjs';

const area = process.argv[2] || 'home';
const rounds = Number(process.argv[3] || 3);
const uid = (await personas())['member-a'].nextcloudUserId;
await mintDevice(uid, 'sync15-debug-1');
await mintDevice(uid, 'sync15-debug-2');
const d1 = await deviceClient(uid, 'sync15-debug-1');
const d2 = await deviceClient(uid, 'sync15-debug-2');
const path = davPath(d1, `${area === 'nas' ? 'NAS-TeamA/' : ''}conc-${Date.now()}.txt`);
console.log('create', (await d1.request('PUT', path, { body: 'v0' })).status);
for (let i = 0; i < rounds; i++) {
  await sleep(1100);
  const get = await d1.request('GET', path, { raw: true });
  const etag = get.headers.get('etag');
  const [a, b] = await Promise.all([
    d1.request('PUT', path, { body: `r${i} d1`, headers: { 'If-Match': etag } }),
    d2.request('PUT', path, { body: `r${i} d2 longer`, headers: { 'If-Match': etag } }),
  ]);
  console.log(i, get.status, etag, a.status, b.status, a.status === 423 ? a.data.slice(0, 200) : '');
}
