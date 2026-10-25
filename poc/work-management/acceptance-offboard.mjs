// Ownership transfer and offboard: manager-a leaves Team A. Every resource is
// handed to successor-a by immutable user ID (admin CLI where the app offers
// one, owner API otherwise), then manager-a is disabled at Authentik and in
// Nextcloud and its app passwords/sessions are revoked. Readback: successor
// manages, member keeps working, manager-a gets 401, outsiders stay denied.
import { spawn } from 'node:child_process';
import { akApi, client, execFileAsync, expectStatus, ncBase, ocsData, occ, readEvidence, resetBruteforce, results, secret, writeEvidence } from './lib.mjs';

await resetBruteforce();
const deck = await readEvidence('acceptance-deck.json');
const notes = await readEvidence('acceptance-notes.json');
const forms = await readEvidence('acceptance-forms.json');
const tables = await readEvidence('acceptance-tables.json');
const wiki = await readEvidence('acceptance-collectives.json');
const manager = await client('manager-a');
const successor = await client('successor-a');
const member = await client('member-a');
const outsider = await client('outsider');
const steps = {};

// Before: successor is only a Team A member (no owner rights).
steps.before = {
  successorEditsBoardTitle: (await successor.request('PUT', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`, { json: { title: 'not yet', color: '0082c9', archived: false } })).status,
  successorReadsAllFormResults: JSON.stringify(ocsData(await successor.request('GET', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}/submissions`))).includes(`Owner answer ${forms.marker}`),
};
if (steps.before.successorEditsBoardTitle < 400 || steps.before.successorReadsAllFormResults) throw new Error(`SUCCESSOR_ALREADY_PRIVILEGED:${JSON.stringify(steps.before)}`);

