import type { RecordInput, RecordKind, RecordType } from '@/api/types';
import { getLimits } from '@/api/client';
import { todayISO } from './format';

export type RecordFormValues = {
  recordTypeId: string;
  functionCode: string;
  workMonth: string;
  subject: string;
  identifier: string;
  createdDate: string;
  backdateReason: string;
  /** 'template' = tạo file Google từ biểu mẫu; 'upload' = tải file lên. */
  source: 'template' | 'upload';
  file: File | null;
};

export function emptyRecordForm(workMonth: string): RecordFormValues {
  return { recordTypeId: '', functionCode: '', workMonth, subject: '', identifier: '', createdDate: todayISO(), backdateReason: '', source: 'template', file: null };
}

/** Lùi n ngày làm việc (bỏ thứ Bảy, Chủ nhật) tính từ hôm nay. */
export function workingDaysBefore(today: string, n: number): string {
  const d = new Date(`${today}T12:00:00`);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return todayISO(d);
}

/** Lập lùi quá N ngày làm việc (limits.backdateWorkingDays) phải ghi lý do (BR-28). Máy chủ vẫn quyết định. */
export function isBackdated(createdDate: string, today = todayISO(), workingDays = getLimits().backdateWorkingDays) {
  return !!createdDate && createdDate < workingDaysBefore(today, workingDays);
}

export function isTooLarge(file: File | null | undefined, maxMb = getLimits().uploadMaxMb) {
  return !!file && file.size > maxMb * 1024 * 1024;
}

/** BR-20: chỉ loại hồ sơ có thời hạn đã duyệt mới lập được. */
export function canUseRecordType(t: Pick<RecordType, 'retentionStatus'>) {
  return t.retentionStatus === 'approved';
}

export function validateRecordForm(v: RecordFormValues, type: RecordType | undefined, today = todayISO()) {
  const e: Partial<Record<keyof RecordFormValues, string>> = {};
  if (!v.recordTypeId || !type) e.recordTypeId = 'Chọn loại hồ sơ.';
  else if (!canUseRecordType(type)) e.recordTypeId = 'Loại hồ sơ này chưa được duyệt thời hạn lưu nên chưa lập được (BR-20).';
  if (!v.functionCode) e.functionCode = 'Chọn mã chức năng.';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.workMonth)) e.workMonth = 'Chọn tháng công việc.';
  if (!v.subject.trim()) e.subject = 'Nhập nội dung ngắn.';
  if (type?.kind === 'OPS' && !v.identifier.trim()) e.identifier = 'Hồ sơ vận hành phải có số định danh (biển số, số PO, mã lớp…).';
  if (!v.createdDate) e.createdDate = 'Chọn ngày lập.';
  else if (v.createdDate > today) e.createdDate = 'Ngày lập không được sau hôm nay.';
  if (isBackdated(v.createdDate, today) && !v.backdateReason.trim()) e.backdateReason = 'Lập lùi ngày phải ghi lý do.';
  if (v.source === 'upload' && !v.file) e.file = 'Chọn file cần tải lên.';
  else if (v.source === 'upload' && isTooLarge(v.file)) e.file = `File quá lớn (tối đa ${getLimits().uploadMaxMb} MB).`;
  return e;
}

export function toRecordInput(v: RecordFormValues, kind: RecordKind, today = todayISO()): RecordInput {
  return {
    recordTypeId: v.recordTypeId,
    kind,
    functionCode: v.functionCode,
    subject: v.subject.trim(),
    identifier: v.identifier.trim() || undefined,
    workMonth: v.workMonth,
    createdDate: v.createdDate || undefined,
    backdateReason: isBackdated(v.createdDate, today) ? v.backdateReason.trim() : undefined,
  };
}

export function toFormData(input: RecordInput, file: File): FormData {
  const fd = new FormData();
  for (const [k, val] of Object.entries(input)) if (val !== undefined && val !== null && val !== '') fd.append(k, String(val));
  fd.append('file', file);
  return fd;
}

/** Tên dự kiến "[Mã] [Loại] Nội dung – YYYY-MM-DD"; tên chính thức do máy chủ đặt (BR-09). */
export function previewRecordName(functionCode: string, kind: RecordKind | undefined, subject: string, identifier: string, createdDate: string) {
  const content = [identifier.trim(), subject.trim()].filter(Boolean).join(' ');
  return `${functionCode || '[Mã]'} ${kind ?? '[Loại]'} ${content || 'Nội dung'} – ${createdDate || 'YYYY-MM-DD'}`;
}
