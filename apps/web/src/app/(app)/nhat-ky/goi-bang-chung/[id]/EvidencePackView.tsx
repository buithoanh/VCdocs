'use client';

import { useQuery } from '@tanstack/react-query';
import { api, ApiError, API_BASE, unwrap } from '@/api/client';
import type { EvidencePack } from '@/api/types';
import { DataTable } from '@/components/DataTable';
import { UserName } from '@/components/pickers';
import { Card, DefList, ErrorBox, LinkButton, Loading, Notice, PageHeader } from '@/components/ui';
import { formatBytes, formatDateTime } from '@/lib/format';

type PackFile = EvidencePack['files'][number];

export function EvidencePackView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['evidence-pack', id], queryFn: () => unwrap(api.GET('/evidence-pack/{id}', { params: { path: { id } } })) });
  const p = q.data;
  const header = <PageHeader title="Gói bằng chứng" back={{ href: '/nhat-ky', label: 'Nhật ký' }} />;
  if (q.isLoading) return (<>{header}<Loading /></>);
  if (q.error instanceof ApiError && q.error.status === 404)
    return (
      <>
        {header}
        <Notice tone="warn">Gói không còn: gói bằng chứng chỉ giữ trên máy chủ một thời gian ngắn rồi tự xoá. Lập lại từ trang tài liệu hoặc hồ sơ.</Notice>
      </>
    );
  if (q.error || !p) return (<>{header}<ErrorBox error={q.error} onRetry={() => q.refetch()} /></>);
  const targetHref = p.targetType === 'document' ? `/tai-lieu/${p.targetId}` : `/ho-so/${p.targetId}`;
  return (
    <>
      <PageHeader
        title="Gói bằng chứng"
        subtitle={`${p.targetType === 'document' ? 'Tài liệu' : 'Hồ sơ'} · tự xoá lúc ${formatDateTime(p.expiresAt)}`}
        back={{ href: '/nhat-ky', label: 'Nhật ký' }}
        actions={
          <>
            <a className="btn btn-primary" href={`${API_BASE}/evidence-pack/${encodeURIComponent(p.id)}/download`} download>
              Tải gói ZIP
            </a>
            <LinkButton href={targetHref}>{p.targetType === 'document' ? 'Mở tài liệu' : 'Mở hồ sơ'}</LinkButton>
          </>
        }
      />
      <Card title="Thông tin gói">
        <DefList
          items={[
            ['Người lập', <UserName key="c" id={p.createdBy} />],
            ['Lập lúc', formatDateTime(p.createdAt)],
            ['Dung lượng', formatBytes(p.sizeBytes)],
            ['Tự xoá lúc', formatDateTime(p.expiresAt)],
            ['SHA-256 của file ZIP', <span key="h" className="mono small break">{p.sha256}</span>],
          ]}
        />
        <p className="hint">Sau khi tải, đối chiếu SHA-256 của file ZIP với mã trên để chắc file không bị đổi.</p>
      </Card>
      <Card title="Nội dung gói">
        <DataTable
          rows={p.files}
          rowKey={(f) => f.path}
          caption="Các file trong gói"
          columns={[
            { key: 'path', header: 'File', render: (f: PackFile) => <span className="mono">{f.path}</span> },
            { key: 'size', header: 'Dung lượng', render: (f: PackFile) => formatBytes(f.sizeBytes), className: 'num' },
            { key: 'sha', header: 'SHA-256', render: (f: PackFile) => <span className="mono small break">{f.sha256}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </>
  );
}
