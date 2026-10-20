'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { SystemRole, UserStatus } from '@/api/types';
import { DataTable, Pagination } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, ErrorBox, PageHeader, QueryState, SelectField } from '@/components/ui';
import { roleLabel, userStatusLabel } from '@/lib/labels';

const LIMIT = 50;
const ROLES = Object.keys(roleLabel) as SystemRole[];
const STATUSES = Object.keys(userStatusLabel) as UserStatus[];

export default function UsersPage() {
  const { can } = useAuth();
  const jobs = useJobs();
  const [q, setQ] = useState('');
  const [departmentId, setDept] = useState('');
  const [role, setRole] = useState<SystemRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('active');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['users', { q, departmentId, role, status, page }],
    queryFn: () =>
      unwrap(
        api.GET('/users', {
          params: { query: { q: q || undefined, departmentId: departmentId || undefined, role: role || undefined, status: status || undefined, page, limit: LIMIT, sort: 'name' } },
        }),
      ),
    placeholderData: (prev) => prev,
  });
  const sync = useAction(() => unwrap(api.POST('/sync/google')), {
    onSuccess: (r) => jobs.track({ jobId: r.jobId, label: 'Đồng bộ nhân sự Google', invalidate: [['users']] }),
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Nhân sự"
        subtitle="Đồng bộ từ Google Workspace. Vai trò lấy theo nhóm Google."
        actions={
          can('syncGoogle') && (
            <Button variant="primary" onClick={() => sync.mutate(undefined)} loading={sync.isPending}>
              Đồng bộ ngay
            </Button>
          )
        }
      />
      <ErrorBox error={sync.error} />
      <div className="filters">
        <div className="field">
          <label htmlFor="tim-ns">Tìm</label>
          <input id="tim-ns" type="search" placeholder="Tên hoặc email" value={q} onChange={(e) => (setQ(e.target.value), reset())} />
        </div>
        <DeptSelect value={departmentId} onChange={(v) => (setDept(v), reset())} allowAll />
        <SelectField label="Vai trò" value={role} onChange={(v) => (setRole(v), reset())} placeholder="Tất cả vai trò" options={ROLES.map((r) => ({ value: r, label: roleLabel[r] }))} />
        <SelectField label="Tình trạng" value={status} onChange={(v) => (setStatus(v), reset())} placeholder="Tất cả" options={STATUSES.map((s) => ({ value: s, label: userStatusLabel[s] }))} />
      </div>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(u) => u.id}
          rowHref={(u) => `/nhan-su/${u.id}`}
          empty="Không có nhân sự phù hợp."
          columns={[
            { key: 'name', header: 'Họ tên', render: (u) => <strong>{u.name}</strong> },
            { key: 'email', header: 'Email', render: (u) => u.email, hideOnMobile: true },
            { key: 'dept', header: 'Phòng', render: (u) => <DeptName id={u.departmentId} /> },
            { key: 'title', header: 'Chức danh', render: (u) => u.title ?? '—', hideOnMobile: true },
            { key: 'roles', header: 'Vai trò', render: (u) => u.systemRoles.map((r) => roleLabel[r]).join(', ') || '—' },
            { key: 'status', header: 'Tình trạng', render: (u) => <Badge status={u.status === 'active' ? 'active' : 'pending'}>{userStatusLabel[u.status]}</Badge> },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
    </>
  );
}
