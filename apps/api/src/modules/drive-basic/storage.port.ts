import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { sha256 } from '../../common/util';

export const WORKSPACE_STORAGE = Symbol('WORKSPACE_STORAGE');
export interface StoredObject { key: string; size: number; sha256: string; bytes?: Buffer }
export interface StorageActor { email: string }
export interface WorkspaceStoragePort {
  ensureFolder(key: string, actor: StorageActor): Promise<void>;
  createFolder(key: string, actor: StorageActor): Promise<void>;
  put(key: string, bytes: Buffer, actor: StorageActor): Promise<StoredObject>;
  get(key: string, actor: StorageActor): Promise<StoredObject>;
  move(fromKey: string, toKey: string, actor: StorageActor): Promise<void>;
}

/** Adapter giả chỉ dùng phát triển/test; không kết nối Google hoặc dữ liệu thật. */
@Injectable()
export class FakeWorkspaceStorage implements WorkspaceStoragePort {
  private readonly objects = new Map<string, Buffer>();
  async ensureFolder(key: string) { if (!this.objects.has(key)) this.objects.set(key, Buffer.alloc(0)); }
  async createFolder(key: string) {
    if (this.objects.has(key)) throw Errors.storageConflict();
    this.objects.set(key, Buffer.alloc(0));
  }
  async put(key: string, bytes: Buffer) {
    if (this.objects.has(key)) throw Errors.storageConflict();
    const copy = Buffer.from(bytes);
    this.objects.set(key, copy);
    return { key, size: copy.length, sha256: sha256(copy) };
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw Errors.notFound('Không tìm thấy nội dung tệp');
    const copy = Buffer.from(bytes);
    return { key, size: copy.length, sha256: sha256(copy), bytes: copy };
  }
  async move(fromKey: string, toKey: string) {
    if (!this.objects.has(fromKey)) throw Errors.notFound('Không tìm thấy nội dung tệp');
    if (this.objects.has(toKey)) throw Errors.storageConflict();
    const moved = [...this.objects.entries()].filter(([key]) => key === fromKey || key.startsWith(fromKey + '/'));
    for (const [key] of moved) this.objects.set(toKey + key.slice(fromKey.length), this.objects.get(key)!);
    for (const [key] of moved) this.objects.delete(key);
  }
}
