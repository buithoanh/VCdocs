// Chat15 debug helper: print the WebDAV listing (names, fileid, etag) of one
// folder for one persona. Usage: node debug-listing.mjs <persona> <path>
import { client, propfind } from './lib.mjs';

const [persona = 'member-a', path = 'NAS-TeamA'] = process.argv.slice(2);
const actor = await client(persona);
const r = await propfind(actor, path, '1');
console.log(r.status);
for (const e of r.entries) console.log(e.fileId, e.etag, e.size, e.path.split('/').filter(Boolean).at(-1));
