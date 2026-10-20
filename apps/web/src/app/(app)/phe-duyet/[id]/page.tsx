'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import { DecideDialog, approvalObjectHref, type DecideKind } from '@/components/approvals/approvalUi';
import { UserName } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, DefList, ErrorBox, Notice, PageHeader, QueryState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { approvalObjectLabel, approvalStatusLabel } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';

const decisionLabel = { approve: 'Đồng ý', changes_requested: 'Yêu cầu sửa', reject: 'Không duyệt' } as const;

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const q = useQuery({ queryKey: ['approval', id], queryFn: () => unwrap(api.GET('/approvals/{id}', { params: { path: { id } } })) });
  const [deciding, setDeciding] = useState<DecideKind | null>(null);
  const cancel = useAction(() => unwrap(api.POST('/approvals/{id}/cancel', { params: { path: { id } } })), {
    invalidate: [['approval', id], ['approvals']],
    onSuccess: () => toast.success('Đã rút phiếu.'),
  });
  const remind = useAction(() => unwrap(api.POST('/approvals/{id}/remind', { params: { path: { id } } })), {
    invalidate: [['approval', id]],
    onSuccess: () => toast.success('Đã nhắc người duyệt.'),
  });
  const a = q.data;
  const objectHref = a && approvalObjectHref(a);
  const canDecide = a && hasAction(a, 'decide');
  const canCheck = a && hasAction(a, 'check');

  return (
    <QueryState q={q}>
      {a && (
        <>
          <PageHeader
            back={{ href: '/phe-duyet', label: 'Phê duyệt' }}
            title={a.objectTitle ?? approvalObjectLabel[a.objectType]}
            subtitle={
              <>
                {approvalObjectLabel[a.objectType]} · <Badge status={a.status}>{approvalStatusLabel[a.status]}</Badge>
              </>
            }
          />
          {a.status === 'invalidated' && <Notice tone="warn">Phiếu mất hiệu lực: {a.invalidatedReason ?? 'file đã bị sửa sau khi trình'}. Người trình cần trình lại.</Notice>}
          <div className="actions" style={{ marginBottom: '1rem' }}>
            {a.snapshot?.viewUrl && (
              <a className="btn btn-primary btn-lg" href={a.snapshot.viewUrl} target="_blank" rel="noreferrer">
                Xem đúng bản đã trình
              </a>
            )}
            {objectHref && (
              <Link className="btn btn-secondary" href={objectHref}>
                Mở {approvalObjectLabel[a.objectType].toLowerCase()}
              </Link>
            )}
            {hasAction(a, 'remind') && (
              <Button onClick={() => remind.mutate()} loading={remind.isPending}>
                Nhắc người duyệt
              </Button>
            )}
            {hasAction(a, 'cancel') && (
              <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                Rút phiếu
              </Button>
            )}
          </div>
          <ErrorBox error={cancel.error || remind.error} />
          <Card title="Thông tin phiếu">
            <DefList
              items={[
                ['Người trình', <UserName key="s" id={a.submittedBy} />],
                ['Lúc trình', formatDateTime(a.submittedAt)],
                ['Người duyệt', <UserName key="a" id={a.approverId} />],
                ['Theo thẩm quyền', a.approverRule ?? '—'],
                ['Người kiểm tra', <UserName key="c" id={a.checkerId} />],
                ['Đã kiểm tra lúc', formatDateTime(a.checkedAt)],
                ['Hạn duyệt', formatDateTime(a.dueAt)],
                ['Đã nhắc', a.reminders?.length ? a.reminders.map(formatDateTime).join(', ') : '—'],
              ]}
            />
          </Card>
          {a.decision && (
            <Card title="Quyết định (bằng chứng phê duyệt)">
              <DefList
                items={[
                  ['Kết quả', decisionLabel[a.decision.result]],
                  ['Người quyết định', <UserName key="b" id={a.decision.by} />],
                  ['Lúc', formatDateTime(a.decision.at)],
                  ['Ý kiến', a.decision.comment ?? '—'],
                  ['Thiết bị', a.decision.device ?? '—'],
                ]}
              />
            </Card>
          )}
          {a.snapshot && (
            <Card title="Bản chụp lúc trình">
              <DefList
                items={[
                  ['Chụp lúc', formatDateTime(a.snapshot.takenAt)],
                  ['Phiên bản Google', <span key="r" className="mono">{a.snapshot.revisionId ?? '—'}</span>],
                  ['Mã băm PDF', <span key="h" className="mono small">{a.snapshot.pdfSha256 ?? '—'}</span>],
                ]}
              />
            </Card>
          )}
          {(canDecide || canCheck) && (
            <div className="sticky-decide">
              {canCheck && (
                <Button variant="primary" className="btn-lg" onClick={() => setDeciding('check')}>
                  Xác nhận kiểm tra
                </Button>
              )}
              {canDecide && (
                <>
                  <Button variant="danger" className="btn-lg" onClick={() => setDeciding('changes_requested')}>
                    Yêu cầu sửa
                  </Button>
                  <Button variant="success" className="btn-lg" onClick={() => setDeciding('approve')}>
                    Đồng ý
                  </Button>
                </>
              )}
            </div>
          )}
          {deciding && (
            <DecideDialog
              approval={a}
              kind={deciding}
              onClose={() => setDeciding(null)}
              onDone={() => toast.success(deciding === 'approve' ? 'Đã đồng ý.' : deciding === 'check' ? 'Đã xác nhận kiểm tra.' : 'Đã gửi yêu cầu sửa.')}
            />
          )}
        </>
      )}
    </QueryState>
  );
}
