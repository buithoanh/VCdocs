import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcworkspace-gate-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts/ai'), { recursive: true });
    for (const file of ['check.mjs', 'hook.mjs', 'policy.mjs']) fs.copyFileSync(path.join(source, file), path.join(dir, 'scripts/ai', file));
    // Avoid recursive integration tests in the fixture.
    for (const file of ['guard.test.mjs', 'gate.test.mjs']) fs.writeFileSync(path.join(dir, 'scripts/ai', file), "import test from 'node:test'; test('fixture', () => {});\n");
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin/pnpm'), [
      '#!/bin/sh',
      'if [ "${CHECK_EXPECT_CLEAN:-}" = 1 ]; then',
      '  test "$GOOGLE_MODE" = fake || exit 21',
      '  test -z "${ALLOW_PARTIAL_COVERAGE:-}" || exit 22',
      '  test -z "${SKIP_CONTRACT_COVERAGE:-}" || exit 23',
      '  test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || exit 24',
      '  test -z "${GH_TOKEN:-}" || exit 25',
      'fi',
      'printf "%s\\n" "$*" >> "$CHECK_TRACE"',
      'exit "${CHECK_EXIT:-0}"', ''
    ].join('\n'), { mode: 0o755 });
    const git = args => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Guard fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    const trace = path.join(dir, 'trace.log');
    const invoke = (args, overrides = {}, input) => spawnSync(process.execPath, args, {
      cwd: dir, encoding: 'utf8', input,
      env: { ...process.env, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH, CHECK_TRACE: trace, ...overrides },
    });
    fn({ dir, trace, invoke });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('docs-only gate does not run application tests', () => fixture(({ dir, trace, invoke }) => {
  fs.mkdirSync(path.join(dir, 'apps/api'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps/api/README.md'), '# docs\n');
  const r = invoke(['scripts/ai/check.mjs']);
  assert.equal(r.status, 0, r.stderr); assert.equal(fs.existsSync(trace), false);
}));
test('untracked API change invokes full API coverage', () => fixture(({ dir, trace, invoke }) => {
  fs.mkdirSync(path.join(dir, 'apps/api'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'apps/api/new.ts'), 'export {};\n');
  const r = invoke(['scripts/ai/check.mjs']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(trace, 'utf8'), /--filter @vcdocs\/api run test --runInBand/);
}));
test('test failure blocks the gate and Stop hook', () => fixture(({ dir, invoke }) => {
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
  const r = invoke(['scripts/ai/check.mjs'], { CHECK_EXIT: '7' });
  assert.equal(r.status, 7);
  const stop = invoke(['scripts/ai/hook.mjs', 'stop'], { CHECK_EXIT: '7' }, '{}');
  assert.equal(stop.status, 2); assert.match(stop.stderr, /blocker|xử lý lỗi/);
}));
test('full gate runs even on clean Git tree', () => fixture(({ trace, invoke }) => {
  const r = invoke(['scripts/ai/check.mjs', '--full']);
  assert.equal(r.status, 0, r.stderr);
  const traceText = fs.readFileSync(trace, 'utf8');
  assert.match(traceText, /@vcdocs\/api run test/); assert.match(traceText, /@vcdocs\/web run test/); assert.match(traceText, /build/);
}));
test('changed secret filename blocks before application commands', () => fixture(({ dir, trace, invoke }) => {
  fs.writeFileSync(path.join(dir, '.env'), 'FAKE_TEST_ONLY=1\n');
  const r = invoke(['scripts/ai/check.mjs']);
  assert.notEqual(r.status, 0); assert.equal(fs.existsSync(trace), false);
  assert.doesNotMatch(r.stderr, /FAKE_TEST_ONLY/);
}));

test('full gate strips credential variables and coverage bypasses', () => fixture(({ invoke }) => {
  const r = invoke(['scripts/ai/check.mjs', '--full'], {
    CHECK_EXPECT_CLEAN: '1', GOOGLE_MODE: 'real', GOOGLE_APPLICATION_CREDENTIALS: '/fake/fixture.json',
    GH_TOKEN: 'fake-fixture-only', ALLOW_PARTIAL_COVERAGE: '1', SKIP_CONTRACT_COVERAGE: '1',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}));
