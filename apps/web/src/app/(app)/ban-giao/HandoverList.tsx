'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { Handover, HandoverStatus } from '@/api/types';
import { DataTable, Pagination } from '@/components/DataTable';
import { DeptName, DeptSelect, UserName } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, PageHeader, QueryState, SelectField } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/format';
import { handoverStatusLabel } from '@/lib/labels';
import { NewHandoverDialog } from './NewHandoverDialog';

const LIMIT = 50;

/** Tiến độ một biên bản từ counts (danh sách không trả items). */
export function countsText(c: Handover['counts']): string {
  if (!c.total) return 'Chưa có mục nào';
  const parts = [`${formatNumber(c.done)}/${formatNumber(c.total)} đã làm`];
  if (c.failed) parts.push(`${formatNumber(c.failed)} lỗi`);
  if (c.skipped) parts.push(`${formatNumber(c.skipped)} bỏ qua`);
  return parts.join(' · ');
}

export function HandoverList() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const userId = params?.get('userId') ?? undefined;
  const [status, setStatus] = useState<HandoverStatus | ''>('');
  const [departmentId, setDept] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['handovers', { status, departmentId, userId, page }],
    queryFn: () =>
      unwrap(
        api.GET('/handovers', {
          params: { query: { status: status || undefined, departmentId: departmentId || undefined, userId, page, limit: LIMIT } },
        }),
      ),
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHeader
        title="Bàn giao khi nghỉ việc"
        subtitle="Biên bản BM-VCPV-08: liệt kê việc của người nghỉ, người nhận xác nhận, HCNS kiểm tra, rồi chuyển quyền."
        actions={
          can('createHandover') && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Lập biên bản
            </Button>
          )
        }
      />
      <div className="filters">
        <SelectField
          label="Tình trạng"
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          placeholder="Tất cả"
          options={(Object.keys(handoverStatusLabel) as HandoverStatus[]).map((s) => ({ value: s, label: handoverStatusLabel[s] }))}
        />
        <DeptSelect value={departmentId} onChange={(v) => (setDept(v), setPage(1))} allowAll />
      </div>
      {userId && (
        <p className="muted small">
          Đang lọc theo người nghỉ <UserName id={userId} />.{' '}
          <button className="btn btn-ghost" onClick={() => router.replace('/ban-giao')}>
            Bỏ lọc
          </button>
        </p>
      )}
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(h) => h.id}
          rowHref={(h) => `/ban-giao/${h.id}`}
          empty="Chưa có biên bản bàn giao nào."
          caption="Biên bản bàn giao"
          columns={[
            { key: 'user', header: 'Người nghỉ', render: (h: Handover) => <strong><UserName id={h.userId} /></strong> },
            { key: 'dept', header: 'Phòng', render: (h: Handover) => <DeptName id={h.departmentId} />, hideOnMobile: true },
            { key: 'day', header: 'Ngày làm việc cuối', render: (h: Handover) => formatDate(h.lastWorkingDay) },
            { key: 'recv', header: 'Người nhận', render: (h: Handover) => <UserName id={h.receiverId} /> },
            { key: 'progress', header: 'Tiến độ', render: (h: Handover) => countsText(h.counts), hideOnMobile: true },
            {
              key: 'status',
              header: 'Tình trạng',
              render: (h: Handover) => (
                <>
                  <Badge status={h.status}>{handoverStatusLabel[h.status]}</Badge>
                  {h.isAuto && <div className="muted small">Tự lập khi ghi ngày nghỉ</div>}
                </>
              ),
            },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
      {creating && <NewHandoverDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/ban-giao/${id}`)} />}
    </>
  );
}
