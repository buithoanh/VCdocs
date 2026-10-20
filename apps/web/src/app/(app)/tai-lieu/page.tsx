'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { DocumentLevel, DocumentStatus, DocumentType } from '@/api/types';
import { DataTable, Pagination } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, ErrorBox, LinkButton, PageHeader, QueryState, SelectField } from '@/components/ui';
import { addDaysISO, formatDate } from '@/lib/format';
import { docLevelLabel, docStatusLabel, docTypeLabel } from '@/lib/labels';

const LIMIT = 50;
const TYPES = Object.keys(docTypeLabel) as DocumentType[];
const LEVELS = Object.keys(docLevelLabel) as DocumentLevel[];
const STATUSES = Object.keys(docStatusLabel) as DocumentStatus[];

export default function DocumentsPage() {
  const { can } = useAuth();
  const jobs = useJobs();
  const [q, setQ] = useState('');
  const [type, setType] = useState<DocumentType | ''>('');
  const [level, setLevel] = useState<DocumentLevel | ''>('');
  const [departmentId, setDept] = useState('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [reviewSoon, setReviewSoon] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['documents', { q, type, level, departmentId, status, reviewSoon, page }],
    queryFn: () =>
      unwrap(
        api.GET('/documents', {
          params: {
            query: {
              q: q || undefined,
              type: type || undefined,
              level: level || undefined,
              departmentId: departmentId || undefined,
              status: status || undefined,
              reviewDueBefore: reviewSoon ? addDaysISO(30) : undefined,
              page,
              limit: LIMIT,
              sort: 'code',
            },
          },
        }),
      ),
    placeholderData: (prev) => prev,
  });
  const exp = useAction(() => unwrap(api.POST('/documents/catalog/export')), {
    onSuccess: (r) => jobs.track({ jobId: r.jobId, label: 'Xuất Danh mục tài liệu VCPV' }),
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Tài liệu hệ thống"
        subtitle="Quy định, quy trình, hướng dẫn, biểu mẫu và tài liệu bên ngoài"
        actions={
          <>
            {can('registerDocument') && (
              <LinkButton href="/tai-lieu/dang-ky" variant="primary">
                Đăng ký tài liệu
              </LinkButton>
            )}
            {can('importExternalDocument') && <LinkButton href="/tai-lieu/ben-ngoai">Nhập tài liệu bên ngoài</LinkButton>}
            {can('exportDocumentCatalog') && (
              <Button onClick={() => exp.mutate()} loading={exp.isPending}>
                Xuất Danh mục
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={exp.error} />
      <div className="filters">
        <div className="field">
          <label htmlFor="tim-tl">Tìm</label>
          <input id="tim-tl" type="search" placeholder="Mã hoặc tên" value={q} onChange={(e) => (setQ(e.target.value), reset())} />
        </div>
        <SelectField label="Loại" value={type} onChange={(v) => (setType(v), reset())} placeholder="Tất cả loại" options={TYPES.map((t) => ({ value: t, label: docTypeLabel[t] }))} />
        <SelectField label="Cấp" value={level} onChange={(v) => (setLevel(v), reset())} placeholder="Tất cả cấp" options={LEVELS.map((l) => ({ value: l, label: docLevelLabel[l] }))} />
        <DeptSelect value={departmentId} onChange={(v) => (setDept(v), reset())} allowAll />
        <SelectField label="Trạng thái" value={status} onChange={(v) => (setStatus(v), reset())} placeholder="Tất cả" options={STATUSES.map((s) => ({ value: s, label: docStatusLabel[s] }))} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={reviewSoon} onChange={(e) => (setReviewSoon(e.target.checked), reset())} />
        Chỉ tài liệu đến kỳ rà soát trong 30 ngày tới
      </label>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(d) => d.id}
          rowHref={(d) => (d.isRestricted ? undefined : `/tai-lieu/${d.id}`)}
          empty="Không có tài liệu phù hợp."
          columns={[
            { key: 'code', header: 'Mã', render: (d) => <strong className="mono">{d.code ?? 'Chưa cấp mã'}</strong> },
            {
              key: 'title',
              header: 'Tên tài liệu',
              render: (d) => (
                <>
                  {d.title} {d.isRestricted && <Badge status="failed">Mật</Badge>}
                </>
              ),
            },
            { key: 'type', header: 'Loại', render: (d) => docTypeLabel[d.type], hideOnMobile: true },
            { key: 'dept', header: 'Phòng', render: (d) => <DeptName id={d.departmentId} />, hideOnMobile: true },
            { key: 'ver', header: 'Phiên bản', render: (d) => (d.current?.number ? `v${d.current.number}` : '—'), hideOnMobile: true },
            { key: 'status', header: 'Trạng thái', render: (d) => (d.isRestricted ? '—' : <Badge status={d.status}>{docStatusLabel[d.status]}</Badge>) },
            { key: 'review', header: 'Kỳ rà soát', render: (d) => formatDate(d.reviewDue), hideOnMobile: true },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
    </>
  );
}
