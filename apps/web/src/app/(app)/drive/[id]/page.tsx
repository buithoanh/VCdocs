'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { driveName, useDrives } from '@/api/queries';
import { DataTable } from '@/components/DataTable';
import { Badge, PageHeader, QueryState } from '@/components/ui';
import { driveRoleLabel } from '@/lib/labels';

const anomalyLabel = { direct_member: 'Thành viên lẻ (không qua nhóm)', foreign_member: 'Ngoài tên miền công ty' } as const;
const typeLabel = { user: 'Người', group: 'Nhóm Google', domain: 'Cả tên miền', anyone: 'Bất kỳ ai' } as const;

export default function DriveMembersPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const drives = useDrives();
  const [onlyAnomalies, setOnly] = useState(false);
  const q = useQuery({
    queryKey: ['drive-members', id, onlyAnomalies],
    queryFn: () => unwrap(api.GET('/drives/{id}/members', { params: { path: { id }, query: { anomalies: onlyAnomalies || undefined } } })).then((r) => r.items),
  });
  return (
    <>
      <PageHeader title={`Thành viên ${driveName(drives.data, id)}`} back={{ href: '/drive', label: 'Bộ nhớ dùng chung' }} />
      <label className="checkbox">
        <input type="checkbox" checked={onlyAnomalies} onChange={(e) => setOnly(e.target.checked)} />
        Chỉ hiện thành viên bất thường (lẻ, ngoài công ty)
      </label>
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(m) => m.permissionId ?? m.email}
          empty={onlyAnomalies ? 'Không có thành viên bất thường.' : 'Chưa có thành viên.'}
          columns={[
            { key: 'who', header: 'Thành viên', render: (m) => <><strong>{m.name ?? m.email}</strong>{m.name && <div className="muted small">{m.email}</div>}</> },
            { key: 'type', header: 'Loại', render: (m) => typeLabel[m.type] },
            { key: 'role', header: 'Quyền', render: (m) => driveRoleLabel[m.role] },
            { key: 'via', header: 'Qua nhóm', render: (m) => m.viaGroup ?? '—', hideOnMobile: true },
            { key: 'anomaly', header: 'Cảnh báo', render: (m) => (m.anomaly ? <Badge status="failed">{anomalyLabel[m.anomaly]}</Badge> : '—') },
          ]}
        />
      </QueryState>
    </>
  );
}
