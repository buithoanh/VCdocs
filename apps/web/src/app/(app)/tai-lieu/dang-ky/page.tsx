'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { DocumentLevel, DocumentType } from '@/api/types';
import { DeptSelect, UserPicker } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, ErrorBox, Notice, PageHeader, SelectField, TextField } from '@/components/ui';
import { docLevelLabel, docStatusLabel, docTypeLabel } from '@/lib/labels';
import { validateDocumentRegistration, type DocumentRegistration } from './validate';

const TYPES: DocumentType[] = ['QD', 'QT', 'HD', 'BM'];

export default function RegisterDocumentPage() {
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<DocumentRegistration>({ type: '', level: '', title: '', departmentId: me.departmentId ?? '', drafterId: '', checkerId: '', dueDate: '' });
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof DocumentRegistration>(k: K) => (v: DocumentRegistration[K]) => setF((x) => ({ ...x, [k]: v }));

  // BR-02: Quy định chỉ đăng ký ở cấp VCPV.
  useEffect(() => {
    if (f.type === 'QD' && f.level !== 'VCPV') setF((x) => ({ ...x, level: 'VCPV' }));
  }, [f.type, f.level]);

  const [debouncedTitle, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(f.title.trim()), 400);
    return () => clearTimeout(t);
  }, [f.title]);
  const similar = useQuery({
    queryKey: ['documents', 'similar', debouncedTitle],
    enabled: debouncedTitle.length >= 4,
    queryFn: () => unwrap(api.GET('/documents/similar', { params: { query: { title: debouncedTitle } } })).then((r) => r.items),
  });

  const errors = validateDocumentRegistration(f);
  const save = useAction(
    (_: void, key: string) =>
      unwrap(
        api.POST('/documents', {
          body: {
            type: f.type as DocumentType,
            level: f.level as DocumentLevel,
            title: f.title.trim(),
            departmentId: f.departmentId,
            drafterId: f.drafterId,
            checkerId: f.checkerId || undefined,
            dueDate: f.dueDate || undefined,
          },
          ...idem(key),
        }),
      ),
    {
      invalidate: [['documents']],
      onSuccess: (d) => {
        toast.success('Đã đăng ký tài liệu. Chờ Kiểm soát tài liệu cấp mã.');
        router.push(`/tai-lieu/${d.id}`);
      },
    },
  );

  return (
    <>
      <PageHeader title="Đăng ký tài liệu" subtitle="Đăng ký để được cấp mã và giao người soạn." back={{ href: '/tai-lieu', label: 'Tài liệu' }} />
      <Card>
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (Object.keys(errors).length === 0) save.mutate();
          }}
        >
          <div className="form-row">
            <SelectField label="Loại tài liệu" value={f.type} onChange={set('type')} required error={touched ? errors.type : undefined} options={TYPES.map((t) => ({ value: t, label: docTypeLabel[t] }))} />
            <SelectField
              label="Cấp"
              value={f.level}
              onChange={set('level')}
              required
              error={touched ? errors.level : undefined}
              hint={f.type === 'QD' ? 'Quy định chỉ ban hành ở cấp công ty.' : 'Liên quan từ 2 phòng trở lên thì chọn cấp công ty.'}
              options={(['VCPV', 'DEPT'] as DocumentLevel[]).map((l) => ({ value: l, label: docLevelLabel[l], disabled: f.type === 'QD' && l === 'DEPT' }))}
            />
          </div>
          <TextField label="Tên tài liệu" value={f.title} onChange={set('title')} required error={touched ? errors.title : undefined} />
          {similar.data && similar.data.length > 0 && (
            <Notice tone="warn">
              <div>
                <strong>Đã có tài liệu tên gần giống – kiểm tra để tránh soạn trùng:</strong>
                <ul>
                  {similar.data.map((d) => (
                    <li key={d.id}>
                      <Link href={`/tai-lieu/${d.id}`} target="_blank">
                        {d.code ?? 'Chưa cấp mã'} – {d.title}
                      </Link>{' '}
                      <Badge status={d.status}>{docStatusLabel[d.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </Notice>
          )}
          <DeptSelect label="Phòng soạn" value={f.departmentId} onChange={set('departmentId')} required />
          {touched && errors.departmentId && <p className="field-error">{errors.departmentId}</p>}
          <UserPicker label="Người soạn" value={f.drafterId} onChange={set('drafterId')} required />
          {touched && errors.drafterId && <p className="field-error">{errors.drafterId}</p>}
          <UserPicker label="Người kiểm tra" value={f.checkerId} onChange={set('checkerId')} hint="Không bắt buộc" />
          <TextField label="Hạn soạn" type="date" value={f.dueDate} onChange={set('dueDate')} />
          <ErrorBox error={save.error} />
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Đăng ký
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
