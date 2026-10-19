'use client';

import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { ApprovalObjectType } from '@/api/types';
import { ErrorBox, Notice } from './ui';

/** Ai sẽ duyệt theo thẩm quyền (BR-03). */
export function ApproverPreview({ objectType, objectId }: { objectType: ApprovalObjectType; objectId: string }) {
  const q = useQuery({
    queryKey: ['approval-preview', objectType, objectId],
    queryFn: () => unwrap(api.GET('/approvals/preview', { params: { query: { objectType, objectId } } })),
    retry: false,
  });
  if (q.isLoading) return <p className="muted">Đang tìm người duyệt…</p>;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return null;
  return (
    <Notice>
      <div>
        Người duyệt: <strong>{q.data.approver.name}</strong> ({q.data.approver.email})
        {q.data.checker && (
          <>
            <br />
            Người kiểm tra trước: <strong>{q.data.checker.name}</strong>
          </>
        )}
        <br />
        <span className="small">Theo: {q.data.approverRule}</span>
      </div>
    </Notice>
  );
}

