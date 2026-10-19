'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { Approval, ApprovalObjectType, ApprovalStatus } from '@/api/types';
import { DecideDialog, type DecideKind } from '@/components/approvals/approvalUi';
import { Pagination } from '@/components/DataTable';
import { UserName } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, PageHeader, QueryState, SelectField, Tabs } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { approvalObjectLabel, approvalStatusLabel } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';

type Box = 'inbox' | 'sent' | 'all';
const LIMIT = 20;

export default function ApprovalsPage() {
  const [box, setBox] = useState<Box>('inbox');
  const [status, setStatus] = useState<ApprovalStatus | ''>('pending');
  const [objectType, setType] = useState<ApprovalObjectType | ''>('');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ a: Approval; kind: DecideKind } | null>(null);
  const toast = useToast();
  const q = useQuery({
    queryKey: ['approvals', { box, status, objectType, page }],
    queryFn: () =>
      unwrap(api.GET('/approvals', { params: { query: { box, status: status || undefined, objectType: objectType || undefined, page, limit: LIMIT, sort: '-submittedAt' } } })),
    placeholderData: (prev) => prev,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Phê duyệt" subtitle="Phiếu trình duyệt thay luồng email BM-VCPV-05" />
      <Tabs
        value={box}
        onChange={(v) => (setBox(v), reset())}
        tabs={[
          { value: 'inbox', label: 'Chờ tôi duyệt' },
          { value: 'sent', label: 'Tôi đã trình' },
          { value: 'all', label: 'Tất cả' },
        ]}
      />
      <div className="filters">
        <SelectField
          label="Trạng thái"
          value={status}
          onChange={(v) => (setStatus(v), reset())}
          placeholder="Tất cả"
          options={(Object.keys(approvalStatusLabel) as ApprovalStatus[]).map((s) => ({ value: s, label: approvalStatusLabel[s] }))}
        />
        <SelectField
          label="Loại việc"
          value={objectType}
          onChange={(v) => (setType(v), reset())}
          placeholder="Tất cả"
          options={(Object.keys(approvalObjectLabel) as ApprovalObjectType[]).map((s) => ({ value: s, label: approvalObjectLabel[s] }))}
        />
      </div>
      <QueryState q={q} empty={q.data?.items.length === 0}>
        <ul className="list">
          {q.data?.items.map((a) => (
            <li key={a.id} className="list-item">
              <div className="list-item-head">
                <div>
                  <span className="muted small">{approvalObjectLabel[a.objectType]}</span>
                  <div>
                    <Link href={`/phe-duyet/${a.id}`}>
                      <strong>{a.objectTitle ?? 'Không có tên'}</strong>
                    </Link>
                  </div>
                </div>
                <Badge status={a.status}>{approvalStatusLabel[a.status]}</Badge>
              </div>
              <div className="muted small">
                Người trình: <UserName id={a.submittedBy} /> · {formatDateTime(a.submittedAt)}
                {a.dueAt && <> · Hạn {formatDateTime(a.dueAt)}</>}
              </div>
              <div className="actions">
                {a.snapshot?.viewUrl && (
                  <a className="btn btn-secondary" href={a.snapshot.viewUrl} target="_blank" rel="noreferrer">
                    Xem file
                  </a>
                )}
                {hasAction(a, 'check') && (
                  <Button variant="primary" onClick={() => setDeciding({ a, kind: 'check' })}>
                    Xác nhận kiểm tra
                  </Button>
                )}
                {hasAction(a, 'decide') && (
                  <>
                    <Button variant="success" onClick={() => setDeciding({ a, kind: 'approve' })}>
                      Đồng ý
                    </Button>
                    <Button variant="danger" onClick={() => setDeciding({ a, kind: 'changes_requested' })}>
                      Yêu cầu sửa
                    </Button>
                  </>
                )}
                {!hasAction(a, 'decide') && (
                  <Link className="btn btn-ghost" href={`/phe-duyet/${a.id}`}>
                    Chi tiết
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
        {q.data && <Pagination page={page} limit={LIMIT} total={q.data.total} onPage={setPage} />}
      </QueryState>
      {q.data?.items.length === 0 && box === 'inbox' && status === 'pending' && <p className="muted">Không có phiếu nào chờ bạn duyệt.</p>}
      {deciding && (
        <DecideDialog
          approval={deciding.a}
          kind={deciding.kind}
          onClose={() => setDeciding(null)}
          onDone={() => toast.success(deciding.kind === 'approve' ? 'Đã đồng ý.' : deciding.kind === 'check' ? 'Đã xác nhận kiểm tra.' : 'Đã gửi yêu cầu sửa.')}
        />
      )}
    </>
  );
}
