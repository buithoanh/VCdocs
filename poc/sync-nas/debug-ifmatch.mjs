// Chat15 debug helper: how Nextcloud evaluates If-Match on PUT/DELETE
// (GET ETag header vs PROPFIND getetag vs PUT response ETag). Usage:
// node debug-ifmatch.mjs [home|nas]
import { client, davPath, propfind } from './lib.mjs';

const area = process.argv[2] || 'home';
const actor = await client('member-a');
const dir = area === 'nas' ? 'NAS-TeamA' : '';
const path = `${dir ? `${dir}/` : ''}ifmatch-${Date.now()}.txt`;
const show = (label, r) => console.log(label, r.status, r.headers?.get?.('etag'), r.headers?.get?.('oc-etag'));
const put0 = await actor.request('PUT', davPath(actor, path), { body: 'v0', raw: true });
show('PUT create', put0);
const get = await actor.request('GET', davPath(actor, path), { raw: true });
show('GET', get);
console.log('PROPFIND getetag', (await propfind(actor, path, '0')).entries[0].etag);
const etag = get.headers.get('etag');
const ok = await actor.request('PUT', davPath(actor, path), { body: 'v1', headers: { 'If-Match': etag }, raw: true });
show('PUT If-Match current', ok);
const stale = await actor.request('PUT', davPath(actor, path), { body: 'v2', headers: { 'If-Match': etag }, raw: true });
show('PUT If-Match stale', stale);
const bogus = await actor.request('PUT', davPath(actor, path), { body: 'v3', headers: { 'If-Match': '"deadbeef"' }, raw: true });
show('PUT If-Match bogus', bogus);
console.log('content', (await actor.request('GET', davPath(actor, path), { raw: true })).bytes.toString());