// 1. Transfer while the leaver still exists.
// deck:transfer-ownership asks for confirmation; answer it explicitly.
await new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', '-u', 'www-data', 'vcworkspace-work13-nextcloud-1', 'php', 'occ', '--no-ansi', 'deck:transfer-ownership', '--remap', manager.uid, successor.uid], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`DECK_TRANSFER_FAILED:${code}:${output}`))));
  child.stdin.end('y\n');
});
await occ('tables:owner', String(tables.resources.tableId), successor.uid);
expectStatus('forms owner transfer', await manager.request('PATCH', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}`, { json: { keyValuePairs: { ownerId: successor.uid } } }), [200]);
const directMember = ocsData(expectStatus('add successor to wiki team', await manager.request('POST', `/ocs/v2.php/apps/circles/circles/${wiki.resources.circleId}/members`, { json: { userId: successor.uid, type: 1 } }), [200]));
expectStatus('promote successor to team owner', await manager.request('PUT', `/ocs/v2.php/apps/circles/circles/${wiki.resources.circleId}/members/${directMember.id}/level`, { json: { level: 9 } }), [200]);
const { stdout: filesTransfer } = await occ('files:transfer-ownership', '--use-user-id', manager.uid, successor.uid);
steps.transfer = { deck: 'occ deck:transfer-ownership --remap', tables: 'occ tables:owner', forms: 'owner API PATCH ownerId', collectives: 'team member + level 9 (owner) via circles API', files: filesTransfer.trim().split('\n').slice(-2) };

// 2. Offboard the leaver: IdP first (no new logins), then Nextcloud account,
// sessions and app passwords.
const akUser = results(await akApi('/core/users/?page_size=100')).find((item) => item.username === 'manager-a');
await akApi(`/core/users/${akUser.pk}/`, { method: 'PATCH', body: { is_active: false } });
const akSessions = results(await akApi('/core/authenticated_sessions/?page_size=100')).filter((item) => item.user === akUser.pk);
for (const session of akSessions) await akApi(`/core/authenticated_sessions/${session.uuid}/`, { method: 'DELETE' });
await occ('user:disable', manager.uid);
const tokens = JSON.parse((await occ('user:auth-tokens:list', '--output=json', manager.uid)).stdout);
for (const token of tokens) await occ('user:auth-tokens:delete', manager.uid, String(token.id));
const tokensAfter = JSON.parse((await occ('user:auth-tokens:list', '--output=json', manager.uid)).stdout);
steps.offboard = { authentikDisabled: true, authentikSessionsDeleted: akSessions.length, nextcloudDisabled: true, tokensRevoked: tokens.length, tokensRemaining: tokensAfter.length };

// 3. Readback.
await resetBruteforce();
const leaverPassword = await secret('app_password_manager-a');
const leaverApi = await fetch(`${ncBase}/ocs/v2.php/cloud/user?format=json`, { headers: { Authorization: `Basic ${Buffer.from(`${manager.uid}:${leaverPassword}`).toString('base64')}`, 'OCS-APIRequest': 'true' } });
const leaverDeck = await manager.request('GET', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`);
const boardAfter = expectStatus('successor reads board', await successor.request('GET', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`), [200]).data;
const successorBoardEdit = await successor.request('PUT', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`, { json: { title: boardAfter.title, color: '0082c9', archived: false } });
const tableAfter = expectStatus('successor reads table', await successor.request('GET', `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}`), [200]).data;
const formResults = JSON.stringify(ocsData(expectStatus('successor reads all results', await successor.request('GET', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}/submissions`), [200])));
const formAfter = ocsData(await successor.request('GET', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}`));
const wikiAfter = ocsData(expectStatus('successor reads wiki page', await successor.request('GET', `/ocs/v2.php/apps/collectives/api/v1.0/collectives/${wiki.resources.collectiveId}/pages/${wiki.resources.pageId}`), [200]));
const circle = JSON.parse((await occ('circles:manage:details', wiki.resources.circleId, '--output=json')).stdout);
// The note moved into "transferred from <uid> on <date>/<Notes folder>/..." of the successor.
const { stdout: found } = await execFileAsync('docker', ['exec', '-u', 'www-data', 'vcworkspace-work13-nextcloud-1', 'find', `/var/www/html/data/${successor.uid}/files`, '-name', notes.resources.noteFile]);
const successorNotePath = found.trim().split('\n')[0]?.replace(`/var/www/html/data/${successor.uid}/files/`, '');
const successorNote = successorNotePath ? await successor.request('GET', `/remote.php/dav/files/${encodeURIComponent(successor.uid)}/${successorNotePath.split('/').map(encodeURIComponent).join('/')}`, { raw: true }) : { status: 404, bytes: Buffer.alloc(0) };
const memberNote = await member.request('GET', `/remote.php/dav/files/${encodeURIComponent(member.uid)}/${encodeURIComponent(notes.resources.memberTarget)}/${encodeURIComponent(notes.resources.noteFile)}`, { raw: true });

const readback = {
  leaver: { appPasswordApi: leaverApi.status, deckBoard: leaverDeck.status },
  successor: {
    deckOwner: boardAfter.owner?.uid === successor.uid, deckEditBoard: successorBoardEdit.status,
    tablesOwner: tableAfter.ownership === successor.uid,
    formsOwner: formAfter.ownerId === successor.uid, formsSeesAllResults: formResults.includes(`Owner answer ${forms.marker}`) && formResults.includes(`Answer ${forms.marker}`),
    wikiPageRead: wikiAfter.page?.id === wiki.resources.pageId, teamOwner: circle.owner?.userId === successor.uid,
    noteTransferredPath: successorNotePath ?? null, noteRead: successorNote.status, noteContent: successorNote.bytes.toString().includes(notes.marker),
  },
  member: {
    deck: (await member.request('GET', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`)).status,
    sharedNote: memberNote.status,
    form: (await member.request('GET', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}`)).status,
    tableRows: (await member.request('GET', `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}/rows`)).status,
    wikiPage: (await member.request('GET', `/ocs/v2.php/apps/collectives/api/v1.0/collectives/${wiki.resources.collectiveId}/pages/${wiki.resources.pageId}`)).status,
  },
  outsider: {
    deck: (await outsider.request('GET', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`)).status,
    form: (await outsider.request('GET', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}`)).status,
    table: (await outsider.request('GET', `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}`)).status,
    wikiPage: (await outsider.request('GET', `/ocs/v2.php/apps/collectives/api/v1.0/collectives/${wiki.resources.collectiveId}/pages/${wiki.resources.pageId}`)).status,
  },
};
const problems = [];
if (readback.leaver.appPasswordApi !== 401 || readback.leaver.deckBoard !== 401) problems.push('leaver-not-locked-out');
for (const [key, value] of Object.entries(readback.successor)) if (value === false || (typeof value === 'number' && value !== 200)) problems.push(`successor:${key}`);
for (const [key, value] of Object.entries(readback.member)) if (value !== 200) problems.push(`member:${key}:${value}`);
for (const [key, value] of Object.entries(readback.outsider)) if (value < 400) problems.push(`outsider:${key}:${value}`);
await writeEvidence('acceptance-offboard.json', { leaver: 'manager-a', successor: 'successor-a', steps, readback, problems, result: problems.length ? 'PARTIAL' : 'LOCAL PASS' });
if (problems.length) throw new Error(`OFFBOARD_PROBLEMS:${problems.join(',')}:${JSON.stringify(readback)}`);
console.log(`Offboard PASS: ${JSON.stringify(readback)}`);
