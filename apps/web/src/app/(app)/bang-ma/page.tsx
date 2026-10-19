'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction, useCodeExists } from '@/api/queries';
import type { Code, CodeStatus, CodeType } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { DataTable, Pagination } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { ActionBar, DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, ErrorBox, Modal, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
import { codeStatusLabel, codeTypeLabel } from '@/lib/labels';

const LIMIT = 50;
const TYPES = Object.keys(codeTypeLabel) as CodeType[];
const STATUSES = Object.keys(codeStatusLabel) as CodeStatus[];

export default function CodesPage() {
  const { can } = useAuth();
  const jobs = useJobs();
  const [q, setQ] = useState('');
  const [type, setType] = useState<CodeType | ''>('');
  const [departmentId, setDept] = useState('');
  const [status, setStatus] = useState<CodeStatus | ''>('');
  const [page, setPage] = useState(1);
  const [proposing, setProposing] = useState(false);
  const [deciding, setDeciding] = useState<{ code: Code; result: 'approve' | 'reject' } | null>(null);

  const list = useQuery({
    queryKey: ['codes', { q, type, departmentId, status, page }],
    queryFn: () =>
      unwrap(
        api.GET('/codes', {
          params: { query: { q: q || undefined, type: type || undefined, departmentId: departmentId || undefined, status: status || undefined, page, limit: LIMIT, sort: 'code' } },
        }),
      ),
    placeholderData: (prev) => prev,
  });
  const exp = useAction(() => unwrap(api.POST('/codes/export')), {
    onSuccess: (r) => jobs.track({ jobId: r.jobId, label: 'Xuất Bảng mã ra Google Sheets' }),
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Bảng mã"
        subtitle="Mã được phép dùng để đặt tên thư mục, hồ sơ. Mã chờ duyệt chưa dùng được."
        actions={
          <>
            {can('proposeCode') && (
              <Button variant="primary" onClick={() => setProposing(true)}>
                Đề nghị mã mới
              </Button>
            )}
            {can('exportCodes') && (
              <Button onClick={() => exp.mutate()} loading={exp.isPending}>
                Xuất ra Google Sheets
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={exp.error} />
      <div className="filters">
        <div className="field">
          <label htmlFor="tim-ma">Tìm</label>
          <input id="tim-ma" type="search" placeholder="Mã hoặc ý nghĩa" value={q} onChange={(e) => (setQ(e.target.value), reset())} />
        </div>
        <SelectField label="Loại mã" value={type} onChange={(v) => (setType(v), reset())} placeholder="Tất cả loại" options={TYPES.map((t) => ({ value: t, label: codeTypeLabel[t] }))} />
        <DeptSelect value={departmentId} onChange={(v) => (setDept(v), reset())} allowAll />
        <SelectField label="Trạng thái" value={status} onChange={(v) => (setStatus(v), reset())} placeholder="Tất cả" options={STATUSES.map((s) => ({ value: s, label: codeStatusLabel[s] }))} />
      </div>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(c) => c.id}
          empty="Không có mã phù hợp."
          columns={[
            { key: 'code', header: 'Mã', render: (c) => <strong className="mono">{c.code}</strong> },
            { key: 'meaning', header: 'Ý nghĩa', render: (c) => c.meaning },
            { key: 'type', header: 'Loại', render: (c) => codeTypeLabel[c.type] ?? c.type },
            { key: 'scope', header: 'Phạm vi', render: (c) => c.scope ?? '—', hideOnMobile: true },
            { key: 'dept', header: 'Phòng', render: (c) => <DeptName id={c.departmentId} />, hideOnMobile: true },
            { key: 'status', header: 'Trạng thái', render: (c) => <Badge status={c.status}>{codeStatusLabel[c.status]}</Badge> },
            {
              key: 'act',
              header: '',
              render: (c) => (
                <ActionBar
                  obj={c}
                  actions={[
                    { action: 'decide', label: 'Duyệt', variant: 'success', onClick: () => setDeciding({ code: c, result: 'approve' }) },
                    { action: 'decide', label: 'Không duyệt', variant: 'danger', onClick: () => setDeciding({ code: c, result: 'reject' }) },
                  ]}
                />
              ),
            },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
      {proposing && <ProposeCodeDialog onClose={() => setProposing(false)} />}
      {deciding && (
        <ActionDialog
          open
          title={deciding.result === 'approve' ? `Duyệt mã ${deciding.code.code}` : `Không duyệt mã ${deciding.code.code}`}
          description={
            <p>
              {deciding.code.meaning}
              {deciding.code.reason && <><br />Lý do đề nghị: {deciding.code.reason}</>}
            </p>
          }
          confirmLabel={deciding.result === 'approve' ? 'Duyệt' : 'Không duyệt'}
          variant={deciding.result === 'approve' ? 'success' : 'danger'}
          textLabel="Ý kiến"
          textRequired={deciding.result === 'reject'}
          run={(comment) =>
            unwrap(api.POST('/codes/{id}/decide', { params: { path: { id: deciding.code.id } }, body: { result: deciding.result, comment: comment || undefined } }))
          }
          invalidate={[['codes']]}
          onClose={() => setDeciding(null)}
        />
      )}
    </>
  );
}

function ProposeCodeDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: '', type: '' as CodeType | '', meaning: '', scope: '', reason: '' });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: k === 'code' ? v.toUpperCase() : v });
  const exists = useCodeExists(f.code);
  const dup = exists.data ? `Mã ${exists.data.code} đã có (${codeStatusLabel[exists.data.status]}): ${exists.data.meaning}` : undefined;
  const valid = f.code.trim() && f.type && f.meaning.trim() && f.scope.trim() && f.reason.trim() && !dup;
  const save = useAction(
    (_: void, key: string) =>
      unwrap(api.POST('/codes', { body: { code: f.code.trim(), type: f.type as CodeType, meaning: f.meaning.trim(), scope: f.scope.trim(), reason: f.reason.trim() }, ...idem(key) })),
    { invalidate: [['codes']], onSuccess: () => (toast.success('Đã gửi đề nghị mã mới. Mã dùng được sau khi Ban Điều hành duyệt.'), onClose()) },
  );
  return (
    <Modal
      open
      title="Đề nghị mã mới"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Gửi đề nghị
          </Button>
        </>
      }
    >
      <TextField label="Mã" value={f.code} onChange={set('code')} required placeholder="SEO-PTDA" error={dup} hint="Chữ in hoa, nối bằng dấu gạch ngang" />
      <SelectField label="Loại mã" value={f.type} onChange={set('type')} required options={TYPES.map((t) => ({ value: t, label: codeTypeLabel[t] }))} />
      <TextField label="Ý nghĩa" value={f.meaning} onChange={set('meaning')} required />
      <TextField label="Phạm vi dùng" value={f.scope} onChange={set('scope')} required hint="Phòng, mảng dùng mã này" />
      <TextField label="Lý do" value={f.reason} onChange={set('reason')} required multiline />
      <ErrorBox error={save.error} />
    </Modal>
  );
}
