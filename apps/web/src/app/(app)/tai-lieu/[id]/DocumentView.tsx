'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, getLimits, idem, unwrap } from '@/api/client';
import { useAction, useDepartments } from '@/api/queries';
import type { Document, RevisionKind } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { ApproverPreview } from '@/components/ApproverPreview';
import { DataTable } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { ActionBar, DeptName, MultiUserPicker, UserName } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { AuditTools } from '@/components/AuditTools';
import { Badge, Button, Card, DefList, DriveLink, ErrorBox, Notice, PageHeader, QueryState, TextField } from '@/components/ui';
import { formatDate, formatDateTime, todayISO } from '@/lib/format';
import { docLevelLabel, docStatusLabel, docTypeLabel, securityLabel } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';

type Dialog = 'feedback' | 'submit' | 'issue' | 'revise' | 'withdraw' | 'review' | null;

export function DocumentView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['document', id], queryFn: () => unwrap(api.GET('/documents/{id}', { params: { path: { id } } })) });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const toast = useToast();
  const jobs = useJobs();
  const invalidate = [['document', id], ['documents']];

  const assignCode = useAction(() => unwrap(api.POST('/documents/{id}/assign-code', { params: { path: { id } } })), {
    invalidate,
    onSuccess: (d) => toast.success(`Đã cấp mã ${d.code ?? ''}.`),
  });
  const createDraft = useAction((_: void, key: string) => unwrap(api.POST('/documents/{id}/create-draft', { params: { path: { id } }, ...idem(key) })), {
    onSuccess: (r) => jobs.track({ jobId: r.jobId, label: 'Tạo file nháp từ biểu mẫu khung', invalidate }),
  });
  const relock = useAction(() => unwrap(api.POST('/documents/{id}/relock', { params: { path: { id } } })), {
    invalidate: [...invalidate, ['document-integrity', id]],
    onSuccess: () => toast.success('Đã khoá lại file.'),
  });
  const busyError = assignCode.error || createDraft.error || relock.error;

  const d = q.data;
  return (
    <QueryState q={q}>
      {d && (
        <>
          <PageHeader
            back={{ href: '/tai-lieu', label: 'Tài liệu' }}
            title={
              <>
                {d.code && <span className="mono">{d.code} </span>}
                {d.title}
              </>
            }
            subtitle={
              <>
                <Badge status={d.status}>{docStatusLabel[d.status]}</Badge> {d.current?.number ? `· Bản hiệu lực v${d.current.number}` : ''}
              </>
            }
            actions={
              <ActionBar
                obj={d}
                actions={[
                  { action: 'assign-code', label: 'Cấp mã', variant: 'primary', onClick: () => assignCode.mutate() },
                  { action: 'create-draft', label: 'Tạo file nháp', variant: 'primary', onClick: () => createDraft.mutate() },
                  { action: 'request-feedback', label: 'Gửi lấy góp ý', onClick: () => setDialog('feedback') },
                  { action: 'feedback', label: 'Xem góp ý', onClick: () => setShowFeedback(true) },
                  { action: 'submit', label: 'Trình duyệt', variant: 'primary', onClick: () => setDialog('submit') },
                  { action: 'issue', label: 'Ban hành', variant: 'success', onClick: () => setDialog('issue') },
                  { action: 'revise', label: 'Sửa đổi', onClick: () => setDialog('revise') },
                  { action: 'review', label: 'Ghi kết quả rà soát', onClick: () => setDialog('review') },
                  { action: 'withdraw', label: 'Trình huỷ bỏ', variant: 'danger', onClick: () => setDialog('withdraw') },
                  { action: 'relock', label: 'Khoá lại', onClick: () => relock.mutate() },
                ]}
              />
            }
          />
          <ErrorBox error={busyError} />
          {d.status === 'revising' && <Notice>Đang sửa lớn: mọi người vẫn dùng bản v{d.current?.number} đang hiệu lực cho tới khi bản mới được ban hành.</Notice>}
          {d.replacedById && (
            <Notice tone="warn">
              Tài liệu đã được thay thế. <Link href={`/tai-lieu/${d.replacedById}`}>Mở tài liệu thay thế</Link>
            </Notice>
          )}
          <Card title="Thông tin">
            <DefList
              items={[
                ['Loại', docTypeLabel[d.type]],
                ['Cấp', docLevelLabel[d.level]],
                ['Phòng', <DeptName key="dp" id={d.departmentId} />],
                ['Mức bảo mật', d.securityLevel ? securityLabel[d.securityLevel] : '—'],
                ['Người soạn', <UserName key="dr" id={d.drafterId} />],
                ['Người kiểm tra', <UserName key="ck" id={d.checkerId} />],
                ['Người duyệt', <UserName key="ap" id={d.approverId} />],
                ['Hạn soạn', formatDate(d.dueDate)],
                ['Kỳ rà soát', formatDate(d.reviewDue)],
                ['Hiệu lực từ', formatDate(d.current?.effectiveFrom)],
              ]}
            />
            <div className="actions" style={{ marginTop: '1rem' }}>
              <DriveLink fileId={d.current?.fileId ?? d.fileId}>Mở file trên Drive</DriveLink>
              <DriveLink fileId={d.current?.pdfFileId}>Mở bản PDF</DriveLink>
              {d.current?.approvalId && (
                <Link className="btn btn-secondary" href={`/phe-duyet/${d.current.approvalId}`}>
                  Phiếu duyệt
                </Link>
              )}
              <AuditTools target={{ documentId: d.id }} departmentId={d.departmentId} />
            </div>
          </Card>
          {d.type === 'EXT' && <ExternalCard doc={d} />}
          {showFeedback && hasAction(d, 'feedback') && <OpenCommentsCard id={id} />}
          {hasAction(d, 'integrity') && <IntegrityCard id={id} lockedAt={d.lock?.lockedAt} />}
          <Card title="Lịch sử phiên bản">
            <DataTable
              rows={[...(d.versions ?? [])].sort((a, b) => b.number - a.number)}
              rowKey={(v) => `${v.number}-${v.kind}-${v.effectiveFrom ?? ''}`}
              empty="Chưa có phiên bản ban hành."
              columns={[
                { key: 'n', header: 'Phiên bản', render: (v) => `v${v.number}` },
                { key: 'kind', header: 'Loại sửa', render: (v) => (v.kind === 'major' ? 'Sửa lớn' : 'Sửa nhỏ') },
                { key: 'note', header: 'Nội dung thay đổi', render: (v) => v.changeNote ?? '—' },
                { key: 'by', header: 'Người duyệt', render: (v) => <UserName id={v.approvedBy} />, hideOnMobile: true },
                { key: 'from', header: 'Hiệu lực từ', render: (v) => formatDate(v.effectiveFrom) },
              ]}
            />
          </Card>

          {dialog === 'feedback' && <FeedbackDialog id={id} onClose={() => setDialog(null)} />}
          {dialog === 'submit' && <SubmitDialog doc={d} onClose={() => setDialog(null)} />}
          {dialog === 'issue' && <IssueDialog doc={d} onClose={() => setDialog(null)} />}
          {dialog === 'revise' && <ReviseDialog id={id} onClose={() => setDialog(null)} />}
          {dialog === 'withdraw' && <WithdrawDialog doc={d} onClose={() => setDialog(null)} />}
          {dialog === 'review' && <ReviewDialog id={id} onClose={() => setDialog(null)} />}
        </>
      )}
    </QueryState>
  );
}

