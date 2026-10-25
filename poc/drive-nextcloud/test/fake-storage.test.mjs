import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, PocDrive, PocError, MAX_BYTES } from '../src/poc-drive.mjs';

const fixture = Buffer.from('du-lieu-gia-vcworkspace\n');
const rejects = (code) => (error) => error instanceof PocError && error.code === code;

test('P01 A creates folder with stable internal id', async () => {
  const drive = new PocDrive(new MemoryStorage());
  const item = await drive.createFolder({ actor: 'a', space: 'department', name: 'Tai-lieu-thu' });
  assert.ok(item.id);
  assert.equal(item.kind, 'folder');
});

test('P02 A uploads, lists and downloads identical bytes', async () => {
  const drive = new PocDrive(new MemoryStorage());
  const file = await drive.upload({ actor: 'a', space: 'department', name: 'mau.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k1' });
  assert.equal(drive.list({ actor: 'a', space: 'department' })[0].id, file.id);
  assert.deepEqual(await drive.download({ actor: 'a', fileId: file.id }), fixture);
});

test('P03 reconstructed adapters preserve storage and metadata', async () => {
  const storage1 = new MemoryStorage();
  const drive1 = new PocDrive(storage1);
  const file = await drive1.upload({ actor: 'a', space: 'department', name: 'persist.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k2' });
  const drive2 = new PocDrive(new MemoryStorage(storage1.snapshot()), drive1.snapshot());
  assert.deepEqual(await drive2.download({ actor: 'a', fileId: file.id }), fixture);
});

test('P04 B reader lists and downloads', async () => {
  const drive = new PocDrive(new MemoryStorage());
  const file = await drive.upload({ actor: 'a', space: 'department', name: 'read.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k3' });
  assert.equal(drive.list({ actor: 'b', space: 'department' }).length, 1);
  assert.deepEqual(await drive.download({ actor: 'b', fileId: file.id }), fixture);
});

test('P05 B reader cannot create or upload', async () => {
  const drive = new PocDrive(new MemoryStorage());
  await assert.rejects(drive.createFolder({ actor: 'b', space: 'department', name: 'x' }),
    rejects('FORBIDDEN'));
  await assert.rejects(drive.upload({ actor: 'b', space: 'department', name: 'x.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k4' }), rejects('FORBIDDEN'));
});

test('P06 B none cannot access personal A by guessed id', async () => {
  const drive = new PocDrive(new MemoryStorage());
  const file = await drive.upload({ actor: 'a', space: 'personal', name: 'private.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k5' });
  assert.throws(() => drive.list({ actor: 'b', space: 'personal' }), rejects('NOT_FOUND'));
  await assert.rejects(drive.download({ actor: 'b', fileId: file.id }), rejects('NOT_FOUND'));
});

test('P07 same key and bytes replay one file and blob', async () => {
  const storage = new MemoryStorage();
  const drive = new PocDrive(storage);
  const input = { actor: 'a', space: 'department', name: 'once.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k6' };
  const first = await drive.upload(input);
  const second = await drive.upload(input);
  assert.equal(first.id, second.id);
  assert.equal((await storage.list('department')).length, 1);
});

test('P08 same key with different bytes conflicts and preserves old file', async () => {
  const drive = new PocDrive(new MemoryStorage());
  const input = { actor: 'a', space: 'department', name: 'same.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k7' };
  const file = await drive.upload(input);
  await assert.rejects(drive.upload({ ...input, bytes: Buffer.from('different') }),
    rejects('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(await drive.download({ actor: 'a', fileId: file.id }), fixture);
});

test('P09 duplicate name conflicts without overwrite or rename', async () => {
  const drive = new PocDrive(new MemoryStorage());
  await drive.upload({ actor: 'a', space: 'department', name: 'duplicate.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k8' });
  await assert.rejects(drive.upload({ actor: 'a', space: 'department', name: 'duplicate.txt',
    bytes: Buffer.from('new'), mimeType: 'text/plain', key: 'k9' }),
  rejects('NAME_CONFLICT'));
  assert.equal(drive.list({ actor: 'a', space: 'department' }).length, 1);
});

test('P10 timeout after stored bytes reconciles without duplicate', async () => {
  const storage = new MemoryStorage();
  storage.failAfterPut = true;
  const drive = new PocDrive(storage);
  const file = await drive.upload({ actor: 'a', space: 'department', name: 'timeout.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'k10' });
  assert.ok(file.id);
  assert.equal((await storage.list('department')).length, 1);
});

test('P11 oversize and forbidden MIME create no ready blob', async () => {
  const storage = new MemoryStorage();
  const drive = new PocDrive(storage);
  await assert.rejects(drive.upload({ actor: 'a', space: 'department', name: 'large.bin',
    bytes: Buffer.alloc(MAX_BYTES + 1), mimeType: 'application/octet-stream', key: 'k11' }),
  rejects('PAYLOAD_TOO_LARGE'));
  await assert.rejects(drive.upload({ actor: 'a', space: 'department', name: 'bad.html',
    bytes: fixture, mimeType: 'text/html', key: 'k12' }),
  rejects('UNSUPPORTED_MEDIA_TYPE'));
  assert.equal((await storage.list('department')).length, 0);
});

test('P12 audit has outcomes but no bytes or credentials', async () => {
  const drive = new PocDrive(new MemoryStorage());
  const file = await drive.upload({ actor: 'a', space: 'department', name: 'audit.txt',
    bytes: fixture, mimeType: 'text/plain', key: 'secret-key-must-not-log' });
  await drive.download({ actor: 'a', fileId: file.id });
  await assert.rejects(drive.createFolder({ actor: 'b', space: 'department', name: 'denied' }),
    rejects('FORBIDDEN'));
  const json = JSON.stringify(drive.audit);
  assert.match(json, /upload/);
  assert.match(json, /download/);
  assert.match(json, /denied/);
  assert.doesNotMatch(json, /du-lieu-gia|secret-key|Authorization|cookie/i);
});
