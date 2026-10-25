// Chat19 debug: list one folder (Depth 1) as a persona and print names + perms.
// Usage: node probe-list.mjs <persona> <folder>
import { client } from './lib.mjs';

const [persona, folder] = process.argv.slice(2);
const c = await client(persona);
const r = await c.request('PROPFIND', `/remote.php/dav/files/${encodeURIComponent(c.uid)}/${folder.split('/').map(encodeURIComponent).join('/')}`, {
  headers: { Depth: '1', 'Content-Type': 'application/xml' },
  body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:permissions/><oc:fileid/></d:prop></d:propfind>',
});
console.log(r.status);
for (const b of r.text.split('<d:response>').slice(1)) console.log(decodeURIComponent((/<d:href>([^<]*)</.exec(b) ?? [])[1]), (/<oc:permissions>([^<]*)</.exec(b) ?? [])[1]);
