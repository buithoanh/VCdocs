// Chat19: create the fake Team A / Team B corpus through the public APIs as
// the owning personas (never DB/data directory): Files (folder shared read-only
// to the team group), Notes (personal), Deck (board shared to the team group),
// Collectives (Team A wiki, Team A group as member), Talk messages in the
// chat17 team rooms. Idempotent: existing items are found and reused.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aiRoot, client, ocs, teamGroups, writeEvidence } from './lib.mjs';
import { collective, deck, notes, talkMessages, teamAFiles, teamBFiles } from './corpus.mjs';

const enc = encodeURIComponent;
const dav = (uid, path) => `/remote.php/dav/files/${enc(uid)}/${path.split('/').map(enc).join('/')}`;
const expect = (label, res, ok = [200, 201, 204]) => {
  if (!ok.includes(res.status)) throw new Error(`${label}: HTTP ${res.status} ${String(res.text).slice(0, 300)}`);
  return res;
};
const out = { files: {}, shares: {}, notes: {}, deck: {}, collective: {}, talk: {} };

async function fileId(c, path) {
  const res = await c.request('PROPFIND', dav(c.uid, path), {
    headers: { Depth: '0', 'Content-Type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
  });
  return Number((/<oc:fileid>(\d+)<\/oc:fileid>/.exec(res.text) ?? [])[1] ?? 0) || null;
}

async function teamFolder(ownerName, folder, files, groupId) {
  const owner = await client(ownerName);
  const mk = await owner.request('MKCOL', dav(owner.uid, folder));
  expect(`mkcol ${folder}`, mk, [201, 405]);
  for (const [name, body] of Object.entries(files)) {
    expect(`put ${name}`, await owner.request('PUT', dav(owner.uid, `${folder}/${name}`), { body, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }));
    out.files[`${folder}/${name}`] = { owner: ownerName, fileId: await fileId(owner, `${folder}/${name}`) };
  }
  const existing = ocs(await owner.request('GET', `/ocs/v2.php/apps/files_sharing/api/v1/shares?path=${enc(`/${folder}`)}`)) ?? [];
  let share = existing.find((s) => s.share_type === 1 && s.share_with === groupId);
  if (!share) {
    share = ocs(expect('share folder', await owner.request('POST', '/ocs/v2.php/apps/files_sharing/api/v1/shares', { json: { path: `/${folder}`, shareType: 1, shareWith: groupId, permissions: 1 } }), [200]));
  }
  out.shares[folder] = { id: share.id, shareWith: groupId, permissions: share.permissions, folderId: await fileId(owner, folder) };
}
await teamFolder('successor-a', 'ai19-team-a', teamAFiles, teamGroups.a);
await teamFolder('manager-b', 'ai19-team-b', teamBFiles, teamGroups.b);

// Notes (personal, stored in the user's Notes/ folder).
for (const [name, note] of Object.entries(notes)) {
  const c = await client(name);
  const api = '/index.php/apps/notes/api/v1/notes';
  const list = expect('notes list', await c.request('GET', api), [200]).data;
  let n = list.find((item) => item.title === note.title);
  if (!n) n = expect('note create', await c.request('POST', api, { json: { title: note.title, content: note.content, category: 'ai19' } }), [200]).data;
  out.notes[name] = { id: n.id, title: n.title };
}

// Deck boards shared to the team group (read-only ACL).
const deckApi = '/index.php/apps/deck/api/v1.0';
for (const [teamKey, d] of Object.entries(deck)) {
  const c = await client(d.owner);
  const boards = expect('deck boards', await c.request('GET', `${deckApi}/boards`), [200]).data;
  let board = boards.find((b) => b.title === d.board && !b.deletedAt);
  if (!board) {
    board = expect('deck board', await c.request('POST', `${deckApi}/boards`, { json: { title: d.board, color: '0082c9' } }), [200]).data;
    expect('deck acl', await c.request('POST', `${deckApi}/boards/${board.id}/acl`, { json: { type: 1, participant: teamGroups[teamKey.toLowerCase()], permissionEdit: false, permissionShare: false, permissionManage: false } }), [200]);
  }
  const stacks = expect('deck stacks', await c.request('GET', `${deckApi}/boards/${board.id}/stacks`), [200]).data;
  let stack = stacks[0];
  if (!stack) stack = expect('deck stack', await c.request('POST', `${deckApi}/boards/${board.id}/stacks`, { json: { title: 'Việc', order: 1 } }), [200]).data;
  let card = (stack.cards ?? []).find((x) => x.title === d.card);
  if (!card) card = expect('deck card', await c.request('POST', `${deckApi}/boards/${board.id}/stacks/${stack.id}/cards`, { json: { title: d.card, type: 'plain', order: 1, description: d.description } }), [200]).data;
  out.deck[teamKey] = { boardId: board.id, stackId: stack.id, cardId: card.id };
}

// Collectives: Team A wiki with the Team A group as member.
{
  const c = await client(collective.owner);
  const api = '/ocs/v2.php/apps/collectives/api/v1.0';
  const list = ocs(expect('collectives list', await c.request('GET', `${api}/collectives`), [200]));
  let col = (list.collectives ?? list).find((x) => x.name === collective.name);
  if (!col) {
    const created = ocs(expect('collective create', await c.request('POST', `${api}/collectives`, { json: { name: collective.name } }), [200]));
    col = created.collective ?? created;
    expect('collective add Team A', await c.request('POST', `/ocs/v2.php/apps/circles/circles/${col.circleId}/members`, { json: { userId: teamGroups.a, type: 2 } }), [200]);
  }
  const pages = ocs(expect('pages', await c.request('GET', `${api}/collectives/${col.id}/pages`), [200])).pages;
  const landing = pages.find((p) => p.parentId === 0);
  let page = pages.find((p) => p.title === collective.page);
  if (!page) page = ocs(expect('page create', await c.request('POST', `${api}/collectives/${col.id}/pages/${landing.id}`, { json: { title: collective.page } }), [200])).page;
  const pagePath = `${page.collectivePath}/${page.filePath}/${page.fileName}`.replace(/\/+/g, "/").replace(/^\//, "");
  expect('page body', await c.request('PUT', dav(c.uid, pagePath), { body: collective.body, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }));
  out.collective = { id: col.id, circleId: col.circleId, pageId: page.id, pagePath };
}

// Talk messages in the chat17 team rooms (posted once; reused by marker).
const rooms = JSON.parse(await readFile(join(aiRoot, '..', 'talk', 'evidence', 'conversations.json'), 'utf8'));
for (const [teamKey, msgs] of Object.entries(talkMessages)) {
  const token = teamKey === 'A' ? rooms.teamA.token : rooms.teamB.token;
  out.talk[teamKey] = { token, messages: [] };
  for (const m of msgs) {
    const c = await client(m.by);
    const history = ocs(await c.request('GET', `/ocs/v2.php/apps/spreed/api/v1/chat/${token}?lookIntoFuture=0&limit=200`)) ?? [];
    let msg = history.find((h) => h.message === m.text);
    if (!msg) msg = ocs(expect('talk post', await c.request('POST', `/ocs/v2.php/apps/spreed/api/v1/chat/${token}`, { json: { message: m.text } }), [201]));
    out.talk[teamKey].messages.push({ id: msg.id, by: m.by });
  }
}

await writeEvidence('corpus.json', out);
console.log(JSON.stringify(out));
