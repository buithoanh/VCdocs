// Owner-level export of every Work management resource. Files land in the
// git-ignored backup/export-* folder; evidence records sizes, hashes and the
// markers found, never the content itself.
import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { client, execFileAsync, ncContainer, ocsData, occ, readEvidence, root, writeEvidence } from './lib.mjs';

const deck = await readEvidence('acceptance-deck.json');
const notes = await readEvidence('acceptance-notes.json');
const forms = await readEvidence('acceptance-forms.json');
const tables = await readEvidence('acceptance-tables.json');
const wiki = await readEvidence('acceptance-collectives.json');
const manager = await client('manager-a');
const dir = join(root, 'backup', `export-${Date.now()}`);
await mkdir(dir, { recursive: true, mode: 0o700 });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exports = {};
async function save(name, bytes, mustContain) {
  await writeFile(join(dir, name), bytes, { mode: 0o600 });
  await chmod(join(dir, name), 0o600);
  const text = Buffer.from(bytes).toString('utf8');
  const missing = mustContain.filter((value) => !text.includes(value));
  exports[name] = { bytes: bytes.length, sha256: sha(bytes), contains: mustContain.length - missing.length, missing };
  if (missing.length) throw new Error(`EXPORT_MISSING:${name}:${missing.join(',')}`);
}

// Deck: admin CLI export of the owner's boards (JSON), includes cards and ACL.
const { stdout: deckJson } = await occ('deck:export', manager.uid);
await save('deck-export.json', Buffer.from(deckJson), [deck.marker, `Card ${deck.marker}`]);
// Notes: the note is a Markdown file; the attachment is a sibling file.
const note = ocsData(await manager.request('GET', `/index.php/apps/notes/api/v1/notes/${notes.resources.noteId}`));
await save('note.md', Buffer.from(note.content), [notes.marker, `Member update ${notes.marker}`]);
// Forms: CSV of all responses.
const csv = await manager.request('GET', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}/submissions?fileFormat=csv`, { raw: true, headers: { Accept: 'text/csv' } });
await save('forms-submissions.csv', csv.bytes, [`Answer ${forms.marker}`, `Owner answer ${forms.marker}`]);
// Tables: scheme + rows JSON (the UI CSV export is client-side only).
const scheme = (await manager.request('GET', `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}/scheme`)).data;
const rows = (await manager.request('GET', `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}/rows`)).data;
await save('tables-export.json', Buffer.from(JSON.stringify({ scheme, rows }, null, 2)), [tables.marker, `Member task edited ${tables.marker}`]);
// Collectives: the collective folder as a zip through WebDAV.
const folder = wiki.resources.memberPagePath.split('/').slice(0, 2).join('/');
const zip = await manager.request('GET', `/remote.php/dav/files/${encodeURIComponent(manager.uid)}/${folder.split('/').map(encodeURIComponent).join('/')}`, { raw: true, headers: { Accept: 'application/zip' } });
if (zip.status !== 200 || zip.bytes.subarray(0, 2).toString() !== 'PK') throw new Error(`COLLECTIVE_ZIP_${zip.status}`);
await save('collective.zip', zip.bytes, []);
const { stdout: listing } = await execFileAsync('unzip', ['-l', join(dir, 'collective.zip')]);
exports['collective.zip'].entries = listing.split('\n').filter((line) => /\.md$|\.attachments/.test(line)).map((line) => line.trim().split(/\s+/).slice(3).join(' '));
if (!exports['collective.zip'].entries.some((entry) => entry.includes(`Runbook ${wiki.marker}`))) throw new Error('COLLECTIVE_ZIP_MISSING_PAGE');

await writeEvidence('export.json', { container: ncContainer, location: 'poc/work-management/backup/ (git-ignored, 0600)', exports, result: 'LOCAL PASS' });
console.log(`Export PASS: ${Object.entries(exports).map(([name, item]) => `${name} ${item.bytes}B`).join(', ')}`);
