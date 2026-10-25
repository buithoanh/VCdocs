// First OIDC login for every persona: creates the Nextcloud accounts through
// user_oidc and records the immutable ID binding used by every later script.
import { akApi, personaNames, readEvidence, results, writeEvidence } from './lib.mjs';
import { launchChrome, loginNextcloud } from './browser-lib.mjs';

const config = await readEvidence('nextcloud-config.json');
const groupByHash = Object.fromEntries(Object.entries(config.federatedGroups).map(([name, hash]) => [hash, name]));
const akUsers = results(await akApi('/core/users/?page_size=100'));
const { cdp, close } = await launchChrome();
const bindings = [];
try {
  for (const username of personaNames) {
    const account = await loginNextcloud(cdp, username);
    const akUser = akUsers.find((item) => item.username === username);
    if (account.status !== 200 || !/^[0-9a-f]{64}$/.test(account.id ?? '')) throw new Error(`LOGIN_INVALID:${username}:${account.status}`);
    bindings.push({
      username,
      authentikPk: akUser.pk,
      authentikUid: akUser.uid,
      nextcloudUserId: account.id,
      email: account.email,
      groups: account.groups.map((group) => groupByHash[group] ?? group),
    });
  }
} finally {
  close();
}
if (new Set(bindings.map((item) => item.nextcloudUserId)).size !== bindings.length) throw new Error('DUPLICATE_NEXTCLOUD_ID');
await writeEvidence('identity-bindings.json', { bindings });
console.log(bindings.map((item) => `${item.username} -> ${item.nextcloudUserId.slice(0, 12)}… ${item.groups.join(',')}`).join('\n'));
