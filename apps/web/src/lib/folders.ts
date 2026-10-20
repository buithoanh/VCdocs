import type { FolderKind } from '@/api/types';

/** Loại thư mục được tạo ở gốc drive (D20); năm, tháng, đối tượng phải nằm trong thư mục cha. */
export const ROOT_FOLDER_KINDS: FolderKind[] = ['area', 'project', 'operations', 'docs', 'plan_report', 'closed', 'archive'];
export const CHILD_ONLY_KINDS: FolderKind[] = ['year', 'month', 'entity'];

export function allowedFolderKinds(atRoot: boolean): FolderKind[] {
  return atRoot ? ROOT_FOLDER_KINDS : [...ROOT_FOLDER_KINDS, ...CHILD_ONLY_KINDS];
}

/**
 * Tên dự kiến "số MÃ-TÊN NGẮN tên đầy đủ" (BR-11); tên chính thức do máy chủ ghép.
 * Mã đã chứa tên ngắn thì chỉ giữ mã (SAN-TTS + TTS → SAN-TTS), giống máy chủ.
 */
export function folderToken(code: string, shortName: string) {
  const c = code.trim();
  const s = shortName.trim();
  if (!c) return s;
  if (!s || c.toLowerCase().includes(s.toLowerCase())) return c;
  return `${c}-${s}`;
}

export function previewFolderName(number: string, code: string, shortName: string, fullName: string) {
  return [number, folderToken(code, shortName), fullName.trim()].filter(Boolean).join(' ');
}
