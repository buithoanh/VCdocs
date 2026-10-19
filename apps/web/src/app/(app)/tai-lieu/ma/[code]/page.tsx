'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, unwrap } from '@/api/client';
import { PageHeader, QueryState } from '@/components/ui';

/** Mở bản hiệu lực theo mã tài liệu (US-08.2). */
export default function DocumentByCodePage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code);
  const router = useRouter();
  const q = useQuery({
    queryKey: ['documents', 'by-code', code],
    queryFn: () => unwrap(api.GET('/documents/by-code/{code}', { params: { path: { code } } })),
    retry: false,
  });
  useEffect(() => {
    if (q.data) router.replace(`/tai-lieu/${q.data.id}`);
  }, [q.data, router]);
  return (
    <>
      <PageHeader title={`Tài liệu ${code}`} back={{ href: '/tra-cuu', label: 'Tra cứu' }} />
      <QueryState q={q}>{null}</QueryState>
    </>
  );
}
