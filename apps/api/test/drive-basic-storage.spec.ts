import { FakeWorkspaceStorage } from '../src/modules/drive-basic/storage.port';

describe('Drive cơ bản StoragePort giả', () => {
  it('ghi/đọc byte và giữ checksum', async () => {
    const storage = new FakeWorkspaceStorage();
    const bytes = Buffer.from('vcworkspace-drive');
    const stored = await storage.put('file:a', bytes);
    const opened = await storage.get('file:a');
    expect(opened.bytes).toEqual(bytes);
    expect(opened.sha256).toBe(stored.sha256);
  });

  it('không ghi đè cùng storage key', async () => {
    const storage = new FakeWorkspaceStorage();
    await storage.put('file:a', Buffer.from('first'));
    await expect(storage.put('file:a', Buffer.from('second'))).rejects.toMatchObject({
      code: 'STORAGE_CONFLICT', status: 409,
    });
  });
});
