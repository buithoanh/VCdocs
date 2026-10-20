'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction, useApprovedCodes, useDrives } from '@/api/queries';
import type { Folder, FolderKind } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { useJobs } from '@/components/jobs';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, DefList, ErrorBox, Loading, Modal, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
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
      <div className="filters">
        <SelectField
          label="Bộ nhớ dùng chung"
          value={driveId}
          onChange={(v) => {
            setDriveId(v);
            setSelectedId(null);
          }}
          placeholder={drives.isLoading ? 'Đang tải…' : '— Chọn drive —'}
          options={(drives.data ?? []).map((d) => ({ value: d.driveId, label: `${d.name}${d.myRole ? '' : ' (không là thành viên)'}` }))}
        />
      </div>
      <div className="layout-split">
        <Card title="Thư mục">
          <QueryState q={roots} empty={!!roots.data && roots.data.length === 0}>
            <ul className="tree">
              {roots.data?.map((f) => (
                <TreeNode key={f.id} folder={f} selectedId={selectedId} onSelect={setSelectedId} />
              ))}
            </ul>
          </QueryState>
          {!driveId && !drives.isLoading && <p className="muted">Chọn một drive.</p>}
        </Card>
        <div>{selectedId ? <FolderDetail id={selectedId} /> : <p className="empty">Chọn một thư mục để xem chi tiết.</p>}</div>
      </div>
      {creating && <CreateFolderDialog driveId={driveId} parentId={selectedId} onClose={() => setCreating(false)} />}
      {periods && <EnsurePeriodsDialog driveId={driveId} onClose={() => setPeriods(false)} />}
    </>
  );
}

