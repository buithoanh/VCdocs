'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { API_BASE, api, getCsrfToken, newId, unwrap } from '@/api/client';

type DriveRow = { id: string; kind: 'file' | 'folder'; name: string; mimeType?: string; size?: number; currentVersionId?: string; contentSha256?: string; versionNumber?: number; createdAt?: string };
type Version = { id: string; number: number; contentSha256: string };
type CreateKind = 'folder' | 'document' | 'spreadsheet' | 'presentation';
type IconName = 'plus' | 'space' | 'trash' | 'search' | 'refresh' | 'folder' | 'doc' | 'sheet' | 'slide' | 'file' | 'upload' | 'download' | 'chevron' | 'close';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const OFFICE: Record<string, { label: string; open: string; native: string; icon: IconName }> = {
  [DOCX]: { label: 'Văn bản', open: 'Mở soạn thảo', native: 'docx', icon: 'doc' },
  [XLSX]: { label: 'Bảng tính', open: 'Mở bảng tính', native: 'xlsx', icon: 'sheet' },
  [PPTX]: { label: 'Trình chiếu', open: 'Mở trình chiếu', native: 'pptx', icon: 'slide' },
};
const CREATE: Record<CreateKind, { label: string; placeholder: string; path: '/drive/folders' | '/drive/documents' | '/drive/spreadsheets' | '/drive/presentations' }> = {
  folder: { label: 'Thư mục', placeholder: 'Tên thư mục mới', path: '/drive/folders' },
  document: { label: 'Văn bản', placeholder: 'Tên văn bản mới', path: '/drive/documents' },
  spreadsheet: { label: 'Bảng tính', placeholder: 'Tên bảng tính mới', path: '/drive/spreadsheets' },
  presentation: { label: 'Trình chiếu', placeholder: 'Tên trình chiếu mới', path: '/drive/presentations' },
};

function Icon({ name }: { name: IconName }) {
  const paths = {
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    space: <><path d="M3 7h6l2 2h10v10H3z"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></>,
    folder: <path d="M3 6h6l2 2h10v11H3z"/>,
    doc: <><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/></>,
    sheet: <><path d="M5 4h14v16H5z"/><path d="M5 10h14M5 15h14M11 4v16"/></>,
    slide: <><path d="M4 5h16v11H4z"/><path d="M12 16v4M8 20h8"/></>,
    file: <><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/></>,
    upload: <><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
  };
  return <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function iconFor(item: DriveRow): IconName {
  if (item.kind === 'folder') return 'folder';
  return OFFICE[item.mimeType ?? '']?.icon ?? 'file';
}

function typeLabel(item: DriveRow) {
  if (item.kind === 'folder') return 'Thư mục';
  return OFFICE[item.mimeType ?? '']?.label ?? (item.mimeType === 'application/pdf' ? 'PDF' : 'Tệp');
}

function formatSize(size?: number) {
  if (size === undefined) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function headers(json = false): HeadersInit {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), 'X-Request-Id': newId(), 'Idempotency-Key': newId(),
    ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}) };
}

