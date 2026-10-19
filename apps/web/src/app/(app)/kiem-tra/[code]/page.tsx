'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api, unwrap } from '@/api/client';
import { Badge, Card, DefList, Notice, PageHeader, QueryState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { recordStatusLabel } from '@/lib/labels';

/** Quét mã QR trên dấu chốt: xác nhận hồ sơ đã chốt thật, không hiện nội dung. */
export default function VerifyPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const q = useQuery({
    queryKey: ['verify', code],
    queryFn: () => unwrap(api.GET('/verify/{verifyCode}', { params: { path: { verifyCode: code } } })),
    retry: false,
  });
  return (
    <>
      <PageHeader title="Kiểm tra dấu chốt" subtitle={`Mã ${code}`} />
      <QueryState q={q}>
        {q.data && (
          <Card>
            <Notice tone="success">Hồ sơ có trong sổ VCdocs và đã được chốt.</Notice>
            <DefList
              items={[
                ['Số hồ sơ', <span key="n" className="mono">{q.data.number}</span>],
                ['Trạng thái', <Badge key="s" status={q.data.status}>{recordStatusLabel[q.data.status]}</Badge>],
                ['Chốt lúc', formatDateTime(q.data.finalizedAt)],
                ['Dấu vân tay số (SHA-256)', <span key="h" className="mono small" style={{ wordBreak: 'break-all' }}>{q.data.pdfSha256}</span>],
              ]}
            />
            <p className="hint">So dấu vân tay số với bản PDF bạn đang cầm để chắc chắn bản đó chưa bị sửa.</p>
          </Card>
        )}
      </QueryState>
    </>
  );
}
