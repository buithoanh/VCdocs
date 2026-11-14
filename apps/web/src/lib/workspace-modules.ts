/**
 * Phân hệ VCworkspace hiện trên giao diện (menu và trang).
 *
 * Đặt lúc build bằng NEXT_PUBLIC_WORKSPACE_MODULES (danh sách cách nhau dấu phẩy: `drive`, `mail`;
 * chuỗi rỗng = tắt hết). Không đặt: ngoài production bật hết để phát triển; production tắt hết
 * cho tới khi có Nextcloud/Stalwart thật. Phải khớp WORKSPACE_STORAGE_MODE / MAIL_ENGINE_MODE của API —
 * máy chủ vẫn trả 503 cho phân hệ đang tắt, cờ này chỉ để ẩn/hiện.
 */
export type WorkspaceModule = 'drive' | 'mail';
const ALL: WorkspaceModule[] = ['drive', 'mail'];

export function enabledWorkspaceModules(): WorkspaceModule[] {
  const raw = process.env.NEXT_PUBLIC_WORKSPACE_MODULES;
  if (raw === undefined) return process.env.NODE_ENV === 'production' ? [] : ALL;
  const wanted = raw.split(',').map((s) => s.trim());
  return ALL.filter((m) => wanted.includes(m));
}

export function workspaceModuleEnabled(module: WorkspaceModule): boolean {
  return enabledWorkspaceModules().includes(module);
}
