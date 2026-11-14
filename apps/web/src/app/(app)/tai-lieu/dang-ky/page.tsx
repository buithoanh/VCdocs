'use client';

import { useQuery } from '@tanstack/react-query';
import { Col, DatePicker, Form, Input, Row, Select } from 'antd';
import type { Dayjs } from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { DocumentLevel, DocumentType } from '@/api/types';
import { toISODate } from '@/components/dates';
import { DeptSelectInput, UserSelectInput } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, ErrorBox, Notice, PageHeader } from '@/components/ui';
import { docLevelLabel, docStatusLabel, docTypeLabel } from '@/lib/labels';
import { validateDocumentRegistration, type DocumentRegistration } from './validate';

const TYPES: DocumentType[] = ['QD', 'QT', 'HD', 'BM'];
const LEVELS: DocumentLevel[] = ['VCPV', 'DEPT'];

/** Giá trị trong antd Form: ô chọn để undefined khi trống (hiện placeholder), hạn soạn là dayjs. */
type FormValues = {
  type?: DocumentType;
  level?: DocumentLevel;
  title: string;
  departmentId?: string;
  drafterId?: string;
  checkerId?: string;
  dueDate: Dayjs | null;
};

function toRegistration(v: Partial<FormValues>): DocumentRegistration {
  return {
    type: v.type ?? '',
    level: v.level ?? '',
    title: v.title ?? '',
    departmentId: v.departmentId ?? '',
    drafterId: v.drafterId ?? '',
    checkerId: v.checkerId ?? '',
    dueDate: toISODate(v.dueDate),
  };
}

export default function RegisterDocumentPage() {
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [form] = Form.useForm<FormValues>();
  const type = Form.useWatch('type', form);
  const title = Form.useWatch('title', form) ?? '';

  const [debouncedTitle, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(title.trim()), 400);
    return () => clearTimeout(t);
  }, [title]);
  const similar = useQuery({
    queryKey: ['documents', 'similar', debouncedTitle],
    enabled: debouncedTitle.length >= 4,
    queryFn: () => unwrap(api.GET('/documents/similar', { params: { query: { title: debouncedTitle } } })).then((r) => r.items),
  });

  /** Mỗi ô kiểm bằng validateDocumentRegistration để quy tắc (BR-02…) và thông điệp chỉ có một nơi. */
  const ruleFor = (key: keyof DocumentRegistration) => ({
    validator: () => {
      const err = validateDocumentRegistration(toRegistration(form.getFieldsValue(true)))[key];
      return err ? Promise.reject(new Error(err)) : Promise.resolve();
    },
  });

  const save = useAction(
    (f: DocumentRegistration, key: string) =>
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
        <Form<FormValues>
          form={form}
          layout="vertical"
          style={{ maxWidth: 640 }}
          initialValues={{ title: '', departmentId: me.departmentId || undefined, dueDate: null }}
          onValuesChange={(changed, all) => {
            // BR-02: Quy định chỉ đăng ký ở cấp VCPV.
            if (changed.type === 'QD' && all.level !== 'VCPV') form.setFieldValue('level', 'VCPV');
          }}
          onFinish={(v) => save.mutate(toRegistration(v))}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="type" label="Loại tài liệu" required rules={[ruleFor('type')]}>
                <Select placeholder="— Chọn —" options={TYPES.map((t) => ({ value: t, label: docTypeLabel[t] }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="level"
                label="Cấp"
                required
                rules={[ruleFor('level')]}
                extra={type === 'QD' ? 'Quy định chỉ ban hành ở cấp công ty.' : 'Liên quan từ 2 phòng trở lên thì chọn cấp công ty.'}
              >
                <Select placeholder="— Chọn —" options={LEVELS.map((l) => ({ value: l, label: docLevelLabel[l], disabled: type === 'QD' && l === 'DEPT' }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="Tên tài liệu" required rules={[ruleFor('title')]}>
            <Input maxLength={200} />
          </Form.Item>
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
          <Form.Item name="departmentId" label="Phòng soạn" required rules={[ruleFor('departmentId')]}>
            <DeptSelectInput required />
          </Form.Item>
          <Form.Item name="drafterId" label="Người soạn" required rules={[ruleFor('drafterId')]}>
            <UserSelectInput required />
          </Form.Item>
          <Form.Item name="checkerId" label="Người kiểm tra" extra="Không bắt buộc" rules={[ruleFor('checkerId')]}>
            <UserSelectInput />
          </Form.Item>
          <Form.Item name="dueDate" label="Hạn soạn">
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <ErrorBox error={save.error} />
          <Button type="submit" variant="primary" loading={save.isPending}>
            Đăng ký
          </Button>
        </Form>
      </Card>
    </>
  );
}
