'use client';

import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction, useRecordTypes } from '@/api/queries';
import { DataTable } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, ErrorBox, LinkButton, PageHeader, QueryState } from '@/components/ui';
import { recordKindLabel, retentionStatusLabel, retentionText } from '@/lib/labels';

const retentionTone = { draft: 'expired', submitted: 'pending', approved: 'approved' } as const;

export default function RecordTypesPage() {
  const { can } = useAuth();
  const jobs = useJobs();
  const [departmentId, setDept] = useState('');
  const q = useRecordTypes(departmentId || undefined);
  const exp = useAction(() => unwrap(api.POST('/record-types/catalog/export')), {
    onSuccess: (r) => jobs.track({ jobId: r.jobId, label: 'Xuất Danh mục hồ sơ VCPV' }),
  });
  return (
    <>
      <PageHeader
        title="Danh mục hồ sơ"
        subtitle="Loại hồ sơ của từng phòng: tên, nơi lưu, người giữ, thời hạn và cách huỷ"
        actions={
          <>
            {can('createRecordType') && (
              <LinkButton href="/danh-muc-ho-so/moi" variant="primary">
                Khai báo loại hồ sơ
              </LinkButton>
            )}
            {can('exportRecordCatalog') && (
              <Button onClick={() => exp.mutate()} loading={exp.isPending}>
                Xuất Danh mục
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={exp.error} />
      <div className="filters">
        <DeptSelect value={departmentId} onChange={setDept} allowAll />
      </div>
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(t) => t.id}
          rowHref={(t) => `/danh-muc-ho-so/${t.id}`}
          empty="Chưa có loại hồ sơ nào."
          columns={[
            { key: 'name', header: 'Loại hồ sơ', render: (t) => <strong>{t.name}</strong> },
            { key: 'kind', header: 'Loại', render: (t) => recordKindLabel[t.kind] },
            { key: 'dept', header: 'Phòng', render: (t) => <DeptName id={t.departmentId} />, hideOnMobile: true },
            { key: 'keeper', header: 'Người giữ', render: (t) => t.keeperTitle, hideOnMobile: true },
            { key: 'ret', header: 'Thời hạn', render: (t) => retentionText(t.retentionYears) },
            { key: 'basis', header: 'Căn cứ', render: (t) => t.retentionBasis, hideOnMobile: true },
            { key: 'status', header: 'Thời hạn đã duyệt?', render: (t) => <Badge status={retentionTone[t.retentionStatus]}>{retentionStatusLabel[t.retentionStatus]}</Badge> },
          ]}
        />
      </QueryState>
    </>
  );
}
