import { describe, expect, it } from 'vitest';
import { recordTypes } from '@/test/fixtures';
import { emptyRecordForm, previewRecordName, toFormData, toRecordInput, validateRecordForm } from './records';

const [approved, draft, ops] = recordTypes;
const today = '2026-10-19';
const ok = { ...emptyRecordForm('2026-10'), recordTypeId: approved.id, functionCode: 'SEO-PTDA', subject: 'Báo cáo tuần 42', createdDate: today };

describe('lập hồ sơ', () => {
  it('đủ thông tin thì hợp lệ', () => {
    expect(validateRecordForm(ok, approved, today)).toEqual({});
  });

  it('loại hồ sơ chưa duyệt thời hạn thì chặn (BR-20)', () => {
    expect(validateRecordForm({ ...ok, recordTypeId: draft.id }, draft, today).recordTypeId).toMatch(/BR-20/);
  });

  it('hồ sơ vận hành bắt buộc số định danh', () => {
    expect(validateRecordForm({ ...ok, recordTypeId: ops.id }, ops, today).identifier).toBeTruthy();
    expect(validateRecordForm({ ...ok, recordTypeId: ops.id, identifier: '51G-123.45' }, ops, today)).toEqual({});
  });

  it('lập lùi ngày phải ghi lý do; không cho ngày tương lai', () => {
    expect(validateRecordForm({ ...ok, createdDate: '2026-10-01' }, approved, today).backdateReason).toBeTruthy();
    expect(validateRecordForm({ ...ok, createdDate: '2026-10-01', backdateReason: 'Nhập bù' }, approved, today)).toEqual({});
    expect(validateRecordForm({ ...ok, createdDate: '2026-10-20' }, approved, today).createdDate).toBeTruthy();
  });

  it('tải file lên thì phải chọn file', () => {
    expect(validateRecordForm({ ...ok, source: 'upload' }, approved, today).file).toBeTruthy();
  });

  it('chỉ gửi lý do lùi ngày khi lùi ngày', () => {
    expect(toRecordInput({ ...ok, backdateReason: 'x' }, 'BC', today).backdateReason).toBeUndefined();
    expect(toRecordInput({ ...ok, createdDate: '2026-10-01', backdateReason: 'Nhập bù' }, 'BC', today).backdateReason).toBe('Nhập bù');
  });

  it('FormData có đủ trường và file', () => {
    const fd = toFormData(toRecordInput(ok, 'BC', today), new File(['x'], 'a.pdf'));
    expect(fd.get('recordTypeId')).toBe(approved.id);
    expect(fd.get('kind')).toBe('BC');
    expect(fd.get('identifier')).toBeNull();
    expect(fd.get('file')).toBeInstanceOf(File);
  });

  it('tên dự kiến theo mẫu', () => {
    expect(previewRecordName('SEO-PTDA', 'BC', 'Báo cáo tuần 42', '', today)).toBe('SEO-PTDA BC Báo cáo tuần 42 – 2026-10-19');
  });
});
