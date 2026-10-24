import { createTestApp, TestApp } from './support/app';

describe('Drive cơ bản VCworkspace', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => t.close());

  it('phủ sáu API, metadata/checksum/idempotency và quyền chỉ đọc', async () => {
    const manager = await t.login('tp.mkt');
    const spaces = await manager.get('/spaces');
    expect(spaces.status).toBe(200);
    const department = spaces.body.items.find((item: any) => item.kind === 'department');
    expect(department).toMatchObject({ role: 'manager' });

    const folder = await manager.post('/drive/folders', { spaceId: department.id, name: 'Tài liệu thử' });
    expect(folder.status).toBe(201);
    expect(folder.body).toMatchObject({ kind: 'folder', name: 'Tài liệu thử' });
    expect((await manager.post('/drive/folders', { spaceId: department.id, name: 'Tài liệu thử' })).status).toBe(409);

    const key = 'drive-upload-fixed-key';
    const uploaded = await manager.upload('/drive/files', { spaceId: department.id }, {
      name: 'mau.txt', type: 'text/plain', content: Buffer.from('VCworkspace Drive'),
    }, { idem: key });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ kind: 'file', name: 'mau.txt', size: 17,
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const listed = await manager.get(`/drive/items?spaceId=${department.id}`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item: any) => item.name)).toEqual(expect.arrayContaining(['Tài liệu thử', 'mau.txt']));
    const metadata = await manager.get(`/drive/files/${uploaded.body.id}`);
    expect(metadata.status).toBe(200);
    expect(metadata.body.contentSha256).toBe(uploaded.body.contentSha256);
    const content = await manager.get(`/drive/files/${uploaded.body.id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers['x-content-sha256']).toBe(uploaded.body.contentSha256);
    expect(content.text).toBe('VCworkspace Drive');

    const replay = await manager.upload('/drive/files', { spaceId: department.id }, {
      name: 'mau.txt', type: 'text/plain', content: Buffer.from('VCworkspace Drive'),
    }, { idem: key });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(uploaded.body.id);
    const duplicateName = await manager.upload('/drive/files', { spaceId: department.id }, {
      name: 'mau.txt', type: 'text/plain', content: Buffer.from('khac'),
    }, { idem: 'another-upload-key' });
    expect(duplicateName.status).toBe(409);

    const reader = await t.login('nv.mkt');
    const readerSpaces = await reader.get('/spaces');
    const readDepartment = readerSpaces.body.items.find((item: any) => item.kind === 'department');
    expect(readDepartment.role).toBe('reader');
    expect((await reader.post('/drive/folders', { spaceId: readDepartment.id, name: 'Không được tạo' })).status).toBe(403);
  });

  it('giữ id khi đổi tên/di chuyển, khôi phục đúng phiên bản và thùng rác', async () => {
    const manager = await t.login('tp.mkt');
    const spaces = await manager.get('/spaces');
    const space = spaces.body.items.find((item: any) => item.kind === 'department');
    const folderA = await manager.post('/drive/folders', { spaceId: space.id, name: 'An toàn A' });
    const folderB = await manager.post('/drive/folders', { spaceId: space.id, name: 'An toàn B' });
    const first = await manager.upload('/drive/files', { spaceId: space.id, parentId: folderA.body.id }, {
      name: 'du-lieu.txt', type: 'text/plain', content: Buffer.from('ban-mot'),
    }, { idem: 'safe-first-version' });
    expect(first.status).toBe(201);
    expect(first.body.versionNumber).toBe(1);

    const moved = await manager.patch('/drive/items/' + first.body.id, { name: 'da-doi-ten.txt', parentId: folderB.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ id: first.body.id, name: 'da-doi-ten.txt', parentId: folderB.body.id });
    expect((await manager.patch('/drive/items/' + first.body.id, { name: 'da-doi-ten.txt', parentId: folderB.body.id })).status).toBe(409);

    const second = await manager.upload('/drive/files/' + first.body.id + '/versions', {}, {
      name: 'du-lieu.txt', type: 'text/plain', content: Buffer.from('ban-hai'),
    }, { idem: 'safe-second-version' });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ id: first.body.id, versionNumber: 2 });
    expect((await manager.get('/drive/files/' + first.body.id + '/content')).text).toBe('ban-hai');
    const versions = await manager.get('/drive/files/' + first.body.id + '/versions');
    expect(versions.body.items.map((v: any) => v.number)).toEqual([2, 1]);
    const v1 = versions.body.items.find((v: any) => v.number === 1);
    const restoredVersion = await manager.post(`/drive/files/${first.body.id}/versions/${v1.id}/restore`, {});
    expect(restoredVersion.body).toMatchObject({ id: first.body.id, versionNumber: 1, contentSha256: v1.contentSha256 });
    expect((await manager.get('/drive/files/' + first.body.id + '/content')).text).toBe('ban-mot');

    const trashed = await manager.post('/drive/items/' + first.body.id + '/trash', {});
    expect(trashed.status).toBe(200);
    expect((await manager.get(`/drive/items?spaceId=${space.id}&parentId=${folderB.body.id}`)).body.items).toHaveLength(0);
    const trash = await manager.get('/drive/trash?spaceId=' + space.id);
    expect(trash.body.items.map((item: any) => item.id)).toContain(first.body.id);
    const restored = await manager.post('/drive/items/' + first.body.id + '/restore', {});
    expect(restored.body).toMatchObject({ id: first.body.id, parentId: folderB.body.id });
    expect((await manager.get('/drive/files/' + first.body.id + '/content')).text).toBe('ban-mot');

    const reader = await t.login('nv.mkt');
    expect((await reader.patch('/drive/items/' + first.body.id, { name: 'reader-khong-duoc.txt' })).status).toBe(403);
    expect((await reader.upload('/drive/files/' + first.body.id + '/versions', {}, {
      name: 'x.txt', type: 'text/plain', content: Buffer.from('x'),
    }, { idem: 'reader-version-denied' })).status).toBe(403);
    expect((await reader.get('/drive/files/' + first.body.id + '/versions')).status).toBe(200);
    const outsider = await t.login('tp.kd');
    expect((await outsider.get('/drive/files/' + first.body.id)).status).toBe(404);
    expect((await outsider.patch('/drive/items/' + first.body.id, { name: 'khong-duoc.txt' })).status).toBe(404);

    const nested = await manager.upload('/drive/files', { spaceId: space.id, parentId: folderA.body.id }, {
      name: 'nested.txt', type: 'text/plain', content: Buffer.from('nested'),
    }, { idem: 'safe-nested-file' });
    expect((await manager.post('/drive/items/' + folderA.body.id + '/trash', {})).status).toBe(200);
    expect((await manager.get('/drive/files/' + nested.body.id)).status).toBe(404);
    expect((await manager.post('/drive/items/' + folderA.body.id + '/restore', {})).status).toBe(200);
    expect((await manager.get('/drive/files/' + nested.body.id + '/content')).text).toBe('nested');

    // Bản sao metadata được phục hồi vào một CSDL thử mới; byte kho được kiểm
    // riêng ở bài volume Nextcloud để hai lớp không tự chứng minh lẫn nhau.
    const sourceNames = ['workspace_spaces', 'workspace_space_members', 'workspace_drive_items', 'workspace_drive_versions'];
    const restoredDb = t.db.conn.useDb(`restore_${Date.now()}`, { useCache: false });
    try {
      for (const name of sourceNames) {
        const docs = await t.db.conn.collection(name).find({}).toArray();
        if (docs.length) await restoredDb.collection(name).insertMany(docs);
        expect(await restoredDb.collection(name).countDocuments({})).toBe(docs.length);
      }
      const restoredFile = await restoredDb.collection('workspace_drive_items').findOne({ name: 'da-doi-ten.txt' });
      expect(restoredFile).toMatchObject({ name: 'da-doi-ten.txt', contentSha256: v1.contentSha256, versionNumber: 1 });
    } finally {
      await restoredDb.dropDatabase();
    }
  });
});
