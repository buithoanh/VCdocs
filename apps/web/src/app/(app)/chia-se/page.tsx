'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, getLimits, unwrap } from '@/api/client';
import type { ExternalShare, ShareStatus } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { DataTable, Pagination } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { ActionBar, DeptName, DeptSelect, UserName } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, LinkButton, PageHeader, QueryState, SelectField, Tabs, TextField } from '@/components/ui';
import { addDaysISO, endOfDayVN, formatDate, formatDateTime } from '@/lib/format';
import { shareRoleLabel, shareStatusLabel } from '@/lib/labels';

const LIMIT = 50;
type Tab = 'so' | 'bat-thuong';

export default function SharesPage() {
  const { can, me } = useAuth();
  const jobs = useJobs();
  const [tab, setTab] = useState<Tab>('so');
  const [departmentId, setDept] = useState('');
  const [status, setStatus] = useState<ShareStatus | ''>('active');
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState<ExternalShare | null>(null);
  const [extending, setExtending] = useState<ExternalShare | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  const list = useQuery({
    queryKey: ['external-shares', { departmentId, status, page }],
    enabled: tab === 'so',
    queryFn: () =>
      unwrap(api.GET('/external-shares', { params: { query: { departmentId: departmentId || undefined, status: status || undefined, page, limit: LIMIT, sort: 'expiresAt' } } })),
    placeholderData: (prev) => prev,
  });
  const anomalies = useQuery({
    queryKey: ['external-shares', 'anomalies'],
    enabled: tab === 'bat-thuong',
    queryFn: () => unwrap(api.GET('/external-shares/anomalies')).then((r) => r.items),
  });

  const columns = [
    { key: 'file', header: 'File', render: (s: ExternalShare) => <strong>{s.fileName ?? s.fileId}</strong> },
    { key: 'email', header: 'Đối tác', render: (s: ExternalShare) => s.email },
    { key: 'role', header: 'Quyền', render: (s: ExternalShare) => shareRoleLabel[s.role], hideOnMobile: true },
    { key: 'reason', header: 'Lý do', render: (s: ExternalShare) => (s.source === 'detected' ? <span className="muted">Chia sẻ ngoài VCdocs</span> : s.reason ?? '—'), hideOnMobile: true },
    { key: 'by', header: 'Người chia sẻ', render: (s: ExternalShare) => <UserName id={s.sharedBy} />, hideOnMobile: true },
    { key: 'dept', header: 'Phòng', render: (s: ExternalShare) => <DeptName id={s.departmentId} />, hideOnMobile: true },
    {
      key: 'exp',
      header: 'Hết hạn',
      render: (s: ExternalShare) => (s.source === 'detected' ? <span className="muted">Phát hiện {formatDateTime(s.detectedAt)}</span> : formatDateTime(s.expiresAt)),
    },
    {
      key: 'status',
      header: 'Tình trạng',
      render: (s: ExternalShare) => (
        <>
          <Badge status={s.status}>{shareStatusLabel[s.status]}</Badge>
          {s.revokedAt && <div className="muted small">Gỡ {formatDate(s.revokedAt)}</div>}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Chia sẻ ra ngoài"
        subtitle="Sổ chia sẻ ngoài (thay BM-VCPV-07): chia sẻ có hạn, tự gỡ khi hết hạn."
        actions={
          <>
            {can('createShare') && (
              <LinkButton href="/chia-se/moi" variant="primary">
                Chia sẻ một file
              </LinkButton>
            )}
            {can('revokeAllShares') && me.departmentId && (
              <Button variant="danger" onClick={() => setRevokeAll(true)}>
                Gỡ hết chia sẻ của phòng
              </Button>
            )}
          </>
        }
      />
      {can('viewShareAnomalies') && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'so', label: 'Sổ chia sẻ' },
            { value: 'bat-thuong', label: 'Chia sẻ ngoài sổ' },
          ]}
        />
      )}
      {tab === 'so' ? (
        <>
          <div className="filters">
            <DeptSelect value={departmentId} onChange={(v) => (setDept(v), setPage(1))} allowAll />
            <SelectField
              label="Tình trạng"
              value={status}
              onChange={(v) => (setStatus(v), setPage(1))}
              placeholder="Tất cả"
              options={(Object.keys(shareStatusLabel) as ShareStatus[]).map((s) => ({ value: s, label: shareStatusLabel[s] }))}
            />
          </div>
          <QueryState q={list}>
            <DataTable
              rows={list.data?.items ?? []}
              rowKey={(s) => s.id}
              empty="Không có lượt chia sẻ nào."
              columns={[
                ...columns,
                {
                  key: 'act',
                  header: '',
                  render: (s: ExternalShare) => (
                    <ActionBar
                      obj={s}
                      actions={[
                        { action: 'extend', label: 'Gia hạn', onClick: () => setExtending(s) },
                        { action: 'revoke', label: 'Gỡ', variant: 'danger', onClick: () => setRevoking(s) },
                      ]}
                    />
                  ),
                },
              ]}
            />
            {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
          </QueryState>
        </>
      ) : (
        <QueryState q={anomalies}>
          <p className="muted">Chia sẻ thấy trong nhật ký Google nhưng không qua VCdocs. Người chia sẻ hoặc trưởng phòng nên gỡ ngay.</p>
          <DataTable
            rows={anomalies.data ?? []}
            rowKey={(s) => s.id}
            empty="Không phát hiện chia sẻ ngoài sổ."
            columns={[
              ...columns,
              {
                key: 'act',
                header: '',
                render: (s: ExternalShare) => <ActionBar obj={s} actions={[{ action: 'revoke', label: 'Gỡ', variant: 'danger', onClick: () => setRevoking(s) }]} />,
              },
            ]}
          />
        </QueryState>
      )}
      {revoking && (
        <ActionDialog
          open
          title="Gỡ chia sẻ"
          description={`Gỡ quyền của ${revoking.email} trên file ${revoking.fileName ?? revoking.fileId}.`}
          confirmLabel="Gỡ"
          variant="danger"
          run={() => unwrap(api.POST('/external-shares/{id}/revoke', { params: { path: { id: revoking.id } } }))}
          invalidate={[['external-shares']]}
          onClose={() => setRevoking(null)}
        />
      )}
      {extending && <ExtendDialog share={extending} onClose={() => setExtending(null)} />}
      {revokeAll && me.departmentId && (
        <ActionDialog
          open
          title="Gỡ hết chia sẻ ngoài của phòng"
          description="Mọi file của phòng đang chia sẻ ra ngoài sẽ bị gỡ quyền ngay. Dùng khi nghi lộ dữ liệu."
          confirmLabel="Gỡ hết"
          variant="danger"
          run={() => unwrap(api.POST('/external-shares/revoke-all', { params: { query: { departmentId: me.departmentId! } } }))}
          onDone={(r) => jobs.track({ jobId: r.jobId, label: 'Gỡ hết chia sẻ ngoài của phòng', invalidate: [['external-shares']] })}
          onClose={() => setRevokeAll(false)}
        />
      )}
    </>
  );
}

function ExtendDialog({ share, onClose }: { share: ExternalShare; onClose: () => void }) {
  const max = addDaysISO(getLimits().shareMaxDays);
  const [date, setDate] = useState(max);
  return (
    <ActionDialog
      open
      title="Gia hạn chia sẻ"
      description={`${share.email} · hiện hết hạn ${formatDateTime(share.expiresAt)}`}
      confirmLabel="Gia hạn"
      canConfirm={!!date && date <= max}
      run={() => unwrap(api.POST('/external-shares/{id}/extend', { params: { path: { id: share.id } }, body: { expiresAt: endOfDayVN(date) } }))}
      invalidate={[['external-shares']]}
      onClose={onClose}
    >
      <TextField
        label="Hết hạn ngày"
        type="date"
        value={date}
        onChange={setDate}
        required
        min={addDaysISO(1)}
        max={max}
        hint={`Tối đa ${getLimits().shareMaxDays} ngày kể từ hôm nay.`}
        error={date > max ? `Quá ${getLimits().shareMaxDays} ngày cho phép.` : undefined}
      />
    </ActionDialog>
  );
}
