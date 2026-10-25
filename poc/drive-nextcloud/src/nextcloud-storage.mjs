import { createHash } from 'node:crypto';

export class StorageError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.status = status;
  }
}

const encodePath = (path) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const decodeXml = (value) => value
  .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"').replaceAll('&apos;', "'");
const tagValue = (xml, localName) => {
  const pattern = new RegExp('<(?:[A-Za-z0-9_-]+:)?' + localName
    + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?' + localName + '>', 'i');
  return xml.match(pattern)?.[1]?.trim();
};

export function parseDavMultistatus(xml) {
  const responses = [...xml.matchAll(
    /<(?:[A-Za-z0-9_-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi,
  )];
  return responses.map((match) => {
    const responseXml = match[1];
    const successfulProps = [...responseXml.matchAll(
      /<(?:[A-Za-z0-9_-]+:)?propstat(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?propstat>/gi,
    )].map((part) => part[1]).find((part) => /HTTP\/\d(?:\.\d)?\s+200\b/i.test(part));
    if (!successfulProps) return undefined;
    const href = tagValue(responseXml, 'href');
    if (!href) return undefined;
    const etag = tagValue(successfulProps, 'getetag') || null;
    const rawSize = tagValue(successfulProps, 'getcontentlength');
    const kind = /<(?:[A-Za-z0-9_-]+:)?collection(?:\s[^>]*)?\s*\/>/i
      .test(successfulProps) ? 'folder' : 'file';
    return {
      href: decodeURIComponent(decodeXml(href)),
      kind,
      size: rawSize === undefined ? 0 : Number(rawSize),
      etag: etag ? decodeXml(etag) : null,
    };
  }).filter(Boolean);
}

export class NextcloudStorage {
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.username = options.username;
    this.requestHeaders = options.requestHeaders;
    this.timeoutMs = options.timeoutMs || 10_000;
    this.fetchImpl = options.fetchImpl || fetch;
  }
  url(path) {
    return this.baseUrl + '/remote.php/dav/files/' + encodeURIComponent(this.username)
      + '/' + encodePath(path);
  }
  async request(path, init = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.url(path), {
        ...init,
        headers: { ...this.requestHeaders, ...(init.headers || {}) },
        redirect: 'manual',
        signal: init.signal || AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new StorageError('STORAGE_TIMEOUT', 504, 'Storage request timed out');
      }
      throw new StorageError('STORAGE_UNAVAILABLE', 503, 'Storage network failure');
    }
    if (response.status === 401 || response.status === 403) {
      throw new StorageError('FORBIDDEN', response.status, 'Storage denied operation');
    }
    if (response.status === 404) throw new StorageError('NOT_FOUND', 404, 'Object not found');
    if (response.status === 405 || response.status === 412) {
      throw new StorageError('NAME_CONFLICT', 409, 'Object already exists');
    }
    if (response.status === 413 || response.status === 507) {
      throw new StorageError('PAYLOAD_TOO_LARGE', 413, 'Storage rejected object size');
    }
    if (response.status === 429) {
      throw new StorageError('STORAGE_RATE_LIMITED', 429, 'Storage rate limited request');
    }
    if (response.status >= 500) {
      throw new StorageError('STORAGE_UNAVAILABLE', 503, 'Storage unavailable');
    }
    if (!response.ok && response.status !== 207) {
      throw new StorageError('STORAGE_STATE_CONFLICT', 409, 'Unexpected storage status');
    }
    return response;
  }
  async createFolder(path) {
    await this.request(path, { method: 'MKCOL' });
    return this.stat(path);
  }
  async put(path, bytes, mimeType = 'application/octet-stream') {
    if (await this.exists(path)) throw new StorageError('NAME_CONFLICT', 409, 'Object exists');
    const response = await this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, 'If-None-Match': '*' },
      body: bytes,
    });
    return {
      path, kind: 'file', size: bytes.byteLength, mimeType,
      etag: response.headers.get('etag'), sha256: sha256(bytes),
    };
  }
  async open(path) {
    const response = await this.request(path, { method: 'GET' });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, sha256: sha256(bytes), etag: response.headers.get('etag') };
  }
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch (error) {
      if (error.code === 'NOT_FOUND') return false;
      throw error;
    }
  }
  async stat(path) {
    const response = await this.request(path, {
      method: 'PROPFIND', headers: { Depth: '0' },
    });
    const entries = parseDavMultistatus(await response.text());
    if (!entries.length) {
      throw new StorageError('STORAGE_STATE_CONFLICT', 409, 'Invalid DAV stat response');
    }
    return { path, kind: entries[0].kind, size: entries[0].size, etag: entries[0].etag };
  }
  async list(path) {
    const response = await this.request(path, {
      method: 'PROPFIND', headers: { Depth: '1' },
    });
    return parseDavMultistatus(await response.text()).slice(1).map((entry) => entry.href);
  }
  async remove(path) { await this.request(path, { method: 'DELETE' }); }
}

export async function shareReadOnly(options) {
  const body = new URLSearchParams({
    path: options.path,
    shareType: '0',
    shareWith: options.shareWith,
    permissions: '1',
  });
  const response = await fetch(options.baseUrl.replace(/\/$/, '')
    + '/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json', {
    method: 'POST',
    headers: {
      ...options.requestHeaders,
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) throw new StorageError('STORAGE_STATE_CONFLICT', 409, 'Share failed');
  const payload = await response.json();
  if (payload?.ocs?.meta?.status !== 'ok') {
    throw new StorageError('STORAGE_STATE_CONFLICT', 409, 'Share rejected');
  }
  return payload.ocs.data;
}
