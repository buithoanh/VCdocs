'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { API_BASE, getCsrfToken, newId } from '@/api/client';
import { MessageBody, type MailBodyAttachment } from './MessageBody';
import { RichTextEditor } from './RichTextEditor';
import { cleanHtml, htmlToPlainText, parseAddressList, textToHtml } from './rich-text';

type Folder = 'inbox' | 'sent';
type Message = { id: string; threadId: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; sentAt: string; deliveryStatus: string; labels?: string[]; folder?: string };
type Label = { id: string; name: string; color?: string };
type SharedMailbox = { id: string; address: string; name: string; currentRoles: string[]; members: { email: string; roles: string[] }[] };
type IconName = 'compose' | 'inbox' | 'sent' | 'search' | 'refresh' | 'paperclip' | 'download' | 'close';

function Icon({ name }: { name: IconName }) {
  const paths = {
    compose: <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
    inbox: <><path d="M4 4h16v16H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
    sent: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></>,
    paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"/>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
  };
  return <svg className="mail-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) throw new Error('Thao tác email không thành công.');
  return response.json();
}

export default function EmailPage() {
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState<Folder>('inbox');
  const [selectedId, setSelectedId] = useState('');
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState('');
  const [mailbox, setMailbox] = useState('');
  const [managing, setManaging] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCopies, setShowCopies] = useState(false);
  const [fromIdentity, setFromIdentity] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [draftId, setDraftId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [attachment, setAttachment] = useState<{ filename: string; contentType: string; contentBase64: string } | null>(null);
  const [labelName, setLabelName] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [aliasAddress, setAliasAddress] = useState('');
  const [sharedAddress, setSharedAddress] = useState('');
  const [sharedName, setSharedName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const spaces = useQuery({ queryKey: ['interop-spaces'], queryFn: () => json('/spaces').then((value) => value.items as { id:string; name:string; role:string }[]) });
  const labels = useQuery({ queryKey: ['mail-labels', mailbox], queryFn: () => json(`/mail/labels${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`).then((value) => value.items as Label[]) });
  const aliases = useQuery({ queryKey: ['mail-aliases'], queryFn: () => json('/mail/aliases').then((value) => value.items as { id: string; address: string }[]) });
  const shared = useQuery({ queryKey: ['mail-shared'], queryFn: () => json('/mail/shared-mailboxes').then((value) => value.items as SharedMailbox[]) });
  const messages = useQuery({ queryKey: ['mail', folder, mailbox, search], queryFn: () => json(`/mail/messages?folder=${encodeURIComponent(folder)}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}${search.trim() ? `&q=${encodeURIComponent(search.trim())}&scope=all` : ''}`).then((value) => value.items as Message[]) });
  const filtered = useMemo(() => messages.data ?? [], [messages.data]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const headers = (idempotent = false) => ({ 'Content-Type': 'application/json', 'X-Request-Id': newId(), ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}), ...(idempotent ? { 'Idempotency-Key': newId() } : {}) });

  /** To/Cc/Bcc tách theo dấu phẩy hoặc chấm phẩy như Gmail/Outlook; server kiểm địa chỉ và bỏ trùng giữa các ô. */
  function recipients() { return { to: parseAddressList(to), cc: parseAddressList(cc), bcc: parseAddressList(bcc) }; }
  /** html (đã lọc allowlist) và text thuần lấy từ cùng nội dung trình soạn thảo. */
  function content() { const html = cleanHtml(bodyHtml); const text = htmlToPlainText(html); return { text, html: text ? html : '' }; }
  async function run(action: () => Promise<void>) { setError(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Có lỗi xảy ra.'); } }
  async function saveDraft() {
    const payload = JSON.stringify({ ...recipients(), subject, ...content() });
    const row = await json(draftId ? `/mail/drafts/${draftId}` : '/mail/drafts', { method: draftId ? 'PATCH' : 'POST', headers: headers(), body: payload });
    setDraftId(row.id); setNotice('Đã lưu bản nháp.');
  }
  async function reopen() {
    if (!draftId) return;
    const row = await json(`/mail/drafts/${draftId}`);
    setTo((row.to ?? []).join(', ')); setCc((row.cc ?? []).join(', ')); setBcc((row.bcc ?? []).join(', ')); setShowCopies(!!(row.cc?.length || row.bcc?.length));
    setSubject(row.subject); setBodyHtml(row.html ? cleanHtml(row.html) : textToHtml(row.text ?? '')); setNotice('Đã mở lại bản nháp.'); setComposing(true);
  }
  async function choose(file: File) {
    setAttachment(await encodedAttachment(file.name, file.type || 'application/octet-stream', await file.arrayBuffer()));
  }
  async function encodedAttachment(filename: string, contentType: string, source: ArrayBuffer) {
    const bytes = new Uint8Array(source); let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { filename, contentType, contentBase64: btoa(binary) };
  }
  async function forwardSelected() {
    if (!selected) return;
    const response = await fetch(`${API_BASE}/mail/messages/${selected.id}/raw${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Không tải được thư gốc để chuyển tiếp.');
    setAttachment(await encodedAttachment('forwarded-message.eml', 'message/rfc822', await response.arrayBuffer()));
    setTo(''); setCc(''); setBcc(''); setSubject(selected.subject.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject}`);
    setBodyHtml(textToHtml(`\n\n---------- Thư được chuyển tiếp ----------\nTừ: ${selected.from}\nĐến: ${selected.to.join(', ')}${selected.cc?.length ? `\nCc: ${selected.cc.join(', ')}` : ''}\nNgày: ${new Date(selected.sentAt).toLocaleString('vi-VN')}\nTiêu đề: ${selected.subject}\n\nThư gốc được đính kèm dưới dạng MIME.`));
    setNotice('Đã đính kèm thư gốc để chuyển tiếp.'); setComposing(true);
  }
  async function send() {
    const response = await fetch(`${API_BASE}/mail/send`, { method: 'POST', credentials: 'same-origin', headers: headers(true), body: JSON.stringify({ ...recipients(), subject, ...content(), draftId: draftId || undefined, attachments: attachment ? [attachment] : [], fromIdentity: fromIdentity || (mailbox || undefined) }) });
    if (!response.ok) throw new Error('Mail server chưa xác nhận gửi.');
    setNotice('Mail server đã nhận thư.'); setDraftId(''); setAttachment(null); setTo(''); setCc(''); setBcc(''); setShowCopies(false); setSubject(''); setBodyHtml(''); setComposing(false); setFolder('sent');
    await queryClient.invalidateQueries({ queryKey: ['mail'] });
  }
  async function post(path: string, payload: unknown) { return json(path, { method: 'POST', headers: headers(true), body: JSON.stringify(payload) }); }
  async function addLabel() { const row = await post(`/mail/labels${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { name: labelName, color: '#0f6cbd' }); setLabelName(''); setNotice(`Đã tạo nhãn ${row.name}.`); await labels.refetch(); }
  async function applyLabel(name: string) { if (!selected) return; await json(`/mail/messages/${selected.id}/labels${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ labels: [...new Set([...(selected.labels ?? []), name])] }) }); setNotice(`Đã gán nhãn ${name}.`); await messages.refetch(); }
  async function createFilter() { await post('/mail/filters', { name: `Lọc ${filterValue}`, field: 'subject', operator: 'contains', value: filterValue, addLabels: labels.data?.[0] ? [labels.data[0].name] : [], moveToFolder: 'inbox', stop: true }); setFilterValue(''); setNotice('Đã bật bộ lọc thư đến.'); }
  async function createAlias() { await post('/mail/aliases', { address: aliasAddress, displayName: aliasAddress.split('@')[0] }); setAliasAddress(''); setNotice('Đã tạo alias gửi; alias không phải hộp thư nhóm.'); await aliases.refetch(); }
  async function createShared() { await post('/mail/shared-mailboxes', { address: sharedAddress, name: sharedName }); setSharedAddress(''); setSharedName(''); setNotice('Đã tạo hộp thư nhóm với quyền tách biệt.'); await shared.refetch(); }
  async function setMember(box: SharedMailbox, roles: string[]) { await json(`/mail/shared-mailboxes/${box.id}/members`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ email: memberEmail, roles }) }); setNotice(roles.length ? 'Đã cập nhật quyền thành viên.' : 'Đã thu hồi quyền thành viên ngay.'); await shared.refetch(); }
  /** `part` lấy từ GET /body, cùng chỉ số với save-to-drive. */
  async function saveAttachmentToDrive(item: MailBodyAttachment) {
    if (!selected) return;
    const target=(spaces.data ?? []).find((space)=>space.role==='manager');
    if (!target) throw new Error('Bạn chưa có không gian Drive được phép ghi.');
    const row=await post(`/mail/messages/${selected.id}/attachments/${item.part}/save-to-drive${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { spaceId:target.id });
    setNotice(`Đã lưu ${row.name} vào ${target.name}; hash ${row.contentSha256.slice(0,12)}…`);
  }
  function openFolder(next: Folder) { setFolder(next); setMailbox(''); setSelectedId(''); setComposing(false); setManaging(false); setNotice(''); }

  return <div className="mail-page">
    <header className="mail-titlebar">
      <div><p className="mail-eyebrow">VCworkspace Mail</p><h1>Email</h1></div>
      <label className="mail-search"><Icon name="search"/><span className="sr-only">Tìm kiếm thư</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong thư"/></label>
      <button className="mail-icon-button" type="button" onClick={() => void messages.refetch()} aria-label="Làm mới danh sách"><Icon name="refresh"/></button>
    </header>
    <div className="mail-shell">
      <nav className="mail-folders" aria-label="Thư mục email">
        <button className="mail-compose-button" type="button" onClick={() => { setManaging(false); setComposing(true); setNotice(''); }}><Icon name="compose"/>Thư mới</button>
        <p className="mail-nav-label">Thư mục</p>
        <button className={`mail-folder-button ${folder === 'inbox' ? 'is-active' : ''}`} type="button" onClick={() => openFolder('inbox')} aria-pressed={folder === 'inbox'}><Icon name="inbox"/><span>Hộp thư đến</span></button>
        <button className={`mail-folder-button ${folder === 'sent' ? 'is-active' : ''}`} type="button" onClick={() => openFolder('sent')} aria-pressed={folder === 'sent'}><Icon name="sent"/><span>Đã gửi</span></button>
        <button className={`mail-folder-button ${managing ? 'is-active' : ''}`} type="button" onClick={() => { setManaging(true); setComposing(false); }} aria-pressed={managing}><Icon name="paperclip"/><span>Quản lý mail</span></button>
        {(shared.data ?? []).map((box) => <button key={box.id} className={`mail-folder-button ${mailbox === box.address ? 'is-active' : ''}`} type="button" onClick={() => { setMailbox(box.address); setFolder('inbox'); setManaging(false); }}><Icon name="inbox"/><span>{box.name}</span></button>)}
        <div className="mail-account"><span className="mail-avatar">VC</span><div><strong>Nội bộ</strong><small>@vcworkspace.test</small></div></div>
      </nav>
      <section className="mail-list-pane" aria-label={folder === 'inbox' ? 'Hộp thư đến' : 'Thư đã gửi'}>
        <div className="mail-list-header"><div><h2>{folder === 'inbox' ? 'Hộp thư đến' : 'Đã gửi'}</h2><p>{filtered.length} thư</p></div></div>
        {messages.isLoading && <div className="mail-state"><span className="spinner"/>Đang tải thư…</div>}
        {messages.error && <div className="mail-state is-error"><p>Không tải được danh sách thư.</p><button className="btn btn-secondary" onClick={() => void messages.refetch()}>Thử lại</button></div>}
        {!messages.isLoading && !messages.error && filtered.length === 0 && <div className="mail-state"><Icon name="inbox"/><strong>Chưa có thư</strong><p>{search ? 'Không tìm thấy kết quả phù hợp.' : 'Thư mới sẽ xuất hiện tại đây.'}</p></div>}
        <div className="mail-message-list">{filtered.map((message) => <button key={message.id} className={`mail-message-row ${selected?.id === message.id && !composing ? 'is-selected' : ''}`} type="button" onClick={() => { setSelectedId(message.id); setComposing(false); }}>
          <span className="mail-avatar is-small">{(folder === 'inbox' ? message.from : message.to[0] || '?').slice(0, 2).toUpperCase()}</span>
          <span className="mail-message-copy"><span className="mail-message-meta"><strong>{folder === 'inbox' ? message.from : `Đến: ${message.to.join(', ')}`}</strong><time>{new Date(message.sentAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</time></span><span className="mail-message-subject">{message.subject || '(Không có tiêu đề)'}</span><span className="mail-message-preview">{message.deliveryStatus === 'accepted' ? 'Mail server đã nhận thư' : 'Chưa gửi thành công'}</span></span>
        </button>)}</div>
      </section>
      <main className="mail-reading-pane">
        {managing ? <section className="mail-management" aria-label="Quản lý email">
          <div className="mail-pane-toolbar"><div><p className="mail-eyebrow">Quản trị cá nhân</p><h2>Nhãn, bộ lọc và danh tính</h2></div></div>
          {(notice || error) && <p className={`mail-notice ${error ? 'is-error' : ''}`} role="status">{error || notice}</p>}
          <div className="mail-management-grid">
            <form onSubmit={(event) => { event.preventDefault(); void run(addLabel); }}><h3>Nhãn nhiều lựa chọn</h3><p>Nhãn độc lập với thư mục và có thể gán nhiều nhãn cho một thư.</p><div className="mail-inline-form"><input aria-label="Tên nhãn" value={labelName} onChange={(event) => setLabelName(event.target.value)} required/><button>Tạo nhãn</button></div><div className="mail-chips">{(labels.data ?? []).map((label) => <button type="button" key={label.id} onClick={() => void run(() => applyLabel(label.name))}>{label.name}</button>)}</div></form>
            <form onSubmit={(event) => { event.preventDefault(); void run(createFilter); }}><h3>Bộ lọc thư đến</h3><p>Khớp tiêu đề, tự gán nhãn đầu tiên; không chuyển tiếp nên không tạo vòng lặp.</p><div className="mail-inline-form"><input aria-label="Chuỗi tiêu đề cần lọc" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} required/><button>Tạo bộ lọc</button></div></form>
            <form onSubmit={(event) => { event.preventDefault(); void run(createAlias); }}><h3>Alias gửi</h3><p>Alias là danh tính gửi của cá nhân, không tạo hộp thư dùng chung.</p><div className="mail-inline-form"><input aria-label="Địa chỉ alias" type="email" value={aliasAddress} onChange={(event) => setAliasAddress(event.target.value)} placeholder="alias@vcworkspace.test" required/><button>Tạo alias</button></div><ul>{(aliases.data ?? []).map((item) => <li key={item.id}>{item.address}</li>)}</ul></form>
            <form onSubmit={(event) => { event.preventDefault(); void run(createShared); }}><h3>Hộp thư nhóm</h3><p>Quyền đọc, gửi và quản lý được cấp riêng.</p><input aria-label="Tên hộp thư nhóm" value={sharedName} onChange={(event) => setSharedName(event.target.value)} required/><div className="mail-inline-form"><input aria-label="Địa chỉ hộp thư nhóm" type="email" value={sharedAddress} onChange={(event) => setSharedAddress(event.target.value)} placeholder="nhom@vcworkspace.test" required/><button>Tạo hộp thư</button></div></form>
            {(shared.data ?? []).map((box) => <section key={box.id} className="mail-shared-card"><h3>{box.name}</h3><p>{box.address}</p><input aria-label={`Thành viên ${box.name}`} type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="nguoi@vcworkspace.test"/><div className="mail-chips"><button type="button" onClick={() => void run(() => setMember(box, ['read']))}>Chỉ đọc</button><button type="button" onClick={() => void run(() => setMember(box, ['read', 'send']))}>Đọc + gửi</button><button type="button" onClick={() => void run(() => setMember(box, ['read', 'send', 'manage']))}>Quản lý</button><button type="button" className="is-danger" onClick={() => void run(() => setMember(box, []))}>Thu hồi</button></div><ul>{box.members.map((member) => <li key={member.email}>{member.email}: {member.roles.join(', ')}</li>)}</ul></section>)}
          </div>
        </section> : composing ? <section className="mail-compose" aria-label="Soạn thư mới">
          <div className="mail-pane-toolbar"><div><p className="mail-eyebrow">Soạn thư</p><h2>{draftId ? 'Bản nháp' : 'Thư mới'}</h2></div><button className="mail-icon-button" type="button" onClick={() => setComposing(false)} aria-label="Đóng soạn thư"><Icon name="close"/></button></div>
          <div className="mail-compose-fields">
            <label><span>Gửi từ</span><select value={fromIdentity} onChange={(event) => setFromIdentity(event.target.value)}><option value="">Địa chỉ cá nhân</option>{(aliases.data ?? []).map((item) => <option key={item.id} value={item.address}>{item.address}</option>)}{(shared.data ?? []).filter((box) => box.currentRoles.includes('send')).map((box) => <option key={box.id} value={box.address}>{box.name} — {box.address}</option>)}</select></label>
            <div className="mail-recipient-row"><label><span>Đến</span><input value={to} onChange={(event) => setTo(event.target.value)} placeholder="ten@vcworkspace.test, ..."/></label><button className="mail-copies-toggle" type="button" aria-expanded={showCopies} aria-controls="mail-copy-fields" onClick={() => setShowCopies((value) => !value)}>Cc/Bcc</button></div>
            {showCopies && <div id="mail-copy-fields" className="mail-copy-fields">
              <label><span>Cc</span><input value={cc} onChange={(event) => setCc(event.target.value)} placeholder="Phân cách bằng dấu phẩy hoặc chấm phẩy"/></label>
              <label><span>Bcc</span><input value={bcc} onChange={(event) => setBcc(event.target.value)} placeholder="Người nhận ẩn, không ai khác thấy"/></label>
            </div>}
            <label><span>Tiêu đề</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Thêm tiêu đề"/></label>
            <div className="mail-body-field"><RichTextEditor value={bodyHtml} onChange={setBodyHtml} onError={setError} label="Nội dung" placeholder="Nhập nội dung thư…"/></div>
          </div>
          {attachment && <div className="mail-attachment"><Icon name="paperclip"/><span>{attachment.filename}</span><button type="button" onClick={() => setAttachment(null)} aria-label={`Bỏ tệp ${attachment.filename}`}><Icon name="close"/></button></div>}
          {(notice || error) && <p className={`mail-notice ${error ? 'is-error' : ''}`} role="status">{error || notice}</p>}
          <div className="mail-compose-actions"><button className="mail-send-button" type="button" disabled={!parseAddressList(to).length || !subject} onClick={() => void run(send)}>Gửi</button><label className="mail-attach-button"><Icon name="paperclip"/><span>Đính kèm</span><input className="sr-only" type="file" onChange={(event) => event.target.files?.[0] && void choose(event.target.files[0])}/></label><button className="mail-text-button" type="button" onClick={() => void run(saveDraft)}>Lưu nháp</button><button className="mail-text-button" type="button" disabled={!draftId} onClick={() => void run(reopen)}>Mở lại</button></div>
        </section> : selected ? <article className="mail-reader">
          <div className="mail-pane-toolbar"><div><p className="mail-eyebrow">{folder === 'inbox' ? 'Hộp thư đến' : 'Đã gửi'}</p><h2>{selected.subject || '(Không có tiêu đề)'}</h2></div><div className="mail-reader-actions"><button className="mail-download-button" type="button" onClick={() => void run(forwardSelected)}><Icon name="sent"/>Chuyển tiếp</button><a className="mail-download-button" href={`${API_BASE}/mail/messages/${selected.id}/raw${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`}><Icon name="download"/>Tải MIME</a></div></div>
          <div className="mail-sender"><span className="mail-avatar">{selected.from.slice(0, 2).toUpperCase()}</span><div><strong>{selected.from}</strong><p>Đến {selected.to.join(', ')}</p>{selected.cc?.length ? <p>Cc {selected.cc.join(', ')}</p> : null}{selected.bcc?.length ? <p>Bcc {selected.bcc.join(', ')}</p> : null}</div><time>{new Date(selected.sentAt).toLocaleString('vi-VN')}</time></div>
          {selected.labels?.length || selected.deliveryStatus !== 'accepted' ? <div className="mail-chips mail-reader-labels">{selected.labels?.map((label) => <span key={label}>{label}</span>)}{selected.deliveryStatus !== 'accepted' && <span className="mail-delivery is-error">Gửi chưa thành công</span>}</div> : null}
          <MessageBody key={`${selected.id}:${mailbox}`} messageId={selected.id} mailbox={mailbox} onSaveAttachment={(item) => void run(() => saveAttachmentToDrive(item))}/>
          {(notice || error) && <p className={`mail-notice ${error ? 'is-error' : ''}`} role="status">{error || notice}</p>}
        </article> : <div className="mail-empty-reader"><div className="mail-empty-illustration"><Icon name="inbox"/></div><h2>Chọn một thư để đọc</h2><p>Hoặc bắt đầu cuộc trò chuyện mới với đồng nghiệp.</p><button className="mail-compose-button" type="button" onClick={() => { setManaging(false); setComposing(true); }}><Icon name="compose"/>Thư mới</button></div>}
      </main>
    </div>
  </div>;
}
