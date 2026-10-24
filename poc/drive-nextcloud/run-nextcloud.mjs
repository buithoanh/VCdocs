import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { NextcloudStorage, shareReadOnly } from './src/nextcloud-storage.mjs';
import { MAX_BYTES, PocDrive } from './src/poc-drive.mjs';
import {
  EXPECTED_PROJECT, evidenceFile, hasReadOnlyShare, parseComposePs, restartedAfter,
  validateComposeTarget, validateInspect,
} from './src/runner-support.mjs';

const projectName = EXPECTED_PROJECT;
if (process.env.COMPOSE_PROJECT_NAME !== projectName) {
  throw new Error('Refusing project other than ' + projectName);
}
const baseUrl = new URL(process.env.POC_BASE_URL || '');
if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname)) {
  throw new Error('PoC endpoint must be HTTP on loopback');
}
if (baseUrl.port !== '18080') throw new Error('PoC endpoint must use port 18080');

const userA = 'vcw-poc-a';
const userB = 'vcw-poc-b';
const required = ['POC_ADMIN_AUTH', 'POC_USER_A_AUTH', 'POC_USER_B_AUTH',
  'POC_USER_A_VALUE', 'POC_USER_B_VALUE'];
for (const name of required) {
  if (!process.env[name]) throw new Error('Missing required variable: ' + name);
}
const adminHeaders = { Authorization: process.env.POC_ADMIN_AUTH };
const aHeaders = { Authorization: process.env.POC_USER_A_AUTH };
const bHeaders = { Authorization: process.env.POC_USER_B_AUTH };
const storageA = new NextcloudStorage({ baseUrl: baseUrl.href, username: userA,
  requestHeaders: aHeaders, timeoutMs: 15_000 });
const storageB = new NextcloudStorage({ baseUrl: baseUrl.href, username: userB,
  requestHeaders: bHeaders, timeoutMs: 15_000 });
const evidenceDir = resolve('evidence');
const statePath = resolve(evidenceDir, 'restart-state.json');
const now = () => new Date().toISOString();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const execFile = promisify(execFileCallback);

