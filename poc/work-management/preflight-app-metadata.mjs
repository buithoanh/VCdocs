// Read the official App Store metadata for Nextcloud 33.0.10 and record the
// highest stable (non pre-release, non nightly) release of each app we use.
// configure-nextcloud.mjs refuses to continue if the installed version drifts.
import { writeEvidence } from './lib.mjs';

const platform = '33.0.10';
const source = `https://apps.nextcloud.com/api/v1/platform/${platform}/apps.json`;
const wanted = ['user_oidc', 'deck', 'notes', 'forms', 'tables', 'collectives', 'forms_deck'];
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
  if (!app) throw new Error(`APP_NOT_LISTED_FOR_${platform}:${id}`);
  const stable = app.releases.filter((release) => !release.isNightly && /^\d+(\.\d+)*$/.test(release.version));
  stable.sort((left, right) => compare(right.version, left.version));
  const release = stable[0];
  if (!release) throw new Error(`NO_STABLE_RELEASE:${id}`);
  return {
    id,
    stableVersion: release.version,
    platformSpec: release.rawPlatformVersionSpec,
    released: release.created.slice(0, 10),
    download: release.download,
    licenses: release.licenses,
    signed: Boolean(release.signature),
  };
});
await writeEvidence('app-metadata-preflight.json', { source, platform, apps });
console.log(apps.map((app) => `${app.id} ${app.stableVersion} (${app.platformSpec})`).join('\n'));
