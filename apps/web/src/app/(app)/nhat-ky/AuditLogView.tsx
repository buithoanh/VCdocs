'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, unwrap } from '@/api/client';
import type { AuditLog } from '@/api/types';
import { DataTable, Pagination } from '@/components/DataTable';
import { DeptName, DeptSelect, UserName, UserPicker } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Button, DefList, Modal, Notice, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
import { formatDate, formatDateTime, shortId } from '@/lib/format';
import { auditObjectTypeLabel, auditResultLabel } from '@/lib/labels';
import { AnchorCard } from './AnchorCard';

const LIMIT = 50;

export type AuditFilter = {
  objectType: string;
  objectId: string;
  actorId: string;
  action: string;
  departmentId: string;
  from: string;
  to: string;
  sort: '-seq' | 'seq';
};

const EMPTY: AuditFilter = { objectType: '', objectId: '', actorId: '', action: '', departmentId: '', from: '', to: '', sort: '-seq' };

/** Bộ lọc → tham số GET /audit-logs. Ngày tính theo giờ Việt Nam, trọn ngày. */
export function auditQuery(f: AuditFilter, page: number) {
  return {
    objectType: f.objectType || undefined,
    objectId: f.objectId.trim() || undefined,
    actorId: f.actorId || undefined,
    action: f.action.trim() || undefined,
    departmentId: f.departmentId || undefined,
    from: f.from ? `${f.from}T00:00:00+07:00` : undefined,
    to: f.to ? `${f.to}T23:59:59+07:00` : undefined,
    sort: f.sort,
    page,
    limit: LIMIT,
  };
}

/** Trang của đối tượng trong VCdocs (nếu có). */
export function objectHref(objectType?: string, objectId?: string): string | undefined {
  if (!objectType || !objectId) return undefined;
  const map: Record<string, string> = {
    document: '/tai-lieu/',
    record: '/ho-so/',
    approval: '/phe-duyet/',
    handover: '/ban-giao/',
    record_type: '/danh-muc-ho-so/',
    user: '/nhan-su/',
    evidence_pack: '/nhat-ky/goi-bang-chung/',
  };
  return map[objectType] ? `${map[objectType]}${objectId}` : undefined;
}

function Actor({ log }: { log: AuditLog }) {
  if (log.actorId) return <UserName id={log.actorId} />;
  if (log.actorEmail) return <>{log.actorEmail}</>;
  return <span className="muted">Hệ thống</span>;
}

