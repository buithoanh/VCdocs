/**
 * Audit 11/12: bản Google thật không được coi người sửa cuối (lastModifyingUser) là người tạo file.
 * Chỉ kiểm hàm ánh xạ thuần, không gọi Google.
 */
import { creatorFromRevisions, toMeta } from '../src/google/real/real-google';

const A = 'nguoi-tao@audit.vn';
const B = 'nguoi-sua@audit.vn';
const created = '2026-10-01T08:00:00.000Z';

describe('real-google: người tạo và người sửa cuối', () => {
  it('toMeta chỉ ghi lastModifyingUser là người sửa cuối, không phải người tạo', () => {
    const m = toMeta({ id: 'f1', name: 'x', mimeType: 'application/pdf', createdTime: created, lastModifyingUser: { emailAddress: B } });
    expect(m.lastModifierEmail).toBe(B);
    expect((m as any).createdByEmail).toBeUndefined();
  });

  it('người tạo lấy từ phiên bản đầu tiên, sắp theo thời gian', () => {
    const revs = [
      { id: '3', modifiedTime: '2026-10-05T00:00:00.000Z', lastModifyingUser: { emailAddress: B } },
      { id: '1', modifiedTime: '2026-10-01T08:00:05.000Z', lastModifyingUser: { emailAddress: 'Nguoi-Tao@audit.vn' } },
    ];
    expect(creatorFromRevisions(created, revs)).toBe(A);
  });

  it('không xác định được thì trả undefined (phiên bản đầu đã bị xoá, thiếu email, không có phiên bản)', () => {
    expect(creatorFromRevisions(created, [{ id: '9', modifiedTime: '2026-10-20T00:00:00.000Z', lastModifyingUser: { emailAddress: B } }])).toBeUndefined();
    expect(creatorFromRevisions(created, [{ id: '1', modifiedTime: created, lastModifyingUser: {} }])).toBeUndefined();
    expect(creatorFromRevisions(created, [])).toBeUndefined();
    expect(creatorFromRevisions(undefined, [{ id: '1', modifiedTime: created, lastModifyingUser: { emailAddress: A } }])).toBeUndefined();
  });
});
