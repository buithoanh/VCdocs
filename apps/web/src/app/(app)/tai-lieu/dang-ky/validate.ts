import type { DocumentLevel, DocumentType } from '@/api/types';

export type DocumentRegistration = {
  type: DocumentType | '';
  level: DocumentLevel | '';
  title: string;
  departmentId: string;
  drafterId: string;
  checkerId: string;
  dueDate: string;
};

/** Kiểm tra trước khi gửi; máy chủ vẫn kiểm tra lại (BR-02 trả 422). */
export function validateDocumentRegistration(f: DocumentRegistration): Partial<Record<keyof DocumentRegistration, string>> {
  const e: Partial<Record<keyof DocumentRegistration, string>> = {};
  if (!f.type) e.type = 'Chọn loại tài liệu.';
  if (!f.level) e.level = 'Chọn cấp.';
  if (f.type === 'QD' && f.level === 'DEPT') e.level = 'Quy định chỉ được đăng ký ở cấp VCPV.';
  if (!f.title.trim()) e.title = 'Nhập tên tài liệu.';
  if (!f.departmentId) e.departmentId = 'Chọn phòng soạn.';
  if (!f.drafterId) e.drafterId = 'Chọn người soạn.';
  if (f.checkerId && f.checkerId === f.drafterId) e.checkerId = 'Người kiểm tra phải khác người soạn.';
  return e;
}
