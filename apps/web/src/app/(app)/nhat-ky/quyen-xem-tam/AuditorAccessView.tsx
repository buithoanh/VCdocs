'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, getLimits, idem, unwrap } from '@/api/client';
import { useDepartments } from '@/api/queries';
import type { AuditorAccess, AuditorAccessStatus } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { DataTable, Pagination } from '@/components/DataTable';
import { ActionBar, DeptName, UserName } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Field, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
import { addDaysISO, endOfDayVN, formatDateTime, todayVN } from '@/lib/format';
import { auditorAccessStatusLabel } from '@/lib/labels';

const LIMIT = 50;

/** Lỗi nhập của phiếu cấp quyền xem tạm (E16). Máy chủ vẫn kiểm lại (BR-15: tài khoản đang làm việc). */
export function validateGrant(f: { email: string; departmentIds: string[]; expires: string }, opts: { domain: string; today: string; maxDate: string }) {
  const e: Partial<Record<'email' | 'departmentIds' | 'expires', string>> = {};
  const email = f.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'Email chưa đúng.';
  else if (!email.endsWith(`@${opts.domain}`)) e.email = `Chỉ cấp cho tài khoản @${opts.domain}.`;
  if (!f.departmentIds.length) e.departmentIds = 'Chọn ít nhất một phòng.';
  if (!f.expires) e.expires = 'Chọn ngày hết hạn.';
  else if (f.expires <= opts.today) e.expires = 'Phải sau hôm nay.';
  else if (f.expires > opts.maxDate) e.expires = 'Quá hạn tối đa cho phép.';
  return e;
}

export function AuditorAccessView() {
  const { can } = useAuth();
  const [status, setStatus] = useState<AuditorAccessStatus | ''>('active');
  const [page, setPage] = useState(1);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<AuditorAccess | null>(null);
  const list = useQuery({
    queryKey: ['auditor-access', { status, page }],
    queryFn: () => unwrap(api.GET('/auditor-access', { params: { query: { status: status || undefined, page, limit: LIMIT } } })),
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHeader
        title="Quyền xem của kiểm toán viên"
        subtitle="Cấp quyền xem tạm nhật ký và tài liệu, hồ sơ của một số phòng cho kiểm toán viên; tự hết hạn."
        actions={
          can('grantAuditorAccess') && (
            <Button variant="primary" onClick={() => setGranting(true)}>
              Cấp quyền xem tạm
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
          options={(Object.keys(auditorAccessStatusLabel) as AuditorAccessStatus[]).map((s) => ({ value: s, label: auditorAccessStatusLabel[s] }))}
        />
      </div>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(a) => a.id}
          caption="Quyền xem tạm"
          empty="Chưa cấp quyền xem tạm nào."
          columns={[
            {
              key: 'who',
              header: 'Kiểm toán viên',
              render: (a: AuditorAccess) => (
                <>
                  <strong><UserName id={a.userId} /></strong>
                  <div className="muted small">{a.email}</div>
                </>
              ),
            },
            {
              key: 'depts',
              header: 'Phòng',
              render: (a: AuditorAccess) =>
                a.departmentIds.map((d, i) => (
                  <span key={d}>
                    {i > 0 && ', '}
                    <DeptName id={d} />
                  </span>
                )),
            },
            { key: 'exp', header: 'Hết hạn', render: (a: AuditorAccess) => formatDateTime(a.expiresAt) },
            { key: 'reason', header: 'Lý do', render: (a: AuditorAccess) => a.reason || '—', hideOnMobile: true },
            {
              key: 'by',
              header: 'Người cấp',
              render: (a: AuditorAccess) => (
                <>
                  <UserName id={a.grantedBy} />
                  <div className="muted small">{formatDateTime(a.createdAt)}</div>
                </>
              ),
              hideOnMobile: true,
            },
            { key: 'used', header: 'Dùng lần cuối', render: (a: AuditorAccess) => formatDateTime(a.lastUsedAt), hideOnMobile: true },
            {
              key: 'status',
              header: 'Tình trạng',
              render: (a: AuditorAccess) => (
                <>
                  <Badge status={a.status}>{auditorAccessStatusLabel[a.status]}</Badge>
                  {a.revokedAt && <div className="muted small">Thu hồi {formatDateTime(a.revokedAt)}</div>}
                </>
              ),
            },
            {
              key: 'act',
              header: '',
              render: (a: AuditorAccess) => <ActionBar obj={a} actions={[{ action: 'revoke', label: 'Thu hồi', variant: 'danger', onClick: () => setRevoking(a) }]} />,
            },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
      {granting && <GrantDialog onClose={() => setGranting(false)} />}
      {revoking && (
        <ActionDialog
          open
          title="Thu hồi quyền xem tạm"
          description={`${revoking.email} sẽ không xem được nhật ký và tài liệu, hồ sơ của các phòng đã cấp nữa.`}
          confirmLabel="Thu hồi"
          variant="danger"
          run={() => unwrap(api.DELETE('/auditor-access/{id}', { params: { path: { id: revoking.id } } }))}
          invalidate={[['auditor-access']]}
          onClose={() => setRevoking(null)}
        />
      )}
    </>
  );
}

function GrantDialog({ onClose }: { onClose: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const depts = useDepartments();
  const maxDays = getLimits().auditorMaxDays ?? 30;
  const domain = me.user.email.split('@')[1] ?? 'vcprosperous.com';
  const today = todayVN();
  const maxDate = addDaysISO(maxDays);
  const [email, setEmail] = useState('');
  const [departmentIds, setDepts] = useState<string[]>([]);
  const [expires, setExpires] = useState(maxDate);
  const [touched, setTouched] = useState(false);
  const errors = validateGrant({ email, departmentIds, expires }, { domain, today, maxDate });
  const valid = Object.keys(errors).length === 0;
  return (
    <ActionDialog
      open
      title="Cấp quyền xem tạm cho kiểm toán viên"
      description={`Chỉ tài khoản @${domain} đang làm việc. Hạn tối đa ${maxDays} ngày; mọi lượt xem đều được ghi nhật ký.`}
      confirmLabel="Cấp quyền"
      textLabel="Lý do"
      canConfirm={valid}
      run={(reason, key) =>
        unwrap(api.POST('/auditor-access', { body: { email: email.trim().toLowerCase(), departmentIds, expiresAt: endOfDayVN(expires), reason: reason || undefined }, ...idem(key) }))
      }
      invalidate={[['auditor-access']]}
      onDone={(r) => toast.success(`Đã cấp quyền xem tạm cho ${r.email}.`)}
      onClose={onClose}
    >
      <TextField label="Email kiểm toán viên" type="email" inputMode="email" value={email} onChange={(v) => (setEmail(v), setTouched(true))} required error={touched ? errors.email : undefined} />
      <Field label="Phòng được xem" required error={touched ? errors.departmentIds : undefined}>
        <div className="check-grid">
          {depts.data?.map((d) => (
            <label key={d.id} className="checkbox">
              <input
                type="checkbox"
                checked={departmentIds.includes(d.id)}
                onChange={(e) => (setDepts(e.target.checked ? [...departmentIds, d.id] : departmentIds.filter((x) => x !== d.id)), setTouched(true))}
              />
              {d.number} {d.code} – {d.name}
            </label>
          ))}
        </div>
      </Field>
      <TextField label="Hết hạn ngày" type="date" value={expires} onChange={setExpires} required min={addDaysISO(1)} max={maxDate} error={errors.expires} hint={`Tối đa ${maxDays} ngày kể từ hôm nay.`} />
    </ActionDialog>
  );
}
