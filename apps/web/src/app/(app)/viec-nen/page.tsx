'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { Job } from '@/api/types';
import { DataTable, Pagination } from '@/components/DataTable';
import { JobProgress, jobResultLink } from '@/components/jobs';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, Modal, PageHeader, QueryState, Tabs } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { jobStatusLabel, jobTypeText } from '@/lib/labels';

const LIMIT = 30;

export default function JobsPage() {
  const { can } = useAuth();
  const [mine, setMine] = useState<'mine' | 'all'>('mine');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Job | null>(null);
  const q = useQuery({
    queryKey: ['jobs', mine, page],
    queryFn: () => unwrap(api.GET('/jobs', { params: { query: { mine: mine === 'mine', page, limit: LIMIT } } })),
    refetchInterval: (qq) => (qq.state.data?.items.some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false),
  });
  return (
    <>
      <PageHeader title="Việc đang chạy" subtitle="Các việc phải làm nhiều bước trên Google Drive (tạo file, ban hành, chốt, xuất danh mục…)" />
      {can('viewAllJobs') && (
        <Tabs
          value={mine}
          onChange={(v) => {
            setMine(v);
            setPage(1);
          }}
          tabs={[
            { value: 'mine', label: 'Của tôi' },
            { value: 'all', label: 'Tất cả' },
          ]}
        />
      )}
      <QueryState q={q}>
        <DataTable
          rows={q.data?.items ?? []}
          rowKey={(j) => j.id}
          empty="Chưa có việc nào."
          columns={[
            { key: 'type', header: 'Việc', render: (j) => jobTypeText(j.type) },
            { key: 'status', header: 'Tình trạng', render: (j) => <Badge status={j.status}>{jobStatusLabel[j.status]}</Badge> },
            { key: 'progress', header: 'Tiến độ', render: (j) => `${j.progress}%`, className: 'num' },
            { key: 'createdAt', header: 'Lúc bắt đầu', render: (j) => formatDateTime(j.createdAt), hideOnMobile: true },
            {
              key: 'open',
              header: '',
              render: (j) => {
                const link = j.status === 'done' ? jobResultLink(j) : undefined;
                return (
                  <div className="actions">
                    <Button variant="ghost" onClick={() => setOpen(j)}>
                      Chi tiết
                    </Button>
                    {link && (
                      <a className="btn btn-ghost" href={link.href} target={link.external ? '_blank' : undefined} rel="noreferrer">
                        {link.text}
                      </a>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
        {q.data && <Pagination page={page} limit={LIMIT} total={q.data.total} onPage={setPage} />}
      </QueryState>
      <Modal open={!!open} onClose={() => setOpen(null)} title={jobTypeText(open?.type)}>
        {open && <JobProgress jobId={open.id} />}
      </Modal>
    </>
  );
}