export function AuditLogView() {
  const { can, me } = useAuth();
  const params = useSearchParams();
  const initial: AuditFilter = { ...EMPTY, objectType: params?.get('objectType') ?? '', objectId: params?.get('objectId') ?? '' };
  const [draft, setDraft] = useState<AuditFilter>(initial);
  const [filter, setFilter] = useState<AuditFilter>(initial);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditLog | null>(null);
  const set = <K extends keyof AuditFilter>(k: K, v: AuditFilter[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const list = useQuery({
    queryKey: ['audit-logs', filter, page],
    queryFn: () => unwrap(api.GET('/audit-logs', { params: { query: auditQuery(filter, page) } })),
    placeholderData: (prev) => prev,
  });

  function apply(e: FormEvent) {
    e.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) return;
    setFilter(draft);
    setPage(1);
  }

  const auditor = me.auditorAccess;
  return (
    <>
      <PageHeader title="Nhật ký thao tác" subtitle="Chỉ đọc. Mỗi dòng nối mã băm với dòng trước, sửa hay xoá một dòng là chuỗi lệch." />
      {auditor && (
        <Notice>
          Bạn đang có quyền xem tạm của kiểm toán viên đến {formatDateTime(auditor.expiresAt)}, cho phòng:{' '}
          {auditor.departmentIds.map((d, i) => (
            <span key={d}>
              {i > 0 && ', '}
              <DeptName id={d} />
            </span>
          ))}
          . Mọi lượt xem đều được ghi nhật ký.
        </Notice>
      )}
      {can('auditChain') && <AnchorCard />}
      <form className="filters" onSubmit={apply} aria-label="Lọc nhật ký">
        <SelectField
          label="Loại đối tượng"
          value={draft.objectType}
          onChange={(v) => set('objectType', v)}
          placeholder="Tất cả"
          options={Object.entries(auditObjectTypeLabel).map(([value, label]) => ({ value, label }))}
        />
        <TextField label="Id đối tượng" value={draft.objectId} onChange={(v) => set('objectId', v)} />
        <TextField label="Thao tác" value={draft.action} onChange={(v) => set('action', v)} placeholder="vd record.finalize" />
        <DeptSelect value={draft.departmentId} onChange={(v) => set('departmentId', v)} allowAll />
        <UserPicker label="Người làm" value={draft.actorId} onChange={(v) => set('actorId', v)} />
        <TextField label="Từ ngày" type="date" value={draft.from} onChange={(v) => set('from', v)} />
        <TextField
          label="Đến ngày"
          type="date"
          value={draft.to}
          onChange={(v) => set('to', v)}
          error={draft.from && draft.to && draft.from > draft.to ? 'Trước “Từ ngày”.' : undefined}
        />
        <SelectField
          label="Sắp xếp"
          value={draft.sort}
          onChange={(v) => set('sort', v || '-seq')}
          placeholder="Mới nhất trước"
          options={[{ value: 'seq', label: 'Cũ nhất trước' }]}
        />
        <div className="actions">
          <Button type="submit" variant="primary">
            Lọc
          </Button>
          <Button onClick={() => (setDraft(EMPTY), setFilter(EMPTY), setPage(1))}>Xoá lọc</Button>
        </div>
      </form>
      <QueryState q={list}>
        <DataTable
          rows={list.data?.items ?? []}
          rowKey={(l) => l.id}
          caption="Nhật ký thao tác"
          empty="Không có dòng nhật ký nào khớp."
          columns={[
            { key: 'seq', header: 'Số', render: (l: AuditLog) => <span className="mono">{l.seq}</span>, className: 'num' },
            { key: 'at', header: 'Lúc', render: (l: AuditLog) => formatDateTime(l.at) },
            { key: 'actor', header: 'Người làm', render: (l: AuditLog) => <Actor log={l} /> },
            { key: 'action', header: 'Thao tác', render: (l: AuditLog) => <span className="mono">{l.action}</span> },
            {
              key: 'obj',
              header: 'Đối tượng',
              render: (l: AuditLog) => {
                if (!l.objectType) return '—';
                const href = objectHref(l.objectType, l.objectId);
                const text = `${auditObjectTypeLabel[l.objectType] ?? l.objectType} ${shortId(l.objectId)}`;
                return href ? <Link href={href}>{text}</Link> : text;
              },
              hideOnMobile: true,
            },
            { key: 'dept', header: 'Phòng', render: (l: AuditLog) => <DeptName id={l.departmentId} />, hideOnMobile: true },
            { key: 'result', header: 'Kết quả', render: (l: AuditLog) => <Badge status={l.result}>{auditResultLabel[l.result]}</Badge> },
            {
              key: 'more',
              header: '',
              render: (l: AuditLog) => (
                <Button variant="ghost" onClick={() => setOpen(l)} aria-label={`Chi tiết dòng ${l.seq}`}>
                  Chi tiết
                </Button>
              ),
            },
          ]}
        />
        {list.data && <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />}
      </QueryState>
      {open && <LogDetail log={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === undefined) return <span className="muted">—</span>;
  return <pre className="mono small json-box">{JSON.stringify(value, null, 2)}</pre>;
}

export function LogDetail({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  return (
    <Modal open title={`Dòng nhật ký số ${log.seq}`} onClose={onClose}>
      <DefList
        items={[
          ['Lúc', formatDateTime(log.at)],
          ['Người làm', <Actor key="a" log={log} />],
          ['Thao tác', <span key="ac" className="mono">{log.action}</span>],
          ['Đối tượng', log.objectType ? `${auditObjectTypeLabel[log.objectType] ?? log.objectType} · ${log.objectId ?? '—'}` : '—'],
          ['Phòng', <DeptName key="d" id={log.departmentId} />],
          ['Kết quả', auditResultLabel[log.result]],
          ['Mã yêu cầu', log.requestId ?? '—'],
          ['IP · thiết bị', `${log.ip ?? '—'} · ${log.device ?? '—'}`],
        ]}
      />
      {log.isRedacted ? (
        <Notice tone="warn">Đối tượng nằm ở bộ nhớ dùng chung bạn không được xem nên không hiện giá trị trước và sau.</Notice>
      ) : (
        <div className="grid json-grid">
          <div>
            <h3 className="small">Trước</h3>
            <Json value={log.before} />
          </div>
          <div>
            <h3 className="small">Sau</h3>
            <Json value={log.after} />
          </div>
        </div>
      )}
      <DefList
        items={[
          ['Mã băm dòng trước', <span key="p" className="mono small break">{log.prevHash}</span>],
          ['Mã băm dòng này', <span key="h" className="mono small break">{log.hash}</span>],
        ]}
      />
      <p className="hint">Ngày ghi: {formatDate(log.at)}. Mã băm = SHA-256(mã băm dòng trước + nội dung dòng).</p>
    </Modal>
  );
}
