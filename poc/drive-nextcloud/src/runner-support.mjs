export const EXPECTED_PROJECT = 'vcworkspace-drive-poc';
export const EXPECTED_IMAGE = 'nextcloud@sha256:f6653516c000dd83a8ead6d7eda3ccdc6437fee78153bae71702c70f727dd79b';

export function parseComposePs(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = trimmed.startsWith('[') ? JSON.parse(trimmed)
    : trimmed.split('\n').map((line) => JSON.parse(line));
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function validateComposeTarget(services) {
  const target = services.find((item) => item.Service === 'nextcloud'
    && item.Project === EXPECTED_PROJECT);
  if (!target || target.State !== 'running') {
    throw new Error('Expected running Nextcloud service in isolated PoC project');
  }
  const publishers = Array.isArray(target.Publishers) ? target.Publishers : [];
  const endpoint = publishers.find((item) => Number(item.PublishedPort) === 18080
    && Number(item.TargetPort) === 80 && ['127.0.0.1', '::1'].includes(item.URL));
  if (!endpoint) throw new Error('Expected loopback 127.0.0.1:18080 mapping to port 80');
  return target;
}

export function validateInspect(inspect) {
  if (inspect?.Config?.Image !== EXPECTED_IMAGE) throw new Error('Unexpected Nextcloud image');
  if (!inspect?.State?.Running || !inspect?.State?.StartedAt) {
    throw new Error('Nextcloud container is not running');
  }
  return { containerId: inspect.Id, startedAt: inspect.State.StartedAt,
    image: inspect.Config.Image };
}

export function restartedAfter(before, after) {
  return Boolean(before?.containerId && after?.containerId
    && before.containerId === after.containerId
    && before.startedAt && after.startedAt && before.startedAt !== after.startedAt);
}

export function evidenceFile(mode, runId) {
  if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error('Invalid evidence run id');
  if (mode === 'matrix') return 'p01-p12-matrix-' + runId + '.json';
  if (mode === 'verify-restart') return 'p03-restart-' + runId + '.json';
  throw new Error('Unknown evidence mode');
}

export function hasReadOnlyShare(payload, userId) {
  return (payload?.ocs?.data || []).some((item) =>
    item.share_with === userId && Number(item.permissions) === 1);
}
