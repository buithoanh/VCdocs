// Chat14: start/stop the NestJS Flow receiver (gated Jest spec, Google giả,
// MongoDB local riêng 127.0.0.1:18141) and call its API as fake-Google users.
// No .env is read; the runner app password and webhook secrets are passed by env.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { flowRoot, flowSecretsDir, personas, readEvidence, receiverBase, receiverPort, secret, sleep } from './lib.mjs';

const apiDir = join(flowRoot, '..', '..', 'apps', 'api');
export const mongoUri = 'mongodb://127.0.0.1:18141/flow14-live';

export async function webhookSecrets() {
  const file = (name) => join(flowSecretsDir, name);
  if (!existsSync(file('webhook_secret_current'))) {
    await writeFile(file('webhook_secret_current'), `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    await chmod(file('webhook_secret_current'), 0o600);
  }
  const current = (await readFile(file('webhook_secret_current'), 'utf8')).trim();
  const previous = existsSync(file('webhook_secret_previous')) ? (await readFile(file('webhook_secret_previous'), 'utf8')).trim() : null;
  return { current, previous };
}

/** Xoay vòng: bản hiện hành thành bản cũ, sinh bản mới (0600, Git bỏ qua) */
export async function rotateSecret() {
  const { current } = await webhookSecrets();
  await writeFile(join(flowSecretsDir, 'webhook_secret_previous'), `${current}\n`, { mode: 0o600 });
  await writeFile(join(flowSecretsDir, 'webhook_secret_current'), `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  return webhookSecrets();
}
export async function dropPreviousSecret() {
  const { current } = await webhookSecrets();
  await writeFile(join(flowSecretsDir, 'webhook_secret_previous'), '', { mode: 0o600 });
  return { current, previous: null };
}

export async function receiverEnv(extra = {}) {
  const resources = await readEvidence('resources.json');
  const people = await personas();
  const { current, previous } = await webhookSecrets();
  const rules = [
    { id: 'form-deck', kind: 'forms.submission-to-deck', runner: 'runner', formId: resources.forms.formId, boardId: resources.deck.boardId, stackId: resources.deck.nestStackId },
    { id: 'table-notify', kind: 'tables.row-notify', runner: 'runner', tableId: resources.tables.tableId, recipients: ['successor-a', 'member-a', 'manager-b', 'outsider'].map((name) => people[name].nextcloudUserId) },
    { id: 'files-tag', kind: 'files.verify-tag', runner: 'runner', folderPath: resources.files.folder, tagName: 'flow14-hoso' },
  ];
  const bindings = {
    [people['successor-a'].nextcloudUserId]: 'tp.mkt@vcprosperous.com',
    [people['member-a'].nextcloudUserId]: 'nv.mkt@vcprosperous.com',
    [people['manager-b'].nextcloudUserId]: 'tp.kd@vcprosperous.com',
    [people.outsider.nextcloudUserId]: 'nv.kd@vcprosperous.com',
  };
  return {
    RUN_FLOW14_RECEIVER: '1',
    ALLOW_PARTIAL_COVERAGE: '1',
    NODE_ENV: 'test',
    GOOGLE_MODE: 'fake',
    MONGOMS_SYSTEM_BINARY: '/usr/local/bin/mongod',
    FLOW14_MONGO_URI: mongoUri,
    FLOW14_FAKE_GOOGLE_STATE: join(flowRoot, '.runtime', 'fake-google.json'),
    FLOW14_PORT: String(receiverPort),
    FLOW14_WEBHOOK_SECRETS: [current, previous].filter(Boolean).join(','),
    FLOW14_NC_BASE: 'http://nc13.localtest.me:18130',
    FLOW14_RUNNER_UID: people['successor-a'].nextcloudUserId,
    FLOW14_RUNNER_PASSWORD: await secret('app_password_successor-a'),
    FLOW14_RULES_JSON: JSON.stringify(rules),
    FLOW14_USER_BINDINGS_JSON: JSON.stringify(bindings),
    ...extra,
  };
}

/** Khởi động receiver; trả { child, logs, stop() }; chờ dòng FLOW14_RECEIVER_READY */
export async function startReceiver(extra = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...(await receiverEnv(extra)) };
  const child = spawn(join(apiDir, 'node_modules', '.bin', 'jest'), ['--runInBand', 'test/flow-nextcloud-server.spec.ts'], { cwd: apiDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  const onData = (chunk) => logs.push(...String(chunk).split('\n').filter(Boolean));
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 120_000;
  while (!logs.some((line) => line.includes('FLOW14_RECEIVER_READY'))) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`RECEIVER_EXITED:\n${logs.slice(-40).join('\n')}`);
    if (Date.now() > deadline) throw new Error(`RECEIVER_NOT_READY:\n${logs.slice(-40).join('\n')}`);
    await sleep(250);
  }
  return {
    child,
    logs,
    exited,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Đăng nhập Google giả (chỉ có ở GOOGLE_MODE=fake) → cookie phiên */
export async function vcLogin(email) {
  const start = await fetch(`${receiverBase}/auth/google`, { redirect: 'manual' });
  const cookies = start.headers.getSetCookie().map((c) => c.split(';')[0]);
  const location = new URL(start.headers.get('location'));
  const state = location.searchParams.get('state');
  const nonce = location.searchParams.get('nonce');
  const callback = await fetch(`${receiverBase}/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`fake|${email}|${nonce}`)}`, { redirect: 'manual', headers: { Cookie: cookies.join('; ') } });
  const session = [...cookies, ...callback.headers.getSetCookie().map((c) => c.split(';')[0])].join('; ');
  if (callback.status !== 302 || !session.includes('vcdocs_sid=')) throw new Error(`VC_LOGIN_FAILED:${email}:${callback.status}`);
  return async (path) => {
    const response = await fetch(`${receiverBase}${path}`, { headers: { Cookie: session } });
    return { status: response.status, data: await response.json().catch(() => null) };
  };
}

export async function postWebhook(body, token, { contentType } = {}) {
  const response = await fetch(`${receiverBase}/flow/nextcloud/webhooks`, {
    method: 'POST',
    headers: { ...(token ? { 'X-VCW-Flow-Token': token } : {}), ...(contentType ? { 'Content-Type': contentType } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
