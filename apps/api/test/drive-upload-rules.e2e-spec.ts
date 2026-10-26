import { createSpreadsheetTemplate } from '../src/modules/drive-basic/xlsx-template';
import { createDocumentTemplate } from '../src/modules/drive-basic/docx-template';
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
});
