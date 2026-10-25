// Chat17 debug helper (read-only): one request as one persona, prints status,
// selected headers and the first bytes of the body. Never prints credentials.
// Usage: node probe.mjs <persona|anonymous> <METHOD> <path> [jsonBody]
import { anonymous, client, resetBruteforce } from './lib.mjs';

const [who, method, path, body] = process.argv.slice(2);
await resetBruteforce();
const actor = who === 'anonymous' ? anonymous() : await client(who);
const res = await actor.request(method, path, { json: body ? JSON.parse(body) : undefined });
console.log(res.status, res.headers.get('content-type'), res.headers.get('location') ?? '');
console.log(String(res.text).slice(0, Number(process.env.PROBE_BYTES ?? 1500)));