function OpenCommentsCard({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['document-feedback', id],
    queryFn: () => unwrap(api.GET('/documents/{id}/feedback', { params: { path: { id } } })),
    retry: false,
  });
  return (
    <Card title="Góp ý trên file" actions={<Button variant="ghost" onClick={() => q.refetch()}>Kiểm tra lại</Button>}>
      <QueryState q={q}>
        {q.data && (
          <p>
            Nhận xét chưa đóng: <strong>{q.data.openComments}</strong>
            {q.data.checkedAt && <span className="muted small"> · kiểm tra lúc {formatDateTime(q.data.checkedAt)}</span>}
          </p>
        )}
      </QueryState>
    </Card>
  );
}

function IntegrityCard({ id, lockedAt }: { id: string; lockedAt?: string }) {
  const { can } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const q = useQuery({
    queryKey: ['document-integrity', id],
    enabled,
    queryFn: () => unwrap(api.GET('/documents/{id}/integrity', { params: { path: { id } } })),
    retry: false,
  });
  const i = q.data;
  return (
    <Card title="Khoá và tính toàn vẹn" actions={<Button onClick={() => (enabled ? q.refetch() : setEnabled(true))} loading={q.isFetching}>Kiểm tra ngay</Button>}>
      {lockedAt && <p className="muted small">Khoá lúc {formatDateTime(lockedAt)}</p>}
      {q.error && <ErrorBox error={q.error} />}
      {i && (
        <>
          {i.isLocked && i.isRevisionMatching ? (
            <Notice tone="success">File đang khoá và khớp bản hiệu lực.</Notice>
          ) : (
            <Notice tone="warn">
              {!i.isLocked && 'File đang không khoá. '}
              {!i.isRevisionMatching && 'Nội dung file đã khác bản hiệu lực. '}
              Bấm “Khoá lại” để khoá ngay.
            </Notice>
          )}
          <p className="muted small">Kiểm tra lúc {formatDateTime(i.checkedAt)}</p>
        </>
      )}
    </Card>
  );
}

