'use client';

import { Segmented } from 'antd';
import { useState } from 'react';
import { Card, Notice } from '@/components/ui';

// fileId đến từ dữ liệu tài liệu (có thể do người dùng dán link khi đăng ký):
// chỉ nhận ký tự của mã Drive để không chèn được đường dẫn hay tham số khác vào URL nhúng.
const DRIVE_ID = /^[A-Za-z0-9_-]+$/;

export function drivePreviewUrl(fileId: string): string | undefined {
  return DRIVE_ID.test(fileId) ? `https://drive.google.com/file/d/${fileId}/preview` : undefined;
}

/** Xem file tài liệu ngay trong VCworkspace (khung xem của Drive), ưu tiên bản PDF đã ban hành. */
export function FilePreview({ fileId, pdfFileId }: { fileId?: string; pdfFileId?: string }) {
  const sources = [
    pdfFileId && { value: 'pdf', label: 'Bản PDF', id: pdfFileId },
    fileId && { value: 'file', label: 'File gốc', id: fileId },
  ].filter(Boolean) as { value: string; label: string; id: string }[];
  const [selected, setSelected] = useState(sources[0]?.value);
  if (!sources.length) return null;
  const source = sources.find((s) => s.value === selected) ?? sources[0];
  const src = drivePreviewUrl(source.id);
  return (
    <Card
      title="Nội dung"
      actions={sources.length > 1 ? <Segmented size="small" value={source.value} onChange={(v) => setSelected(String(v))} options={sources.map(({ value, label }) => ({ value, label }))} /> : undefined}
    >
      {src ? (
        <iframe
          className="doc-preview"
          title={`Xem ${source.label.toLowerCase()}`}
          src={src}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
          allow="fullscreen"
        />
      ) : (
        <Notice tone="warn">Mã file không hợp lệ nên không hiển thị được nội dung.</Notice>
      )}
    </Card>
  );
}
