'use client';

import { useQuery } from '@tanstack/react-query';
import { Checkbox, Col, Empty, Form, Input, Row, Select, Space, Tree, Typography, type TreeDataNode } from 'antd';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction, useApprovedCodes, useDrives } from '@/api/queries';
import type { Folder, FolderKind } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { MonthField } from '@/components/dates';
import { useJobs } from '@/components/jobs';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, DefList, ErrorBox, LinkButton, Modal, PageHeader, QueryState } from '@/components/ui';
import { currentMonth } from '@/lib/format';
import { folderKindLabel, securityLabel } from '@/lib/labels';
import { allowedFolderKinds, previewFolderName } from '@/lib/folders';
import { hasAction } from '@/lib/permissions';

const folderStatusLabel = { active: 'Đang dùng', closed: 'Đã kết thúc', archived: 'Lưu trữ' } as const;

export function FolderBrowser() {
  const { can, me } = useAuth();
  const params = useSearchParams();
  const drives = useDrives();
  const [driveId, setDriveId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('folder'));
  const [creating, setCreating] = useState(false);
  const [periods, setPeriods] = useState(false);

  useEffect(() => {
    if (driveId || !drives.data?.length) return;
    const mine = drives.data.find((d) => d.departmentId === me.departmentId) ?? drives.data.find((d) => d.myRole) ?? drives.data[0];
    setDriveId(mine.driveId);
  }, [drives.data, driveId, me.departmentId]);

  const roots = useQuery({
    queryKey: ['folders', 'roots', driveId],
    enabled: !!driveId,
    // Không có parentId = thư mục cấp 1 của drive (D8).
    queryFn: () => unwrap(api.GET('/folders', { params: { query: { driveId, depth: 1 } } })).then((r) => r.items),
  });

  return (
    <>
      <PageHeader
        title="Cây thư mục"
        subtitle="Đọc từ sổ VCdocs theo khung 00–99. Tạo thư mục ở đây để tên và số luôn đúng."
        actions={
          <>
            {can('createFolder') && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Tạo thư mục mảng / dự án
              </Button>
            )}
            {can('ensurePeriods') && <Button onClick={() => setPeriods(true)}>Tạo thư mục năm, tháng</Button>}
          </>
        }
      />
      <Form layout="vertical" component={false} className="vc-filters">
        <Row gutter={[12, 0]}>
          <Col xs={24} sm={12} lg={8}>
            <Form.Item label="Bộ nhớ dùng chung" htmlFor="drive-tm">
              <Select
                id="drive-tm"
                value={driveId || undefined}
                onChange={(v) => {
                  setDriveId(v);
                  setSelectedId(null);
                }}
                loading={drives.isLoading}
                placeholder={drives.isLoading ? 'Đang tải…' : '— Chọn drive —'}
                options={(drives.data ?? []).map((d) => ({ value: d.driveId, label: `${d.name}${d.myRole ? '' : ' (không là thành viên)'}` }))}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="Thư mục">
            <QueryState q={roots} empty={!!roots.data && roots.data.length === 0}>
              {roots.data && <FolderTree roots={roots.data} selectedId={selectedId} onSelect={setSelectedId} />}
            </QueryState>
            {!driveId && !drives.isLoading && <Typography.Text type="secondary">Chọn một drive.</Typography.Text>}
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          {selectedId ? <FolderDetail id={selectedId} /> : <Empty className="vc-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chọn một thư mục để xem chi tiết." />}
        </Col>
      </Row>
      {creating && <CreateFolderDialog driveId={driveId} parentId={selectedId} onClose={() => setCreating(false)} />}
      {periods && <EnsurePeriodsDialog driveId={driveId} onClose={() => setPeriods(false)} />}
    </>
  );
}

type FolderNode = TreeDataNode & { folder: Folder; children?: FolderNode[] };

function FolderTitle({ f }: { f: Folder }) {
  return (
    <span>
      {f.number && <span className="mono">{f.number} </span>}
      {f.code && f.code !== f.shortName ? `${f.code} ` : ''}
      {f.shortName}
      {f.status !== 'active' && (
        <>
          {' '}
          <Badge status="expired">{folderStatusLabel[f.status]}</Badge>
        </>
      )}
      {!f.isManagedByVcdocs && (
        <span className="muted small" title="Thư mục tạo ngoài VCdocs">
          {' '}
          (ngoài sổ)
        </span>
      )}
    </span>
  );
}