function ExternalCard({ doc }: { doc: Document }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [related, setRelated] = useState<string[] | null>(null);
  const ext = doc.external;
  const patch = useAction(
    (body: { isSuperseded?: boolean; lastCheckedAt?: string }) => unwrap(api.PATCH('/external-documents/{id}', { params: { path: { id: doc.id } }, body })),
    {
      onSuccess: (d) => {
        qc.setQueryData(['document', doc.id], d);
        if (d.external?.isSuperseded) setRelated(d.relatedIds ?? []);
        toast.success('Đã cập nhật tình trạng tài liệu bên ngoài.');
      },
    },
  );
  return (
    <Card title="Tài liệu bên ngoài">
      <DefList
        items={[
          ['Cơ quan ban hành', ext?.source],
          ['Số hiệu', ext?.number],
          ['Ngày ban hành', formatDate(ext?.issuedAt)],
          ['Kiểm tra hiệu lực gần nhất', formatDateTime(ext?.lastCheckedAt)],
          ['Tình trạng', ext?.isSuperseded ? <Badge key="s" status="withdrawn">Đã bị thay thế</Badge> : <Badge key="s" status="effective">Đang hiệu lực</Badge>],
          ['Bản gốc', ext?.originalUrl ? <a key="u" href={ext.originalUrl} target="_blank" rel="noreferrer">Mở</a> : '—'],
        ]}
      />
      {hasAction(doc, 'update-external') && (
        <div className="actions" style={{ marginTop: '1rem' }}>
          <Button onClick={() => patch.mutate({ lastCheckedAt: new Date().toISOString() })} loading={patch.isPending}>
            Đã kiểm tra: vẫn hiệu lực
          </Button>
          {!ext?.isSuperseded && (
            <Button variant="danger" onClick={() => patch.mutate({ isSuperseded: true, lastCheckedAt: new Date().toISOString() })} loading={patch.isPending}>
              Đánh dấu bị thay thế
            </Button>
          )}
        </div>
      )}
      <ErrorBox error={patch.error} />
      {(related ?? (ext?.isSuperseded ? doc.relatedIds : null))?.length ? (
        <Notice tone="warn">
          <div>
            <strong>Tài liệu nội bộ đang dẫn chiếu tới văn bản này, cần rà lại:</strong>
            <ul>
              {(related ?? doc.relatedIds ?? []).map((rid) => (
                <li key={rid}>
                  <Link href={`/tai-lieu/${rid}`}>Mở tài liệu</Link>
                </li>
              ))}
            </ul>
          </div>
        </Notice>
      ) : null}
    </Card>
  );
}

function FeedbackDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const depts = useDepartments();
  const [reviewerIds, setReviewers] = useState<string[]>([]);
  const [departmentIds, setDepts] = useState<string[]>([]);
  const [dueDate, setDue] = useState('');
  return (
    <ActionDialog
      open
      title="Gửi lấy góp ý"
      description="Người nhận được quyền Nhận xét trên file và nhận thông báo."
      confirmLabel="Gửi"
      canConfirm={!!dueDate && (reviewerIds.length > 0 || departmentIds.length > 0)}
      run={() =>
        unwrap(
          api.POST('/documents/{id}/request-feedback', {
            params: { path: { id } },
            body: { dueDate, reviewerIds: reviewerIds.length ? reviewerIds : undefined, departmentIds: departmentIds.length ? departmentIds : undefined },
          }),
        )
      }
      invalidate={[['document', id]]}
      onClose={onClose}
    >
      <MultiUserPicker label="Người góp ý" value={reviewerIds} onChange={setReviewers} />
      <fieldset className="field">
        <legend>Phòng góp ý</legend>
        {depts.data?.map((d) => (
          <label key={d.id} className="checkbox">
            <input type="checkbox" checked={departmentIds.includes(d.id)} onChange={(e) => setDepts(e.target.checked ? [...departmentIds, d.id] : departmentIds.filter((x) => x !== d.id))} />
            {d.number} {d.code} – {d.name}
          </label>
        ))}
      </fieldset>
      <TextField label="Hạn góp ý" type="date" value={dueDate} onChange={setDue} required min={todayISO()} />
    </ActionDialog>
  );
}

function SubmitDialog({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const router = useRouter();
  // Chỉ hỏi số nhận xét mở khi có quyền xem góp ý (D18).
  const feedback = useQuery({
    queryKey: ['document-feedback', doc.id],
    enabled: hasAction(doc, 'feedback'),
    queryFn: () => unwrap(api.GET('/documents/{id}/feedback', { params: { path: { id: doc.id } } })),
    retry: false,
  });
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const open = feedback.data?.openComments ?? 0;
  return (
    <ActionDialog
      open
      title="Trình duyệt"
      description="File được khoá tạm và chụp lại phiên bản để người duyệt xem đúng bản đã trình."
      confirmLabel="Trình duyệt"
      canConfirm={!override || !!reason.trim()}
      run={(_, key) =>
        unwrap(
          api.POST('/documents/{id}/submit', {
            params: { path: { id: doc.id } },
            body: override ? { overrideOpenComments: true, reason: reason.trim() } : {},
            ...idem(key),
          }),
        )
      }
      invalidate={[['document', doc.id], ['documents'], ['approvals']]}
      onDone={() => router.refresh()}
      onClose={onClose}
    >
      <ApproverPreview objectType="document" objectId={doc.id} />
      {open > 0 && (
        <>
          <Notice tone="warn">File còn {open} nhận xét chưa đóng. Nên xử lý hết trước khi trình.</Notice>
          <label className="checkbox">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Vẫn trình (chỉ trưởng phòng được bỏ qua)
          </label>
          {override && <TextField label="Lý do bỏ qua" value={reason} onChange={setReason} required multiline />}
        </>
      )}
    </ActionDialog>
  );
}

function IssueDialog({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const jobs = useJobs();
  const [effectiveFrom, setFrom] = useState(todayISO());
  const [groups, setGroups] = useState('');
  return (
    <ActionDialog
      open
      title={`Ban hành ${doc.code ?? doc.title}`}
      description="Một nút làm đủ: đổi trạng thái Hiệu lực, ghi bảng đầu file, đặt tên phiên bản, chuyển file vào thư mục chính thức, cập nhật danh mục, gửi thông báo. Bước nào lỗi thì dừng, không đổi trạng thái nửa vời."
      confirmLabel="Ban hành"
      variant="success"
      canConfirm={!!effectiveFrom}
      run={(_, key) =>
        unwrap(
          api.POST('/documents/{id}/issue', {
            params: { path: { id: doc.id } },
            body: { effectiveFrom, notifyGroupIds: groups.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) },
            ...idem(key),
          }),
        )
      }
      onDone={(r) => jobs.track({ jobId: r.jobId, label: `Ban hành ${doc.code ?? ''}`, invalidate: [['document', doc.id], ['documents']] })}
      onClose={onClose}
    >
      <TextField label="Hiệu lực từ ngày" type="date" value={effectiveFrom} onChange={setFrom} required />
      <TextField label="Gửi thông báo tới nhóm Google" value={groups} onChange={setGroups} hint="Email nhóm, cách nhau bằng dấu phẩy. Để trống nếu không cần." />
    </ActionDialog>
  );
}

function ReviseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [kind, setKind] = useState<RevisionKind>('minor');
  const [days, setDays] = useState(String(getLimits().minorUnlockDays));
  return (
    <ActionDialog
      open
      title="Sửa đổi tài liệu"
      confirmLabel={kind === 'minor' ? 'Mở khoá để sửa nhỏ' : 'Bắt đầu sửa lớn'}
      textLabel="Lý do sửa"
      textRequired
      canConfirm={kind === 'major' || Number(days) >= 1}
      run={(reason) =>
        unwrap(api.POST('/documents/{id}/revise', { params: { path: { id } }, body: { kind, reason, unlockDays: kind === 'minor' ? Number(days) : undefined } }))
      }
      invalidate={[['document', id], ['documents']]}
      onClose={onClose}
    >
      <label className="checkbox">
        <input type="radio" name="kind" checked={kind === 'minor'} onChange={() => setKind('minor')} />
        Sửa nhỏ – không đổi phiên bản, không cần duyệt, ghi một dòng lịch sử
      </label>
      <label className="checkbox">
        <input type="radio" name="kind" checked={kind === 'major'} onChange={() => setKind('major')} />
        Sửa lớn – lên phiên bản mới, đi lại góp ý, trình duyệt, ban hành; bản cũ vẫn hiệu lực
      </label>
      {kind === 'minor' && <TextField label="Mở khoá trong (ngày)" type="number" min={1} value={days} onChange={setDays} required inputMode="numeric" />}
    </ActionDialog>
  );
}

