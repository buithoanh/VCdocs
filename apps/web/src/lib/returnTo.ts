/** Chỉ nhận đường dẫn tương đối trong giao diện, chặn chuyển hướng ra trang ngoài. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/dang-nhap') || value.startsWith('/api/')) return '/';
  return value;
}
