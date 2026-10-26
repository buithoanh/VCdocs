// Chat19 isolation checks (read-only probes, fake model names):
//  - host Ollama listens on 127.0.0.1 only (lsof), no OLLAMA_HOST override;
//  - Nextcloud container: only the internal work13 network; no Internet;
//    host.docker.internal not reachable directly; only the proxy alias works;
//  - proxy allow-list: GET /v1/models + POST /v1/chat/completions forwarded,
//    every other Ollama API (pull/delete/create/generate/tags/version/push/copy)
//    403, wrong methods 403;
//  - proxy has no published port; its access log carries no prompt text.
import { docker, execFileAsync, ncContainer, writeEvidence } from './lib.mjs';

const proxy = 'vcworkspace-ai19-ollama-proxy-1';
const curl = async (args) => {
  try {
    const { stdout } = await docker('exec', ncContainer, 'curl', '-s', '-m', '8', '-o', '/dev/null', '-w', '%{http_code}', ...args);
    return stdout.trim();
  } catch (e) { return `ERR:${String(e.stdout || e.message).trim().slice(0, 40)}`; }
};
const base = 'http://ollama19.internal:11434';
const out = {};

const lsof = await execFileAsync('lsof', ['-nP', '-iTCP:11434', '-sTCP:LISTEN']).catch((e) => ({ stdout: e.stdout ?? '' }));
out.hostOllamaListen = lsof.stdout.trim().split('\n').slice(1).map((l) => l.split(/\s+/).slice(-2).join(' '));
out.hostOllamaLoopbackOnly = out.hostOllamaListen.length > 0 && out.hostOllamaListen.every((l) => /127\.0\.0\.1:11434|\[::1\]:11434/.test(l));
out.ollamaHostEnvInLaunchctl = (await execFileAsync('launchctl', ['getenv', 'OLLAMA_HOST']).catch(() => ({ stdout: '' }))).stdout.trim() || '(unset)';

const { stdout: nets } = await docker('inspect', ncContainer, '--format', '{{json .NetworkSettings.Networks}}');
out.nextcloudNetworks = Object.keys(JSON.parse(nets));
const { stdout: internal } = await docker('network', 'inspect', 'vcworkspace-work13_work13', '--format', '{{.Internal}}');
out.work13Internal = internal.trim() === 'true';
out.nextcloudEgress = {
  'https://1.1.1.1': await curl(['https://1.1.1.1']),
  'https://registry.ollama.ai/v2/': await curl(['https://registry.ollama.ai/v2/']),
  'http://host.docker.internal:11434/v1/models (direct)': await curl(['http://host.docker.internal:11434/v1/models']),
};
const allow = {
  'GET /v1/models': await curl([`${base}/v1/models`]),
  'GET /v1//models (Apache MergeSlashes → same allowed endpoint)': await curl([`${base}/v1//models`]),
  'POST /v1/chat/completions (tiny)': await curl(['-X', 'POST', '-H', 'Content-Type: application/json', '-d', '{"model":"vcws-qwen3-4b-cpu:latest","messages":[{"role":"user","content":"ok"}],"max_tokens":1}', `${base}/v1/chat/completions`]),
};
const deny = {
  'POST /api/pull': await curl(['-X', 'POST', '-d', '{"model":"ai19-should-not-exist"}', `${base}/api/pull`]),
  'DELETE /api/delete': await curl(['-X', 'DELETE', '-d', '{"model":"ai19-should-not-exist"}', `${base}/api/delete`]),
  'POST /api/create': await curl(['-X', 'POST', '-d', '{"model":"ai19-x"}', `${base}/api/create`]),
  'POST /api/copy': await curl(['-X', 'POST', '-d', '{"source":"a","destination":"b"}', `${base}/api/copy`]),
  'POST /api/push': await curl(['-X', 'POST', '-d', '{"model":"x"}', `${base}/api/push`]),
  'POST /api/generate': await curl(['-X', 'POST', '-d', '{"model":"x"}', `${base}/api/generate`]),
  'GET /api/tags': await curl([`${base}/api/tags`]),
  'GET /api/version': await curl([`${base}/api/version`]),
  'POST /v1/embeddings': await curl(['-X', 'POST', '-d', '{}', `${base}/v1/embeddings`]),
  'DELETE /v1/models': await curl(['-X', 'DELETE', `${base}/v1/models`]),
  'GET /v1/chat/completions': await curl([`${base}/v1/chat/completions`]),
  'GET /v1/models/../../api/tags': await curl(['--path-as-is', `${base}/v1/models/../../api/tags`]),

  'GET /V1/MODELS': await curl([`${base}/V1/MODELS`]),
};
out.proxyAllow = allow;
out.proxyDeny = deny;
out.proxyAllowOk = Object.values(allow).every((s) => s === '200');
out.proxyDenyOk = Object.values(deny).every((s) => s === '403' || s === '400' || s === '404');
const { stdout: ports } = await docker('inspect', proxy, '--format', '{{json .NetworkSettings.Ports}}');
out.proxyPublishedPorts = Object.values(JSON.parse(ports) ?? {}).filter(Boolean);
const { stdout: plog } = await docker('logs', '--tail', '200', proxy);
out.proxyAccessLogSample = plog.trim().split('\n').slice(-4);
out.proxyLogContainsPrompt = /SH-7731|Sông Hồng|INJECTION/.test(plog);
const { stdout: models } = await execFileAsync('ollama', ['list']);
out.ollamaModelsAfter = models.trim().split('\n').slice(1).map((l) => l.split(/\s+/)[0]);
out.pass = out.hostOllamaLoopbackOnly && out.work13Internal && out.nextcloudNetworks.length === 1
  && Object.values(out.nextcloudEgress).every((s) => s === '000' || s.startsWith('ERR'))
  && out.proxyAllowOk && out.proxyDenyOk && out.proxyPublishedPorts.length === 0 && !out.proxyLogContainsPrompt
  && out.ollamaModelsAfter.length === 2;
await writeEvidence('isolation.json', out);
console.log(JSON.stringify(out, null, 1));
if (!out.pass) process.exitCode = 1;
