import { AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import { sha256 } from '../../common/util';
import { StorageActor, StoredObject, WorkspaceStoragePort } from './storage.port';

const encodePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export class NextcloudWorkspaceStorage implements WorkspaceStoragePort {
  constructor(private readonly cfg: AppConfig['workspaceStorage']) {
    const url = new URL(cfg.baseUrl || '');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error('Nextcloud thử chỉ được dùng HTTP loopback');
    }
  }
  private credential(actor: StorageActor) {
    const credential = this.cfg.credentials[actor.email.toLowerCase()];
    if (!credential) throw Errors.forbidden('Không có danh tính kho riêng cho người dùng');
    return credential;
  }
  private url(key: string, actor: StorageActor) {
    const credential = this.credential(actor);
    return this.cfg.baseUrl!.replace(/\/$/, '') + '/remote.php/dav/files/'
      + encodeURIComponent(credential.username) + '/' + encodePath(key);
  }
  private async request(key: string, actor: StorageActor, init: RequestInit = {}) {
    const credential = this.credential(actor);
    const url = this.url(key, actor);
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(this.cfg.timeoutMs),
        headers: { Authorization: 'Basic ' + btoa(credential.username + ':' + credential.password), ...(init.headers || {}) } });
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw Errors.storageTimeout();
      throw Errors.storageUnavailable();
    }
    if ([401, 403].includes(response.status)) throw Errors.forbidden('Kho từ chối thao tác');
    if (response.status === 404) throw Errors.notFound('Không tìm thấy nội dung trong kho');
    if ([405, 412].includes(response.status)) throw Errors.storageConflict();
    if (response.status >= 500) throw Errors.storageUnavailable();
    if (!response.ok && response.status !== 207) throw Errors.storageConflict('Kho trả trạng thái không mong đợi');
    return response;
  }
  async ensureFolder(key: string, actor: StorageActor) {
    try { await this.request(key, actor, { method: 'PROPFIND', headers: { Depth: '0' } }); }
    catch (error: any) {
      if (error?.code !== 'NOT_FOUND') throw error;
      await this.createFolder(key, actor);
    }
  }
  async createFolder(key: string, actor: StorageActor) { await this.request(key, actor, { method: 'MKCOL' }); }
  async put(key: string, bytes: Buffer, actor: StorageActor): Promise<StoredObject> {
    await this.request(key, actor, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: bytes });
    return { key, size: bytes.length, sha256: sha256(bytes) };
  }
  async get(key: string, actor: StorageActor): Promise<StoredObject> {
    const response = await this.request(key, actor, { method: 'GET' });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { key, size: bytes.length, sha256: sha256(bytes), bytes };
  }
  async move(fromKey: string, toKey: string, actor: StorageActor) {
    await this.request(fromKey, actor, { method: 'MOVE', headers: { Destination: this.url(toKey, actor), Overwrite: 'F' } });
  }
}
