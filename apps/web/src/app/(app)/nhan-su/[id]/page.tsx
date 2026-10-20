'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { SystemRole } from '@/api/types';
import { DeptName } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, Card, DefList, ErrorBox, PageHeader, QueryState, TextField } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { roleLabel, userStatusLabel } from '@/lib/labels';

const ROLES = Object.keys(roleLabel) as SystemRole[];

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => unwrap(api.GET('/users/{id}', { params: { path: { id } } })) });
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [lastDay, setLastDay] = useState('');
  useEffect(() => {
    if (q.data) {
      setRoles(q.data.systemRoles);
      setLastDay(q.data.lastWorkingDay ?? '');
    }
  }, [q.data]);

  const patch = useAction(
    (body: { systemRoles?: SystemRole[]; lastWorkingDay?: string }) => unwrap(api.PATCH('/users/{id}', { params: { path: { id } }, body })),
    { invalidate: [['user', id], ['users']] },
  );
  const u = q.data;

  return (
    <QueryState q={q}>
      {u && (
        <>
          <PageHeader title={u.name} subtitle={u.email} back={{ href: '/nhan-su', label: 'Nhân sự' }} />
          <Card>
            <DefList
              items={[
                ['Phòng', <DeptName key="d" id={u.departmentId} />],
                ['Chức danh', u.title ?? '—'],
                ['Tình trạng', userStatusLabel[u.status]],
                ['Vai trò', u.systemRoles.map((r) => roleLabel[r]).join(', ') || '—'],
                ['Ngày làm việc cuối', formatDate(u.lastWorkingDay)],
                ['Cập nhật', formatDateTime(u.updatedAt)],
              ]}
            />
          </Card>
          {can('editSystemRoles') && (
            <Card title="Vai trò trong phần mềm">
              <p className="hint">Thông thường vai trò lấy theo nhóm Google; chỉ sửa tay khi cần. Mọi thay đổi được ghi nhật ký.</p>
              {ROLES.map((r) => (
                <label key={r} className="checkbox">
                  <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                  {roleLabel[r]}
                </label>
              ))}
              <ErrorBox error={patch.error} />
              <Button variant="primary" loading={patch.isPending} onClick={() => patch.mutate({ systemRoles: roles }, { onSuccess: () => toast.success('Đã lưu vai trò.') })}>
                Lưu vai trò
              </Button>
            </Card>
          )}
          {can('setLastWorkingDay') && (
            <Card title="Nghỉ việc">
              <p className="hint">Ghi ngày làm việc cuối: phần mềm tự lập biên bản bàn giao các file người này đang giữ.</p>
              <TextField label="Ngày làm việc cuối" type="date" value={lastDay} onChange={setLastDay} />
              <Button
                variant="danger"
                disabled={!lastDay}
                loading={patch.isPending}
                onClick={() => patch.mutate({ lastWorkingDay: lastDay }, { onSuccess: () => toast.success('Đã ghi ngày nghỉ việc.') })}
              >
                Ghi ngày nghỉ việc
              </Button>
            </Card>
          )}
        </>
      )}
    </QueryState>
  );
}
