import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_IMAGE, evidenceFile, hasReadOnlyShare, parseComposePs, restartedAfter,
  validateComposeTarget, validateInspect,
} from '../src/runner-support.mjs';

const service = {
  ID: 'container-1', Project: 'vcworkspace-drive-poc', Service: 'nextcloud',
  State: 'running', Publishers: [
    { URL: '127.0.0.1', TargetPort: 80, PublishedPort: 18080, Protocol: 'tcp' },
  ],
};

test('preflight accepts only the expected project and loopback publisher', () => {
  assert.equal(validateComposeTarget(parseComposePs(JSON.stringify([service]))).ID,
    'container-1');
  assert.throws(() => validateComposeTarget([{ ...service, Project: 'other' }]));
  assert.throws(() => validateComposeTarget([{ ...service,
    Publishers: [{ URL: '0.0.0.0', TargetPort: 80, PublishedPort: 18080 }] }]));
});

test('inspect validates pinned image and exposes restart generation', () => {
  const info = validateInspect({ Id: 'container-1', Config: { Image: EXPECTED_IMAGE },
    State: { Running: true, StartedAt: '2026-10-23T01:00:00Z' } });
  assert.equal(info.startedAt, '2026-10-23T01:00:00Z');
  assert.throws(() => validateInspect({ Id: 'container-1', Config: { Image: 'nextcloud:latest' },
    State: { Running: true, StartedAt: '2026-10-23T01:00:00Z' } }));
});

test('restart requires same container with changed StartedAt', () => {
  const before = { containerId: 'container-1', startedAt: 'one' };
  assert.equal(restartedAfter(before, { containerId: 'container-1', startedAt: 'two' }), true);
  assert.equal(restartedAfter(before, { containerId: 'container-1', startedAt: 'one' }), false);
  assert.equal(restartedAfter(before, { containerId: 'container-2', startedAt: 'two' }), false);
});

test('matrix and restart evidence use distinct run-scoped files', () => {
  assert.equal(evidenceFile('matrix', 'run123'), 'p01-p12-matrix-run123.json');
  assert.equal(evidenceFile('verify-restart', 'run123'), 'p03-restart-run123.json');
  assert.notEqual(evidenceFile('matrix', 'run123'), evidenceFile('verify-restart', 'run123'));
  assert.throws(() => evidenceFile('matrix', '../escape'));
});

test('existing share is accepted only after matching user and read-only permission', () => {
  const payload = { ocs: { data: [{ share_with: 'vcw-poc-b', permissions: 1 }] } };
  assert.equal(hasReadOnlyShare(payload, 'vcw-poc-b'), true);
  assert.equal(hasReadOnlyShare({ ocs: { data: [{ share_with: 'vcw-poc-b', permissions: 15 }] } },
    'vcw-poc-b'), false);
  assert.equal(hasReadOnlyShare(payload, 'someone-else'), false);
});
