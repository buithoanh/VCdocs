'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { recordTypeName, useAction, useBlocks, useRecordTypes } from '@/api/queries';
import type { Delegation } from '@/api/types';
import { DataTable } from '@/components/DataTable';
import { UserName, UserPicker } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Button, ErrorBox, Modal, Notice, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
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
      <div className="filters">
        <SelectField label="Khối" value={blockId} onChange={setBlock} options={(blocks.data ?? []).map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))} />
      </div>
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(d) => d.id}
          empty="Khối chưa có dòng uỷ quyền nào."
          columns={[
            { key: 'type', header: 'Loại hồ sơ được duyệt', render: (d) => <>{recordTypeName(types.data, d.recordTypeId)}{d.task && <div className="muted small">{d.task}</div>}</> },
            { key: 'legal', header: 'Việc luật yêu cầu chữ ký', render: (d) => (d.isLegalSignature ? 'Có' : '—'), hideOnMobile: true },
            { key: 'limit', header: 'Hạn mức (đồng)', render: (d) => formatNumber(d.limitAmount), className: 'num' },
            { key: 'who', header: 'Người được uỷ quyền', render: (d) => <UserName id={d.delegateId} /> },
            { key: 'from', header: 'Từ ngày', render: (d) => formatDate(d.from) },
            { key: 'to', header: 'Đến ngày', render: (d) => (d.to ? formatDate(d.to) : 'Không thời hạn') },
            { key: 'state', header: 'Tình trạng', render: (d) => (d.from > today ? 'Chưa tới ngày' : d.to && d.to < today ? 'Hết hạn' : 'Đang hiệu lực'), hideOnMobile: true },
            { key: 'edit', header: '', render: (d) => hasAction(d, 'update') && <Button variant="ghost" onClick={() => setEdit(d)}>Sửa</Button> },
          ]}
        />
      </QueryState>
      {edit && <DelegationForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function DelegationForm({ initial, onClose }: { initial: Partial<Delegation>; onClose: () => void }) {
  const toast = useToast();
  const types = useRecordTypes();
  const [recordTypeId, setType] = useState(initial.recordTypeId ?? '');
  const [task, setTask] = useState(initial.task ?? '');
  const [isLegalSignature, setLegal] = useState(initial.isLegalSignature ?? false);
  const [limit, setLimit] = useState(initial.limitAmount !== undefined ? String(initial.limitAmount) : '');
  const [delegateId, setDelegate] = useState(initial.delegateId ?? '');
  const [from, setFrom] = useState(initial.from ?? todayISO());
  const [to, setTo] = useState(initial.to ?? '');
  const limitNum = limit ? Number(limit.replace(/\./g, '')) : undefined;
  const valid = recordTypeId && !isLegalSignature && delegateId && from && (limitNum === undefined || (Number.isFinite(limitNum) && limitNum >= 0)) && (!to || to >= from);
  const save = useAction(
    (_: void, key: string) => {
      const body = { blockId: initial.blockId!, recordTypeId, task: task.trim() || undefined, isLegalSignature, limitAmount: limitNum, delegateId, from, to: to || undefined };
      return initial.id
        ? unwrap(api.PATCH('/delegations/{id}', { params: { path: { id: initial.id } }, body }))
        : unwrap(api.POST('/delegations', { body, ...idem(key) }));
    },
    { invalidate: [['delegations']], onSuccess: () => (toast.success('Đã lưu dòng uỷ quyền.'), onClose()) },
  );
  return (
    <Modal
      open
      title={initial.id ? 'Sửa dòng uỷ quyền' : 'Thêm dòng uỷ quyền'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <Notice>Hạn mức vượt mức tối đa của giám đốc khối, hoặc việc liên khối, việc luật yêu cầu người có thẩm quyền ký sẽ không lưu được.</Notice>
      <SelectField
        label="Loại hồ sơ được uỷ quyền duyệt"
        value={recordTypeId}
        onChange={setType}
        required
        placeholder={types.isLoading ? 'Đang tải…' : '— Chọn loại hồ sơ —'}
        options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
      />
      <TextField label="Mô tả việc" value={task} onChange={setTask} placeholder="Đề xuất mua hàng dưới hạn mức" />
      <label className="checkbox">
        <input type="checkbox" checked={isLegalSignature} onChange={(e) => setLegal(e.target.checked)} />
        Việc luật yêu cầu chữ ký người đại diện
      </label>
      {isLegalSignature && <Notice tone="warn">Việc luật yêu cầu chữ ký người đại diện không được uỷ quyền xuống (BR-24).</Notice>}
      <TextField
        label="Hạn mức (đồng)"
        value={limit ? formatNumber(limitNum) : ''}
        onChange={(v) => setLimit(v.replace(/[^\d]/g, ''))}
        inputMode="numeric"
        hint="Để trống nếu không giới hạn số tiền"
      />
      <UserPicker label="Người được uỷ quyền" value={delegateId} onChange={setDelegate} required />
      <div className="form-row">
        <TextField label="Từ ngày" type="date" value={from} onChange={setFrom} required />
        <TextField label="Đến ngày" type="date" value={to} onChange={setTo} min={from} error={to && to < from ? 'Đến ngày phải sau Từ ngày.' : undefined} />
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