async function preflight() {
  const { stdout } = await execFile('docker', [
    'compose', '-p', projectName, 'ps', '--format', 'json',
  ], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  const target = validateComposeTarget(parseComposePs(stdout));
  const containerId = target.ID || target.Id;
  if (!containerId) throw new Error('Compose did not return a container id');
  const inspected = await execFile('docker', ['inspect', containerId],
    { timeout: 10_000, maxBuffer: 1024 * 1024 });
  const entries = JSON.parse(inspected.stdout);
  if (!Array.isArray(entries) || entries.length !== 1) throw new Error('Invalid inspect result');
  return validateInspect(entries[0]);
}

async function ocsWith(headers, path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { ...headers, 'OCS-APIRequest': 'true', Accept: 'application/json',
      ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('OCS HTTP status ' + response.status);
  return response.json();
}

const ocs = (path, init) => ocsWith(adminHeaders, path, init);

async function ensureUser(userId, userValue) {
  const body = new URLSearchParams({ userid: userId, password: userValue });
  const payload = await ocs('/ocs/v1.php/cloud/users?format=json', {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const code = Number(payload?.ocs?.meta?.statuscode);
  if (![100, 102].includes(code)) throw new Error('Cannot provision user ' + userId);
}

async function ensureFolder(storage, path) {
  if (!await storage.exists(path)) await storage.createFolder(path);
}

async function setup() {
  await ensureUser(userA, process.env.POC_USER_A_VALUE);
  await ensureUser(userB, process.env.POC_USER_B_VALUE);
  await ensureFolder(storageA, 'department');
  await ensureFolder(storageA, 'personal');
  const query = '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json'
    + '&path=%2Fdepartment&reshares=true';
  const before = await ocsWith(aHeaders, query);
  const hasReadShare = hasReadOnlyShare(before, userB);
  if (!hasReadShare) {
    await shareReadOnly({ baseUrl: baseUrl.href, requestHeaders: aHeaders,
      path: '/department', shareWith: userB });
  }
  const after = await ocsWith(aHeaders, query);
  const verified = hasReadOnlyShare(after, userB);
  if (!verified) throw new Error('Read-only department share was not verified');
}

const results = [];
async function check(id, layer, action) {
  const startedAt = now();
  try {
    const detail = await action();
    results.push({ id, layer, status: 'pass', startedAt, finishedAt: now(), detail });
  } catch (error) {
    results.push({ id, layer, status: 'fail', startedAt, finishedAt: now(),
      error: { code: error.code || 'UNEXPECTED', message: error.message } });
  }
}

async function expectCode(action, codes) {
  try {
    await action();
  } catch (error) {
    if (codes.includes(error.code)) return { rejectedAs: error.code };
    throw error;
  }
  throw new Error('Operation unexpectedly succeeded');
}

function failOnceAfterStored(storage) {
  let armed = true;
  return {
    createFolder: (...args) => storage.createFolder(...args),
    exists: (...args) => storage.exists(...args),
    stat: (...args) => storage.stat(...args),
    list: (...args) => storage.list(...args),
    open: (...args) => storage.open(...args),
    remove: (...args) => storage.remove(...args),
    async put(...args) {
      const stored = await storage.put(...args);
      if (armed) {
        armed = false;
        const error = new Error('controlled timeout after storage accepted bytes');
        error.code = 'STORAGE_TIMEOUT';
        error.status = 504;
        throw error;
      }
      return stored;
    },
  };
}

let currentEvidencePath;
async function saveEvidence(mode, runId, extra = {}) {
  await mkdir(evidenceDir, { recursive: true });
  currentEvidencePath = resolve(evidenceDir, evidenceFile(mode, runId));
  const safe = { generatedAt: now(), runId, endpoint: baseUrl.origin, projectName,
    accounts: [userA, userB], mode, results, ...extra };
  await writeFile(currentEvidencePath, JSON.stringify(safe, null, 2) + '\n', { mode: 0o600 });
}

async function runMatrix() {
  const runtime = await preflight();
  await setup();
  const runId = Date.now().toString(36);
  const drive = new PocDrive(storageA);
  const fixture = Buffer.from('vcworkspace-nextcloud-poc-' + runId + '\n');
  const folderName = 'Tai-lieu-thu-' + runId;
  const fileName = 'mau-' + runId + '.txt';
  let uploaded;
  await check('P01', 'adapter', async () => {
    const folder = await drive.createFolder({ actor: 'a', space: 'department',
      name: folderName });
    const stored = await storageA.stat('department/' + folderName);
    return { internalId: folder.id, storageKind: stored.kind, uiVerified: false };
  });
  await check('P02', 'adapter', async () => {
    uploaded = await drive.upload({ actor: 'a', space: 'department', name: fileName,
      bytes: fixture, mimeType: 'text/plain', key: 'p02-' + runId });
    const downloaded = await drive.download({ actor: 'a', fileId: uploaded.id });
    assertEqual(sha256(downloaded), sha256(fixture), 'checksum mismatch');
    return { fileId: uploaded.id, size: uploaded.size, sha256: uploaded.contentSha256 };
  });
  results.push({ id: 'P03', layer: 'adapter-restart', status: 'blocked',
    reason: 'Run verify-restart after an explicit container restart', recordedAt: now() });
  await check('P04', 'storage-acl', async () => {
    const opened = await storageB.open('department/' + fileName);
    assertEqual(opened.sha256, sha256(fixture), 'reader checksum mismatch');
    return { reader: userB, downloaded: true };
  });
  await check('P05', 'storage-acl', () => expectCode(
    () => storageB.createFolder('department/denied-' + runId), ['FORBIDDEN']));
  await check('P06', 'storage-acl', () => expectCode(
    () => storageB.stat('personal'), ['NOT_FOUND', 'FORBIDDEN']));
  await check('P07', 'adapter', async () => {
    const replay = await drive.upload({ actor: 'a', space: 'department', name: fileName,
      bytes: fixture, mimeType: 'text/plain', key: 'p02-' + runId });
    assertEqual(replay.id, uploaded.id, 'replay returned another file id');
    return { fileId: replay.id };
  });
  await check('P08', 'adapter', () => expectCode(() => drive.upload({ actor: 'a',
    space: 'department', name: fileName, bytes: Buffer.from('different'),
    mimeType: 'text/plain', key: 'p02-' + runId }), ['IDEMPOTENCY_CONFLICT']));
  await check('P09', 'adapter', () => expectCode(() => drive.upload({ actor: 'a',
    space: 'department', name: fileName, bytes: Buffer.from('replacement'),
    mimeType: 'text/plain', key: 'p09-' + runId }), ['NAME_CONFLICT']));
  await check('P10', 'post-store-timeout-recovery', async () => {
    const recoveryDrive = new PocDrive(failOnceAfterStored(storageA));
    const name = 'recovery-' + runId + '.txt';
    const key = 'p10-' + runId;
    const first = await recoveryDrive.upload({ actor: 'a', space: 'department', name,
      bytes: fixture, mimeType: 'text/plain', key });
    const replay = await recoveryDrive.upload({ actor: 'a', space: 'department', name,
      bytes: fixture, mimeType: 'text/plain', key });
    assertEqual(replay.id, first.id, 'retry created another metadata item');
    const opened = await storageA.open('department/' + name);
    assertEqual(opened.sha256, sha256(fixture), 'recovered bytes mismatch');
    return { injectedAfterStored: true, fileId: first.id, replayFileId: replay.id,
      sha256: opened.sha256, metadataItems: recoveryDrive.list({ actor: 'a', space: 'department' }).length };
  });
  await check('P11', 'adapter', () => expectCode(() => drive.upload({ actor: 'a',
    space: 'department', name: 'large-' + runId + '.bin',
    bytes: Buffer.alloc(MAX_BYTES + 1), mimeType: 'application/octet-stream',
    key: 'p11-' + runId }), ['PAYLOAD_TOO_LARGE']));
  await check('P12', 'adapter-audit', async () => {
    const serialized = JSON.stringify(drive.audit);
    if (/vcworkspace-nextcloud-poc|Authorization|Basic|POC_/i.test(serialized)) {
      throw new Error('audit contains forbidden data');
    }
    return { entries: drive.audit.length };
  });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(statePath, JSON.stringify({ runId, runtime, snapshot: drive.snapshot(),
    fileId: uploaded?.id, expectedSha256: sha256(fixture) }, null, 2) + '\n', { mode: 0o600 });
  await saveEvidence('matrix', runId, { runtime, restartState: 'restart-state.json' });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message);
}

async function verifyRestart() {
  const runtime = await preflight();
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (!restartedAfter(state.runtime, runtime)) {
    results.push({ id: 'P03', layer: 'adapter-restart', status: 'blocked',
      reason: 'Container StartedAt did not change after matrix run', recordedAt: now() });
  } else {
    const drive = new PocDrive(storageA, state.snapshot);
    await check('P03', 'adapter-restart', async () => {
      const bytes = await drive.download({ actor: 'a', fileId: state.fileId });
      assertEqual(sha256(bytes), state.expectedSha256, 'restart checksum mismatch');
      return { fileId: state.fileId, sha256: state.expectedSha256,
        beforeStartedAt: state.runtime.startedAt, afterStartedAt: runtime.startedAt };
    });
  }
  await saveEvidence('verify-restart', state.runId, { runtime });
}

const mode = process.argv[2] || 'matrix';
if (mode === 'matrix') await runMatrix();
else if (mode === 'verify-restart') await verifyRestart();
else throw new Error('Usage: node run-nextcloud.mjs [matrix|verify-restart]');

const failed = results.filter((item) => item.status === 'fail');
const blocked = results.filter((item) => item.status === 'blocked');
process.stdout.write(JSON.stringify({ evidence: currentEvidencePath, pass:
  results.filter((item) => item.status === 'pass').length, fail: failed.length,
blocked: blocked.length }) + '\n');
if (failed.length) process.exitCode = 1;
