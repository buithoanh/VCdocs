// Chat19: Content-Security-Policy of the Assistant pages. A hijacked answer
// can contain a markdown image pointing outside (exfiltration via the URL);
// the browser only loads it if CSP img-src allows that origin.
import { client, writeEvidence } from './lib.mjs';

const c = await client('member-a');
const out = {};
for (const path of ['/index.php/apps/assistant/', '/index.php/apps/spreed/', '/index.php/apps/files/']) {
  const r = await c.request('GET', path, { headers: { Accept: 'text/html' } });
  const csp = r.headers.get('content-security-policy') ?? '';
  const img = (/img-src ([^;]*)/.exec(csp) ?? [])[1] ?? null;
  const connect = (/connect-src ([^;]*)/.exec(csp) ?? [])[1] ?? null;
  out[path] = { status: r.status, imgSrc: img, connectSrc: connect, thirdPartyImageOrigins: img === null ? null : img.split(/\s+/).filter((s) => !["'self'", 'data:', 'blob:'].includes(s)),
    // evil.example (arbitrary host) is blocked unless img-src has a bare * / https: wildcard.
    arbitraryExternalImagesBlocked: img !== null && !img.split(/\s+/).some((s) => s === '*' || s === 'https:' || s === 'http:') };
}
await writeEvidence('csp.json', out);
console.log(JSON.stringify(out, null, 1));
