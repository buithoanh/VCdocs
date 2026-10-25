// Browser UI matrix: each persona signs in through Authentik OIDC, opens every
// Team A resource in the real app UI and also calls the app API from the same
// cookie session (CSRF request token). Team A sees the marker; Team B and the
// outsider see neither the UI content nor a 2xx from the session API.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { client, ocsData, readEvidence, resetBruteforce, root, writeEvidence } from './lib.mjs';
import { launchChrome, loginNextcloud, pageFetch, screenshot, sleep } from './browser-lib.mjs';

const deck = await readEvidence('acceptance-deck.json');
const notes = await readEvidence('acceptance-notes.json');
const forms = await readEvidence('acceptance-forms.json');
const tables = await readEvidence('acceptance-tables.json');
const wiki = await readEvidence('acceptance-collectives.json');
// Open the exact collective: /apps/collectives/ would redirect to whichever
// collective the user saw first.
const collectives = ocsData(await (await client('manager-a')).request('GET', '/ocs/v2.php/apps/collectives/api/v1.0/collectives'));
const collective = (collectives.collectives ?? collectives).find((item) => item.id === wiki.resources.collectiveId);
const resources = [
  // First: the Text editor long-polls of later pages keep server workers busy
  // for a while after navigation, which delays the heavier Collectives UI.
  { app: 'collectives', url: `/apps/collectives/${encodeURIComponent(collective.slug)}-${collective.id}`, text: wiki.marker, api: `/ocs/v2.php/apps/collectives/api/v1.0/collectives/${wiki.resources.collectiveId}/pages/${wiki.resources.pageId}` },
  { app: 'deck', url: `/apps/deck/board/${deck.resources.boardId}`, text: deck.marker, api: `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}` },
  { app: 'notes', url: `/apps/notes/note/${notes.resources.noteId}`, text: notes.marker, api: `/index.php/apps/notes/api/v1/notes/${notes.resources.noteId}`, ownerOnly: true },
  { app: 'forms', url: `/apps/forms/${forms.resources.hash}`, text: forms.marker, api: `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}` },
  { app: 'tables', url: `/apps/tables/#/table/${tables.resources.tableId}`, text: tables.marker, api: `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}` },
];
// Notes UI/API only shows notes inside the caller's own Notes folder, so for
// member-a the shared note is checked through the Files UI instead.
const memberNotes = { app: 'notes(files)', url: `/apps/files/?dir=/${encodeURIComponent(notes.resources.memberTarget)}`, text: notes.resources.noteFile.replace(/\.md$/, ''), api: `/remote.php/dav/files/{uid}/${encodeURIComponent(notes.resources.memberTarget)}/${encodeURIComponent(notes.resources.noteFile)}` };
const personas = [
  { username: 'manager-a', allowed: true },
  { username: 'member-a', allowed: true },
  { username: 'manager-b', allowed: false },
  { username: 'outsider', allowed: false },
];

const { cdp, close } = await launchChrome();
const matrix = {};
const shots = [];
// Track requests so a stalled UI can be explained by what is still pending.
const inflight = new Map();
cdp.subscribe('Network.requestWillBeSent', ({ requestId, request }) => inflight.set(requestId, { url: request.url, t: Date.now() }));
cdp.subscribe('Network.loadingFinished', ({ requestId }) => inflight.delete(requestId));
cdp.subscribe('Network.loadingFailed', ({ requestId }) => inflight.delete(requestId));
try {
  for (const persona of personas) {
    await resetBruteforce();
    const account = await loginNextcloud(cdp, persona.username);
    matrix[persona.username] = { loginStatus: account.status, uid: account.id };
    const list = resources.map((item) => (persona.username === 'member-a' && item.app === 'notes' ? memberNotes : item));
    for (const item of list) {
      await cdp.send('Page.navigate', { url: `http://nc13.localtest.me:18130${item.url}` });
      let visible = false;
      const deadline = Date.now() + (persona.allowed ? 60000 : 15000);
      while (Date.now() < deadline) {
        try {
          visible = await cdp.evaluate(`(document.body?.innerText || '').includes(${JSON.stringify(item.text)})`);
        } catch { /* navigating */ }
        if (visible) break;
        await sleep(500);
      }
      const apiPath = item.api.replace('{uid}', encodeURIComponent(account.id));
      const api = await pageFetch(cdp, 'GET', apiPath);
      matrix[persona.username][item.app] = { uiShowsMarker: visible, sessionApiStatus: api.status };
      if (persona.allowed && (!visible || api.status >= 400)) {
        const page = await cdp.evaluate('location.href + " | " + (document.body?.innerText || "").slice(0, 400)').catch(() => '?');
        const pending = [...inflight.values()].map((entry) => `${Math.round((Date.now() - entry.t) / 1000)}s ${entry.url.slice(0, 110)}`);
        throw new Error(`UI_ALLOWED_FAILED:${persona.username}:${item.app}:${visible}:${api.status}:${api.text?.slice(0, 200)}:${page}\nPENDING:\n${pending.join('\n')}`);
      }
      if (!persona.allowed && (visible || api.status < 400)) {
        const pending = [...inflight.values()].map((entry) => `${Math.round((Date.now() - entry.t) / 1000)}s ${entry.url.slice(0, 110)}`);
        throw new Error(`UI_DENY_FAILED:${persona.username}:${item.app}:${visible}:${api.status}:${api.text?.slice(0, 120)}\nPENDING:\n${pending.join('\n')}`);
      }
      if (['deck', 'forms'].includes(item.app) && ['manager-a', 'member-a', 'outsider'].includes(persona.username)) {
        const name = `browser-${persona.username}-${item.app}.png`;
        await writeFile(join(root, 'evidence', name), await screenshot(cdp));
        shots.push(name);
      }
    }
  }
} finally {
  close();
}
await writeEvidence('browser-ui.json', { browser: 'Google Chrome headless via CDP, OIDC through Authentik form', matrix, screenshots: shots, result: 'LOCAL PASS' });
console.log(`Browser UI PASS: ${JSON.stringify(matrix)}`);
