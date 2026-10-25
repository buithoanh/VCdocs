'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/api/client';
import { allowedDocumentServer, isObjectId } from '@/lib/document-server';

declare global {
  interface Window { DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => { destroyEditor?: () => void } } }
}

export default function DocumentEditorPage({ params }: { params: Promise<{ fileId: string }> }) {
  const editor = useRef<{ destroyEditor?: () => void } | undefined>(undefined);
  const [message, setMessage] = useState('Đang chuẩn bị trình soạn thảo…');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { fileId } = await params;
      // fileId lấy từ link người khác gửi: chỉ nhận ObjectId, tránh `/`, `?`, `#` đổi sang API khác.
      if (!isObjectId(fileId)) throw new Error('Mã tệp không hợp lệ.');
      const response = await fetch(`${API_BASE}/drive/files/${encodeURIComponent(fileId)}/editor-config`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Không lấy được cấu hình trình soạn thảo.');
      const payload = await response.json();
      // Script chạy trong origin VCworkspace: chỉ nạp từ Document Server đã khai báo lúc build.
      const documentServer = allowedDocumentServer(payload?.documentServerUrl);
      if (!documentServer) throw new Error('Địa chỉ Document Server không nằm trong danh sách cho phép.');
      if (cancelled) return;
      const script = document.createElement('script');
      script.src = `${documentServer}/web-apps/apps/api/documents/api.js`;
      script.onload = () => {
        if (cancelled || !window.DocsAPI) return;
        setMessage(payload.mode === 'edit' ? 'Đang soạn thảo · mọi lần lưu tạo một phiên bản Drive mới' : 'Chế độ chỉ xem');
        editor.current = new window.DocsAPI.DocEditor('vcworkspace-document-editor', {
          ...payload.config,
          // DocsAPI chuyển height thành thuộc tính HTML của iframe; giá trị
          // calc()/vh không hợp lệ ở thuộc tính này và bị trình duyệt rơi về 150px.
          width: '100%', height: '720px',
          events: { onError: (event: any) => setMessage(`ONLYOFFICE báo lỗi ${event?.data?.errorCode ?? ''}`),
            onDocumentReady: () => setMessage(payload.mode === 'edit' ? 'Sẵn sàng soạn thảo' : 'Sẵn sàng xem') },
        });
      };
      script.onerror = () => setMessage('Không tải được ONLYOFFICE Document Server.');
      document.head.appendChild(script);
    })().catch((error) => setMessage(error instanceof Error ? error.message : 'Không mở được tệp Office.'));
    return () => { cancelled = true; editor.current?.destroyEditor?.(); };
  }, [params]);
  return <main><p role="status">{message}</p><div id="vcworkspace-document-editor" /></main>;
}
