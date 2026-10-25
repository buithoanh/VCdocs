// Chat14: read the official App Store metadata for Nextcloud 33.0.10 and pin
// the highest stable release of the Flow apps used by the acceptance flows.
// install-flow-apps.mjs refuses to continue if the installed version drifts.
// workflow_script is only looked up (metadata), never installed.
import { writeEvidence } from './lib.mjs';

const platform = '33.0.10';
const source = `https://apps.nextcloud.com/api/v1/platform/${platform}/apps.json`;
const wanted = ['forms_deck', 'files_automatedtagging', 'files_accesscontrol', 'workflow_script'];
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`APP_STORE_${response.status}`);
const catalog = await response.json();
const compare = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
};
const apps = wanted.map((id) => {
  const app = catalog.find((item) => item.id === id);
  if (!app) return { id, listed: false };
  const stable = app.releases.filter((release) => !release.isNightly && /^\d+(\.\d+)*$/.test(release.version));
  stable.sort((left, right) => compare(right.version, left.version));
  const release = stable[0];
  return {
    id,
    listed: true,
    stableVersion: release?.version ?? null,
    platformSpec: release?.rawPlatformVersionSpec ?? null,
    released: release?.created?.slice(0, 10) ?? null,
    download: release?.download ?? null,
    licenses: release?.licenses ?? [],
    signed: Boolean(release?.signature),
  };
});
await writeEvidence('flow-app-preflight.json', {
  source,
  platform,
  apps,
  note: 'workflow_script chỉ đọc metadata, KHÔNG cài (không bật shell tuỳ ý).',
});
console.log(apps.map((app) => `${app.id} ${app.stableVersion ?? 'NOT_LISTED'} (${app.platformSpec ?? '-'}) signed=${app.signed}`).join('\n'));
