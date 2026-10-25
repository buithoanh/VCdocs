// Chat16 debug probe: `node probe.mjs <persona> <METHOD> <path> [depth] [bodyFile]`.
// Prints status and the first 3000 characters of the response. Read-only by
// convention (used with PROPFIND/REPORT/GET while developing the acceptance).
import { readFile } from 'node:fs/promises';
import { client } from './lib.mjs';

const [persona, method, path, depth, bodyFile] = process.argv.slice(2);
const actor = await client(persona);
const body = bodyFile ? await readFile(bodyFile, 'utf8') : undefined;
const response = await actor.dav(method, path, body, depth ? { Depth: depth } : {});
console.log(response.status, response.headers.get('content-type'));
console.log(response.text.slice(0, Number(process.env.PROBE_MAX ?? 3000)));
