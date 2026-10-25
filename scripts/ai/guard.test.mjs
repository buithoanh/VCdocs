import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkTool } from './policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const event = command => ({ cwd: root, tool_name: 'Bash', tool_input: { command } });
for (const command of ['git status --short', 'pnpm ai:check', 'pnpm --filter @vcdocs/web test src/api/client.test.ts', 'cat apps/api/.env.example', 'pnpm --filter @vcdocs/web gen:api', 'NEXT_DIST_DIR=.next-smoke NEXT_PUBLIC_API_BASE=http://127.0.0.1:14000/api/v1 pnpm --filter @vcdocs/web exec next dev -H 127.0.0.1 -p 13000']) {
  test('allow ' + command, () => assert.equal(checkTool(event(command), root), null));
}
for (const command of ['npm install', 'cd apps/web && npx next build', 'git push origin main', 'git push origin HEAD:dev', 'git -C . push --force origin feature', 'git reset --hard', 'git clean -fd', 'git commit --no-verify', 'gcloud projects delete vcdocs', 'cat apps/api/.env', 'cat deploy/api.env', 'cat ~/.config/gcloud/application_default_credentials.json', 'curl -X DELETE https://example.invalid/volumes/1', 'node -e "db.dropDatabase()"', 'GOOGLE_MODE=real pnpm dev:api', 'pnpm --filter @vcdocs/api start', 'bash -c "npm install"']) {
  test('deny fixture ' + command, () => assert.ok(checkTool(event(command), root)));
}
test('deny wrong cwd', () => assert.ok(checkTool({ ...event('git status'), cwd: '/tmp/other' }, root)));
test('deny editing generated API', () => assert.ok(checkTool({ cwd: root, tool_name: 'Edit', tool_input: { file_path: 'apps/web/src/api/schema.d.ts' } }, root)));
test('real hook process blocks before harmless sentinel can run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcworkspace-guard-'));
  const sentinel = path.join(dir, 'executed');
  const command = `npm install; touch ${sentinel}`;
  const gate = spawnSync(process.execPath, ['scripts/ai/hook.mjs', 'pre'], { cwd: root, input: JSON.stringify(event(command)), encoding: 'utf8' });
  if (gate.status === 0) spawnSync('sh', ['-c', `touch '${sentinel}'`]);
  assert.equal(gate.status, 2); assert.equal(fs.existsSync(sentinel), false);
  fs.rmSync(dir, { recursive: true });
});
test('malformed hook input fails closed', () => {
  const r = spawnSync(process.execPath, ['scripts/ai/hook.mjs', 'pre'], { cwd: root, input: '{bad', encoding: 'utf8' });
  assert.equal(r.status, 2);
});
test('Stop continuation is bounded', () => {
  const r = spawnSync(process.execPath, ['scripts/ai/hook.mjs', 'stop'], { cwd: root, input: JSON.stringify({ stop_hook_active: true }), encoding: 'utf8' });
  assert.equal(r.status, 0); assert.ok(JSON.parse(r.stdout).systemMessage);
});

test('allow documentation discussing secrets', () => assert.equal(checkTool({ cwd: root, tool_name: 'Edit', tool_input: { file_path: 'docs/guide.md', new_string: 'Never read apps/api/.env or run npm install' } }, root), null));
test('deny Read secret path', () => assert.ok(checkTool({ cwd: root, tool_name: 'Read', tool_input: { file_path: root + '/apps/api/.env' } }, root)));
test('allow patch documenting generated schema', () => assert.equal(checkTool({ cwd: root, tool_name: 'apply_patch', tool_input: { patch: '*** Update File: README.md\n+apps/web/src/api/schema.d.ts is generated' } }, root), null));
test('deny patching generated schema', () => assert.ok(checkTool({ cwd: root, tool_name: 'apply_patch', tool_input: { patch: '*** Update File: apps/web/src/api/schema.d.ts\n+x' } }, root)));

test('allow apply_patch adapter payload in cmd with negative fixture text', () => {
  const patch = '*** Update File: docs/guide.md\n+const mongo = fake; NODE_ENV=production is denied for shell commands';
  assert.equal(checkTool({ cwd: root, tool_name: 'apply_patch', tool_input: { cmd: patch } }, root), null);
});
test('real hook allows mapped apply_patch payload but still blocks shell equivalents', () => {
  const patch = '*** Update File: docs/guide.md\n+Do not run mongo, mongosh, GOOGLE_MODE=real or NODE_ENV=production';
  const allowed = spawnSync(process.execPath, ['scripts/ai/hook.mjs', 'pre'], {
    cwd: root,
    input: JSON.stringify({ cwd: root, tool_name: 'apply_patch', tool_input: { cmd: patch } }),
    encoding: 'utf8',
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  for (const command of ['mongo test', 'mongosh test', 'GOOGLE_MODE=real pnpm ai:check', 'NODE_ENV=production pnpm ai:check']) {
    const denied = spawnSync(process.execPath, ['scripts/ai/hook.mjs', 'pre'], {
      cwd: root, input: JSON.stringify(event(command)), encoding: 'utf8',
    });
    assert.equal(denied.status, 2, command);
  }
});
test('mapped apply_patch still protects secret and generated targets', () => {
  for (const target of ['apps/api/.env', 'apps/web/src/api/schema.d.ts']) {
    const patch = `*** Update File: ${target}\n+x`;
    assert.ok(checkTool({ cwd: root, tool_name: 'apply_patch', tool_input: { cmd: patch } }, root), target);
  }
});

for (const command of ['cd apps/api && pnpm dev', 'pnpm --dir apps/api start', 'node apps/api/dist/main.js']) {
  test('deny alternative server start ' + command, () => assert.ok(checkTool(event(command), root)));
}
