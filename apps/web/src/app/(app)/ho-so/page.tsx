'use client';

import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, Col, Form, Input, Row, Select } from 'antd';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { recordTypeName, useRecordTypes } from '@/api/queries';
import type { RecordKind, RecordStatus } from '@/api/types';
import { DataTable } from '@/components/DataTable';
import { MonthPicker } from '@/components/dates';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, LinkButton, PageHeader, QueryState } from '@/components/ui';
import { formatDate, formatMonth } from '@/lib/format';
import { recordKindLabel, recordStatusLabel } from '@/lib/labels';

const LIMIT = 50;
const KIND_OPTIONS = (Object.keys(recordKindLabel) as RecordKind[]).map((k) => ({ value: k, label: recordKindLabel[k] }));
const STATUS_OPTIONS = (Object.keys(recordStatusLabel) as RecordStatus[]).map((s) => ({ value: s, label: recordStatusLabel[s] }));
/** Ô chọn đứng hai cột cả trên điện thoại; ô gõ chữ chiếm trọn hàng. */
const COL = { xs: 12, sm: 12, lg: 8, xl: 6 };
const COL_WIDE = { xs: 24, sm: 12, lg: 8, xl: 6 };

export default function RecordsPage() {
  const { can, me } = useAuth();
  const types = useRecordTypes();
  const [q, setQ] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [recordTypeId, setType] = useState('');
  const [departmentId, setDept] = useState('');
  const [workMonth, setMonth] = useState('');
  const [status, setStatus] = useState<RecordStatus | ''>('');
  const [kind, setKind] = useState<RecordKind | ''>('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['records', { q, identifier, recordTypeId, departmentId, workMonth, status, kind, mine, page }],
    queryFn: () =>
      unwrap(
        api.GET('/records', {
          params: {
            query: {
              q: q || undefined,
              identifier: identifier || undefined,
              recordTypeId: recordTypeId || undefined,
              departmentId: departmentId || undefined,
              workMonth: workMonth || undefined,
              status: status || undefined,
              kind: kind || undefined,
              createdBy: mine ? me.user.id : undefined,
              page,
              limit: LIMIT,
              sort: '-createdAt',
            },
          },
        }),
      ),
    placeholderData: (prev) => prev,
  });
  /** Đổi bộ lọc thì về trang 1. */
  const filter =
    <V,>(set: (v: V) => void) =>
    (v: V) => {
      set(v);
      setPage(1);
    };

  return (
    <>
      <PageHeader
        title="Hồ sơ"
        subtitle="Bằng chứng việc đã làm; chốt xong thì không sửa được."
        actions={
          <>
            {can('createRecord') && (
              <LinkButton href="/ho-so/moi" variant="primary">
                Lập hồ sơ
              </LinkButton>
            )}
            {can('viewUnregistered') && <LinkButton href="/ho-so/chua-dang-ky">File chưa đăng ký</LinkButton>}
          </>
        }
      />
      <Form layout="vertical" component={false} className="vc-filters">
        <Row gutter={[12, 0]}>
          <Col {...COL_WIDE}>
            <Form.Item label="Tìm" htmlFor="tim-hs">
              <Input id="tim-hs" allowClear prefix={<SearchOutlined />} placeholder="Số hồ sơ hoặc nội dung" value={q} onChange={(e) => filter(setQ)(e.target.value)} />
            </Form.Item>
          </Col>
          <Col {...COL_WIDE}>
            <Form.Item label="Số định danh" htmlFor="dinh-danh-hs">
              <Input id="dinh-danh-hs" allowClear placeholder="Biển số, PO…" value={identifier} onChange={(e) => filter(setIdentifier)(e.target.value)} />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <Form.Item label="Loại hồ sơ" htmlFor="loai-hs">
              <Select
                id="loai-hs"
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Tất cả"
                loading={types.isLoading}
                value={recordTypeId || undefined}
                onChange={(v) => filter(setType)(v ?? '')}
                options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
              />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <Form.Item label="Loại" htmlFor="kind-hs">
              <Select id="kind-hs" allowClear placeholder="Tất cả" value={kind || undefined} onChange={(v) => filter(setKind)(v ?? '')} options={KIND_OPTIONS} />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <DeptSelect value={departmentId} onChange={filter(setDept)} allowAll />
          </Col>
          <Col {...COL}>
            <Form.Item label="Tháng công việc" htmlFor="thang-hs">
              <MonthPicker id="thang-hs" value={workMonth} onChange={filter(setMonth)} allowClear placeholder="Tất cả" />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <Form.Item label="Trạng thái" htmlFor="trang-thai-hs">
              <Select id="trang-thai-hs" allowClear placeholder="Tất cả" value={status || undefined} onChange={(v) => filter(setStatus)(v ?? '')} options={STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          <Col {...COL_WIDE}>
            <Form.Item label=" " colon={false}>
              <Checkbox checked={mine} onChange={(e) => filter(setMine)(e.target.checked)}>
                Chỉ hồ sơ tôi lập
              </Checkbox>
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/ho-so/${r.id}`}
          empty="Không có hồ sơ phù hợp."
          pagination={list.data ? { page, limit: LIMIT, total: list.data.total, onPage: setPage } : undefined}
          columns={[
            { key: 'num', header: 'Số hồ sơ', render: (r) => <span className="mono nowrap">{r.number}</span> },
            { key: 'name', header: 'Tên', render: (r) => <strong>{r.fileName ?? r.subject}</strong> },
            { key: 'type', header: 'Loại hồ sơ', render: (r) => recordTypeName(types.data, r.recordTypeId), hideOnMobile: true },
            { key: 'dept', header: 'Phòng', render: (r) => <DeptName id={r.departmentId} />, hideOnMobile: true },
            { key: 'month', header: 'Tháng', render: (r) => formatMonth(r.workMonth) },
            { key: 'date', header: 'Ngày lập', render: (r) => formatDate(r.createdDate), hideOnMobile: true },
            {
              key: 'status',
              header: 'Trạng thái',
              render: (r) => (
                <>
                  <Badge status={r.status}>{recordStatusLabel[r.status]}</Badge>
                  {r.status === 'drafting' && r.isApproved && <> <Badge status="approved">Đã duyệt, chờ chốt</Badge></>}
                </>
              ),
            },
          ]}
        />
      </QueryState>
    </>
  );
}
