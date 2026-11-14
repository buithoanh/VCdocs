'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import { JobProgress } from '@/components/jobs';
import { Badge, Button, Card, DefList, DriveLink, ErrorBox, Notice, QueryState } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/lib/format';
import { chainStatusLabel } from '@/lib/labels';

/** Mã băm neo và lần kiểm chuỗi gần nhất (R1, R3 – E15). Không kiểm lại khi mở trang. */
export function AnchorCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['audit-anchor'], queryFn: () => unwrap(api.GET('/audit-logs/anchor')) });
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const verify = useAction((_: void) => unwrap(api.POST('/audit-logs/verify')), {
    onSuccess: (r) => {
      setJobId(r.jobId);
      setRunning(true);
    },
  });
  const a = q.data;
  const v = a?.verification;
  return (
    <Card
      title="Tính toàn vẹn của nhật ký"
      actions={
        <Button variant="primary" loading={verify.isPending} disabled={running} onClick={() => verify.mutate()}>
          Kiểm chuỗi ngay
        </Button>
      }
    >
      <QueryState q={q}>
        {a && v && (
          <>
            {v.status === 'broken' && (
              <Notice tone="warn">
                Chuỗi bị lệch từ dòng số {v.brokenAtSeq ?? '?'}: có dòng nhật ký đã bị sửa hoặc xoá ngoài phần mềm. Báo ngay Ban Điều hành và Quản trị hệ thống.
              </Notice>
            )}
            <DefList
              items={[
                ['Lần kiểm gần nhất', <span key="v"><Badge status={v.status}>{chainStatusLabel[v.status]}</Badge> {v.checkedAt ? formatDateTime(v.checkedAt) : ''}</span>],
                ['Số dòng đã kiểm', formatNumber(v.count)],
                ['Dòng cuối', a.lastSeq ? `Số ${formatNumber(a.lastSeq)} · ${formatDateTime(a.lastAt)}` : 'Chưa có dòng nào'],
                ['Mã băm cuối chuỗi', <span key="h" className="mono small break">{a.lastHash ?? '—'}</span>],
                [
                  'Lần neo gần nhất',
                  a.latestAnchor ? (
                    <span key="n">
                      {formatDateTime(a.latestAnchor.at)} · dòng số {formatNumber(a.latestAnchor.seq)}
                      <span className="mono small break" style={{ display: 'block' }}>{a.latestAnchor.hash}</span>
                      {a.latestAnchor.sentTo?.length ? <span className="muted small">Đã gửi {a.latestAnchor.sentTo.join(', ')}</span> : null}
                    </span>
                  ) : (
                    'Chưa neo lần nào (07:00 thứ Hai hằng tuần)'
                  ),
                ],
              ]}
            />
            {a.latestAnchor?.fileId && (
              <div className="actions" style={{ marginTop: '.75rem' }}>
                <DriveLink fileId={a.latestAnchor.fileId}>Mở file Mỏ neo nhật ký</DriveLink>
              </div>
            )}
          </>
        )}
      </QueryState>
      <ErrorBox error={verify.error} />
      {jobId && (
        <JobProgress
          key={jobId}
          jobId={jobId}
          onFinished={() => {
            qc.invalidateQueries({ queryKey: ['audit-anchor'] });
            setRunning(false);
          }}
        />
      )}
    </Card>
  );
}
