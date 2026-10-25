'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { API_BASE, api, getCsrfToken, newId, unwrap } from '@/api/client';
import { DataTable } from '@/components/DataTable';
import { PageHeader, QueryState } from '@/components/ui';

type DriveRow = { id: string; kind: 'file' | 'folder'; name: string; mimeType?: string; size?: number; currentVersionId?: string; contentSha256?: string };

export default function WorkspaceDrivePage() {
  const client = useQueryClient();
  const [spaceId, setSpaceId] = useState('');
  const [folderName, setFolderName] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [presentationName, setPresentationName] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [versions, setVersions] = useState<Record<string, Array<{ id: string; number: number; contentSha256: string }>>>({});
  const [editing, setEditing] = useState<Record<string, { name: string; parentId: string }>>({});
  const [mailRecipient, setMailRecipient] = useState('');
  const [mailMode, setMailMode] = useState<'attachment'|'link'>('attachment');
  const [mailNotice, setMailNotice] = useState('');
  const spaces = useQuery({ queryKey: ['workspace-spaces'], queryFn: () => unwrap(api.GET('/spaces')).then((r) => r.items) });
  const selected = spaceId || spaces.data?.[0]?.id || '';
  const items = useQuery({ queryKey: ['workspace-drive-items', selected], enabled: !!selected,
    queryFn: () => unwrap(api.GET('/drive/items', { params: { query: { spaceId: selected } } })).then((r) => r.items) });
  const trash = useQuery({ queryKey: ['workspace-drive-trash', selected], enabled: !!selected && showTrash,
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/drive/trash?spaceId=${encodeURIComponent(selected)}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Không đọc được thùng rác.');
      return (await response.json()).items;
    } });
  const refresh = () => client.invalidateQueries({ queryKey: ['workspace-drive-items', selected] });
  const createFolder = useMutation({ mutationFn: () => unwrap(api.POST('/drive/folders', {
    body: { spaceId: selected, name: folderName }, headers: { 'Idempotency-Key': newId() },
  })), onSuccess: () => { setFolderName(''); void refresh(); } });
  const createDocument = useMutation({ mutationFn: () => unwrap(api.POST('/drive/documents', {
    body: { spaceId: selected, name: documentName }, headers: { 'Idempotency-Key': newId() },
  })), onSuccess: () => { setDocumentName(''); void refresh(); } });
  const createSpreadsheet = useMutation({ mutationFn: () => unwrap(api.POST('/drive/spreadsheets', {
    body: { spaceId: selected, name: spreadsheetName }, headers: { 'Idempotency-Key': newId() },
  })), onSuccess: () => { setSpreadsheetName(''); void refresh(); } });
  const createPresentation = useMutation({ mutationFn: () => unwrap(api.POST('/drive/presentations', {
    body: { spaceId: selected, name: presentationName }, headers: { 'Idempotency-Key': newId() },
  })), onSuccess: () => { setPresentationName(''); void refresh(); } });
  async function upload(file: File) {
    const body = new FormData();
    body.set('spaceId', selected);
    body.set('file', file);
    const response = await fetch(`${API_BASE}/drive/files`, { method: 'POST', body, credentials: 'same-origin',
      headers: { 'X-Request-Id': newId(), 'Idempotency-Key': newId(), ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}) } });
    if (!response.ok) throw new Error('Không tải được tệp.');
    await refresh();
  }
  async function mutate(path: string, method: 'POST' | 'PATCH', body?: unknown) {
    const response = await fetch(`${API_BASE}${path}`, { method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': newId(), 'Idempotency-Key': newId(),
        ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}) }, body: JSON.stringify(body ?? {}) });
    if (!response.ok) throw new Error('Thao tác Drive không thành công.');
    await refresh();
    await client.invalidateQueries({ queryKey: ['workspace-drive-trash', selected] });
  }
  function beginEdit(item: DriveRow) {
    setEditing((current) => ({ ...current, [item.id]: { name: item.name, parentId: '' } }));
  }
  async function saveEdit(item: DriveRow) {
    const edit = editing[item.id];
    if (!edit?.name.trim()) return;
    await mutate(`/drive/items/${item.id}`, 'PATCH', {
      name: edit.name.trim(), ...(edit.parentId ? { parentId: edit.parentId } : {}),
    });
    setEditing((current) => { const next = { ...current }; delete next[item.id]; return next; });
  }
  async function uploadVersion(fileId: string, file: File) {
    const form = new FormData(); form.set('file', file);
    const response = await fetch(`${API_BASE}/drive/files/${fileId}/versions`, { method: 'POST', body: form,
      credentials: 'same-origin', headers: { 'X-Request-Id': newId(), 'Idempotency-Key': newId(),
        ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}) } });
    if (!response.ok) throw new Error('Không tạo được phiên bản.');
    await refresh();
  }
  async function loadVersions(fileId: string) {
    const response = await fetch(`${API_BASE}/drive/files/${fileId}/versions`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Không đọc được phiên bản.');
    const payload = await response.json();
    setVersions((current) => ({ ...current, [fileId]: payload.items }));
  }
  async function sendDriveFile(item: DriveRow) {
    if (!item.currentVersionId || !item.contentSha256 || !mailRecipient) return;
    const response=await fetch(`${API_BASE}/mail/send-drive-file`, { method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json', 'X-Request-Id':newId(), 'Idempotency-Key':newId(), ...(getCsrfToken()?{'X-CSRF-Token':getCsrfToken()!}:{}) }, body:JSON.stringify({ to:[mailRecipient], subject:`Tệp Drive: ${item.name}`, text:`Gửi ${item.name} từ VCworkspace`, fileId:item.id, versionId:item.currentVersionId, expectedSha256:item.contentSha256, mode:mailMode }) });
    if (!response.ok) throw new Error(mailMode==='link'?'Người nhận chưa có quyền Drive hoặc mail chưa được xác nhận.':'Mail chưa được xác nhận.');
    setMailNotice(`Đã gửi ${mailMode==='link'?'link có xác thực':'snapshot bất biến'} của ${item.name}.`);
  }
  const role = spaces.data?.find((s) => s.id === selected)?.role;
  const rows = (showTrash ? (trash.data ?? []) : (items.data ?? [])) as DriveRow[];
  return <>
    <PageHeader title="Bộ nhớ VCworkspace" subtitle="Thư mục và tệp qua hợp đồng kho trung lập" />
    <QueryState q={spaces}>
      <label>Không gian <select value={selected} onChange={(e) => setSpaceId(e.target.value)}>
        {(spaces.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role === 'manager' ? 'Quản lý' : 'Chỉ đọc'}</option>)}
      </select></label>
      <div className="toolbar"><button onClick={() => setShowTrash((value) => !value)}>{showTrash ? 'Quay lại tệp' : 'Mở thùng rác'}</button></div>
      {!showTrash && <div className="toolbar"><input type="email" value={mailRecipient} onChange={(event)=>setMailRecipient(event.target.value)} placeholder="người nhận @vcworkspace.test"/><select value={mailMode} onChange={(event)=>setMailMode(event.target.value as 'attachment'|'link')}><option value="attachment">Gửi snapshot attachment</option><option value="link">Gửi link cần đăng nhập</option></select>{mailNotice && <span role="status">{mailNotice}</span>}</div>}
      {!showTrash && spaces.data?.find((s) => s.id === selected)?.allowedActions.includes('create-folder') && <div className="toolbar">
        <input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Tên thư mục mới" />
        <button onClick={() => createFolder.mutate()} disabled={!folderName.trim() || createFolder.isPending}>Tạo thư mục</button>
        <input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="Tên văn bản mới" />
        <button onClick={() => createDocument.mutate()} disabled={!documentName.trim() || createDocument.isPending}>Tạo văn bản từ mẫu</button>
        <input value={spreadsheetName} onChange={(e) => setSpreadsheetName(e.target.value)} placeholder="Tên bảng tính mới" />
        <button onClick={() => createSpreadsheet.mutate()} disabled={!spreadsheetName.trim() || createSpreadsheet.isPending}>Tạo bảng tính từ mẫu</button>
        <input value={presentationName} onChange={(e) => setPresentationName(e.target.value)} placeholder="Tên trình chiếu mới" />
        <button onClick={() => createPresentation.mutate()} disabled={!presentationName.trim() || createPresentation.isPending}>Tạo trình chiếu từ mẫu</button>
        <label className="button">Tải tệp<input hidden type="file" accept="text/plain,application/octet-stream,.docx,.xlsx,.pptx" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} /></label>
      </div>}
      <QueryState q={showTrash ? trash : items}>
        <DataTable<DriveRow> rows={rows} rowKey={(item) => item.id} empty={showTrash ? 'Thùng rác đang trống.' : 'Không gian đang trống.'}
          columns={[
            { key: 'name', header: 'Tên', render: (item) => <strong>{item.kind === 'folder' ? '📁 ' : '📄 '}{item.name}</strong> },
            { key: 'kind', header: 'Loại', render: (item) => item.kind === 'folder' ? 'Thư mục' : item.mimeType },
            { key: 'size', header: 'Dung lượng', render: (item) => item.kind === 'file' ? `${item.size} byte` : '—' },
            { key: 'actions', header: 'Thao tác', render: (item) => showTrash
              ? role === 'manager' && <button onClick={() => void mutate(`/drive/items/${item.id}/restore`, 'POST')}>Khôi phục</button>
              : <div className="toolbar">
                {item.kind === 'file' && <a href={`${API_BASE}/drive/files/${item.id}/content`}>Tải xuống</a>}
                {item.kind === 'file' && item.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  && <><a href={`/bo-nho/soan-thao/${item.id}`}>Mở soạn thảo</a>
                    <a href={`${API_BASE}/drive/files/${item.id}/export?format=docx`}>Xuất DOCX</a>
                    <a href={`${API_BASE}/drive/files/${item.id}/export?format=pdf`}>Xuất PDF</a></>}
                {item.kind === 'file' && item.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  && <><a href={`/bo-nho/soan-thao/${item.id}`}>Mở bảng tính</a>
                    <a href={`${API_BASE}/drive/files/${item.id}/export?format=xlsx`}>Xuất XLSX</a>
                    <a href={`${API_BASE}/drive/files/${item.id}/export?format=pdf`}>Xuất PDF</a></>}
                {item.kind === 'file' && item.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                  && <><a href={`/bo-nho/soan-thao/${item.id}`}>Mở trình chiếu</a>
                    <a href={`${API_BASE}/drive/files/${item.id}/export?format=pptx`}>Xuất PPTX</a>
                    <a href={`${API_BASE}/drive/files/${item.id}/export?format=pdf`}>Xuất PDF</a></>}
                {role === 'manager' && !editing[item.id] && <button onClick={() => beginEdit(item)}>Đổi tên/di chuyển</button>}
                {role === 'manager' && editing[item.id] && <>
                  <input aria-label={`Tên mới ${item.name}`} value={editing[item.id].name}
                    onChange={(e) => setEditing((current) => ({ ...current, [item.id]: { ...current[item.id], name: e.target.value } }))} />
                  <select aria-label={`Thư mục đích ${item.name}`} value={editing[item.id].parentId}
                    onChange={(e) => setEditing((current) => ({ ...current, [item.id]: { ...current[item.id], parentId: e.target.value } }))}>
                    <option value="">Giữ thư mục hiện tại</option>
                    {(items.data ?? []).filter((candidate) => candidate.kind === 'folder' && candidate.id !== item.id)
                      .map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select>
                  <button onClick={() => void saveEdit(item)}>Lưu</button>
                  <button onClick={() => setEditing((current) => { const next = { ...current }; delete next[item.id]; return next; })}>Huỷ</button>
                </>}
                {role === 'manager' && item.kind === 'file' && <label className="button">Bản mới<input hidden type="file" accept="text/plain,application/octet-stream" onChange={(e) => e.target.files?.[0] && void uploadVersion(item.id, e.target.files[0])} /></label>}
                {item.kind === 'file' && <button onClick={() => void loadVersions(item.id)}>Phiên bản</button>}
                {item.kind === 'file' && <button disabled={!mailRecipient || !item.currentVersionId} onClick={() => void sendDriveFile(item)}>Gửi bản hiện tại</button>}
                {role === 'manager' && <button onClick={() => void mutate(`/drive/items/${item.id}/trash`, 'POST')}>Bỏ vào thùng rác</button>}
                {versions[item.id]?.map((version) => <button key={version.id} disabled={role !== 'manager'}
                  title={version.contentSha256} onClick={() => void mutate(`/drive/files/${item.id}/versions/${version.id}/restore`, 'POST')}>
                  Khôi phục bản {version.number}
                </button>)}
              </div> },
          ]} />
      </QueryState>
    </QueryState>
  </>;
}
