// Chat19: record the runtime versions/config this evidence was produced on.
import { docker, execFileAsync, ncContainer, occ, occJson, ollamaHost, writeEvidence } from './lib.mjs';

const status = JSON.parse((await occ('status', '--output=json')).stdout);
const apps = await occJson('app:list');
const sys = {};
for (const key of ['has_internet_connection', 'allow_local_remote_servers', 'loglevel', 'overwrite.cli.url']) sys[key] = (await occ('config:system:get', key).catch(() => ({ stdout: '(unset)' }))).stdout.trim() || '(unset)';
const { stdout: php } = await docker('exec', ncContainer, 'php', '-r', 'echo PHP_VERSION;');
const { stdout: proxyImage } = await docker('inspect', 'vcworkspace-ai19-ollama-proxy-1', '--format', '{{.Config.Image}} {{.Image}}');
const { stdout: ollamaList } = await execFileAsync('ollama', ['list']);
const { stdout: modelfile } = await execFileAsync('ollama', ['show', '--modelfile', 'vcws-qwen3-4b-cpu:latest']);
await writeEvidence('environment.json', {
  nextcloud: status.versionstring, php: php.trim(),
  apps: Object.fromEntries(['assistant', 'integration_openai', 'spreed', 'deck', 'notes', 'collectives', 'admin_audit', 'app_api'].map((a) => [a, apps.enabled[a] ?? 'not enabled'])),
  systemConfig: sys,
  taskProcessingWorker: 'occ taskprocessing:worker -t 300 (taskprocessing-worker.mjs loop, docker exec)',
  ollama: { version: (await (await fetch(`${ollamaHost}/api/version`)).json()).version, listen: '127.0.0.1:11434 (host, unchanged)', models: ollamaList.trim().split('\n').slice(1).map((l) => l.split(/\s+/).slice(0, 3).join(' ')), cpuAliasParameters: modelfile.split('\n').filter((l) => l.startsWith('PARAMETER') || l.startsWith('FROM')).map((l) => l.replace(/\/Users\/[^/]+/, '~')) },
  proxy: { container: 'vcworkspace-ai19-ollama-proxy-1', image: proxyImage.trim(), config: 'ollama-proxy/httpd.conf' },
  host: { os: (await execFileAsync('sw_vers', ['-productVersion'])).stdout.trim(), cpu: (await execFileAsync('sysctl', ['-n', 'machdep.cpu.brand_string'])).stdout.trim(), cores: (await execFileAsync('sysctl', ['-n', 'hw.ncpu'])).stdout.trim(), perfCores: (await execFileAsync('sysctl', ['-n', 'hw.perflevel0.physicalcpu']).catch(() => ({ stdout: '?' }))).stdout.trim(), ramGiB: Math.round(Number((await execFileAsync('sysctl', ['-n', 'hw.memsize'])).stdout.trim()) / 2 ** 30) },
});
console.log('environment recorded');
