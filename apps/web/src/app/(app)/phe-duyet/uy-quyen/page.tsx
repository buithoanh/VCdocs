'use client';

import { useQuery } from '@tanstack/react-query';
import { Checkbox, Col, DatePicker, Form, Input, InputNumber, Row, Select } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { recordTypeName, useAction, useBlocks, useRecordTypes } from '@/api/queries';
import type { Delegation } from '@/api/types';
import { DataTable } from '@/components/DataTable';
import { toDayjs, toISODate } from '@/components/dates';
import { UserName, UserSelectInput } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, ErrorBox, Modal, Notice, PageHeader, QueryState } from '@/components/ui';
import { formatDate, formatNumber, todayISO } from '@/lib/format';
import { hasAction } from '@/lib/permissions';

export default function DelegationsPage() {
  const { me } = useAuth();
  const blocks = useBlocks();
  const types = useRecordTypes();
  const [blockId, setBlock] = useState('');
  const [edit, setEdit] = useState<Partial<Delegation> | null>(null);
  useEffect(() => {
    if (blockId || !blocks.data?.length) return;
    setBlock(me.blockId ?? (blocks.data.find((b) => b.directorId === me.user.id) ?? blocks.data[0]).id);
  }, [blocks.data, blockId, me.blockId, me.user.id]);
  const q = useQuery({
    queryKey: ['delegations', blockId],
    enabled: !!blockId,
    queryFn: () => unwrap(api.GET('/delegations', { params: { query: { blockId } } })).then((r) => r.items),
  });
  const today = todayISO();
  return (
    <>
      <PageHeader
        title="Uỷ quyền phê duyệt"
        subtitle="Bảng uỷ quyền của khối: phần mềm dùng để giao duyệt hồ sơ nghiệp vụ đúng người (QĐ-VCPV-03)."
        actions={
          <Button variant="primary" disabled={!blockId} onClick={() => setEdit({ blockId })}>
            Thêm dòng uỷ quyền
          </Button>
        }
      />
      <Form layout="vertical" component={false} className="vc-filters">
        <Row gutter={[12, 0]}>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label="Khối" htmlFor="khoi-uq">
              <Select id="khoi-uq" value={blockId || undefined} onChange={setBlock} loading={blocks.isLoading} options={(blocks.data ?? []).map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(d) => d.id}
          empty="Khối chưa có dòng uỷ quyền nào."
          columns={[
            {
              key: 'type',
              header: 'Loại hồ sơ được duyệt',
              render: (d) => (
                <>
                  {recordTypeName(types.data, d.recordTypeId)}
                  {d.task && <div className="muted small">{d.task}</div>}
                </>
              ),
            },
            { key: 'legal', header: 'Việc luật yêu cầu chữ ký', render: (d) => (d.isLegalSignature ? 'Có' : '—'), hideOnMobile: true },
            { key: 'limit', header: 'Hạn mức (đồng)', render: (d) => formatNumber(d.limitAmount), className: 'num' },
            { key: 'who', header: 'Người được uỷ quyền', render: (d) => <UserName id={d.delegateId} /> },
            { key: 'from', header: 'Từ ngày', render: (d) => formatDate(d.from) },
            { key: 'to', header: 'Đến ngày', render: (d) => (d.to ? formatDate(d.to) : 'Không thời hạn') },
            { key: 'state', header: 'Tình trạng', render: (d) => (d.from > today ? 'Chưa tới ngày' : d.to && d.to < today ? 'Hết hạn' : 'Đang hiệu lực'), hideOnMobile: true },
            {
              key: 'edit',
              header: '',
              render: (d) =>
                hasAction(d, 'update') && (
                  <Button variant="ghost" size="small" onClick={() => setEdit(d)}>
                    Sửa
                  </Button>
                ),
            },
          ]}
        />
      </QueryState>
      {edit && <DelegationForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

/** Giá trị trong antd Form: ngày là dayjs, hạn mức là số (undefined = không giới hạn). */
type FormValues = { recordTypeId?: string; task: string; isLegalSignature: boolean; limitAmount?: number | null; delegateId?: string; from: Dayjs | null; to: Dayjs | null };

const group = (v: string | number | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function DelegationForm({ initial, onClose }: { initial: Partial<Delegation>; onClose: () => void }) {
  const toast = useToast();
  const types = useRecordTypes();
  const [form] = Form.useForm<FormValues>();
  const isLegalSignature = Form.useWatch('isLegalSignature', form) ?? false;
  const save = useAction(
    (v: FormValues, key: string) => {
      const body = {
        blockId: initial.blockId!,
        recordTypeId: v.recordTypeId ?? '',
        task: v.task?.trim() || undefined,
        isLegalSignature: !!v.isLegalSignature,
        limitAmount: v.limitAmount ?? undefined,
        delegateId: v.delegateId ?? '',
        from: toISODate(v.from),
        to: toISODate(v.to) || undefined,
      };
      return initial.id
        ? unwrap(api.PATCH('/delegations/{id}', { params: { path: { id: initial.id } }, body }))
        : unwrap(api.POST('/delegations', { body, ...idem(key) }));
    },
    {
      invalidate: [['delegations']],
      onSuccess: () => {
        toast.success('Đã lưu dòng uỷ quyền.');
        onClose();
      },
    },
  );
  return (
    <Modal
      open
      title={initial.id ? 'Sửa dòng uỷ quyền' : 'Thêm dòng uỷ quyền'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={isLegalSignature} loading={save.isPending} onClick={() => form.submit()}>
            Lưu
          </Button>
        </>
      }
    >
      <Notice>Hạn mức vượt mức tối đa của giám đốc khối, hoặc việc liên khối, việc luật yêu cầu người có thẩm quyền ký sẽ không lưu được.</Notice>
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{
          recordTypeId: initial.recordTypeId || undefined,
          task: initial.task ?? '',
          isLegalSignature: initial.isLegalSignature ?? false,
          limitAmount: initial.limitAmount ?? undefined,
          delegateId: initial.delegateId || undefined,
          from: toDayjs(initial.from ?? todayISO()),
          to: toDayjs(initial.to),
        }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="recordTypeId" label="Loại hồ sơ được uỷ quyền duyệt" rules={[{ required: true, message: 'Chọn loại hồ sơ.' }]}>
          <Select showSearch optionFilterProp="label" loading={types.isLoading} placeholder={types.isLoading ? 'Đang tải…' : '— Chọn loại hồ sơ —'} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
        </Form.Item>
        <Form.Item name="task" label="Mô tả việc">
          <Input placeholder="Đề xuất mua hàng dưới hạn mức" />
        </Form.Item>
        <Form.Item name="isLegalSignature" valuePropName="checked" style={{ marginBottom: 8 }}>
          <Checkbox>Việc luật yêu cầu chữ ký người đại diện</Checkbox>
        </Form.Item>
        {isLegalSignature && <Notice tone="warn">Việc luật yêu cầu chữ ký người đại diện không được uỷ quyền xuống (BR-24).</Notice>}
        <Form.Item name="limitAmount" label="Hạn mức (đồng)" extra="Để trống nếu không giới hạn số tiền">
          <InputNumber min={0} step={1_000_000} style={{ width: '100%' }} formatter={group} parser={(v) => Number((v ?? '').replace(/\./g, ''))} />
        </Form.Item>
        <Form.Item name="delegateId" label="Người được uỷ quyền" rules={[{ required: true, message: 'Chọn người được uỷ quyền.' }]}>
          <UserSelectInput required />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item name="from" label="Từ ngày" rules={[{ required: true, message: 'Chọn ngày bắt đầu.' }]}>
              <DatePicker format="DD/MM/YYYY" allowClear={false} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="to"
              label="Đến ngày"
              dependencies={['from']}
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_, to: Dayjs | null) => {
                    const from = getFieldValue('from') as Dayjs | null;
                    return to && from && to.isBefore(from, 'day') ? Promise.reject(new Error('Đến ngày phải sau Từ ngày.')) : Promise.resolve();
                  },
                }),
              ]}
            >
              <DatePicker format="DD/MM/YYYY" placeholder="Không thời hạn" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