function TreeNode({ folder, selectedId, onSelect }: { folder: Folder; selectedId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const children = useQuery({
    queryKey: ['folders', 'children', folder.id],
    enabled: open,
    queryFn: () => unwrap(api.GET('/folders/{id}/children', { params: { path: { id: folder.id } } })).then((r) => r.items),
  });
  const canOpen = folder.hasChildren !== false;
  return (
    <li>
      <div className={`tree-row ${selectedId === folder.id ? 'is-selected' : ''}`}>
        <button className="tree-toggle" aria-label={open ? 'Thu gọn' : 'Mở rộng'} aria-expanded={open} disabled={!canOpen} onClick={() => setOpen((v) => !v)}>
          {canOpen ? (open ? '▾' : '▸') : '·'}
        </button>
        <button className="tree-name" onClick={() => onSelect(folder.id)}>
          {folder.number && <span className="mono">{folder.number} </span>}
          {folder.code && folder.code !== folder.shortName ? `${folder.code} ` : ''}
          {folder.shortName}
        </button>
        {folder.status !== 'active' && <Badge status="expired">{folderStatusLabel[folder.status]}</Badge>}
        {!folder.isManagedByVcdocs && <span className="muted small" title="Thư mục tạo ngoài VCdocs">(ngoài sổ)</span>}
      </div>
      {open && (
        <>
          {children.isLoading && <Loading />}
          {children.error && <ErrorBox error={children.error} onRetry={() => children.refetch()} />}
          {children.data && children.data.length > 0 && (
            <ul className="tree">
              {children.data.map((c) => (
                <TreeNode key={c.id} folder={c} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

function FolderDetail({ id }: { id: string }) {
  const { can } = useAuth();
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
            <p className="mono">{f.path}</p>
            <h3>{f.fullName}</h3>
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
            <div className="actions" style={{ marginTop: '1rem' }}>
              <a className="btn btn-secondary" href={`https://drive.google.com/drive/folders/${encodeURIComponent(f.googleId)}`} target="_blank" rel="noreferrer">
                Mở trên Drive
              </a>
              {hasAction(f, 'rename') && (
                <Button onClick={() => setRenaming(true)}>Đổi tên</Button>
              )}
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
            </div>
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

function RenameDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const toast = useToast();
  const [shortName, setShort] = useState(folder.shortName);
  const [fullName, setFull] = useState(folder.fullName);
  const save = useAction(
    () => unwrap(api.POST('/folders/{id}/rename', { params: { path: { id: folder.id } }, body: { shortName: shortName.trim(), fullName: fullName.trim() || undefined } })),
    { invalidate: [['folder', folder.id], ['folders']], onSuccess: () => (toast.success('Đã đổi tên thư mục.'), onClose()) },
  );
  return (
    <Modal
      open
      title="Đổi tên thư mục"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!shortName.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <p className="hint">Giữ nguyên số {folder.number} và mã {folder.code ?? '—'}; tên ghép lại đúng mẫu.</p>
      <TextField label="Tên ngắn" value={shortName} onChange={setShort} required />
      <TextField label="Tên đầy đủ" value={fullName} onChange={setFull} />
      <ErrorBox error={save.error} />
    </Modal>
  );
}

const ROOT = '__goc__';

function CreateFolderDialog({ driveId, parentId: initialParent, onClose }: { driveId: string; parentId: string | null; onClose: () => void }) {
  const jobs = useJobs();
  const drives = useDrives();
  const drive = drives.data?.find((d) => d.driveId === driveId);
  const codes = useApprovedCodes(drive?.departmentId);
  const parents = useQuery({
    queryKey: ['folders', 'parents', driveId],
    enabled: !!driveId,
    queryFn: () => unwrap(api.GET('/folders', { params: { query: { driveId, depth: 2 } } })).then((r) => r.items.filter((f) => hasAction(f, 'create-child'))),
  });
  const { can } = useAuth();
  const [parentId, setParent] = useState(initialParent ?? (can('createFolder') ? ROOT : ''));
  const atRoot = parentId === ROOT;
  const [kind, setKind] = useState<FolderKind | ''>('area');
  // Đổi sang gốc drive mà đang chọn năm/tháng/đối tượng thì bỏ chọn (D20).
  useEffect(() => {
    if (kind && !allowedFolderKinds(atRoot).includes(kind)) setKind('');
  }, [atRoot, kind]);
  const [code, setCode] = useState('');
  const [shortName, setShort] = useState('');
  const [fullName, setFull] = useState('');
  const next = useQuery({
    queryKey: ['folders', 'next-number', driveId, parentId, kind],
    enabled: !!parentId && !!kind,
    queryFn: () =>
      unwrap(api.GET('/folders/next-number', { params: { query: atRoot ? { driveId, kind: kind as FolderKind } : { parentId, kind: kind as FolderKind } } })).then((r) => r.number),
  });
  const needsCode = kind === 'area' || kind === 'project';
  const valid = !!driveId && !!parentId && !!kind && !!shortName.trim() && (!needsCode || !!code);
  const preview = useMemo(() => previewFolderName(next.data ?? '??', code, shortName, fullName), [next.data, code, shortName, fullName]);
  const save = useAction(
    (_: void, key: string) =>
      unwrap(
        api.POST('/folders', {
          body: { driveId, parentId: atRoot ? undefined : parentId, kind: kind as FolderKind, code: code || undefined, shortName: shortName.trim(), fullName: fullName.trim() || undefined },
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
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Tạo thư mục
          </Button>
        </>
      }
    >
      <SelectField
        label="Nằm trong thư mục"
        value={parentId}
        onChange={setParent}
        required
        placeholder={parents.isLoading ? 'Đang tải…' : '— Chọn thư mục cha —'}
        options={[...(can('createFolder') ? [{ value: ROOT, label: `Gốc drive ${drive?.name ?? ''}` }] : []), ...(parents.data ?? []).map((f) => ({ value: f.id, label: f.path }))]}
      />
      <SelectField label="Loại" value={kind} onChange={setKind} required options={allowedFolderKinds(atRoot).map((k) => ({ value: k, label: folderKindLabel[k] }))} hint={atRoot ? 'Thư mục năm, tháng, đối tượng chỉ tạo được bên trong một thư mục.' : undefined} />
      <p className="hint">Số kế tiếp còn trống: {next.isLoading ? '…' : <strong>{next.data ?? '—'}</strong>}</p>
      {next.error && <ErrorBox error={next.error} />}
      <SelectField
        label="Mã (từ Bảng mã đã duyệt)"
        value={code}
        onChange={setCode}
        required={needsCode}
        placeholder={codes.isLoading ? 'Đang tải…' : '— Chọn mã —'}
        options={(codes.data ?? []).map((c) => ({ value: c.code, label: `${c.code} – ${c.meaning}` }))}
        hint="Chưa có mã phù hợp? Trưởng phòng đề nghị mã mới ở Bảng mã."
      />
      <TextField label="Tên ngắn" value={shortName} onChange={setShort} required placeholder="PTDA" />
      <TextField label="Tên đầy đủ" value={fullName} onChange={setFull} placeholder="Phát triển dự án" />
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
      <TextField label="Tháng" type="month" value={month} onChange={setMonth} required />
      <label className="checkbox">
        <input type="checkbox" checked={allDrives} onChange={(e) => setAll(e.target.checked)} />
        Cho mọi drive
      </label>
    </ActionDialog>
  );
}
