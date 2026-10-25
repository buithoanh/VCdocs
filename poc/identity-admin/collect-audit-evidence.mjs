import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './authentik-api.mjs';

const input = process.argv[2];
if (!input) throw new Error('AUDIT_INPUT_REQUIRED');
const acl = JSON.parse(await readFile(join(root, 'evidence', 'acl-webdav.json'), 'utf8'));
const correlationId = acl.correlationId;
const records = (await readFile(input, 'utf8')).split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}).filter((record) => record.clientReqId === correlationId).map((record) => ({
  time: record.time,
  user: record.user,
  app: record.app,
  method: record.method,
  url: record.url,
  message: record.message,
  clientReqId: record.clientReqId,
}));
if (records.length < 4) throw new Error(`AUDIT_CORRELATION_INCOMPLETE_${records.length}`);
await writeFile(join(root, 'evidence', 'audit-correlation.json'), `${JSON.stringify({ correlationId, count: records.length, records, secretsIncluded: false }, null, 2)}\n`);
console.log(`Audit PASS: ${records.length} sanitized records correlate to ${correlationId}.`);
