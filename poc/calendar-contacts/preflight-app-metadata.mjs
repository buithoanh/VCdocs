// Chat16: read the official App Store metadata for Nextcloud 33.0.10 and pin
// the highest stable release of Calendar, Contacts and the room/resource
// backend (calendar_resource_management). install-apps.mjs refuses to continue
// if the installed version drifts from this pin. Metadata only, no download.
import { writeEvidence } from './lib.mjs';

const platform = '33.0.10';
const source = `https://apps.nextcloud.com/api/v1/platform/${platform}/apps.json`;
const wanted = ['calendar', 'contacts', 'calendar_resource_management'];
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`APP_STORE_${response.status}`);
const catalog = await response.json();
const compare = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
const apps = wanted.map((id) => {
  const app = catalog.find((item) => item.id === id);
  if (!app) return { id, listed: false };
  const stable = app.releases.filter((r) => !r.isNightly && /^\d+(\.\d+)*$/.test(r.version));
  stable.sort((l, r) => compare(r.version, l.version));
  const release = stable[0];
  return {
    id,
    listed: true,
    stableVersion: release?.version ?? null,
    platformSpec: release?.rawPlatformVersionSpec ?? null,
    phpSpec: release?.rawPhpVersionSpec ?? null,
    released: release?.created?.slice(0, 10) ?? null,
    download: release?.download ?? null,
    licenses: release?.licenses ?? [],
    signed: Boolean(release?.signature),
    otherStableForPlatform: stable.slice(1, 4).map((r) => r.version),
    authors: (app.authors ?? []).map((a) => a.name),
  };
});
await writeEvidence('app-metadata-preflight.json', { source, platform, checkedAt: new Date().toISOString().slice(0, 10), apps });
console.log(apps.map((a) => `${a.id} ${a.stableVersion ?? 'NOT_LISTED'} (${a.platformSpec ?? '-'}) signed=${a.signed} ${a.released}`).join('\n'));
