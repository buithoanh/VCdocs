// Browser readback after offboard: the leaver cannot complete an OIDC login,
// the successor opens the transferred board and table in the real UI.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readEvidence, resetBruteforce, root, writeEvidence } from './lib.mjs';
import { launchChrome, loginNextcloud, pageFetch, screenshot, sleep } from './browser-lib.mjs';

const deck = await readEvidence('acceptance-deck.json');
const tables = await readEvidence('acceptance-tables.json');
await resetBruteforce();
const { cdp, close } = await launchChrome();
const result = {};
try {
  try {
    await loginNextcloud(cdp, 'manager-a');
    result.leaverLogin = 'SUCCEEDED';
  } catch (error) {
    result.leaverLogin = 'BLOCKED';
    result.leaverPage = (await cdp.evaluate('location.host + location.pathname')).slice(0, 120);
  }
  await writeFile(join(root, 'evidence', 'browser-offboard-leaver.png'), await screenshot(cdp));
  const account = await loginNextcloud(cdp, 'successor-a');
  result.successorLogin = account.status;
  for (const [app, url, text, api] of [
    ['deck', `/apps/deck/board/${deck.resources.boardId}`, deck.marker, `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}`],
    ['tables', `/apps/tables/#/table/${tables.resources.tableId}`, tables.marker, `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}`],
  ]) {
    await cdp.send('Page.navigate', { url: `http://nc13.localtest.me:18130${url}` });
    let visible = false;
    for (let index = 0; index < 120 && !visible; index += 1) {
      await sleep(500);
      visible = await cdp.evaluate(`(document.body?.innerText || '').includes(${JSON.stringify(text)})`).catch(() => false);
    }
    result[app] = { uiShowsMarker: visible, sessionApiStatus: (await pageFetch(cdp, 'GET', api)).status };
    if (app === 'deck') await writeFile(join(root, 'evidence', 'browser-offboard-successor-deck.png'), await screenshot(cdp));
  }
} finally {
  close();
}
if (result.leaverLogin !== 'BLOCKED' || result.successorLogin !== 200 || !result.deck.uiShowsMarker || !result.tables.uiShowsMarker) throw new Error(`BROWSER_OFFBOARD_FAILED:${JSON.stringify(result)}`);
await writeEvidence('browser-offboard.json', { ...result, result: 'LOCAL PASS' });
console.log(`Browser offboard PASS: ${JSON.stringify(result)}`);
