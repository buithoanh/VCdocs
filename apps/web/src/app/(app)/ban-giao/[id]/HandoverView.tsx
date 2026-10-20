'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { HandoverDetail, HandoverItem, HandoverItemAction, HandoverItemKind } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { DataTable } from '@/components/DataTable';
import { JobProgress, useJobs } from '@/components/jobs';
import { ActionBar, DeptName, UserName, UserPicker } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, DefList, DriveLink, ErrorBox, Modal, Notice, PageHeader, QueryState, SelectField, Tabs, TextField } from '@/components/ui';
import { formatDate, formatDateTime, formatNumber, todayVN } from '@/lib/format';
import { handoverActionsByKind, handoverItemActionLabel, handoverItemKindLabel, handoverItemStatusLabel, handoverStatusLabel } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';
import { countsText } from '../HandoverList';

type Dialog = 'update' | 'confirm' | 'verify' | 'execute-1' | 'execute-2' | 'cancel' | null;
type KindTab = HandoverItemKind | 'all';

/** Hôm nay sau ngày làm việc cuối (giờ Việt Nam) → kiểm tra trễ, phải ghi lý do (BR-25, E9). */
export function isLate(lastWorkingDay: string, today = todayVN()) {
  return today > lastWorkingDay;
}

/** Chuyển quyền chỉ từ ngày làm việc cuối trở đi (BR-25, E9). */
export function canExecuteOn(lastWorkingDay: string, today = todayVN()) {
  return today >= lastWorkingDay;
}

