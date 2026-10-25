// Chat15: record the runtime used (images, versions) and whether a CLI sync
// client image (nextcloudcmd) exists locally. Read-only.
import { docker, nasContainer, occ, writeEvidence } from './lib.mjs';

const images = (await docker('images', '--digests', '--format', '{{.Repository}}:{{.Tag}} {{.Digest}} {{.ID}}')).stdout.split('\n').filter(Boolean);
const status = (await occ('status', '--output=json')).stdout;
const apps = JSON.parse((await occ('app:list', '--output=json')).stdout);
const smbd = (await docker('exec', nasContainer, 'smbd', '--version')).stdout.trim();
const smbclient = (await docker('exec', 'vcworkspace-work13-nextcloud-1', 'smbclient', '--version')).stdout.trim();
const phpExt = (await docker('exec', 'vcworkspace-work13-nextcloud-1', 'php', '--re', 'smbclient')).stdout.split('\n')[0].trim();
const notifyMount = (await docker('inspect', '--format', '{{json .Config.Entrypoint}}', 'vcworkspace-sync15-files-notify-1')).stdout.trim();
await writeEvidence('environment.json', {
  nextcloud: JSON.parse(status),
  apps: { files_external: apps.enabled.files_external, workflowengine: apps.enabled.workflowengine, webhook_listeners: apps.enabled.webhook_listeners, files_accesscontrol: apps.enabled.files_accesscontrol, files_automatedtagging: apps.enabled.files_automatedtagging },
  nas: { image: 'vcworkspace-sync15/nas:alpine3.22.2-1 (FROM alpine@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412)', smbd },
  nextcloudSmb: { image: 'vcworkspace-sync15/nextcloud-smb:33.0.10-1 (FROM nextcloud@sha256:431d389f…)', smbclient, phpExtension: phpExt },
  notifyEntrypoint: notifyMount,
  cliSyncClientImagePresent: images.some((line) => /nextcloudcmd|nextcloud-client|desktop-client/i.test(line)),
  sampleImages: images.filter((line) => /vcworkspace-sync15|alpine|nextcloud|postgres|redis/.test(line)),
});
console.log('environment.json written');
