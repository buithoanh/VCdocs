'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, unwrap } from '@/api/client';
import { usePendingApprovals, useUnreadCount } from '@/components/AppShell';
import { useAuth } from '@/components/providers/AuthProvider';
import { Card, LinkButton, Loading, PageHeader } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/lib/format';
import { jobStatusLabel, jobTypeText } from '@/lib/labels';

export default function HomePage() {
  const { me, can } = useAuth();
  const pending = usePendingApprovals();
  const unread = useUnreadCount();
  const notes = useQuery({
    queryKey: ['notifications', 'list', { home: true }],
    queryFn: () => unwrap(api.GET('/notifications', { params: { query: { limit: 5 } } })),
  });
  const jobs = useQuery({
    queryKey: ['jobs', 'mine', 'home'],
    queryFn: () => unwrap(api.GET('/jobs', { params: { query: { mine: true, limit: 5 } } })),
  });

  return (
    <>
      <PageHeader title={`Xin chào, ${me.user.name}`} subtitle="Việc của bạn hôm nay" />
      <div className="grid grid-3">
        <Card>
          <div className="stat">
            <span className="muted">Chờ tôi duyệt</span>
            <span className="stat-num">{pending.isLoading ? '…' : formatNumber(pending.data ?? 0)}</span>
            <Link href="/phe-duyet">Mở hộp duyệt →</Link>
          </div>
        </Card>
        <Card>
          <div className="stat">
            <span className="muted">Thông báo chưa đọc</span>
            <span className="stat-num">{unread.isLoading ? '…' : formatNumber(unread.data ?? 0)}</span>
            <Link href="/thong-bao">Xem thông báo →</Link>
          </div>
        </Card>
        <Card title="Làm nhanh">
          <div className="actions">
            {can('createRecord') && (
              <LinkButton href="/ho-so/moi" variant="primary">
                Lập hồ sơ
              </LinkButton>
            )}
            <LinkButton href="/tra-cuu">Tìm kiếm</LinkButton>
            {can('registerDocument') && <LinkButton href="/tai-lieu/dang-ky">Đăng ký tài liệu</LinkButton>}
            {can('createShare') && <LinkButton href="/chia-se/moi">Chia sẻ ra ngoài</LinkButton>}
          </div>
        </Card>
      </div>
      <div className="grid grid-2">
        <Card title="Thông báo mới" actions={<Link href="/thong-bao">Tất cả</Link>}>
          {notes.isLoading ? (
            <Loading />
          ) : notes.data?.items.length ? (
            <ul className="list">
              {notes.data.items.map((n) => (
                <li key={n.id} className={`list-item ${n.isRead ? '' : 'is-unread'}`}>
                  {n.link ? <Link href={n.link}>{n.title}</Link> : <strong>{n.title}</strong>}
                  <div className="muted small">{formatDateTime(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Không có thông báo mới.</p>
          )}
        </Card>
        <Card title="Việc chạy nền gần đây" actions={<Link href="/viec-nen">Tất cả</Link>}>
          {jobs.isLoading ? (
            <Loading />
          ) : jobs.data?.items.length ? (
            <ul className="list">
              {jobs.data.items.map((j) => (
                <li key={j.id} className="list-item">
                  <div className="list-item-head">
                    <span>{jobTypeText(j.type)}</span>
                    <span className="small">
                      {jobStatusLabel[j.status]} · {j.progress}%
                    </span>
                  </div>
                  <div className="muted small">{formatDateTime(j.createdAt)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Chưa có việc nào.</p>
          )}
        </Card>
      </div>
    </>
  );
}
