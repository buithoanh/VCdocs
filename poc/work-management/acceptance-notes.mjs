// Notes: note + image attachment in a category folder shared to Team A; member
// reads/edits through WebDAV and comments via Files comments; Team B and the
// outsider are denied on Notes API, WebDAV, comments and share APIs.
import { createHash } from 'node:crypto';
import { client, expectStatus, ocsData, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';

await resetBruteforce();

const { federatedGroups } = await readEvidence('nextcloud-config.json');
const manager = await client('manager-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const notes = '/index.php/apps/notes/api/v1';
const marker = `work13-notes-${Date.now()}`;
const category = `TeamA-${marker}`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const davPath = (uid, path) => `/remote.php/dav/files/${encodeURIComponent(uid)}/${path.split('/').map(encodeURIComponent).join('/')}`;

// The Notes folder name is localised per user; ask the app instead of guessing.
const notesPath = expectStatus('notes settings', await manager.request('GET', `${notes}/settings`), [200]).data.notesPath.replace(/^\/|\/$/g, '');
const note = expectStatus('create note', await manager.request('POST', `${notes}/notes`, { json: { title: `Meeting ${marker}`, content: `# Meeting ${marker}\n\nAgenda for Team A.\n`, category } }), [200]).data;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), `${marker}.png`);
const upload = expectStatus('note attachment', await manager.request('POST', `${notes}/attachment/${note.id}`, { body: form }), [200]).data;
const attachmentPath = upload.filename;
const attachmentRead = await manager.request('GET', `${notes}/attachment/${note.id}?path=${encodeURIComponent(attachmentPath)}`, { raw: true });
if (attachmentRead.status !== 200 || sha(attachmentRead.bytes) !== sha(png)) throw new Error(`NOTE_ATTACHMENT_READBACK_${attachmentRead.status}`);

const share = ocsData(expectStatus('share category folder', await manager.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', {
  json: { path: `/${notesPath}/${category}`, shareType: 1, shareWith: federatedGroups['vcw-team-a'], permissions: 3 },
}), [200]));
const target = share.file_target.replace(/^\//, '');
const noteFile = `${note.title}.md`;
const memberRead = await member.request('GET', davPath(member.uid, `${target}/${noteFile}`), { raw: true });
if (memberRead.status !== 200 || !memberRead.bytes.toString().includes(marker)) throw new Error(`MEMBER_NOTE_READ_${memberRead.status}`);
const memberEdit = expectStatus('member edit note', await member.request('PUT', davPath(member.uid, `${target}/${noteFile}`), { body: `${memberRead.bytes.toString()}\nMember update ${marker}\n` }), [204]);
const managerAfterEdit = expectStatus('manager reads member edit', await manager.request('GET', `${notes}/notes/${note.id}`), [200]).data;
if (!managerAfterEdit.content.includes(`Member update ${marker}`)) throw new Error('MEMBER_EDIT_NOT_VISIBLE_TO_OWNER');
const comment = await member.request('POST', `/remote.php/dav/comments/files/${note.id}`, { json: { actorType: 'users', verb: 'comment', message: `Comment ${marker}` } });
if (comment.status !== 201) throw new Error(`MEMBER_COMMENT_${comment.status}`);

const deny = {};
await resetBruteforce();
for (const actor of [otherTeam, outsider]) {
  deny[actor.username] = {
    notesApiRead: (await actor.request('GET', `${notes}/notes/${note.id}`)).status,
    notesApiUpdate: (await actor.request('PUT', `${notes}/notes/${note.id}`, { json: { content: 'intrusion' } })).status,
    notesAttachment: (await actor.request('GET', `${notes}/attachment/${note.id}?path=${encodeURIComponent(attachmentPath)}`, { raw: true })).status,
    webdavOwnerPath: (await actor.request('GET', davPath(manager.uid, `${notesPath}/${category}/${noteFile}`), { raw: true })).status,
    webdavSharedTarget: (await actor.request('GET', davPath(actor.uid, `${target}/${noteFile}`), { raw: true })).status,
    filesComment: (await actor.request('POST', `/remote.php/dav/comments/files/${note.id}`, { json: { actorType: 'users', verb: 'comment', message: 'intrusion' } })).status,
    shareInfo: (await actor.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/shares/${share.id}?format=json`)).status,
    reshareToSelf: (await actor.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', { json: { path: `/${notesPath}/${category}`, shareType: 0, shareWith: actor.uid, permissions: 31 } })).status,
  };
  const listed = ocsData(await actor.request('GET', `${notes}/notes`));
  deny[actor.username].notesListContainsNote = Array.isArray(listed) && listed.some((item) => item.id === note.id);
  for (const [check, value] of Object.entries(deny[actor.username])) {
    if (value === true || (typeof value === 'number' && value < 400)) throw new Error(`NOTES_DENY_FAILED:${actor.username}:${check}:${value}`);
  }
}

await writeEvidence('acceptance-notes.json', {
  marker,
  resources: { noteId: note.id, notesPath, category, noteFile, attachmentPath, shareId: share.id, memberTarget: target },
  manager: { created: true, attachmentSha256: sha(png), sharedTo: 'vcw-team-a (federated id)', sharePermissions: share.permissions, sawMemberEdit: true },
  member: { webdavRead: memberRead.status, webdavEdit: memberEdit.status, filesComment: comment.status },
  deny,
  limitation: 'Notes API only lists notes in the caller own Notes folder; shared notes are reached through Files/WebDAV, not the Notes app list.',
  result: 'LOCAL PASS',
});
console.log(`Notes PASS: note ${note.id}, share ${share.id} -> ${target}, deny ${JSON.stringify(deny)}`);
