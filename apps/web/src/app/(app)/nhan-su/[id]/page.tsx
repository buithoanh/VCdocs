'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { SystemRole } from '@/api/types';
import { DeptName } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, Card, DefList, ErrorBox, LinkButton, PageHeader, QueryState, TextField } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { roleLabel, userStatusLabel } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';

const ROLES = Object.keys(roleLabel) as SystemRole[];

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
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
          {hasAction(u, 'update-roles') && (
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
          {hasAction(u, 'update-leave') && (
            <Card title="Nghỉ việc">
              <p className="hint">Ghi ngày làm việc cuối: người này chuyển sang “Sắp nghỉ” và hệ thống tự lập biên bản bàn giao (BM-VCPV-08) để người nhận, HCNS xử lý.</p>
              <TextField label="Ngày làm việc cuối" type="date" value={lastDay} onChange={setLastDay} />
              <Button
                variant="danger"
                disabled={!lastDay}
                loading={patch.isPending}
                onClick={() =>
                  patch.mutate(
                    { lastWorkingDay: lastDay },
                    { onSuccess: () => toast.success('Đã ghi ngày nghỉ việc, biên bản bàn giao đang được lập.', { href: `/ban-giao?userId=${u.id}`, text: 'Xem biên bản' }) },
                  )
                }
              >
                Ghi ngày nghỉ việc
              </Button>
              {u.status !== 'active' && (
                <LinkButton href={`/ban-giao?userId=${u.id}`}>Biên bản bàn giao</LinkButton>
              )}
            </Card>
          )}
        </>
      )}
    </QueryState>
  );
}
