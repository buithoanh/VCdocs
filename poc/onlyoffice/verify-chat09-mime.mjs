import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { simpleParser } = require('mailparser');

const [path, expectedSha256] = process.argv.slice(2);
if (!path || !expectedSha256) throw new Error('Cần đường dẫn MIME và SHA-256 dự kiến');
const parsed = await simpleParser(await readFile(path));
if (parsed.attachments.length !== 1) throw new Error(`Cần đúng một attachment, nhận ${parsed.attachments.length}`);
const attachment = parsed.attachments[0];
const actualSha256 = createHash('sha256').update(attachment.content).digest('hex');
if (actualSha256 !== expectedSha256) throw new Error(`SHA-256 không khớp: ${actualSha256}`);
console.log(`CHAT09_MIME_SNAPSHOT_OK filename=${attachment.filename} bytes=${attachment.size} sha256=${actualSha256}`);
