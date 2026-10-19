'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { recordTypeName, useRecordTypes } from '@/api/queries';
import type { RecordKind, RecordStatus } from '@/api/types';
import { DataTable, Pagination } from '@/components/DataTable';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, LinkButton, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
import { formatDate, formatMonth } from '@/lib/format';
import { recordKindLabel, recordStatusLabel } from '@/lib/labels';

const LIMIT = 50;

export default function RecordsPage() {
  const { can, me } = useAuth();
  const types = useRecordTypes();
  const [q, setQ] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [recordTypeId, setType] = useState('');
  const [departmentId, setDept] = useState('');
  const [workMonth, setMonth] = useState('');
  const [status, setStatus] = useState<RecordStatus | ''>('');
  const [kind, setKind] = useState<RecordKind | ''>('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['records', { q, identifier, recordTypeId, departmentId, workMonth, status, kind, mine, page }],
    queryFn: () =>
      unwrap(
        api.GET('/records', {
          params: {
            query: {
              q: q || undefined,
              identifier: identifier || undefined,
              recordTypeId: recordTypeId || undefined,
              departmentId: departmentId || undefined,
              workMonth: workMonth || undefined,
              status: status || undefined,
              kind: kind || undefined,
              createdBy: mine ? me.user.id : undefined,
              page,
              limit: LIMIT,
              sort: '-createdAt',
            },
          },
        }),
      ),
    placeholderData: (prev) => prev,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Hồ sơ"
        subtitle="Bằng chứng việc đã làm; chốt xong thì không sửa được."
        actions={
          <>
            {can('createRecord') && (
              <LinkButton href="/ho-so/moi" variant="primary">
                Lập hồ sơ
              </LinkButton>
            )}
            {can('viewUnregistered') && <LinkButton href="/ho-so/chua-dang-ky">File chưa đăng ký</LinkButton>}
          </>
        }
      />
      <div className="filters">
        <div className="field">
          <label htmlFor="tim-hs">Tìm</label>
          <input id="tim-hs" type="search" placeholder="Số hồ sơ hoặc nội dung" value={q} onChange={(e) => (setQ(e.target.value), reset())} />
        </div>
        <TextField label="Số định danh" value={identifier} onChange={(v) => (setIdentifier(v), reset())} placeholder="Biển số, PO…" />
        <SelectField label="Loại hồ sơ" value={recordTypeId} onChange={(v) => (setType(v), reset())} placeholder="Tất cả" options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
        <SelectField label="Loại" value={kind} onChange={(v) => (setKind(v), reset())} placeholder="Tất cả" options={(Object.keys(recordKindLabel) as RecordKind[]).map((k) => ({ value: k, label: recordKindLabel[k] }))} />
        <DeptSelect value={departmentId} onChange={(v) => (setDept(v), reset())} allowAll />
        <TextField label="Tháng công việc" type="month" value={workMonth} onChange={(v) => (setMonth(v), reset())} />
        <SelectField label="Trạng thái" value={status} onChange={(v) => (setStatus(v), reset())} placeholder="Tất cả" options={(Object.keys(recordStatusLabel) as RecordStatus[]).map((s) => ({ value: s, label: recordStatusLabel[s] }))} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={mine} onChange={(e) => (setMine(e.target.checked), reset())} />
        Chỉ hồ sơ tôi lập
      </label>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/ho-so/${r.id}`}
          empty="Không có hồ sơ phù hợp."
          columns={[
            { key: 'num', header: 'Số hồ sơ', render: (r) => <span className="mono nowrap">{r.number}</span> },
            { key: 'name', header: 'Tên', render: (r) => <strong>{r.fileName ?? r.subject}</strong> },
            { key: 'type', header: 'Loại hồ sơ', render: (r) => recordTypeName(types.data, r.recordTypeId), hideOnMobile: true },
            { key: 'dept', header: 'Phòng', render: (r) => <DeptName id={r.departmentId} />, hideOnMobile: true },
            { key: 'month', header: 'Tháng', render: (r) => formatMonth(r.workMonth) },
            { key: 'date', header: 'Ngày lập', render: (r) => formatDate(r.createdDate), hideOnMobile: true },
            {
              key: 'status',
              header: 'Trạng thái',
              render: (r) => (
                <>
                  <Badge status={r.status}>{recordStatusLabel[r.status]}</Badge>
                  {r.status === 'drafting' && r.isApproved && <> <Badge status="approved">Đã duyệt, chờ chốt</Badge></>}
                </>
              ),
            },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
    </>
  );
}
