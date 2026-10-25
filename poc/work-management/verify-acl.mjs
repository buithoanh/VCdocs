// Read-only ACL readback for every Work management resource created by the
// acceptance scripts. Used after restart and against the restored instance
// (WORK13_NC_BASE / WORK13_NC_CONTAINER point it at the restore stack).
import { createHash } from 'node:crypto';
import { client, ncBase, ocsData, readEvidence, writeEvidence } from './lib.mjs';
import { execFileAsync } from './lib.mjs';

const label = process.argv[2] || 'readback';
const relay = process.env.WORK13_RELAY_CONTAINER || 'vcworkspace-work13-nextcloud-loopback-relay-1';
const ncContainer = process.env.WORK13_NC_CONTAINER || 'vcworkspace-work13-nextcloud-1';
const { stdout: relayIp } = await execFileAsync('docker', ['inspect', relay, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}']);
for (const ip of relayIp.trim().split(' ')) await execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-interaction', 'security:bruteforce:reset', ip]);

const deck = await readEvidence('acceptance-deck.json');
const notes = await readEvidence('acceptance-notes.json');
const forms = await readEvidence('acceptance-forms.json');
const tables = await readEvidence('acceptance-tables.json');
const wiki = await readEvidence('acceptance-collectives.json');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dav = (uid, path) => `/remote.php/dav/files/${encodeURIComponent(uid)}/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

const checks = [
  { app: 'deck', owner: true, path: () => `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`, expect: deck.marker },
  { app: 'deck-attachment', owner: true, raw: true, path: () => `/index.php/apps/deck/api/v1.1/boards/${deck.resources.boardId}/stacks/${deck.resources.stackId}/cards/${deck.resources.cardId}/attachments/file/${deck.resources.attachmentId}`, sha: deck.manager.attachmentDownloadSha256 },
  { app: 'deck-comments', owner: true, path: () => `/ocs/v2.php/apps/deck/api/v1.0/cards/${deck.resources.cardId}/comments`, expect: deck.marker },
  { app: 'notes', ownerOnly: true, path: () => `/index.php/apps/notes/api/v1/notes/${notes.resources.noteId}`, expect: notes.marker },
  { app: 'notes-shared-file', memberOnly: true, raw: true, path: (actor) => dav(actor.uid, `${notes.resources.memberTarget}/${notes.resources.noteFile}`), expect: notes.marker },
  { app: 'forms', owner: true, path: () => `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}`, expect: forms.marker },
  // Submit-only members may list submissions, scoped to their own responses.
  { app: 'forms-results', owner: true, path: () => `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}/submissions`, expect: forms.marker, memberMustNotSee: `Owner answer ${forms.marker}` },
  { app: 'tables-rows', owner: true, path: () => `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}/rows`, expect: tables.marker },
  { app: 'collectives-page', owner: true, path: () => `/ocs/v2.php/apps/collectives/api/v1.0/collectives/${wiki.resources.collectiveId}/pages/${wiki.resources.pageId}`, expect: wiki.marker },
  { app: 'collectives-file', memberOnly: true, raw: true, path: (actor) => dav(actor.uid, wiki.resources.memberPagePath), expect: wiki.marker },
];

const actors = Object.fromEntries(await Promise.all(['manager-a', 'member-a', 'manager-b', 'outsider'].map(async (name) => [name, await client(name)])));
const results = {};
const failures = [];
for (const check of checks) {
  results[check.app] = {};
  for (const [name, actor] of Object.entries(actors)) {
    let allowed = name === 'manager-a' || name === 'member-a';
    if (check.ownerOnly) allowed = name === 'manager-a';
    if (check.memberOnly) allowed = name === 'member-a';
    if (check.memberOnly && name === 'manager-a') continue;
    // Deny probes on per-user DAV paths target member-a's path, not their own.
    const target = check.memberOnly && !allowed ? actors['member-a'] : actor;
    const response = await actor.request('GET', check.path(target), { raw: Boolean(check.raw) });
    const body = check.raw ? response.bytes.toString() : JSON.stringify(ocsData(response));
    let ok;
    if (allowed) {
      ok = response.status === 200 && (!check.expect || body.includes(check.expect)) && (!check.sha || sha(response.bytes) === check.sha);
      if (name === 'member-a' && check.memberMustNotSee && body.includes(check.memberMustNotSee)) ok = false;
    } else {
      // Raw (DAV) error bodies echo the requested path, so only the status counts there.
      ok = response.status >= 400 && (check.raw || !check.expect || !body.includes(check.expect));
    }
    results[check.app][name] = response.status;
    if (!ok) failures.push(`${check.app}:${name}:${response.status}`);
  }
}
if (failures.length) throw new Error(`ACL_READBACK_FAILED(${label}):${failures.join(',')}`);
await writeEvidence(`verify-acl-${label}.json`, { label, ncBase, results, result: 'LOCAL PASS' });
console.log(`ACL readback ${label} PASS on ${ncBase}: ${JSON.stringify(results)}`);
