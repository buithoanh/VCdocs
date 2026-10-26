'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, Flex, Form, Row, Select, Space, Typography } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { Approval, ApprovalObjectType, ApprovalStatus } from '@/api/types';
import { DecideDialog, type DecideKind } from '@/components/approvals/approvalUi';
import { Pagination } from '@/components/DataTable';
import { UserName } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, LinkButton, PageHeader, QueryState, Tabs } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { approvalObjectLabel, approvalStatusLabel } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';

type Box = 'inbox' | 'sent' | 'all';
const LIMIT = 20;
const STATUS_OPTIONS = (Object.keys(approvalStatusLabel) as ApprovalStatus[]).map((s) => ({ value: s, label: approvalStatusLabel[s] }));
const TYPE_OPTIONS = (Object.keys(approvalObjectLabel) as ApprovalObjectType[]).map((s) => ({ value: s, label: approvalObjectLabel[s] }));
const COL = { xs: 12, sm: 12, lg: 8, xl: 6 };

export default function ApprovalsPage() {
  const [box, setBox] = useState<Box>('inbox');
  const [status, setStatus] = useState<ApprovalStatus | ''>('pending');
  const [objectType, setType] = useState<ApprovalObjectType | ''>('');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ a: Approval; kind: DecideKind } | null>(null);
  const toast = useToast();
  const q = useQuery({
    queryKey: ['approvals', { box, status, objectType, page }],
    queryFn: () =>
      unwrap(api.GET('/approvals', { params: { query: { box, status: status || undefined, objectType: objectType || undefined, page, limit: LIMIT, sort: '-submittedAt' } } })),
    placeholderData: (prev) => prev,
  });
  /** Đổi hộp hoặc bộ lọc thì về trang 1. */
  const filter =
    <V,>(set: (v: V) => void) =>
    (v: V) => {
      set(v);
      setPage(1);
    };
  const emptyText = box === 'inbox' && status === 'pending' ? 'Không có phiếu nào chờ bạn duyệt.' : 'Không có phiếu phù hợp.';

  return (
    <>
      <PageHeader title="Phê duyệt" subtitle="Phiếu trình duyệt thay luồng email BM-VCPV-05" />
      <Tabs
        value={box}
        onChange={filter(setBox)}
        tabs={[
          { value: 'inbox', label: 'Chờ tôi duyệt' },
          { value: 'sent', label: 'Tôi đã trình' },
          { value: 'all', label: 'Tất cả' },
        ]}
      />
      <Form layout="vertical" component={false} className="vc-filters">
        <Row gutter={[12, 0]}>
          <Col {...COL}>
            <Form.Item label="Trạng thái" htmlFor="trang-thai-pd">
              <Select id="trang-thai-pd" allowClear placeholder="Tất cả" value={status || undefined} onChange={(v) => filter(setStatus)(v ?? '')} options={STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          <Col {...COL}>
            <Form.Item label="Loại việc" htmlFor="loai-viec-pd">
              <Select id="loai-viec-pd" allowClear placeholder="Tất cả" value={objectType || undefined} onChange={(v) => filter(setType)(v ?? '')} options={TYPE_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <QueryState q={q}>
        {q.data && q.data.items.length === 0 && <Empty className="vc-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />}
        <Flex vertical gap={12}>
          {q.data?.items.map((a) => (
            <Card key={a.id} size="small">
              <Flex justify="space-between" align="flex-start" gap={12}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link href={`/phe-duyet/${a.id}`}>
                    <strong>{a.objectTitle ?? 'Không có tên'}</strong>
                  </Link>
                  <div>
                    <Typography.Text type="secondary">
                      {approvalObjectLabel[a.objectType]} · Người trình: <UserName id={a.submittedBy} /> · {formatDateTime(a.submittedAt)}
                      {a.dueAt && <> · Hạn {formatDateTime(a.dueAt)}</>}
                    </Typography.Text>
                  </div>
                </div>
                <Badge status={a.status}>{approvalStatusLabel[a.status]}</Badge>
              </Flex>
              <Space wrap style={{ marginTop: 12 }}>
                {a.snapshot?.viewUrl && <LinkButton href={a.snapshot.viewUrl}>Xem file</LinkButton>}
                {hasAction(a, 'check') && (
                  <Button variant="primary" onClick={() => setDeciding({ a, kind: 'check' })}>
                    Xác nhận kiểm tra
                  </Button>
                )}
                {hasAction(a, 'decide') && (
                  <>
                    <Button variant="success" onClick={() => setDeciding({ a, kind: 'approve' })}>
                      Đồng ý
                    </Button>
                    <Button variant="danger" onClick={() => setDeciding({ a, kind: 'changes_requested' })}>
                      Yêu cầu sửa
                    </Button>
                  </>
                )}
                {!hasAction(a, 'decide') && (
                  <LinkButton href={`/phe-duyet/${a.id}`} variant="ghost">
                    Chi tiết
                  </LinkButton>
                )}
              </Space>
            </Card>
          ))}
        </Flex>
        {q.data && <Pagination page={page} limit={LIMIT} total={q.data.total} onPage={setPage} />}
      </QueryState>
      {deciding && (
        <DecideDialog
          approval={deciding.a}
          kind={deciding.kind}
          onClose={() => setDeciding(null)}
          onDone={() => toast.success(deciding.kind === 'approve' ? 'Đã đồng ý.' : deciding.kind === 'check' ? 'Đã xác nhận kiểm tra.' : 'Đã gửi yêu cầu sửa.')}
        />
      )}
    </>
  );
}