export default function WorkspaceDrivePage() {
  const client = useQueryClient();
  const [spaceId, setSpaceId] = useState('');
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [versions, setVersions] = useState<Record<string, Version[]>>({});
  const [edit, setEdit] = useState<{ name: string; parentId: string } | null>(null);
  const [mailRecipient, setMailRecipient] = useState('');
  const [mailMode, setMailMode] = useState<'attachment' | 'link'>('attachment');

  const spaces = useQuery({ queryKey: ['workspace-spaces'], queryFn: () => unwrap(api.GET('/spaces')).then((r) => r.items) });
  const selected = spaceId || spaces.data?.[0]?.id || '';
  const space = spaces.data?.find((s) => s.id === selected);
  const role = space?.role;
  const parentId = path.at(-1)?.id;
  const items = useQuery({ queryKey: ['workspace-drive-items', selected, parentId ?? ''], enabled: !!selected && !showTrash,
    queryFn: () => unwrap(api.GET('/drive/items', { params: { query: { spaceId: selected, ...(parentId ? { parentId } : {}) } } })).then((r) => r.items) });
  const trash = useQuery({ queryKey: ['workspace-drive-trash', selected], enabled: !!selected && showTrash,
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/drive/trash?spaceId=${encodeURIComponent(selected)}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Không đọc được thùng rác.');
      return (await response.json()).items;
    } });
  const listing = showTrash ? trash : items;
  const rows = useMemo(() => {
    const all = ((listing.data ?? []) as DriveRow[]).slice()
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'vi') : a.kind === 'folder' ? -1 : 1));
    const q = search.trim().toLocaleLowerCase('vi');
    return q ? all.filter((row) => row.name.toLocaleLowerCase('vi').includes(q)) : all;
  }, [listing.data, search]);
  const current = rows.find((row) => row.id === selectedId) ?? null;
  const canCreate = !showTrash && !!space?.allowedActions.includes('create-folder');

  const fail = (error: unknown) => setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Thao tác Drive không thành công.' });
  const done = (text: string) => setNotice({ tone: 'success', text });
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['workspace-drive-items', selected] });
    await client.invalidateQueries({ queryKey: ['workspace-drive-trash', selected] });
  }

  function chooseSpace(id: string) {
    setSpaceId(id); setPath([]); setShowTrash(false); setSelectedId(''); setEdit(null); setNotice(null);
  }
  function openFolder(item: DriveRow) {
    setPath((current) => [...current, { id: item.id, name: item.name }]); setSelectedId(''); setEdit(null); setSearch('');
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!creating) return;
      await unwrap(api.POST(CREATE[creating].path, {
        body: { spaceId: selected, name: newName.trim(), ...(parentId ? { parentId } : {}) }, headers: { 'Idempotency-Key': newId() },
      }));
    },
    onSuccess: async () => { done(`Đã tạo ${CREATE[creating!].label.toLowerCase()} ${newName.trim()}.`); setNewName(''); setCreating(null); await refresh(); },
    onError: () => setNotice({ tone: 'error', text: 'Không tạo được. Tên không được chứa dấu /, và không trùng mục đã có trong thư mục này.' }),
  });

  async function upload(file: File) {
    try {
      const body = new FormData();
      body.set('spaceId', selected);
      if (parentId) body.set('parentId', parentId);
      body.set('file', file);
      const response = await fetch(`${API_BASE}/drive/files`, { method: 'POST', body, credentials: 'same-origin', headers: headers() });
      if (!response.ok) throw new Error(response.status === 409 ? `Đã có tệp tên ${file.name} trong thư mục này.` : 'Không tải được tệp.');
      done(`Đã tải lên ${file.name}.`); await refresh();
    } catch (error) { fail(error); }
  }
  async function mutate(target: string, method: 'POST' | 'PATCH', body: unknown, success: string) {
    try {
      const response = await fetch(`${API_BASE}${target}`, { method, credentials: 'same-origin', headers: headers(true), body: JSON.stringify(body ?? {}) });
      if (!response.ok) throw new Error(response.status === 409 ? 'Tên đã tồn tại trong thư mục đích.' : 'Thao tác Drive không thành công.');
      done(success); await refresh(); return true;
    } catch (error) { fail(error); return false; }
  }
  async function saveEdit(item: DriveRow) {
    if (!edit?.name.trim()) return;
    const ok = await mutate(`/drive/items/${item.id}`, 'PATCH', { name: edit.name.trim(), ...(edit.parentId ? { parentId: edit.parentId } : {}) },
      `Đã cập nhật ${edit.name.trim()}.`);
    if (ok) { setEdit(null); if (edit.parentId) setSelectedId(''); }
  }
  async function uploadVersion(item: DriveRow, file: File) {
    try {
      const form = new FormData(); form.set('file', file);
      const response = await fetch(`${API_BASE}/drive/files/${item.id}/versions`, { method: 'POST', body: form, credentials: 'same-origin', headers: headers() });
      if (!response.ok) throw new Error('Không tạo được phiên bản mới.');
      done(`Đã tải phiên bản mới cho ${item.name}.`); await refresh();
      if (versions[item.id]) await loadVersions(item.id);
    } catch (error) { fail(error); }
  }
  async function loadVersions(fileId: string) {
    try {
      const response = await fetch(`${API_BASE}/drive/files/${fileId}/versions`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Không đọc được phiên bản.');
      const payload = await response.json();
      setVersions((all) => ({ ...all, [fileId]: payload.items }));
    } catch (error) { fail(error); }
  }
  async function restoreVersion(item: DriveRow, version: Version) {
    if (await mutate(`/drive/files/${item.id}/versions/${version.id}/restore`, 'POST', {}, `Đã khôi phục bản ${version.number} của ${item.name}.`)) await loadVersions(item.id);
  }
  async function sendDriveFile(item: DriveRow) {
    if (!item.currentVersionId || !item.contentSha256 || !mailRecipient) return;
    try {
      const response = await fetch(`${API_BASE}/mail/send-drive-file`, { method: 'POST', credentials: 'same-origin', headers: headers(true),
        body: JSON.stringify({ to: [mailRecipient], subject: `Tệp Drive: ${item.name}`, text: `Gửi ${item.name} từ VCworkspace`,
          fileId: item.id, versionId: item.currentVersionId, expectedSha256: item.contentSha256, mode: mailMode }) });
      if (!response.ok) throw new Error(mailMode === 'link' ? 'Người nhận chưa có quyền Drive hoặc mail chưa được xác nhận.' : 'Mail chưa được xác nhận.');
      done(`Đã gửi ${mailMode === 'link' ? 'link có xác thực' : 'bản đính kèm'} của ${item.name}.`);
    } catch (error) { fail(error); }
  }

  const folders = ((items.data ?? []) as DriveRow[]).filter((row) => row.kind === 'folder');
  const office = current?.kind === 'file' ? OFFICE[current.mimeType ?? ''] : undefined;

  return <div className="mail-page drive-page">
    <header className="mail-titlebar">
      <div><p className="mail-eyebrow">VCworkspace Drive</p><h1>Bộ nhớ</h1></div>
      <label className="mail-search"><Icon name="search"/><span className="sr-only">Tìm trong thư mục</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong thư mục này"/></label>
      <button className="mail-icon-button" type="button" onClick={() => void listing.refetch()} aria-label="Làm mới danh sách"><Icon name="refresh"/></button>
    </header>
    <div className="mail-shell drive-shell">
      <nav className="mail-folders" aria-label="Không gian Drive">
        {canCreate && <button className="mail-compose-button" type="button" aria-expanded={!!creating}
          onClick={() => { setCreating((value) => value ? null : 'folder'); setNotice(null); }}><Icon name="plus"/>Mới</button>}
        <p className="mail-nav-label">Không gian</p>
        {spaces.isLoading && <p className="drive-muted">Đang tải…</p>}
        {(spaces.data ?? []).map((s) => <button key={s.id} type="button"
          className={`mail-folder-button${s.id === selected && !showTrash ? ' is-active' : ''}`} onClick={() => chooseSpace(s.id)}>
          <Icon name="space"/><span className="drive-space-name">{s.name}<small>{s.role === 'manager' ? 'Quản lý' : 'Chỉ đọc'}</small></span>
        </button>)}
        <p className="mail-nav-label">Khác</p>
        <button type="button" className={`mail-folder-button${showTrash ? ' is-active' : ''}`} disabled={!selected}
          onClick={() => { setShowTrash(true); setSelectedId(''); setEdit(null); setCreating(null); }}><Icon name="trash"/><span>Thùng rác</span></button>
      </nav>

      <section className="mail-list-pane" aria-label={showTrash ? 'Thùng rác' : 'Tệp và thư mục'}>
        <div className="mail-list-header drive-list-header">
          <div className="drive-breadcrumb">
            {showTrash ? <h2>Thùng rác</h2> : <nav aria-label="Đường dẫn thư mục">
              <button type="button" className="drive-crumb" onClick={() => { setPath([]); setSelectedId(''); }}>{space?.name ?? 'Không gian'}</button>
              {path.map((crumb, index) => <span key={crumb.id} className="drive-crumb-wrap"><Icon name="chevron"/>
                <button type="button" className="drive-crumb" aria-current={index === path.length - 1 ? 'page' : undefined}
                  onClick={() => { setPath(path.slice(0, index + 1)); setSelectedId(''); }}>{crumb.name}</button></span>)}
            </nav>}
            <p>{rows.length} mục{search.trim() ? ' khớp tìm kiếm' : ''}</p>
          </div>
          {canCreate && <label className="mail-text-button drive-upload"><Icon name="upload"/>Tải tệp lên
            <input hidden type="file" accept="text/plain,application/octet-stream,.docx,.xlsx,.pptx"
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }}/></label>}
        </div>

        {creating && <form className="drive-create" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) create.mutate(); }}>
          <div className="drive-create-kinds" role="radiogroup" aria-label="Loại mục mới">
            {(Object.keys(CREATE) as CreateKind[]).map((kind) => <button key={kind} type="button" role="radio" aria-checked={creating === kind}
              className={`drive-chip${creating === kind ? ' is-active' : ''}`} onClick={() => setCreating(kind)}>{CREATE[kind].label}</button>)}
          </div>
          <div className="mail-inline-form">
            <label className="drive-grow"><span className="sr-only">Tên mục mới</span>
              <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={CREATE[creating].placeholder}/></label>
            <button type="submit" disabled={!newName.trim() || create.isPending}>Tạo</button>
            <button type="button" className="drive-ghost" onClick={() => { setCreating(null); setNewName(''); }}>Huỷ</button>
          </div>
        </form>}

        {notice && <p role="status" className={`mail-notice drive-notice${notice.tone === 'error' ? ' is-error' : ''}`}>{notice.text}
          <button type="button" aria-label="Đóng thông báo" onClick={() => setNotice(null)}><Icon name="close"/></button></p>}

        {spaces.error && <div className="mail-state is-error"><p>Không tải được danh sách không gian.</p></div>}
        {listing.isLoading && <div className="mail-state"><span className="spinner"/>Đang tải…</div>}
        {listing.error && <div className="mail-state is-error"><p>Không tải được danh sách.</p>
          <button className="btn btn-secondary" onClick={() => void listing.refetch()}>Thử lại</button></div>}
        {!listing.isLoading && !listing.error && rows.length === 0 && <div className="mail-state"><Icon name={showTrash ? 'trash' : 'folder'}/>
          <p>{search.trim() ? 'Không có mục nào khớp.' : showTrash ? 'Thùng rác đang trống.' : 'Thư mục đang trống.'}</p></div>}
        {rows.length > 0 && <ul className="drive-rows" aria-label="Danh sách mục">
          {rows.map((row) => <li key={row.id}>
            <button type="button" className={`mail-message-row drive-row${row.id === selectedId ? ' is-selected' : ''}`}
              onClick={() => { setSelectedId(row.id); setEdit(null); }}
              onDoubleClick={() => { if (row.kind === 'folder' && !showTrash) openFolder(row); }}>
              <span className={`drive-file-icon is-${iconFor(row)}`}><Icon name={iconFor(row)}/></span>
              <span className="mail-message-copy"><strong className="drive-row-name">{row.name}</strong>
                <span className="mail-message-preview">{typeLabel(row)}{row.kind === 'file' ? ` · ${formatSize(row.size)}` : ''}{row.versionNumber ? ` · bản ${row.versionNumber}` : ''}</span></span>
              {row.kind === 'folder' && !showTrash && <span className="drive-open-hint" aria-hidden="true"><Icon name="chevron"/></span>}
            </button>
          </li>)}
        </ul>}
      </section>

      <aside className="mail-reading-pane" aria-label="Chi tiết">
        {!current ? <div className="mail-empty-reader"><span className="mail-empty-illustration"><Icon name="folder"/></span>
          <h2>Chọn một mục</h2><p>Bấm vào tệp hoặc thư mục để xem chi tiết. Bấm đúp vào thư mục để mở.</p></div>
        : <div className="mail-reader drive-detail">
          <div className="mail-pane-toolbar"><div className="drive-detail-title">
            <span className={`drive-file-icon is-large is-${iconFor(current)}`}><Icon name={iconFor(current)}/></span>
            <div><h2>{current.name}</h2><p className="drive-muted">{typeLabel(current)}{current.kind === 'file' ? ` · ${formatSize(current.size)}` : ''}{current.versionNumber ? ` · bản ${current.versionNumber}` : ''}</p></div>
          </div></div>

          <div className="drive-actions">
            {showTrash ? (role === 'manager'
              ? <button type="button" className="mail-send-button" onClick={() => void mutate(`/drive/items/${current.id}/restore`, 'POST', {}, `Đã khôi phục ${current.name}.`).then((ok) => ok && setSelectedId(''))}>Khôi phục</button>
              : <p className="drive-muted">Chỉ người quản lý không gian mới khôi phục được.</p>)
            : <>
              {current.kind === 'folder' && <button type="button" className="mail-send-button" onClick={() => openFolder(current)}>Mở thư mục</button>}
              {office && <a className="mail-send-button drive-link-button" href={`/bo-nho/soan-thao/${current.id}`}>{office.open}</a>}
              {current.kind === 'file' && <a className="mail-download-button" href={`${API_BASE}/drive/files/${current.id}/content`}><Icon name="download"/>Tải xuống</a>}
              {office && <a className="mail-download-button" href={`${API_BASE}/drive/files/${current.id}/export?format=${office.native}`}>Xuất {office.native.toUpperCase()}</a>}
              {office && <a className="mail-download-button" href={`${API_BASE}/drive/files/${current.id}/export?format=pdf`}>Xuất PDF</a>}
            </>}
          </div>

          {!showTrash && role === 'manager' && <section className="drive-section">
            <h3>Đổi tên hoặc di chuyển</h3>
            {!edit ? <button type="button" className="mail-text-button" onClick={() => setEdit({ name: current.name, parentId: '' })}>Đổi tên/di chuyển</button>
            : <form className="drive-form" onSubmit={(event) => { event.preventDefault(); void saveEdit(current); }}>
              <label><span>Tên mới</span><input aria-label={`Tên mới ${current.name}`} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })}/></label>
              <label><span>Thư mục đích</span><select aria-label={`Thư mục đích ${current.name}`} value={edit.parentId} onChange={(event) => setEdit({ ...edit, parentId: event.target.value })}>
                <option value="">Giữ thư mục hiện tại</option>
                {folders.filter((folder) => folder.id !== current.id).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select></label>
              <div className="drive-form-actions"><button type="submit" className="mail-send-button" disabled={!edit.name.trim()}>Lưu</button>
                <button type="button" className="mail-text-button" onClick={() => setEdit(null)}>Huỷ</button></div>
            </form>}
          </section>}

          {!showTrash && current.kind === 'file' && <section className="drive-section">
            <h3>Phiên bản</h3>
            <div className="drive-inline">
              <button type="button" className="mail-text-button" onClick={() => void loadVersions(current.id)}>{versions[current.id] ? 'Tải lại danh sách' : 'Xem phiên bản'}</button>
              {role === 'manager' && <label className="mail-text-button"><Icon name="upload"/>Tải bản mới
                <input hidden type="file" accept="text/plain,application/octet-stream,.docx,.xlsx,.pptx"
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadVersion(current, file); }}/></label>}
            </div>
            {versions[current.id] && <ul className="drive-versions">
              {versions[current.id].map((version) => <li key={version.id}>
                <span>Bản {version.number}{version.number === current.versionNumber ? ' (hiện tại)' : ''}</span>
                <code title={version.contentSha256}>{version.contentSha256.slice(0, 10)}…</code>
                {role === 'manager' && version.number !== current.versionNumber
                  && <button type="button" className="mail-text-button" onClick={() => void restoreVersion(current, version)}>Khôi phục bản {version.number}</button>}
              </li>)}
            </ul>}
          </section>}

          {!showTrash && current.kind === 'file' && <section className="drive-section">
            <h3>Gửi qua email</h3>
            <form className="drive-form" onSubmit={(event) => { event.preventDefault(); void sendDriveFile(current); }}>
              <label><span>Người nhận</span><input type="email" value={mailRecipient} onChange={(event) => setMailRecipient(event.target.value)} placeholder="ten@vcworkspace.test"/></label>
              <label><span>Cách gửi</span><select value={mailMode} onChange={(event) => setMailMode(event.target.value as 'attachment' | 'link')}>
                <option value="attachment">Đính kèm bản hiện tại</option><option value="link">Gửi link cần đăng nhập</option></select></label>
              <div className="drive-form-actions"><button type="submit" className="mail-send-button" disabled={!mailRecipient || !current.currentVersionId}>Gửi bản hiện tại</button></div>
            </form>
          </section>}

          {!showTrash && role === 'manager' && <section className="drive-section drive-danger">
            <button type="button" className="mail-text-button is-danger"
              onClick={() => void mutate(`/drive/items/${current.id}/trash`, 'POST', {}, `Đã bỏ ${current.name} vào thùng rác.`).then((ok) => ok && setSelectedId(''))}>
              <Icon name="trash"/>Bỏ vào thùng rác</button>
          </section>}
        </div>}
      </aside>
    </div>
  </div>;
}
