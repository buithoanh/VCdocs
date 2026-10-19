import { describe, expect, it } from 'vitest';
import { canRole, hasAction, navFor } from './permissions';
import { safeReturnTo } from './returnTo';

describe('allowedActions', () => {
  it('chỉ đúng khi hành động có trong danh sách', () => {
    expect(hasAction({ allowedActions: ['submit', 'issue'] }, 'submit')).toBe(true);
    expect(hasAction({ allowedActions: ['submit'] }, 'issue')).toBe(false);
    expect(hasAction({ allowedActions: [] }, 'submit')).toBe(false);
    expect(hasAction(undefined, 'submit')).toBe(false);
  });

  it('so đúng tên trong enum, không so lỏng', () => {
    expect(hasAction({ allowedActions: ['release-hold'] }, 'release-hold')).toBe(true);
    expect(hasAction({ allowedActions: ['release-hold'] as string[] }, 'releaseHold')).toBe(false);
  });
});

describe('quyền theo vai trò', () => {
  it('chỉ trưởng phòng đăng ký tài liệu', () => {
    expect(canRole(['R4'], 'registerDocument')).toBe(true);
    expect(canRole(['R6'], 'registerDocument')).toBe(false);
  });

  it('nhân viên, leader, trưởng phòng, kế toán trưởng lập được hồ sơ; người xem, quản trị thì không', () => {
    for (const r of ['R4', 'R5', 'R6', 'R8'] as const) expect(canRole([r], 'createRecord')).toBe(true);
    expect(canRole(['R7'], 'createRecord')).toBe(false);
    expect(canRole(['R9'], 'createRecord')).toBe(false);
  });

  it('một người nhiều vai trò thì cộng quyền', () => {
    expect(canRole(['R7', 'R2'], 'manageDelegations')).toBe(true);
  });

  it('menu ẩn mục quản trị với nhân viên', () => {
    const hrefs = navFor(['R6']).map((i) => i.href);
    expect(hrefs).toContain('/ho-so');
    expect(hrefs).toContain('/phe-duyet');
    expect(hrefs).not.toContain('/nhan-su');
    expect(hrefs).not.toContain('/phe-duyet/uy-quyen');
  });

  it('menu có Nhân sự cho quản trị, Uỷ quyền cho giám đốc khối', () => {
    expect(navFor(['R9']).map((i) => i.href)).toContain('/nhan-su');
    expect(navFor(['R2']).map((i) => i.href)).toContain('/phe-duyet/uy-quyen');
  });

  it('người xem không thấy sổ chia sẻ ngoài', () => {
    expect(navFor(['R7']).map((i) => i.href)).not.toContain('/chia-se');
  });
});

describe('returnTo', () => {
  it('chỉ nhận đường dẫn trong giao diện', () => {
    expect(safeReturnTo('/ho-so/123?x=1')).toBe('/ho-so/123?x=1');
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('/dang-nhap')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});