function WithdrawDialog({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const router = useRouter();
  const [replacementCode, setReplacement] = useState('');
  const [debounced, setDebounced] = useState('');
  const replacement = useQuery({
    queryKey: ['documents', 'by-code', debounced],
    enabled: debounced.length >= 4,
    queryFn: () => unwrap(api.GET('/documents/by-code/{code}', { params: { path: { code: debounced } } })),
    retry: false,
  });
  return (
    <ActionDialog
      open
      title={`Trình huỷ bỏ ${doc.code ?? doc.title}`}
      description="Duyệt xong: tên file thêm “[HẾT HIỆU LỰC]”, chuyển vào 99 Hết hiệu lực, cập nhật danh mục. Không xoá file."
      confirmLabel="Trình huỷ bỏ"
      variant="danger"
      textLabel="Lý do huỷ bỏ"
      textRequired
      canConfirm={!replacementCode.trim() || !!replacement.data}
      run={(reason, key) =>
        unwrap(api.POST('/documents/{id}/withdraw', { params: { path: { id: doc.id } }, body: { reason, replacedById: replacement.data?.id }, ...idem(key) }))
      }
      invalidate={[['document', doc.id], ['approvals']]}
      onDone={(a) => router.push(`/phe-duyet/${a.id}`)}
      onClose={onClose}
    >
      <ApproverPreview objectType="document_withdrawal" objectId={doc.id} />
      <TextField
        label="Mã tài liệu thay thế"
        value={replacementCode}
        onChange={(v) => {
          setReplacement(v.toUpperCase());
          setDebounced(v.trim().toUpperCase());
        }}
        placeholder="QT-MKT-02"
        hint={replacement.data ? `Thay bằng: ${replacement.data.title}` : 'Không bắt buộc'}
        error={replacementCode && replacement.isError ? 'Không tìm thấy tài liệu hiệu lực có mã này.' : undefined}
      />
    </ActionDialog>
  );
}

function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [result, setResult] = useState<'keep' | 'revise' | 'withdraw'>('keep');
  const labels = { keep: 'Giữ nguyên', revise: 'Cần sửa', withdraw: 'Cần huỷ bỏ' } as const;
  return (
    <ActionDialog
      open
      title="Kết quả rà soát định kỳ"
      description="Kết quả ghi vào lịch sử phiên bản; kỳ rà soát tiếp theo được đặt lại."
      confirmLabel="Ghi kết quả"
      textLabel="Ghi chú"
      run={(note) => unwrap(api.POST('/documents/{id}/review', { params: { path: { id } }, body: { result, note: note || undefined } }))}
      invalidate={[['document', id], ['documents']]}
      onClose={onClose}
    >
      {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
        <label key={k} className="checkbox">
          <input type="radio" name="review" checked={result === k} onChange={() => setResult(k)} />
          {labels[k]}
        </label>
      ))}
    </ActionDialog>
  );
}
