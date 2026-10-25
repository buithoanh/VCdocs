// Chat15 debug helper: which conditional request leaves the file locked (423)?
// Usage: node debug-lock.mjs [home|nas]
import { client, davPath, sleep } from './lib.mjs';

const area = process.argv[2] || 'home';
const actor = await client('member-a');
const dir = area === 'nas' ? 'NAS-TeamA/' : '';
const base = 'http://nc13.localtest.me:18130';
for (const step of ['none', 'ifNoneMatchStar', 'staleDelete', 'staleMove', 'stalePut']) {
  const path = davPath(actor, `${dir}lock-${step}-${Date.now()}.txt`);
  const created = await actor.request('PUT', path, { body: 'v0', raw: true });
  const stale = created.headers.get('etag');
  await sleep(1100);
  await actor.request('PUT', path, { body: 'v1-longer', raw: true });
  let r;
  if (step === 'ifNoneMatchStar') r = await actor.request('PUT', path, { body: 'x', headers: { 'If-None-Match': '*' } });
  if (step === 'staleDelete') r = await actor.request('DELETE', path, { headers: { 'If-Match': stale } });
  if (step === 'staleMove') r = await actor.request('MOVE', path, { headers: { 'If-Match': stale, Destination: `${base}${path}.moved` } });
  if (step === 'stalePut') r = await actor.request('PUT', path, { body: 'stale', headers: { 'If-Match': stale } });
  const after = await actor.request('PUT', path, { body: 'after' });
  console.log(step, r?.status ?? '-', 'next plain PUT →', after.status);
}
