import { AppConfig } from '../../config/config';
import { Errors } from '../../common/errors';
import { sha256 } from '../../common/util';
import { checkServiceUrl } from '../../common/service-url';
import { StorageActor, StoredObject, WorkspaceStoragePort } from './storage.port';
import type { StorageCredential } from './storage-credential.store';

const encodePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** Lấy app password của người gọi (StorageCredentialStore: env ở dev/staging, bản mã CSDL ở production). */
export interface CredentialSource {
  resolve(actor: StorageActor): Promise<StorageCredential>;
  forget(actor: StorageActor): void;
}

export class NextcloudWorkspaceStorage implements WorkspaceStoragePort {
  /** Production bắt buộc https; ngoài production còn nhận http loopback (PoC/test). Basic auth không đi qua http mạng. */
  constructor(private readonly cfg: AppConfig['workspaceStorage'], opts: { production: boolean; credentials: CredentialSource }) {
    checkServiceUrl('WORKSPACE_STORAGE_BASE_URL', cfg.baseUrl, { production: opts.production });
    this.credentials = opts.credentials;
  }
  private readonly credentials: CredentialSource;
  private url(key: string, credential: StorageCredential) {
    return this.cfg.baseUrl!.replace(/\/$/, '') + '/remote.php/dav/files/'
      + encodeURIComponent(credential.username) + '/' + encodePath(key);
  }
  private async request(key: string, actor: StorageActor, init: RequestInit = {}, destinationKey?: string) {
    const credential = await this.credentials.resolve(actor);
    const url = this.url(key, credential);
    const headers: Record<string, string> = {
      Authorization: 'Basic ' + Buffer.from(credential.username + ':' + credential.password).toString('base64'),
      ...(destinationKey === undefined ? {} : { Destination: this.url(destinationKey, credential) }),
      ...(init.headers as Record<string, string> | undefined),
    };
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(this.cfg.timeoutMs), headers });
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw Errors.storageTimeout();
      throw Errors.storageUnavailable();
    }
    if (response.status === 401) this.credentials.forget(actor);
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
    await this.request(fromKey, actor, { method: 'MOVE', headers: { Overwrite: 'F' } }, toKey);
  }
}
