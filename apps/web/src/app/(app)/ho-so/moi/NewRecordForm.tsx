'use client';

import { UploadOutlined } from '@ant-design/icons';
import { DatePicker, Form, Input, Radio, Select, Space, Steps, Upload, type UploadFile } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, getLimits, idem, unwrap } from '@/api/client';
import { deptName, useAction, useApprovedCodes, useDepartments, useRecordTypes } from '@/api/queries';
import type { Job } from '@/api/types';
import { toDayjs, toISODate, toISOMonth } from '@/components/dates';
import { JobProgress } from '@/components/jobs';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, Card, ErrorBox, Notice, PageHeader } from '@/components/ui';
import { currentMonth } from '@/lib/format';
import { recordKindLabel } from '@/lib/labels';
import { canUseRecordType, emptyRecordForm, isBackdated, previewRecordName, toFormData, toRecordInput, validateRecordForm, type RecordFormValues } from '@/lib/records';

const EXCLUDED_CODE_TYPES = new Set(['department', 'division']);

/** Giá trị trong antd Form: ngày / tháng là dayjs, file là danh sách của Upload. */
type FormValues = Omit<RecordFormValues, 'recordTypeId' | 'functionCode' | 'workMonth' | 'createdDate' | 'file'> & {
  /** undefined (không phải '') để antd Select hiện placeholder. */
  recordTypeId?: string;
  functionCode?: string;
  workMonth: Dayjs | null;
  createdDate: Dayjs | null;
  file?: UploadFile[];
};

/** Đưa về dạng chuỗi mà lib/records (kiểm tra, gửi API) đang dùng. */
function toRecordValues(v: Partial<FormValues>): RecordFormValues {
  return {
    recordTypeId: v.recordTypeId ?? '',
    functionCode: v.functionCode ?? '',
    workMonth: toISOMonth(v.workMonth),
    subject: v.subject ?? '',
    identifier: v.identifier ?? '',
    createdDate: toISODate(v.createdDate),
    backdateReason: v.backdateReason ?? '',
    source: v.source ?? 'template',
    file: (v.file?.[0]?.originFileObj as File | undefined) ?? null,
  };
}

function initialValues(workMonth: string, recordTypeId: string, functionCode = ''): FormValues {
  const e = emptyRecordForm(workMonth);
  return { ...e, recordTypeId: recordTypeId || undefined, functionCode: functionCode || undefined, workMonth: toDayjs(e.workMonth), createdDate: toDayjs(e.createdDate), file: [] };
}

const STEPS = [{ title: 'Loại và tháng' }, { title: 'Nội dung' }, { title: 'Lập' }];