function toNode(f: Folder): FolderNode {
  return { key: f.id, title: <FolderTitle f={f} />, isLeaf: f.hasChildren === false, folder: f };
}

function withChildren(list: FolderNode[], key: string, children: FolderNode[]): FolderNode[] {
  return list.map((n) => (n.key === key ? { ...n, children } : n.children ? { ...n, children: withChildren(n.children, key, children) } : n));
}

/** Cây thư mục tải dần từng cấp qua GET /folders/{id}/children khi mở nút. */
function FolderTree({ roots, selectedId, onSelect }: { roots: Folder[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const toast = useToast();
  const [treeData, setTreeData] = useState<FolderNode[]>(() => roots.map(toNode));
  useEffect(() => setTreeData(roots.map(toNode)), [roots]);
  return (
    <Tree<FolderNode>
      showLine
      blockNode
      className="vc-tree"
      treeData={treeData}
      selectedKeys={selectedId ? [selectedId] : []}
      onSelect={(keys) => {
        if (keys[0]) onSelect(String(keys[0]));
      }}
      loadData={async (node) => {
        if (node.children) return;
        try {
          const items = await unwrap(api.GET('/folders/{id}/children', { params: { path: { id: String(node.key) } } })).then((r) => r.items);
          setTreeData((prev) => withChildren(prev, String(node.key), items.map(toNode)));
        } catch {
          toast.error('Không đọc được thư mục con, vui lòng thử lại.');
          throw new Error('load-children');
        }
      }}
    />
  );
}

function FolderDetail({ id }: { id: string }) {
  const toast = useToast();
  const jobs = useJobs();
  const q = useQuery({ queryKey: ['folder', id], queryFn: () => unwrap(api.GET('/folders/{id}', { params: { path: { id } } })) });
  const [renaming, setRenaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const resync = useAction(() => unwrap(api.POST('/folders/{id}/resync', { params: { path: { id } } })), {
    invalidate: [['folder', id], ['folders']],
    onSuccess: () => toast.success('Đã đọc lại từ Drive.'),
  });
  const f = q.data;
  return (
    <Card title="Chi tiết thư mục">
      <QueryState q={q}>
        {f && (
          <>
            <Typography.Text type="secondary" className="mono">
              {f.path}
            </Typography.Text>
            <h3 style={{ marginTop: 4 }}>{f.fullName}</h3>
            <DefList
              items={[
                ['Số', f.number || '—'],
                ['Mã', f.code ?? '—'],
                ['Loại', folderKindLabel[f.kind]],
                ['Mức bảo mật', securityLabel[f.securityLevel]],
                ['Tình trạng', folderStatusLabel[f.status]],
                ['Do VCdocs quản lý', f.isManagedByVcdocs ? 'Có' : 'Không (tạo thẳng trên Drive)'],
              ]}
            />
            <Space wrap style={{ marginTop: 16 }}>
              <LinkButton href={`https://drive.google.com/drive/folders/${encodeURIComponent(f.googleId)}`}>Mở trên Drive</LinkButton>
              {hasAction(f, 'rename') && <Button onClick={() => setRenaming(true)}>Đổi tên</Button>}
              {hasAction(f, 'close-project') && (
                <Button variant="danger" onClick={() => setClosing(true)}>
                  Kết thúc dự án
                </Button>
              )}
              {hasAction(f, 'resync') && (
                <Button onClick={() => resync.mutate()} loading={resync.isPending}>
                  Đọc lại từ Drive
                </Button>
              )}
            </Space>
            <ErrorBox error={resync.error} />
            {renaming && <RenameDialog folder={f} onClose={() => setRenaming(false)} />}
            <ActionDialog
              open={closing}
              title={`Kết thúc dự án ${f.number} ${f.shortName}`}
              description="Thư mục chuyển vào 98 Đã kết thúc, giữ nguyên ID trên Drive. Số dự án không cấp lại."
              confirmLabel="Kết thúc dự án"
              variant="danger"
              run={() => unwrap(api.POST('/folders/{id}/close-project', { params: { path: { id } } }))}
              onDone={(r) => jobs.track({ jobId: r.jobId, label: 'Kết thúc dự án', invalidate: [['folder', id], ['folders']] })}
              onClose={() => setClosing(false)}
            />
          </>
        )}
      </QueryState>
    </Card>
  );
}

type RenameValues = { shortName: string; fullName: string };

function RenameDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const toast = useToast();
  const [form] = Form.useForm<RenameValues>();
  const save = useAction(
    (v: RenameValues) => unwrap(api.POST('/folders/{id}/rename', { params: { path: { id: folder.id } }, body: { shortName: v.shortName.trim(), fullName: v.fullName?.trim() || undefined } })),
    {
      invalidate: [['folder', folder.id], ['folders']],
      onSuccess: () => {
        toast.success('Đã đổi tên thư mục.');
        onClose();
      },
    },
  );
  return (
    <Modal
      open
      title="Đổi tên thư mục"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => form.submit()}>
            Lưu
          </Button>
        </>
      }
    >
      <Typography.Paragraph type="secondary">
        Giữ nguyên số {folder.number} và mã {folder.code ?? '—'}; tên ghép lại đúng mẫu.
      </Typography.Paragraph>
      <Form<RenameValues> form={form} layout="vertical" initialValues={{ shortName: folder.shortName, fullName: folder.fullName }} onFinish={(v) => save.mutate(v)}>
        <Form.Item name="shortName" label="Tên ngắn" rules={[{ required: true, whitespace: true, message: 'Nhập tên ngắn.' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="fullName" label="Tên đầy đủ">
          <Input />
        </Form.Item>
      </Form>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

const ROOT = '__goc__';

type CreateValues = { parentId?: string; kind?: FolderKind; code?: string; shortName: string; fullName: string };

function CreateFolderDialog({ driveId, parentId: initialParent, onClose }: { driveId: string; parentId: string | null; onClose: () => void }) {
  const jobs = useJobs();
  const drives = useDrives();
  const { can } = useAuth();
  const drive = drives.data?.find((d) => d.driveId === driveId);
  const codes = useApprovedCodes(drive?.departmentId);
  const parents = useQuery({
    queryKey: ['folders', 'parents', driveId],
    enabled: !!driveId,
    queryFn: () => unwrap(api.GET('/folders', { params: { query: { driveId, depth: 2 } } })).then((r) => r.items.filter((f) => hasAction(f, 'create-child'))),
  });
  const [form] = Form.useForm<CreateValues>();
  const parentId = Form.useWatch('parentId', form);
  const kind = Form.useWatch('kind', form);
  const code = Form.useWatch('code', form) ?? '';
  const shortName = Form.useWatch('shortName', form) ?? '';
  const fullName = Form.useWatch('fullName', form) ?? '';
  const atRoot = parentId === ROOT;
  // Đổi sang gốc drive mà đang chọn năm/tháng/đối tượng thì bỏ chọn (D20).
  useEffect(() => {
    if (kind && !allowedFolderKinds(atRoot).includes(kind)) form.setFieldValue('kind', undefined);
  }, [atRoot, kind, form]);
  const next = useQuery({
    queryKey: ['folders', 'next-number', driveId, parentId, kind],
    enabled: !!parentId && !!kind,
    queryFn: () =>
      unwrap(api.GET('/folders/next-number', { params: { query: atRoot ? { driveId, kind: kind as FolderKind } : { parentId, kind: kind as FolderKind } } })).then((r) => r.number),
  });
  const needsCode = kind === 'area' || kind === 'project';
  const preview = useMemo(() => previewFolderName(next.data ?? '??', code, shortName, fullName), [next.data, code, shortName, fullName]);
  const save = useAction(
    (v: CreateValues, key: string) =>
      unwrap(
        api.POST('/folders', {
          body: {
            driveId,
            parentId: v.parentId === ROOT ? undefined : v.parentId,
            kind: v.kind as FolderKind,
            code: v.code || undefined,
            shortName: v.shortName.trim(),
            fullName: v.fullName?.trim() || undefined,
          },
          ...idem(key),
        }),
      ),
    {
      onSuccess: (r) => {
        jobs.track({ jobId: r.jobId, label: `Tạo thư mục ${preview}`, invalidate: [['folders']] });
        onClose();
      },
    },
  );
  return (
    <Modal
      open
      title="Tạo thư mục mảng / dự án"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!driveId} loading={save.isPending} onClick={() => form.submit()}>
            Tạo thư mục
          </Button>
        </>
      }
    >
      <Form<CreateValues>
        form={form}
        layout="vertical"
        initialValues={{ parentId: initialParent ?? (can('createFolder') ? ROOT : undefined), kind: 'area', shortName: '', fullName: '' }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="parentId" label="Nằm trong thư mục" rules={[{ required: true, message: 'Chọn thư mục cha.' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={parents.isLoading}
            placeholder={parents.isLoading ? 'Đang tải…' : '— Chọn thư mục cha —'}
            options={[...(can('createFolder') ? [{ value: ROOT, label: `Gốc drive ${drive?.name ?? ''}` }] : []), ...(parents.data ?? []).map((f) => ({ value: f.id, label: f.path }))]}
          />
        </Form.Item>
        <Form.Item name="kind" label="Loại" rules={[{ required: true, message: 'Chọn loại.' }]} extra={atRoot ? 'Thư mục năm, tháng, đối tượng chỉ tạo được bên trong một thư mục.' : undefined}>
          <Select options={allowedFolderKinds(atRoot).map((k) => ({ value: k, label: folderKindLabel[k] }))} />
        </Form.Item>
        <Typography.Paragraph type="secondary">
          Số kế tiếp còn trống: {next.isLoading ? '…' : <strong>{next.data ?? '—'}</strong>}
        </Typography.Paragraph>
        {next.error && <ErrorBox error={next.error} />}
        <Form.Item name="code" label="Mã (từ Bảng mã đã duyệt)" rules={[{ required: needsCode, message: 'Chọn mã.' }]} extra="Chưa có mã phù hợp? Trưởng phòng đề nghị mã mới ở Bảng mã.">
          <Select
            allowClear={!needsCode}
            showSearch
            optionFilterProp="label"
            loading={codes.isLoading}
            placeholder={codes.isLoading ? 'Đang tải…' : '— Chọn mã —'}
            options={(codes.data ?? []).map((c) => ({ value: c.code, label: `${c.code} – ${c.meaning}` }))}
          />
        </Form.Item>
        <Form.Item name="shortName" label="Tên ngắn" rules={[{ required: true, whitespace: true, message: 'Nhập tên ngắn.' }]}>
          <Input placeholder="PTDA" />
        </Form.Item>
        <Form.Item name="fullName" label="Tên đầy đủ">
          <Input placeholder="Phát triển dự án" />
        </Form.Item>
      </Form>
      <p>
        Tên dự kiến: <strong className="mono">{preview}</strong>
      </p>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function EnsurePeriodsDialog({ driveId, onClose }: { driveId: string; onClose: () => void }) {
  const jobs = useJobs();
  const [month, setMonth] = useState(currentMonth());
  const [allDrives, setAll] = useState(true);
  return (
    <ActionDialog
      open
      title="Tạo thư mục năm, tháng còn thiếu"
      description="Hằng tháng phần mềm tự làm việc này; chỉ bấm khi cần tạo sớm hoặc bù tháng bị thiếu."
      confirmLabel="Tạo"
      canConfirm={/^\d{4}-\d{2}$/.test(month)}
      run={() => unwrap(api.POST('/folders/ensure-periods', { body: { month, driveId: allDrives ? undefined : driveId } }))}
      onDone={(r) => jobs.track({ jobId: r.jobId, label: `Tạo thư mục tháng ${month}`, invalidate: [['folders']] })}
      onClose={onClose}
    >
      <MonthField label="Tháng" value={month} onChange={setMonth} required />
      <Checkbox checked={allDrives} onChange={(e) => setAll(e.target.checked)}>
        Cho mọi drive
      </Checkbox>
    </ActionDialog>
  );
}
