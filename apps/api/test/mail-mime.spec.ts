import { simpleParser } from 'mailparser';
import { buildMime } from '../src/modules/mail-basic/mime';

const base = { from: 'tp.mkt@vcworkspace.test', to: ['nv.mkt@vcworkspace.test'], subject: 'Kế hoạch', messageId: 'mime-test@vcworkspace.test' };

describe('buildMime', () => {
  it('đặt text và html trong multipart/alternative để client không hiện nội dung hai lần', async () => {
    const raw = buildMime({ ...base, text: 'BẢN-CHỮ-THUẦN', html: '<p><strong>BẢN-HTML</strong></p>' });
    expect(raw.toString()).toMatch(/Content-Type: multipart\/alternative; boundary=/);
    const parsed = await simpleParser(raw);
    expect(parsed.text).toContain('BẢN-CHỮ-THUẦN');
    expect(parsed.html).toContain('<strong>BẢN-HTML</strong>');
    expect(parsed.html).not.toContain('BẢN-CHỮ-THUẦN');
  });

  it('thư chỉ có chữ thuần không có phần html và tệp đính kèm vẫn nằm ngoài alternative', async () => {
    const plain = await simpleParser(buildMime({ ...base, text: 'Chỉ có chữ' }));
    expect(plain.text).toContain('Chỉ có chữ');
    expect(plain.html).toBeFalsy();
    const withFile = await simpleParser(buildMime({ ...base, text: 'Có tệp', html: '<p>Có tệp</p>',
      attachments: [{ filename: 'ghi-chu.txt', contentType: 'text/plain', bytes: Buffer.from('noi dung'), sha256: '' }] }));
    expect(withFile.attachments.map((a) => a.filename)).toEqual(['ghi-chu.txt']);
    expect(withFile.html).toContain('<p>Có tệp</p>');
  });
});