/** Lập hồ sơ: 1 màn hình, 3 phần, 1 nút (BA 9.3: tối đa 3 bước). */
export function NewRecordForm() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const types = useRecordTypes();
  const depts = useDepartments();
  const [form] = Form.useForm<FormValues>();
  const [initial, setInitial] = useState(() => initialValues(currentMonth(), params.get('loai') ?? ''));
  const [submitted, setSubmitted] = useState<RecordFormValues | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const recordTypeId = Form.useWatch('recordTypeId', form);
  const functionCode = Form.useWatch('functionCode', form) ?? '';
  const subject = Form.useWatch('subject', form) ?? '';
  const identifier = Form.useWatch('identifier', form) ?? '';
  const createdDate = toISODate(Form.useWatch('createdDate', form));
  const source = Form.useWatch('source', form);

  const sortedTypes = useMemo(
    () => [...(types.data ?? [])].sort((a, b) => Number(b.departmentId === me.departmentId) - Number(a.departmentId === me.departmentId) || a.name.localeCompare(b.name, 'vi')),
    [types.data, me.departmentId],
  );
  const type = types.data?.find((t) => t.id === recordTypeId);
  const codes = useApprovedCodes(type?.departmentId);
  const codeOptions = (codes.data ?? []).filter((c) => !EXCLUDED_CODE_TYPES.has(c.type));
  const step = !type || !functionCode ? 0 : !subject.trim() ? 1 : 2;
  const preview = previewRecordName(functionCode, type?.kind, subject, identifier, createdDate);

  /**
   * Mỗi ô kiểm bằng validateRecordForm (lib/records) để quy tắc và thông điệp chỉ có một nơi.
   * Đọc loại hồ sơ từ giá trị form lúc kiểm (không dùng `type` của lần render trước) vì antd
   * chạy validator ngay trong onChange, trước khi component render lại.
   */
  const ruleFor = (key: keyof RecordFormValues) => ({
    validator: () => {
      const values = toRecordValues(form.getFieldsValue(true));
      const err = validateRecordForm(values, types.data?.find((t) => t.id === values.recordTypeId))[key];
      return err ? Promise.reject(new Error(err)) : Promise.resolve();
    },
  });

  const create = useAction(
    (v: RecordFormValues, key: string) => {
      const input = toRecordInput(v, type!.kind);
      if (v.source === 'upload' && v.file) {
        const fd = toFormData(input, v.file);
        return unwrap(api.POST('/records/upload', { body: fd as never, bodySerializer: (b: unknown) => b as FormData, ...idem(key) }));
      }
      return unwrap(api.POST('/records', { body: input, ...idem(key) }));
    },
    { onSuccess: (r) => setJobId(r.jobId) },
  );

  function onFinish(v: FormValues) {
    const values = toRecordValues(v);
    setSubmitted(values);
    create.mutate(values);
  }

  function onFinished(job: Job) {
    const r = job.result;
    if (job.status === 'done' && r && 'objectType' in r && r.objectType === 'record') router.push(`/ho-so/${r.objectId}`);
  }

  if (jobId && submitted) {
    // Form đã unmount nên `type` (theo useWatch) không còn; lấy loại theo giá trị đã gửi.
    const sentType = types.data?.find((t) => t.id === submitted.recordTypeId);
    return (
      <>
        <PageHeader title="Đang lập hồ sơ" back={{ href: '/ho-so', label: 'Hồ sơ' }} />
        <Card>
          <p>
            Tên dự kiến: <strong>{previewRecordName(submitted.functionCode, sentType?.kind, submitted.subject, submitted.identifier, submitted.createdDate)}</strong>
          </p>
          <JobProgress jobId={jobId} onFinished={onFinished} />
          <Button
            style={{ marginTop: 12 }}
            onClick={() => {
              // Form đã unmount; đặt initialValues mới rồi mới mở lại để giữ loại, mã và tháng vừa dùng.
              setInitial(initialValues(submitted.workMonth, submitted.recordTypeId, submitted.functionCode));
              setSubmitted(null);
              setJobId(null);
            }}
          >
            Lập hồ sơ khác
          </Button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Lập hồ sơ" back={{ href: '/ho-so', label: 'Hồ sơ' }} subtitle="Phần mềm tự đặt tên và đặt đúng thư mục năm / tháng." />
      <Steps size="small" current={step} items={STEPS} style={{ marginBottom: 16, maxWidth: 640 }} aria-label="Các bước" />
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={initial}
        style={{ maxWidth: 640 }}
        onFinish={onFinish}
        onValuesChange={(changed) => {
          if ('recordTypeId' in changed) form.setFieldValue('functionCode', undefined);
        }}
      >
        <Card title="1. Loại hồ sơ và tháng công việc">
          <Form.Item name="recordTypeId" label="Loại hồ sơ" required rules={[ruleFor('recordTypeId')]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={types.isLoading}
              placeholder={types.isLoading ? 'Đang tải…' : '— Chọn loại hồ sơ —'}
              options={sortedTypes.map((t) => ({
                value: t.id,
                label: `${t.name} (${recordKindLabel[t.kind]} · ${deptName(depts.data, t.departmentId)})${canUseRecordType(t) ? '' : ' – chưa duyệt thời hạn'}`,
                disabled: !canUseRecordType(t),
              }))}
            />
          </Form.Item>
          {types.error && <ErrorBox error={types.error} />}
          <Form.Item name="functionCode" label="Mã chức năng" required rules={[ruleFor('functionCode')]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!type}
              loading={codes.isLoading}
              placeholder={!type ? 'Chọn loại hồ sơ trước' : codes.isLoading ? 'Đang tải…' : '— Chọn mã —'}
              options={codeOptions.map((c) => ({ value: c.code, label: `${c.code} – ${c.meaning}` }))}
            />
          </Form.Item>
          <Form.Item name="workMonth" label="Tháng công việc" required rules={[ruleFor('workMonth')]}>
            <DatePicker picker="month" format="MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'month')} style={{ width: '100%' }} />
          </Form.Item>
        </Card>

        <Card title="2. Nội dung">
          <Form.Item name="subject" label="Nội dung ngắn" required rules={[ruleFor('subject')]}>
            <Input placeholder="Báo cáo tuần 42" maxLength={120} />
          </Form.Item>
          {type?.kind === 'OPS' && (
            <Form.Item name="identifier" label="Số định danh" required rules={[ruleFor('identifier')]}>
              <Input placeholder="Biển số, số PO, mã lớp…" />
            </Form.Item>
          )}
          <Form.Item name="createdDate" label="Ngày lập" required rules={[ruleFor('createdDate')]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} style={{ width: '100%' }} />
          </Form.Item>
          {isBackdated(createdDate) && (
            <Form.Item name="backdateReason" label="Lý do lập lùi ngày" required rules={[ruleFor('backdateReason')]} extra={`Lùi quá ${getLimits().backdateWorkingDays} ngày làm việc phải ghi lý do.`}>
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
          <Form.Item name="source" label="File hồ sơ">
            <Radio.Group>
              <Space orientation="vertical">
                <Radio value="template">{type?.templateId ? 'Tạo file Google từ biểu mẫu' : 'Tạo file Google trống'}</Radio>
                <Radio value="upload">Tải file lên (ảnh, PDF, XML hoá đơn, Word, Excel…)</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          {source === 'upload' && (
            <Form.Item
              name="file"
              label="Chọn file"
              required
              valuePropName="fileList"
              getValueFromEvent={(e: { fileList: UploadFile[] }) => e?.fileList}
              rules={[ruleFor('file')]}
              extra={`Tối đa ${getLimits().uploadMaxMb} MB. File Word, Excel, PowerPoint được đổi sang định dạng Google; hoá đơn, giấy tờ ký, scan giữ nguyên.`}
            >
              <Upload maxCount={1} beforeUpload={() => false}>
                <Button icon={<UploadOutlined />}>Chọn file từ máy</Button>
              </Upload>
            </Form.Item>
          )}
        </Card>

        <Card title="3. Lập hồ sơ">
          <p>
            Tên dự kiến: <strong className="mono">{preview}</strong>
          </p>
          {type?.requiresApproval && <Notice>Loại hồ sơ này cần trình duyệt trước khi chốt.</Notice>}
          <ErrorBox error={create.error} />
          <Button type="submit" variant="primary" size="large" loading={create.isPending}>
            Lập hồ sơ
          </Button>
        </Card>
      </Form>
    </>
  );
}
