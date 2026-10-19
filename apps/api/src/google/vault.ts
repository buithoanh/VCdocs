import * as fs from 'fs';
import * as path from 'path';
import type { VaultPort } from './ports';

/** Kho riêng giữ bản PDF chốt, độc lập với Drive (BA 11.3). Giai đoạn 1: thư mục trên máy chủ. */
export class FsVault implements VaultPort {
  constructor(private readonly dir: string) {}
  private file(key: string) {
    if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Khoá kho không hợp lệ');
    return path.join(this.dir, key);
  }
  async put(key: string, content: Buffer) {
    const f = this.file(key);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    // Không ghi đè bản đã chốt
    await fs.promises.writeFile(f, content, { flag: 'wx' }).catch(async (e) => {
      if (e.code !== 'EEXIST') throw e;
    });
  }
  async get(key: string) {
    try {
      return await fs.promises.readFile(this.file(key));
    } catch {
      return undefined;
    }
  }
  async remove(key: string) {
    await fs.promises.rm(this.file(key), { force: true });
  }
}

export class MemoryVault implements VaultPort {
  readonly items = new Map<string, Buffer>();
  async put(key: string, content: Buffer) {
    if (!this.items.has(key)) this.items.set(key, content);
  }
  async get(key: string) {
    return this.items.get(key);
  }
  async remove(key: string) {
    this.items.delete(key);
  }
}