export function HandoverView({ id }: { id: string }) {
  const qc = useQueryClient();
  const jobs = useJobs();
  const toast = useToast();
  const key = ['handover', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/handovers/{id}', { params: { path: { id } } })) as Promise<unknown> as Promise<HandoverDetail>,
    // Đang liệt kê / đang chuyển quyền thì tự tải lại để thấy dòng mới và tình trạng.
    refetchInterval: (query) => (query.state.data?.status === 'listing' || query.state.data?.status === 'executing' ? 3000 : false),
  });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editing, setEditing] = useState<HandoverItem | null>(null);
  const [job, setJob] = useState<{ id: string; label: string } | null>(null);
  const [kind, setKind] = useState<KindTab>('all');

  const reload = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['handover', id] });
    qc.invalidateQueries({ queryKey: ['handovers'] });
  }, [qc, id]);

  const refresh = useAction((_: void) => unwrap(api.POST('/handovers/{id}/refresh', { params: { path: { id } } })), {
    onSuccess: (r) => setJob({ id: r.jobId, label: 'Liệt kê lại' }),
  });
  const exportForm = useAction((_: void, k: string) => unwrap(api.POST('/handovers/{id}/export', { params: { path: { id } }, ...idem(k) })), {
    onSuccess: (r) => setJob({ id: r.jobId, label: 'Xuất BM-VCPV-08' }),
  });

  const h = q.data;
  const items = h?.items ?? [];
  const kinds = Array.from(new Set(items.map((i) => i.kind)));
  const shown = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const canEditItems = hasAction(h, 'update-items');

  return (
    <QueryState q={q}>
      {h && (
        <>
          <PageHeader
            back={{ href: '/ban-giao', label: 'Bàn giao' }}
            title={
              <>
                Bàn giao của <UserName id={h.userId} />
              </>
            }
            subtitle={
              <>
                <Badge status={h.status}>{handoverStatusLabel[h.status]}</Badge> · Ngày làm việc cuối {formatDate(h.lastWorkingDay)}
              </>
            }
            actions={
              <ActionBar
                obj={h}
                actions={[
                  { action: 'confirm-receiver', label: 'Xác nhận đã nhận', variant: 'success', onClick: () => setDialog('confirm') },
                  { action: 'verify', label: 'Kiểm tra (HCNS)', variant: 'primary', onClick: () => setDialog('verify') },
                  { action: 'execute', label: 'Chuyển quyền', variant: 'danger', onClick: () => setDialog('execute-1') },
                  { action: 'update', label: 'Đổi người nhận, ghi chú', onClick: () => setDialog('update') },
                  { action: 'refresh', label: refresh.isPending ? 'Đang gửi…' : 'Liệt kê lại', onClick: () => refresh.mutate() },
                  { action: 'export', label: exportForm.isPending ? 'Đang gửi…' : 'Xuất BM-VCPV-08', onClick: () => exportForm.mutate() },
                  { action: 'cancel', label: 'Huỷ biên bản', variant: 'danger', onClick: () => setDialog('cancel') },
                ]}
              />
            }
          />
          <ErrorBox error={refresh.error || exportForm.error} />
          {h.status === 'listing' && (
            <Card title="Đang liệt kê việc của người nghỉ">
              {h.listJobId ? <JobProgress jobId={h.listJobId} onFinished={reload} /> : <p className="muted">Đang liệt kê…</p>}
            </Card>
          )}
          {h.status === 'executing' && (
            <Card title="Đang chuyển quyền">
              {h.execution?.jobId ? <JobProgress jobId={h.execution.jobId} onFinished={reload} /> : <p className="muted">Đang chuyển quyền…</p>}
            </Card>
          )}
          {job && (
            <Card title={job.label} actions={<Button variant="ghost" onClick={() => setJob(null)}>Ẩn</Button>}>
              <JobProgress key={job.id} jobId={job.id} onFinished={reload} />
            </Card>
          )}
          <StatusHint h={h} />
          <Card title="Thông tin biên bản">
            <DefList
              items={[
                ['Người nghỉ', <UserName key="u" id={h.userId} />],
                ['Phòng', <DeptName key="d" id={h.departmentId} />],
                ['Ngày làm việc cuối', formatDate(h.lastWorkingDay)],
                ['Người nhận', <UserName key="r" id={h.receiverId} />],
                ['Lập', h.isAuto ? 'Tự lập khi ghi ngày nghỉ việc' : 'Kiểm soát tài liệu lập'],
                ['Tiến độ', countsText(h.counts)],
                ['Người nhận xác nhận', h.receipt ? <span key="rc">{formatDateTime(h.receipt.at)}{h.receipt.note ? ` – ${h.receipt.note}` : ''}</span> : '—'],
                [
                  'HCNS kiểm tra',
                  h.verification ? (
                    <span key="v">
                      <UserName id={h.verification.by} /> · {formatDateTime(h.verification.at)}
                      {h.verification.isLate && <> · <Badge status="failed">Trễ</Badge> {h.verification.lateReason}</>}
                      {h.verification.note && <div className="muted small">{h.verification.note}</div>}
                    </span>
                  ) : (
                    '—'
                  ),
                ],
                ['Chuyển quyền', h.execution?.finishedAt ? `Xong ${formatDateTime(h.execution.finishedAt)}` : h.execution?.startedAt ? `Bắt đầu ${formatDateTime(h.execution.startedAt)}` : '—'],
                ['Ghi chú', h.note || '—'],
                ...(h.status === 'cancelled' ? ([['Lý do huỷ', `${h.cancelReason ?? '—'} (${formatDateTime(h.cancelledAt)})`]] as [string, string][]) : []),
              ]}
            />
            {h.exportFileId && (
              <div className="actions" style={{ marginTop: '.75rem' }}>
                <DriveLink fileId={h.exportFileId}>Mở BM-VCPV-08 đã xuất</DriveLink>
              </div>
            )}
          </Card>
          <Card title={`Danh sách bàn giao (${formatNumber(items.length)})`}>
            {kinds.length > 1 && (
              <Tabs
                value={kind}
                onChange={setKind}
                tabs={[
                  { value: 'all' as KindTab, label: `Tất cả (${items.length})` },
                  ...kinds.map((k) => ({ value: k as KindTab, label: `${handoverItemKindLabel[k]} (${items.filter((i) => i.kind === k).length})` })),
                ]}
              />
            )}
            <DataTable
              rows={shown}
              rowKey={(i) => i.id}
              caption="Các mục bàn giao"
              empty={h.status === 'listing' ? 'Đang liệt kê…' : 'Người này không có việc nào cần bàn giao.'}
              columns={[
                { key: 'kind', header: 'Loại', render: (i: HandoverItem) => handoverItemKindLabel[i.kind] },
                {
                  key: 'name',
                  header: 'Mục',
                  render: (i: HandoverItem) => (
                    <>
                      <strong>{i.name}</strong>
                      {i.detail && <div className="muted small">{i.detail}</div>}
                    </>
                  ),
                },
                {
                  key: 'action',
                  header: 'Cách xử lý',
                  render: (i: HandoverItem) => (
                    <>
                      {handoverItemActionLabel[i.action]}
                      {i.action === 'reassign' && (
                        <div className="small">
                          → <UserName id={i.toUserId ?? h.receiverId} />
                        </div>
                      )}
                      {i.note && <div className="muted small">{i.note}</div>}
                    </>
                  ),
                },
                {
                  key: 'status',
                  header: 'Tình trạng',
                  render: (i: HandoverItem) => (
                    <>
                      <Badge status={i.status}>{handoverItemStatusLabel[i.status]}</Badge>
                      {i.error && <div className="error-text small">{i.error}</div>}
                    </>
                  ),
                },
                ...(canEditItems
                  ? [
                      {
                        key: 'edit',
                        header: '',
                        render: (i: HandoverItem) =>
                          i.status === 'pending' || i.status === 'failed' ? (
                            <Button variant="ghost" onClick={() => setEditing(i)} aria-label={`Sửa cách xử lý ${i.name}`}>
                              Sửa
                            </Button>
                          ) : null,
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

          {editing && <ItemDialog h={h} item={editing} onClose={() => setEditing(null)} />}
          {dialog === 'update' && <UpdateDialog h={h} onClose={() => setDialog(null)} />}
          {dialog === 'confirm' && (
            <ActionDialog
              open
              title="Xác nhận nhận bàn giao"
              description="Bạn đã xem danh sách và nhận các việc trên. Sau đó HCNS kiểm tra và Quản trị hệ thống chuyển quyền."
              confirmLabel="Xác nhận đã nhận"
              variant="success"
              textLabel="Ghi chú"
              run={(note) => unwrap(api.POST('/handovers/{id}/confirm-receiver', { params: { path: { id } }, body: { note: note || undefined } }))}
              invalidate={[key, ['handovers']]}
              onDone={() => toast.success('Đã xác nhận nhận bàn giao.')}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog === 'verify' && <VerifyDialog h={h} onClose={() => setDialog(null)} />}
          {dialog === 'execute-1' && <ExecuteStep1 h={h} onNext={() => setDialog('execute-2')} onClose={() => setDialog(null)} />}
          {dialog === 'execute-2' && (
            <ExecuteStep2
              h={h}
              onClose={() => setDialog(null)}
              onStarted={(jobId) => {
                setJob({ id: jobId, label: 'Chuyển quyền' });
                jobs.track({ jobId, label: 'Chuyển quyền bàn giao', invalidate: [key, ['handovers']] });
              }}
            />
          )}
          {dialog === 'cancel' && (
            <ActionDialog
              open
              title="Huỷ biên bản bàn giao"
              description="Ngày làm việc cuối bị xoá, người này trở lại “Đang làm việc”."
              confirmLabel="Huỷ biên bản"
              variant="danger"
              textLabel="Lý do huỷ"
              textRequired
              run={(reason) => unwrap(api.POST('/handovers/{id}/cancel', { params: { path: { id } }, body: { reason } }))}
              invalidate={[key, ['handovers']]}
              onDone={() => toast.info('Đã huỷ biên bản.')}
              onClose={() => setDialog(null)}
            />
          )}
        </>
      )}
    </QueryState>
  );
}

function StatusHint({ h }: { h: HandoverDetail }) {
  if (h.status === 'open')
    return (
      <Notice>
        Chờ <UserName id={h.receiverId} /> xem danh sách và bấm “Xác nhận đã nhận”. Người nhận và Kiểm soát tài liệu sửa được cách xử lý từng mục.
      </Notice>
    );
  if (h.status === 'received')
    return (
      <Notice tone={isLate(h.lastWorkingDay) ? 'warn' : 'info'}>
        Chờ HCNS kiểm tra trước ngày làm việc cuối ({formatDate(h.lastWorkingDay)}).
        {isLate(h.lastWorkingDay) && ' Đã quá ngày: khi kiểm tra phải ghi lý do trễ.'}
      </Notice>
    );
  if (h.status === 'verified')
    return (
      <Notice tone="warn">
        Đã kiểm tra. Quản trị hệ thống chuyển quyền từ ngày {formatDate(h.lastWorkingDay)}.{h.counts.failed > 0 && ` Lần trước có ${h.counts.failed} mục lỗi: chuyển quyền lại chỉ chạy mục chờ làm và mục lỗi.`}
      </Notice>
    );
  if (h.status === 'done') return <Notice tone="success">Đã chuyển quyền xong.</Notice>;
  return null;
}

function ItemDialog({ h, item, onClose }: { h: HandoverDetail; item: HandoverItem; onClose: () => void }) {
  const options = handoverActionsByKind[item.kind];
  const [action, setAction] = useState<HandoverItemAction | ''>(item.action);
  const [toUserId, setTo] = useState(item.toUserId ?? '');
  return (
    <ActionDialog
      open
      title="Cách xử lý một mục"
      description={
        <>
          {handoverItemKindLabel[item.kind]}: <strong>{item.name}</strong>
        </>
      }
      confirmLabel="Lưu"
      canConfirm={!!action}
      run={() =>
        unwrap(
          api.PATCH('/handovers/{id}/items/{itemId}', {
            params: { path: { id: h.id, itemId: item.id } },
            body: { action: action || undefined, toUserId: action === 'reassign' && toUserId ? toUserId : undefined },
          }),
        )
      }
      invalidate={[['handover', h.id]]}
      onClose={onClose}
    >
      <SelectField
        label="Cách xử lý"
        value={action}
        onChange={setAction}
        required
        options={options.map((a) => ({ value: a, label: handoverItemActionLabel[a] }))}
      />
      {action === 'reassign' && (
        <UserPicker label="Giao cho" value={toUserId} onChange={setTo} excludeIds={[h.userId]} hint="Bỏ trống = người nhận của biên bản." />
      )}
    </ActionDialog>
  );
}

function UpdateDialog({ h, onClose }: { h: HandoverDetail; onClose: () => void }) {
  const [receiverId, setReceiver] = useState(h.receiverId);
  const [note, setNote] = useState(h.note ?? '');
  return (
    <ActionDialog
      open
      title="Đổi người nhận, ghi chú"
      confirmLabel="Lưu"
      canConfirm={!!receiverId && receiverId !== h.userId}
      run={() => unwrap(api.PATCH('/handovers/{id}', { params: { path: { id: h.id } }, body: { receiverId, note } }))}
      invalidate={[['handover', h.id], ['handovers']]}
      onClose={onClose}
    >
      <UserPicker label="Người nhận bàn giao" value={receiverId} onChange={setReceiver} required excludeIds={[h.userId]} hint="Đổi người nhận thì người mới phải xác nhận lại." />
      <TextField label="Ghi chú" value={note} onChange={setNote} multiline maxLength={2000} />
    </ActionDialog>
  );
}

function VerifyDialog({ h, onClose }: { h: HandoverDetail; onClose: () => void }) {
  const late = isLate(h.lastWorkingDay);
  const [lateReason, setLateReason] = useState('');
  return (
    <ActionDialog
      open
      title="HCNS kiểm tra biên bản"
      description={`Đối chiếu danh sách với thực tế trước ngày làm việc cuối (${formatDate(h.lastWorkingDay)}).`}
      confirmLabel="Đã kiểm tra"
      textLabel="Ghi chú"
      canConfirm={!late || !!lateReason.trim()}
      run={(note) =>
        unwrap(
          api.POST('/handovers/{id}/verify', {
            params: { path: { id: h.id } },
            body: { note: note || undefined, lateReason: late ? lateReason.trim() : undefined },
          }),
        )
      }
      invalidate={[['handover', h.id], ['handovers']]}
      onClose={onClose}
    >
      {late && (
        <>
          <Notice tone="warn">Đã quá ngày làm việc cuối – phải ghi lý do kiểm tra trễ (BR-25).</Notice>
          <TextField label="Lý do kiểm tra trễ" value={lateReason} onChange={setLateReason} required multiline maxLength={2000} />
        </>
      )}
    </ActionDialog>
  );
}

/** Lần hỏi thứ nhất: nói rõ việc sẽ làm. */
function ExecuteStep1({ h, onNext, onClose }: { h: HandoverDetail; onNext: () => void; onClose: () => void }) {
  const early = !canExecuteOn(h.lastWorkingDay);
  const todo = h.counts.pending + h.counts.failed;
  return (
    <Modal
      open
      title="Chuyển quyền – bước 1/2"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="danger" disabled={early} onClick={onNext}>
            Tiếp tục
          </Button>
        </>
      }
    >
      <p>
        Chuyển {formatNumber(todo)} mục của <UserName id={h.userId} /> theo cách xử lý đã chọn: đổi người trong VCdocs, chuyển sở hữu file Drive của tôi sang người nhận, gỡ khỏi nhóm Google.
      </p>
      <p>
        <strong>Việc này không đảo ngược được.</strong>
      </p>
      {early && <Notice tone="warn">Chưa tới ngày làm việc cuối ({formatDate(h.lastWorkingDay)}): chỉ chuyển quyền từ ngày đó trở đi (BR-25).</Notice>}
    </Modal>
  );
}

/** Lần hỏi thứ hai: phải đánh dấu đã hiểu mới bấm được. */
function ExecuteStep2({ h, onStarted, onClose }: { h: HandoverDetail; onStarted: (jobId: string) => void; onClose: () => void }) {
  const [sure, setSure] = useState(false);
  return (
    <ActionDialog
      open
      title="Chuyển quyền – xác nhận lần hai"
      confirmLabel="Chuyển quyền ngay"
      variant="danger"
      canConfirm={sure}
      run={(_, key) => unwrap(api.POST('/handovers/{id}/execute', { params: { path: { id: h.id } }, ...idem(key) }))}
      invalidate={[['handover', h.id], ['handovers']]}
      onDone={(r) => onStarted(r.jobId)}
      onClose={onClose}
    >
      <label className="checkbox">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        Tôi hiểu chuyển quyền xong không lấy lại được.
      </label>
    </ActionDialog>
  );
}
