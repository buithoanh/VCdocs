// Chat17: read the official App Store metadata for Nextcloud 33.0.10 and pin
// the highest stable release of Talk (spreed). install-talk.mjs refuses to
// continue if the installed version drifts from this pin. Metadata only.
import { writeEvidence } from './lib.mjs';

const platform = '33.0.10';
const source = `https://apps.nextcloud.com/api/v1/platform/${platform}/apps.json`;
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`APP_STORE_${response.status}`);
const catalog = await response.json();
const compare = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
const app = catalog.find((item) => item.id === 'spreed');
if (!app) throw new Error('SPREED_NOT_LISTED');
const stable = app.releases.filter((r) => !r.isNightly && /^\d+(\.\d+)*$/.test(r.version));
stable.sort((l, r) => compare(r.version, l.version));
const release = stable[0];
const result = {
  id: 'spreed',
  listed: true,
  stableVersion: release.version,
  platformSpec: release.rawPlatformVersionSpec,
  phpSpec: release.rawPhpVersionSpec,
  released: release.created?.slice(0, 10),
  download: release.download,
  licenses: release.licenses,
  signed: Boolean(release.signature),
  otherStableForPlatform: stable.slice(1, 4).map((r) => r.version),
  roadmapCandidate: '23.0.11 (chat11)',
};
await writeEvidence('app-metadata-preflight.json', { source, platform, checkedAt: new Date().toISOString().slice(0, 10), apps: [result] });
console.log(`spreed ${result.stableVersion} (${result.platformSpec}) php ${result.phpSpec} signed=${result.signed} ${result.released}; others ${result.otherStableForPlatform.join(', ')}`);
