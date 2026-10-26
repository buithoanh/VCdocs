import { createSpreadsheetTemplate } from '../src/modules/drive-basic/xlsx-template';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
import { Errors } from '../src/common/errors';
import { DriveBasicService } from '../src/modules/drive-basic/drive-basic.service';
import { WORKSPACE_STORAGE } from '../src/modules/drive-basic/storage.port';
import { createTestApp, TestApp } from './support/app';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Review O8/O9/O10/O14: luật tải tệp, phiên bản và tên trong Drive cơ bản.
describe('Drive: luật tải tệp và phiên bản', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  async function manager() {
    const client = await t.login('tp.mkt');
    const space = (await client.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    return { client, spaceId: space.id as string };
  }

  it('O9: phiên bản mới của XLSX nhận XLSX', async () => {
    const { client, spaceId } = await manager();
    const sheet = await client.post('/drive/spreadsheets', { spaceId, name: 'O9 bảng' }, { idem: 'review-o9-sheet' });
    expect(sheet.status).toBe(201);
    const next = await client.upload(`/drive/files/${sheet.body.id}/versions`, {},
      { name: 'O9 bảng.xlsx', type: XLSX, content: createSpreadsheetTemplate() });
    expect(next.status).toBe(201);
    expect(next.body).toMatchObject({ versionNumber: 2, mimeType: XLSX });
  });

  it('O9: không cho đổi DOCX thành PDF hay gói Office giả', async () => {
    const { client, spaceId } = await manager();
    const doc = await client.post('/drive/documents', { spaceId, name: 'O9 văn bản' }, { idem: 'review-o9-document' });
    const pdf = await client.upload(`/drive/files/${doc.body.id}/versions`, {},
      { name: 'O9 văn bản.pdf', type: 'application/pdf', content: Buffer.from('%PDF-1.4\n') });
    expect(pdf.status).toBe(415);
    const fake = await client.upload(`/drive/files/${doc.body.id}/versions`, {},
      { name: 'O9 văn bản.docx', type: DOCX, content: Buffer.from('PK không phải docx') });
    expect(fake.status).toBe(400);
    const ok = await client.upload(`/drive/files/${doc.body.id}/versions`, {},
      { name: 'O9 văn bản.docx', type: DOCX, content: createDocumentTemplate('Bản 2') });
    expect(ok.status).toBe(201);
    expect((await client.get(`/drive/files/${doc.body.id}`)).body).toMatchObject({ versionNumber: 2, mimeType: DOCX });
  });

  it('O8: lỗi sau khi đã tạo item thì retry cùng Idempotency-Key hoàn tất, không kẹt 409', async () => {
    const { client, spaceId } = await manager();
    const file = { name: 'o8-noi-lai.txt', type: 'text/plain', content: Buffer.from('noi-lai') };
    // Lỗi tạm sau khi item đã được tạo (ví dụ CSDL chậm ở bước tạo version).
    const spy = jest.spyOn(t.db.m.WorkspaceDriveVersion, 'create').mockRejectedValueOnce(Errors.storageUnavailable() as never);
    const first = await client.upload('/drive/files', { spaceId }, file, { idem: 'review-o8-resume' });
    spy.mockRestore();
    expect(first.status).toBe(503);
    const retry = await client.upload('/drive/files', { spaceId }, file, { idem: 'review-o8-resume' });
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ name: 'o8-noi-lai.txt', versionNumber: 1 });
    expect(retry.body.currentVersionId).toBeTruthy();
    expect(await t.db.m.WorkspaceDriveItem.countDocuments({ companyId: t.ids.companyId, name: 'o8-noi-lai.txt' })).toBe(1);
    expect(await t.db.m.WorkspaceDriveVersion.countDocuments({ companyId: t.ids.companyId, fileId: retry.body.id })).toBe(1);
    expect((await client.get(`/drive/files/${retry.body.id}/content`)).text).toBe('noi-lai');
  });

  it('O8: hai lượt cùng key chạy song song thì lượt sau bị chặn, lượt đầu hoàn tất', async () => {
    const { spaceId } = await manager();
    const user = await t.db.m.User.findOne({ companyId: t.ids.companyId, _id: t.ids.users['tp.mkt'] }).lean<any>();
    const ctx: any = { companyId: String(t.ids.companyId), requestId: 'review-o8', ip: '127.0.0.1', device: 'jest', auditIds: [],
      driveRoles: new Map(), visibleDriveIds: [], query: {},
      user: { id: String(user._id), email: user.email, name: user.name, departmentId: String(user.departmentId), systemRoles: user.systemRoles } };
    const drive = t.app.get(DriveBasicService), storage: any = t.app.get(WORKSPACE_STORAGE);
    const file: any = { originalname: 'o8-song-song.txt', mimetype: 'text/plain', size: 8, buffer: Buffer.from('songsong') };
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const put = storage.put.bind(storage);
    const spy = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args: any[]) => { await gate; return put(...args); });
    const first = drive.upload(ctx, { spaceId }, file, 'review-o8-parallel');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(drive.upload(ctx, { spaceId }, file, 'review-o8-parallel')).rejects.toMatchObject({ code: 'STATE_INVALID' });
    release();
    const done: any = await first;
    spy.mockRestore();
    expect(done).toMatchObject({ name: 'o8-song-song.txt', versionNumber: 1 });
    expect(await t.db.m.WorkspaceDriveVersion.countDocuments({ companyId: t.ids.companyId, fileId: done.id })).toBe(1);
    // Lượt đã xong: gọi lại cùng key trả đúng tệp đó.
    expect(await drive.upload(ctx, { spaceId }, file, 'review-o8-parallel')).toMatchObject({ id: done.id });
  });
});
