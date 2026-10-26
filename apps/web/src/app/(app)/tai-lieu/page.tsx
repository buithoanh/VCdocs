'use client';

import { SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, Col, Form, Input, Row, Select } from 'antd';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { DocumentLevel, DocumentStatus, DocumentType } from '@/api/types';
import { DataTable } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, ErrorBox, LinkButton, PageHeader, QueryState } from '@/components/ui';
import { addDaysISO, formatDate } from '@/lib/format';
import { docLevelLabel, docStatusLabel, docTypeLabel } from '@/lib/labels';

const LIMIT = 50;
const TYPE_OPTIONS = (Object.keys(docTypeLabel) as DocumentType[]).map((t) => ({ value: t, label: docTypeLabel[t] }));
const LEVEL_OPTIONS = (Object.keys(docLevelLabel) as DocumentLevel[]).map((l) => ({ value: l, label: docLevelLabel[l] }));
const STATUS_OPTIONS = (Object.keys(docStatusLabel) as DocumentStatus[]).map((s) => ({ value: s, label: docStatusLabel[s] }));
/** Ô chọn đứng hai cột cả trên điện thoại; ô gõ chữ chiếm trọn hàng. */
const COL = { xs: 12, sm: 12, lg: 8, xl: 6 };
const COL_WIDE = { xs: 24, sm: 12, lg: 8, xl: 6 };

export default function DocumentsPage() {
  const { can } = useAuth();
  const jobs = useJobs();
  const [q, setQ] = useState('');
  const [type, setType] = useState<DocumentType | ''>('');
  const [level, setLevel] = useState<DocumentLevel | ''>('');
  const [departmentId, setDept] = useState('');
  const [status, setStatus] = useState<DocumentStatus | ''>('');
  const [reviewSoon, setReviewSoon] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['documents', { q, type, level, departmentId, status, reviewSoon, page }],
    queryFn: () =>
      unwrap(
        api.GET('/documents', {
          params: {
            query: {
              q: q || undefined,
              type: type || undefined,
              level: level || undefined,
              departmentId: departmentId || undefined,
              status: status || undefined,
              reviewDueBefore: reviewSoon ? addDaysISO(30) : undefined,
              page,
              limit: LIMIT,
              sort: 'code',
            },
          },
        }),
      ),
    placeholderData: (prev) => prev,
  });
  const exp = useAction(() => unwrap(api.POST('/documents/catalog/export')), {
    onSuccess: (r) => jobs.track({ jobId: r.jobId, label: 'Xuất Danh mục tài liệu VCPV' }),
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
        title="Tài liệu hệ thống"
        subtitle="Quy định, quy trình, hướng dẫn, biểu mẫu và tài liệu bên ngoài"
        actions={
          <>
            {can('registerDocument') && (
              <LinkButton href="/tai-lieu/dang-ky" variant="primary">
                Đăng ký tài liệu
              </LinkButton>
            )}
            {can('importExternalDocument') && <LinkButton href="/tai-lieu/ben-ngoai">Nhập tài liệu bên ngoài</LinkButton>}
            {can('exportDocumentCatalog') && (
              <Button onClick={() => exp.mutate()} loading={exp.isPending}>
                Xuất Danh mục
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={exp.error} />
      <Form layout="vertical" component={false} className="vc-filters">
        <Row gutter={[12, 0]}>
          <Col {...COL_WIDE}>
            <Form.Item label="Tìm" htmlFor="tim-tl">
              <Input id="tim-tl" allowClear prefix={<SearchOutlined />} placeholder="Mã hoặc tên" value={q} onChange={(e) => filter(setQ)(e.target.value)} />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <Form.Item label="Loại" htmlFor="loai-tl">
              <Select id="loai-tl" allowClear placeholder="Tất cả loại" value={type || undefined} onChange={(v) => filter(setType)(v ?? '')} options={TYPE_OPTIONS} />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <Form.Item label="Cấp" htmlFor="cap-tl">
              <Select id="cap-tl" allowClear placeholder="Tất cả cấp" value={level || undefined} onChange={(v) => filter(setLevel)(v ?? '')} options={LEVEL_OPTIONS} />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <DeptSelect value={departmentId} onChange={filter(setDept)} allowAll />
          </Col>
          <Col {...COL}>
            <Form.Item label="Trạng thái" htmlFor="trang-thai-tl">
              <Select id="trang-thai-tl" allowClear placeholder="Tất cả" value={status || undefined} onChange={(v) => filter(setStatus)(v ?? '')} options={STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          <Col {...COL_WIDE}>
            <Form.Item label=" " colon={false}>
              <Checkbox checked={reviewSoon} onChange={(e) => filter(setReviewSoon)(e.target.checked)}>
                Chỉ tài liệu đến kỳ rà soát trong 30 ngày tới
              </Checkbox>
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(d) => d.id}
          rowHref={(d) => (d.isRestricted ? undefined : `/tai-lieu/${d.id}`)}
          empty="Không có tài liệu phù hợp."
          pagination={list.data ? { page, limit: LIMIT, total: list.data.total, onPage: setPage } : undefined}
          columns={[
            { key: 'code', header: 'Mã', render: (d) => <strong className="mono">{d.code ?? 'Chưa cấp mã'}</strong> },
            {
              key: 'title',
              header: 'Tên tài liệu',
              render: (d) => (
                <>
                  {d.title} {d.isRestricted && <Badge status="failed">Mật</Badge>}
                </>
              ),
            },
            { key: 'type', header: 'Loại', render: (d) => docTypeLabel[d.type], hideOnMobile: true },
            { key: 'dept', header: 'Phòng', render: (d) => <DeptName id={d.departmentId} />, hideOnMobile: true },
            { key: 'ver', header: 'Phiên bản', render: (d) => (d.current?.number ? `v${d.current.number}` : '—'), hideOnMobile: true },
            { key: 'status', header: 'Trạng thái', render: (d) => (d.isRestricted ? '—' : <Badge status={d.status}>{docStatusLabel[d.status]}</Badge>) },
            { key: 'review', header: 'Kỳ rà soát', render: (d) => formatDate(d.reviewDue), hideOnMobile: true },
          ]}
        />
      </QueryState>
    </>
  );
}
