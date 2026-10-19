'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { NotificationChannel, NotificationSettings } from '@/api/types';
import { Pagination } from '@/components/DataTable';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, Card, ErrorBox, Loading, PageHeader, Tabs } from '@/components/ui';
import { useAction } from '@/api/queries';
import { formatDateTime } from '@/lib/format';
import { channelLabel } from '@/lib/labels';

const LIMIT = 20;

export default function NotificationsPage() {
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['notifications', 'list', tab, page],
    queryFn: () => unwrap(api.GET('/notifications', { params: { query: { page, limit: LIMIT, unread: tab === 'unread' ? true : undefined } } })),
  });

  const markRead = useAction((id: string) => unwrap(api.POST('/notifications/{id}/read', { params: { path: { id } } })), {
    invalidate: [['notifications']],
  });
  const readAll = useAction(() => unwrap(api.POST('/notifications/read-all')), {
    invalidate: [['notifications']],
    onSuccess: () => toast.success('Đã đánh dấu tất cả là đã đọc.'),
  });

  return (
    <>
      <PageHeader
        title="Thông báo"
        actions={
          <Button onClick={() => readAll.mutate(undefined)} loading={readAll.isPending}>
            Đánh dấu tất cả đã đọc
          </Button>
        }
      />
      <ErrorBox error={readAll.error} />
      <Tabs
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
        tabs={[
          { value: 'unread', label: `Chưa đọc${q.data && tab === 'unread' ? ` (${q.data.unreadCount})` : ''}` },
          { value: 'all', label: 'Tất cả' },
        ]}
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <p className="empty">{tab === 'unread' ? 'Bạn đã đọc hết thông báo.' : 'Chưa có thông báo.'}</p>
      ) : (
        <>
          <ul className="list">
            {q.data.items.map((n) => (
              <li key={n.id} className={`list-item ${n.isRead ? '' : 'is-unread'}`}>
                <div className="list-item-head">
                  <strong>{n.title}</strong>
                  <span className="muted small">{formatDateTime(n.createdAt)}</span>
                </div>
                {n.body && <p>{n.body}</p>}
                <div className="actions">
                  {n.link && (
                    <Link className="btn btn-secondary" href={n.link} onClick={() => !n.isRead && markRead.mutate(n.id)}>
                      Mở
                    </Link>
                  )}
                  {!n.isRead && (
                    <Button variant="ghost" onClick={() => markRead.mutate(n.id)}>
                      Đã đọc
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} limit={LIMIT} total={q.data.total} onPage={setPage} />
        </>
      )}
      <SettingsCard onSaved={() => qc.invalidateQueries({ queryKey: ['notification-settings'] })} />
    </>
  );
}

const CHANNELS: NotificationChannel[] = ['inapp', 'email', 'zalo'];

function SettingsCard({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['notification-settings'], queryFn: () => unwrap(api.GET('/notification-settings')) });
  const [form, setForm] = useState<NotificationSettings | null>(null);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const save = useAction((body: NotificationSettings) => unwrap(api.PATCH('/notification-settings', { body })), {
    onSuccess: () => {
      toast.success('Đã lưu cách nhận thông báo.');
      onSaved();
    },
  });
  return (
    <Card title="Cách nhận thông báo">
      {q.isLoading || !form ? (
        q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : <Loading />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          {CHANNELS.map((c) => (
            <label key={c} className="checkbox">
              <input
                type="checkbox"
                checked={form.channels.includes(c)}
                disabled={c === 'zalo'}
                onChange={(e) => setForm({ ...form, channels: e.target.checked ? [...form.channels, c] : form.channels.filter((x) => x !== c) })}
              />
              {channelLabel[c]}
              {c === 'zalo' && <span className="muted small">(có từ giai đoạn 3)</span>}
            </label>
          ))}
          <label className="checkbox">
            <input type="radio" name="digest" checked={form.digest === 'instant'} onChange={() => setForm({ ...form, digest: 'instant' })} />
            Gửi ngay khi có việc
          </label>
          <label className="checkbox">
            <input type="radio" name="digest" checked={form.digest === 'daily'} onChange={() => setForm({ ...form, digest: 'daily' })} />
            Gộp một lần mỗi ngày
          </label>
          <ErrorBox error={save.error} />
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Lưu
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
