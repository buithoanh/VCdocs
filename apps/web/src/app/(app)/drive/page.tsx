'use client';

import Link from 'next/link';
import { useDrives } from '@/api/queries';
import { DataTable } from '@/components/DataTable';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, PageHeader, QueryState } from '@/components/ui';
import { driveRoleLabel, securityLabel } from '@/lib/labels';

export default function DrivesPage() {
  const { can } = useAuth();
  const q = useDrives();
  return (
    <>
      <PageHeader title="Bộ nhớ dùng chung" subtitle="11 drive của công ty và quyền của bạn trên từng drive" />
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(d) => d.driveId}
          rowHref={can('viewDriveMembers') ? (d) => `/drive/${encodeURIComponent(d.driveId)}` : undefined}
          columns={[
            { key: 'name', header: 'Drive', render: (d) => <strong>{d.name}</strong> },
            { key: 'sec', header: 'Mức bảo mật', render: (d) => <Badge status={d.securityLevel === 'confidential' ? 'failed' : 'active'}>{securityLabel[d.securityLevel]}</Badge> },
            { key: 'role', header: 'Quyền của tôi', render: (d) => (d.myRole ? driveRoleLabel[d.myRole] : <span className="muted">Không là thành viên</span>) },
            {
              key: 'members',
              header: '',
              render: (d) => (can('viewDriveMembers') ? <Link href={`/drive/${encodeURIComponent(d.driveId)}`}>Thành viên</Link> : null),
            },
          ]}
        />
      </QueryState>
    </>
  );
}
