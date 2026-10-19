import type { SystemRole } from '@/api/types';

/**
 * Quyền phía giao diện chỉ để ẩn/hiện. Máy chủ luôn kiểm tra lại.
 *
 * - Với đối tượng đã có: chỉ dựa vào `allowedActions` do máy chủ trả.
 * - Với việc chưa có đối tượng (nút "Tạo mới", mục menu): dựa vào vai trò hệ thống
 *   theo ma trận BA mục 4 và cột "Ai gọi" của hợp đồng.
 */

/** Tên hành động là enum của từng đối tượng (hợp đồng D9); so đúng từng chữ. */
export function hasAction<A extends string>(obj: { allowedActions?: readonly A[] } | null | undefined, action: A): boolean {
  return !!obj?.allowedActions?.includes(action);
}

export function hasAnyRole(roles: readonly SystemRole[] | undefined, allowed: readonly SystemRole[]): boolean {
  if (!roles) return false;
  return roles.some((r) => allowed.includes(r));
}

/**
 * Việc theo vai trò: chỉ cho việc chưa có đối tượng (nút tạo mới, mục menu).
 * Việc trên đối tượng đã có luôn theo allowedActions (hợp đồng D9).
 */
export const ROLE_RULES = {
  /** Đăng ký tài liệu mới (POST /documents). */
  registerDocument: ['R4'],
  /** Nhập tài liệu bên ngoài: "R6 trở lên" — mọi vai trò làm việc, trừ Người xem và Quản trị. */
  importExternalDocument: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R8'],
  exportDocumentCatalog: ['R3'],
  /** Lập hồ sơ (POST /records, /records/upload). Trưởng phòng cũng lập được (BA mục 4). */
  createRecord: ['R4', 'R5', 'R6', 'R8'],
  viewUnregistered: ['R4', 'R5'],
  /** Khai báo loại hồ sơ. */
  createRecordType: ['R4'],
  exportRecordCatalog: ['R3'],
  /** Tạo thư mục mảng/dự án. */
  createFolder: ['R4', 'R5'],
  ensurePeriods: ['R3'],
  /** Thêm khối, phòng, division (sửa thì theo allowedActions 'update'). */
  editMasterData: ['R3', 'R9'],
  proposeCode: ['R4'],
  exportCodes: ['R3'],
  /** Nhân sự. */
  viewUsers: ['R3', 'R4', 'R9'],
  syncGoogle: ['R9'],
  viewDriveMembers: ['R3', 'R4', 'R9'],
  /** Uỷ quyền phê duyệt của khối. */
  manageDelegations: ['R2'],
  /** Chia sẻ ra ngoài. */
  createShare: ['R4', 'R5', 'R6', 'R8'],
  viewShareRegister: ['R3', 'R4', 'R5', 'R6', 'R8'],
  revokeAllShares: ['R4'],
  viewShareAnomalies: ['R3', 'R4'],
  viewAllJobs: ['R9'],
} as const satisfies Record<string, readonly SystemRole[]>;

export type RoleRule = keyof typeof ROLE_RULES;

export function canRole(roles: readonly SystemRole[] | undefined, rule: RoleRule): boolean {
  return hasAnyRole(roles, ROLE_RULES[rule]);
}

export type NavItem = {
  href: string;
  label: string;
  /** Không có = mọi người đã đăng nhập. */
  roles?: readonly SystemRole[];
  group: 'chinh' | 'danh-muc' | 'quan-tri';
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Trang chủ', group: 'chinh' },
  { href: '/tra-cuu', label: 'Tra cứu', group: 'chinh' },
  { href: '/phe-duyet', label: 'Phê duyệt', group: 'chinh' },
  { href: '/ho-so', label: 'Hồ sơ', group: 'chinh' },
  { href: '/tai-lieu', label: 'Tài liệu', group: 'chinh' },
  { href: '/chia-se', label: 'Chia sẻ ra ngoài', roles: ROLE_RULES.viewShareRegister, group: 'chinh' },
  { href: '/thu-muc', label: 'Cây thư mục', group: 'danh-muc' },
  { href: '/danh-muc-ho-so', label: 'Danh mục hồ sơ', group: 'danh-muc' },
  { href: '/bang-ma', label: 'Bảng mã', group: 'danh-muc' },
  { href: '/danh-muc', label: 'Khối, phòng, division', group: 'danh-muc' },
  { href: '/phe-duyet/uy-quyen', label: 'Uỷ quyền phê duyệt', roles: ROLE_RULES.manageDelegations, group: 'quan-tri' },
  { href: '/nhan-su', label: 'Nhân sự', roles: ROLE_RULES.viewUsers, group: 'quan-tri' },
  { href: '/drive', label: 'Bộ nhớ dùng chung', group: 'quan-tri' },
  { href: '/viec-nen', label: 'Việc đang chạy', group: 'quan-tri' },
];

export const NAV_GROUP_LABEL: Record<NavItem['group'], string> = {
  chinh: 'Công việc',
  'danh-muc': 'Danh mục',
  'quan-tri': 'Quản lý',
};

export function navFor(roles: readonly SystemRole[] | undefined): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.roles || hasAnyRole(roles, i.roles));
}
