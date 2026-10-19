'use client';

import { useRouter } from 'next/navigation';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Card, PageHeader } from '@/components/ui';
import { RecordTypeForm, toBody, toValues, type RecordTypeValues } from '../RecordTypeForm';

export default function NewRecordTypePage() {
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const save = useAction((v: RecordTypeValues, key: string) => unwrap(api.POST('/record-types', { body: toBody(v), ...idem(key) })), {
    invalidate: [['record-types']],
    onSuccess: (t) => {
      toast.success('Đã khai báo loại hồ sơ. Trình thời hạn lưu để Ban Điều hành duyệt.');
      router.push(`/danh-muc-ho-so/${t.id}`);
    },
  });
  return (
    <>
      <PageHeader title="Khai báo loại hồ sơ" back={{ href: '/danh-muc-ho-so', label: 'Danh mục hồ sơ' }} subtitle="Thời hạn lưu chỉ có hiệu lực khi Ban Điều hành duyệt; chưa duyệt thì chưa lập được hồ sơ loại này." />
      <Card>
        <RecordTypeForm initial={toValues(undefined, me.departmentId)} submitLabel="Lưu" pending={save.isPending} error={save.error} onSubmit={(v) => save.mutate(v)} />
      </Card>
    </>
  );
}
