import { createHash, randomUUID } from 'node:crypto';

export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set(['text/plain', 'application/octet-stream']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export class PocError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizeName(value) {
  const name = value.normalize('NFC').trim();
  if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/u.test(name)) {
    throw new PocError('VALIDATION', 400);
  }
  return name;
}

export class MemoryStorage {
  constructor(snapshot) {
    this.objects = new Map(snapshot || [['', { kind: 'folder' }]]);
    this.failAfterPut = false;
  }
  snapshot() { return structuredClone([...this.objects]); }
  async createFolder(path) {
    if (this.objects.has(path)) throw new PocError('NAME_CONFLICT', 409);
    this.objects.set(path, { kind: 'folder' });
    return { path, kind: 'folder' };
  }
  async list(path) {
    const prefix = path ? `${path}/` : '';
    return [...this.objects.keys()].filter((key) =>
      key.startsWith(prefix) && key !== path && !key.slice(prefix.length).includes('/'));
  }
  async put(path, bytes, mimeType) {
    if (this.objects.has(path)) throw new PocError('NAME_CONFLICT', 409);
    this.objects.set(path, { kind: 'file', bytes: Buffer.from(bytes), mimeType });
    if (this.failAfterPut) {
      this.failAfterPut = false;
      throw new PocError('STORAGE_TIMEOUT', 504);
    }
    return { path, size: bytes.byteLength, sha256: hash(bytes) };
  }
  async open(path) {
    const item = this.objects.get(path);
    if (!item || item.kind !== 'file') throw new PocError('NOT_FOUND', 404);
    return { bytes: Buffer.from(item.bytes), sha256: hash(item.bytes) };
  }
  async exists(path) { return this.objects.has(path); }
  async remove(path) { this.objects.delete(path); }
}

export class PocDrive {
  constructor(storage, snapshot) {
    this.storage = storage;
    this.items = new Map(snapshot?.items || []);
    this.attempts = new Map(snapshot?.attempts || []);
    this.audit = snapshot?.audit || [];
    this.roles = new Map([
      ['department:a', 'manager'],
      ['department:b', 'reader'],
      ['personal:a', 'manager'],
    ]);
  }
  snapshot() {
    return {
      items: structuredClone([...this.items]),
      attempts: structuredClone([...this.attempts]),
      audit: structuredClone(this.audit),
    };
  }
  role(space, actor) { return this.roles.get(`${space}:${actor}`) || 'none'; }
  check(space, actor, write) {
    const role = this.role(space, actor);
    const allowed = write ? ['manager', 'editor'].includes(role) : role !== 'none';
    if (!allowed) {
      this.audit.push({ actor, action: write ? 'write' : 'read', result: 'denied' });
      throw new PocError(write && role !== 'none' ? 'FORBIDDEN' : 'NOT_FOUND',
        write && role !== 'none' ? 403 : 404);
    }
  }
  path(space, name) { return `${space}/${normalizeName(name)}`; }
  async createFolder({ actor, space, name }) {
    this.check(space, actor, true);
    const path = this.path(space, name);
    await this.storage.createFolder(path);
    const item = { id: randomUUID(), kind: 'folder', space, name: normalizeName(name), path };
    this.items.set(item.id, item);
    this.audit.push({ actor, action: 'create', result: 'ok', objectId: item.id });
    return item;
  }
  async upload({ actor, space, name, bytes, mimeType, key }) {
    this.check(space, actor, true);
    if (bytes.byteLength > MAX_BYTES) {
      this.audit.push({ actor, action: 'upload', result: 'rejected', code: 'PAYLOAD_TOO_LARGE' });
      throw new PocError('PAYLOAD_TOO_LARGE', 413);
    }
    if (!ALLOWED_MIME.has(mimeType)) throw new PocError('UNSUPPORTED_MEDIA_TYPE', 415);
    const normalized = normalizeName(name);
    const digest = hash(bytes);
    const fingerprint = hash(Buffer.from(
      `${actor}|${space}|${normalized}|${bytes.byteLength}|${mimeType}|${digest}`));
    const attemptKey = `${actor}:${key}`;
    const prior = this.attempts.get(attemptKey);
    if (prior && prior.fingerprint !== fingerprint) {
      throw new PocError('IDEMPOTENCY_CONFLICT', 409);
    }
    if (prior?.fileId) return this.items.get(prior.fileId);
    const path = this.path(space, normalized);
    const attempt = prior || { fingerprint, path, state: 'pending' };
    this.attempts.set(attemptKey, attempt);
    if (await this.storage.exists(path)) {
      if (attempt.state !== 'stored') throw new PocError('NAME_CONFLICT', 409);
    } else {
      try {
        await this.storage.put(path, bytes, mimeType);
        attempt.state = 'stored';
      } catch (error) {
        if (error.code === 'STORAGE_TIMEOUT' && await this.storage.exists(path)) {
          attempt.state = 'stored';
        } else {
          throw error;
        }
      }
    }
    const opened = await this.storage.open(path);
    if (opened.sha256 !== digest) {
      await this.storage.remove(path);
      throw new PocError('STORAGE_INTEGRITY_MISMATCH', 502);
    }
    const item = {
      id: randomUUID(), kind: 'file', space, name: normalized, path,
      size: bytes.byteLength, mimeType, contentSha256: digest,
    };
    this.items.set(item.id, item);
    attempt.fileId = item.id;
    attempt.state = 'ready';
    this.audit.push({ actor, action: 'upload', result: 'ok', objectId: item.id });
    return item;
  }
  list({ actor, space }) {
    this.check(space, actor, false);
    return [...this.items.values()].filter((item) => item.space === space);
  }
  async download({ actor, fileId }) {
    const item = this.items.get(fileId);
    if (!item) throw new PocError('NOT_FOUND', 404);
    this.check(item.space, actor, false);
    const opened = await this.storage.open(item.path);
    if (opened.sha256 !== item.contentSha256) {
      throw new PocError('STORAGE_INTEGRITY_MISMATCH', 502);
    }
    this.audit.push({ actor, action: 'download', result: 'ok', objectId: fileId });
    return opened.bytes;
  }
}
