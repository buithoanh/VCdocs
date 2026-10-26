'use client';

import { Col, DatePicker, Form, Input, Row } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import { toISODate } from '@/components/dates';
import { JobProgress } from '@/components/jobs';
import { DeptSelectInput } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, Card, ErrorBox, PageHeader } from '@/components/ui';
import { parseDriveFileId } from '@/lib/drive';

type FormValues = { source: string; number: string; issuedAt: Dayjs | null; title: string; departmentId?: string; link: string };

const isUrl = (s: string) => /^https?:\/\//.test(s.trim());

export default function ExternalDocumentPage() {
  const { me } = useAuth();
  const [form] = Form.useForm<FormValues>();
  const link = Form.useWatch('link', form) ?? '';
  const fileId = parseDriveFileId(link);
  const [jobId, setJobId] = useState<string | null>(null);
  const save = useAction(
    (v: FormValues, key: string) => {
      const id = parseDriveFileId(v.link);
      return unwrap(
        api.POST('/external-documents', {
          body: {
            source: v.source.trim(),
            number: v.number.trim(),
            issuedAt: toISODate(v.issuedAt),
            title: v.title.trim(),
            departmentId: v.departmentId ?? '',
            ...(id ? { fileId: id } : { url: v.link.trim() }),
          },
          ...idem(key),
        }),
      );
    },
    { onSuccess: (r) => setJobId(r.jobId) },
  );
  return (
    <>
      <PageHeader
        title="Nhập tài liệu bên ngoài"
        subtitle="Luật, nghị định, tài liệu hãng… Không cấp mã nội bộ; bản sao lưu vào 00 Tài liệu."
        back={{ href: '/tai-lieu', label: 'Tài liệu' }}
      />
      <Card>
        {jobId ? (
          <JobProgress jobId={jobId} />
        ) : (
          <Form<FormValues>
            form={form}
            layout="vertical"
            style={{ maxWidth: 640 }}
            initialValues={{ source: '', number: '', issuedAt: null, title: '', departmentId: me.departmentId || undefined, link: '' }}
            onFinish={(v) => save.mutate(v)}
          >
            <Form.Item name="source" label="Cơ quan ban hành" rules={[{ required: true, whitespace: true, message: 'Nhập cơ quan ban hành.' }]}>
              <Input placeholder="Quốc hội, Bộ Tài chính, Toyota…" />
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item name="number" label="Số hiệu văn bản" rules={[{ required: true, whitespace: true, message: 'Nhập số hiệu văn bản.' }]}>
                  <Input placeholder="91/2025/QH15" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="issuedAt" label="Ngày ban hành" rules={[{ required: true, message: 'Chọn ngày ban hành.' }]}>
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="title" label="Tên văn bản" rules={[{ required: true, whitespace: true, message: 'Nhập tên văn bản.' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="departmentId" label="Phòng áp dụng" rules={[{ required: true, message: 'Chọn phòng áp dụng.' }]}>
              <DeptSelectInput required />
            </Form.Item>
            <Form.Item
              name="link"
              label="File trên Drive hoặc đường dẫn gốc"
              required
              extra={fileId ? 'Đã nhận ra file trên Google Drive.' : 'Dán link file Google Drive, hoặc link trang web của văn bản.'}
              rules={[
                {
                  validator: (_, v: string) =>
                    parseDriveFileId(v ?? '') || isUrl(v ?? '') ? Promise.resolve() : Promise.reject(new Error('Dán link file Google Drive hoặc link trang web của văn bản.')),
                },
              ]}
            >
              <Input placeholder="https://drive.google.com/… hoặc https://…" />
            </Form.Item>
            <ErrorBox error={save.error} />
            <Button type="submit" variant="primary" loading={save.isPending}>
              Nhập tài liệu
            </Button>
          </Form>
        )}
      </Card>
    </>
  );
}
