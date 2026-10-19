/** Lấy fileId từ đường dẫn Google Drive/Docs nếu người dùng dán link; dán thẳng id cũng nhận. */
export function parseDriveFileId(input: string): string | undefined {
  const s = input.trim();
  const m = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(s) ?? /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return undefined;
}

export function driveFileUrl(fileId: string) {
  return `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
}
