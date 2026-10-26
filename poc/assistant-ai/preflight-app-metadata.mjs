// Chat19: read the official App Store metadata for Nextcloud 33.0.10 and pin
// the highest stable release of the Assistant stack. install-assistant.mjs
// refuses to continue if the installed version drifts from this pin. Also
// records the metadata of the RAG/agent apps that are NOT installed
// (context_chat needs the context_chat_backend ExApp, context_agent is an ExApp)
// so the decision is traceable. Metadata only, nothing is downloaded.
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
const ids = ['assistant', 'integration_openai', 'context_chat', 'context_chat_backend', 'context_agent', 'llm2', 'app_api'];
const apps = ids.map((id) => {
  const app = catalog.find((item) => item.id === id);
  if (!app) return { id, listed: false };
  const stable = app.releases.filter((r) => !r.isNightly && /^\d+(\.\d+)*$/.test(r.version));
  stable.sort((l, r) => compare(r.version, l.version));
  const release = stable[0];
  return {
    id,
    listed: true,
    stableVersion: release?.version ?? null,
    platformSpec: release?.rawPlatformVersionSpec,
    phpSpec: release?.rawPhpVersionSpec,
    released: release?.created?.slice(0, 10),
    download: release?.download,
    licenses: release?.licenses,
    signed: Boolean(release?.signature),
    isExApp: Boolean(release?.externalApp || app.isExApp || (release?.download ?? '').includes('ghcr.io')),
    externalApp: release?.externalApp ?? null,
    otherStableForPlatform: stable.slice(1, 4).map((r) => r.version),
  };
});
await writeEvidence('app-metadata-preflight.json', { source, platform, checkedAt: new Date().toISOString().slice(0, 10), apps, install: ['assistant', 'integration_openai'] });
for (const a of apps) console.log(`${a.id}: ${a.listed ? `${a.stableVersion} (${a.platformSpec}) php ${a.phpSpec} signed=${a.signed} ${a.released} lic=${a.licenses} exapp=${a.isExApp}` : 'NOT LISTED for 33.0.10'}`);
