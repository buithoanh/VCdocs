import { describe, expect, it } from 'vitest';
import { ids } from '@/test/fixtures';
import { toBody, toValues, validateRecordType } from './RecordTypeForm';

const full = {
  ...toValues(undefined, ids.dept),
  name: 'Báo cáo tuần SEO',
  kind: 'BC' as const,
  folderId: ids.folder,
  keeperTitle: 'Leader SEO',
  retentionYears: '5',
  retentionBasis: 'QĐ-VCPV-01',
  disposalMethod: 'Xoá trên Drive',
  securityLevel: 'department' as const,
};

describe('loại hồ sơ', () => {
  it('đủ trường thì hợp lệ', () => {
    expect(validateRecordType(full)).toEqual({});
  });

  it('bắt buộc số năm hoặc chọn vĩnh viễn', () => {
    expect(validateRecordType({ ...full, retentionYears: '' }).retentionYears).toBeTruthy();
    expect(validateRecordType({ ...full, retentionYears: '0' }).retentionYears).toBeTruthy();
    expect(validateRecordType({ ...full, retentionYears: '', permanent: true })).toEqual({});
  });

  it('vĩnh viễn gửi retentionYears = 0', () => {
    expect(toBody({ ...full, permanent: true }).retentionYears).toBe(0);
    expect(toBody(full).retentionYears).toBe(5);
  });

  it('link biểu mẫu đổi thành fileId', () => {
    expect(toBody({ ...full, template: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit' }).templateId).toBe('1AbCdEfGhIjKlMnOp');
    expect(validateRecordType({ ...full, template: 'abc' }).template).toBeTruthy();
  });
});
