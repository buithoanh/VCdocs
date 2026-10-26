'use client';

import Icon, { CloseOutlined, DownloadOutlined, EditOutlined, InboxOutlined, PaperClipOutlined, ReloadOutlined, SearchOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar, Button, Card, Col, Empty, Flex, Form, Input, Row, Select, Space, Spin, Tag, Typography, Upload } from 'antd';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { API_BASE, getCsrfToken, newId } from '@/api/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { ErrorBox } from '@/components/ui';
import { mailBodyQuery, MessageBody, type MailBodyAttachment } from './MessageBody';
import { quotedReplyHtml, replyRecipients, replySubject, threadHeaders } from './reply';
import { RichTextEditor } from './RichTextEditor';
import { cleanHtml, htmlToPlainText, parseAddressList, textToHtml } from './rich-text';

type Folder = 'inbox' | 'sent';
type Message = { id: string; mailboxOwner?: string; threadId: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; sentAt: string; deliveryStatus: string; labels?: string[]; folder?: string };
type Label = { id: string; name: string; color?: string };
type SharedMailbox = { id: string; address: string; name: string; currentRoles: string[]; members: { email: string; roles: string[] }[] };
/** Header luồng thư khi soạn trả lời: In-Reply-To và References của thư gốc. */
type ReplyRefs = { inReplyTo: string; references: string[] };

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) throw new Error('Thao tác email không thành công.');
  return response.json();
}

const initials = (s: string) => (s || '?').slice(0, 2).toUpperCase();
/** antd chưa có icon Trả lời / Trả lời tất cả: vẽ bằng SVG nét, bọc trong antd `Icon` để cùng cỡ và màu với bộ icon chung. */
const strokeSvg = (paths: ReactNode) => () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);
const ReplySvg = strokeSvg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
const ReplyAllSvg = strokeSvg(<><path d="M7 14 2 9l5-5" /><path d="M12 14 7 9l5-5" /><path d="M7 9h8.5a5.5 5.5 0 0 1 0 11H13" /></>);
const NO_SHARED: SharedMailbox[] = [];

async function encodedAttachment(filename: string, contentType: string, source: ArrayBuffer) {
  const bytes = new Uint8Array(source);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { filename, contentType, contentBase64: btoa(binary) };
}

/** Nút điều hướng cột trái: chữ ẩn trên màn hình hẹp (CSS .mail-nav-text). */
function NavButton({ active, icon, children, ...rest }: { active?: boolean; icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button block className="mail-nav-btn" type="text" color={active ? 'primary' : 'default'} variant={active ? 'filled' : 'text'} icon={icon} aria-pressed={active} {...rest}>
      <span className="mail-nav-text">{children}</span>
    </Button>
  );
}

/**
 * Cột trái tách thành component memo: mỗi phím gõ trong ô soạn thư làm EmailPage render lại,
 * nhưng các nút thư mục (antd Button + cssinjs) không cần render theo. Giảm đáng kể thời gian test jsdom.
 */
const FolderNav = memo(function FolderNav({
  folder,
  mailbox,
  managing,
  shared,
  onCompose,
  onOpenFolder,
  onManage,
  onMailbox,
}: {
  folder: Folder;
  mailbox: string;
  managing: boolean;
  shared: SharedMailbox[];
  onCompose: () => void;
  onOpenFolder: (next: Folder) => void;
  onManage: () => void;
  onMailbox: (address: string) => void;
}) {
  return (
    <nav className="mail-folders" aria-label="Thư mục email">
      <Button type="primary" block className="mail-compose-btn" icon={<EditOutlined aria-hidden />} onClick={onCompose}>
        <span className="mail-nav-text">Thư mới</span>
      </Button>
      <p className="mail-nav-label">Thư mục</p>
      <NavButton active={folder === 'inbox' && !mailbox && !managing} icon={<InboxOutlined aria-hidden />} onClick={() => onOpenFolder('inbox')}>
        Hộp thư đến
      </NavButton>
      <NavButton active={folder === 'sent' && !mailbox && !managing} icon={<SendOutlined aria-hidden />} onClick={() => onOpenFolder('sent')}>
        Đã gửi
      </NavButton>
      <NavButton active={managing} icon={<SettingOutlined aria-hidden />} onClick={onManage}>
        Quản lý mail
      </NavButton>
      {shared.map((box) => (
        <NavButton key={box.id} active={mailbox === box.address && !managing} icon={<InboxOutlined aria-hidden />} onClick={() => onMailbox(box.address)}>
          {box.name}
        </NavButton>
      ))}
      <div className="mail-account">
        <Avatar className="mail-avatar">VC</Avatar>
        <div>
          <strong>Nội bộ</strong>
          <small>@vcworkspace.test</small>
        </div>
      </div>
    </nav>
  );
});

/** Nút đính kèm (antd Upload) tách memo vì không phụ thuộc chữ đang gõ. */
const AttachButton = memo(function AttachButton({ onFile }: { onFile: (file: File) => void }) {
  return (
    <Upload
      showUploadList={false}
      beforeUpload={(file) => {
        onFile(file);
        return false;
      }}
    >
      <Button type="text" icon={<PaperClipOutlined aria-hidden />}>
        Đính kèm
      </Button>
    </Upload>
  );
});

/** Thông báo kết quả thao tác hoặc lỗi trong khung đang mở. */
function Notice({ notice, error }: { notice: string; error: string }) {
  if (!notice && !error) return null;
  return <Alert className="mail-notice-box" type={error ? 'error' : 'success'} showIcon title={error || notice} role="status" />;
}

export default function EmailPage() {
  const queryClient = useQueryClient();
  const { me } = useAuth();
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
  const [replyRefs, setReplyRefs] = useState<ReplyRefs | null>(null);
  const [editorFocus, setEditorFocus] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [attachment, setAttachment] = useState<{ filename: string; contentType: string; contentBase64: string } | null>(null);
  const [labelName, setLabelName] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [aliasAddress, setAliasAddress] = useState('');
  const [sharedAddress, setSharedAddress] = useState('');
  const [sharedName, setSharedName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const spaces = useQuery({ queryKey: ['interop-spaces'], queryFn: () => json('/spaces').then((value) => value.items as { id: string; name: string; role: string }[]) });
  const labels = useQuery({ queryKey: ['mail-labels', mailbox], queryFn: () => json(`/mail/labels${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`).then((value) => value.items as Label[]) });
  const aliases = useQuery({ queryKey: ['mail-aliases'], queryFn: () => json('/mail/aliases').then((value) => value.items as { id: string; address: string }[]) });
  const shared = useQuery({ queryKey: ['mail-shared'], queryFn: () => json('/mail/shared-mailboxes').then((value) => value.items as SharedMailbox[]) });
  const messages = useQuery({
    queryKey: ['mail', folder, mailbox, search],
    queryFn: () =>
      json(`/mail/messages?folder=${encodeURIComponent(folder)}${mailbox ? `&mailbox=${encodeURIComponent(mailbox)}` : ''}${search.trim() ? `&q=${encodeURIComponent(search.trim())}&scope=all` : ''}`).then(
        (value) => value.items as Message[],
      ),
  });
  const filtered = useMemo(() => messages.data ?? [], [messages.data]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const headers = (idempotent = false) => ({
    'Content-Type': 'application/json',
    'X-Request-Id': newId(),
    ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}),
    ...(idempotent ? { 'Idempotency-Key': newId() } : {}),
  });

  /** To/Cc/Bcc tách theo dấu phẩy hoặc chấm phẩy như Gmail/Outlook; server kiểm địa chỉ và bỏ trùng giữa các ô. */
  function recipients() {
    return { to: parseAddressList(to), cc: parseAddressList(cc), bcc: parseAddressList(bcc) };
  }
  /** html (đã lọc allowlist) và text thuần lấy từ cùng nội dung trình soạn thảo. */
  function content() {
    const html = cleanHtml(bodyHtml);
    const text = htmlToPlainText(html);
    return { text, html: text ? html : '' };
  }
  /** Hộp nhóm đang đọc mà người dùng có quyền gửi; không có quyền thì gửi bằng địa chỉ cá nhân. */
  const sendableMailbox = mailbox && (shared.data ?? []).some((box) => box.address === mailbox && box.currentRoles.includes('send')) ? mailbox : '';
  /** Địa chỉ của chính mình bị loại khỏi Trả lời tất cả: cá nhân, alias, hộp nhóm đang đọc. */
  function ownAddresses() {
    const email = me.user.email ?? '';
    const local = email.includes('@') ? email.slice(0, email.lastIndexOf('@')) : '';
    return [email, local ? `${local}@vcworkspace.test` : '', ...(aliases.data ?? []).map((item) => item.address), mailbox, selected?.mailboxOwner ?? ''];
  }
  async function run(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Có lỗi xảy ra.');
    }
  }
  async function saveDraft() {
    const payload = JSON.stringify({ ...recipients(), subject, ...content(), ...(replyRefs ?? {}) });
    const row = await json(draftId ? `/mail/drafts/${draftId}` : '/mail/drafts', { method: draftId ? 'PATCH' : 'POST', headers: headers(), body: payload });
    setDraftId(row.id);
    setNotice('Đã lưu bản nháp.');
  }
  async function reopen() {
    if (!draftId) return;
    const row = await json(`/mail/drafts/${draftId}`);
    setTo((row.to ?? []).join(', '));
    setCc((row.cc ?? []).join(', '));
    setBcc((row.bcc ?? []).join(', '));
    setShowCopies(!!(row.cc?.length || row.bcc?.length));
    setReplyRefs(row.inReplyTo ? { inReplyTo: row.inReplyTo, references: row.references ?? [] } : null);
    setSubject(row.subject);
    setBodyHtml(row.html ? cleanHtml(row.html) : textToHtml(row.text ?? ''));
    setNotice('Đã mở lại bản nháp.');
    setComposing(true);
  }
  const choose = useCallback(async (file: File) => {
    setAttachment(await encodedAttachment(file.name, file.type || 'application/octet-stream', await file.arrayBuffer()));
  }, []);
  async function forwardSelected() {
    if (!selected) return;
    const response = await fetch(`${API_BASE}/mail/messages/${selected.id}/raw${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Không tải được thư gốc để chuyển tiếp.');
    setAttachment(await encodedAttachment('forwarded-message.eml', 'message/rfc822', await response.arrayBuffer()));
    setTo('');
    setCc('');
    setBcc('');
    setReplyRefs(null);
    setSubject(selected.subject.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject}`);
    setBodyHtml(
      textToHtml(
        `\n\n---------- Thư được chuyển tiếp ----------\nTừ: ${selected.from}\nĐến: ${selected.to.join(', ')}${selected.cc?.length ? `\nCc: ${selected.cc.join(', ')}` : ''}\nNgày: ${new Date(selected.sentAt).toLocaleString('vi-VN')}\nTiêu đề: ${selected.subject}\n\nThư gốc được đính kèm dưới dạng MIME.`,
      ),
    );
    setNotice('Đã đính kèm thư gốc để chuyển tiếp.');
    setComposing(true);
  }
  /**
   * Trả lời / Trả lời tất cả: Message-ID và References đọc từ header MIME gốc (API danh sách không trả
   * Message-ID); nội dung trích dẫn lấy từ /body đã lọc. Server dựa In-Reply-To để giữ cùng threadId.
   */
  async function replySelected(all: boolean) {
    if (!selected) return;
    const query = mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : '';
    const [response, body] = await Promise.all([
      fetch(`${API_BASE}/mail/messages/${selected.id}/raw${query}`, { credentials: 'same-origin' }),
      queryClient.fetchQuery(mailBodyQuery(selected.id, mailbox)),
    ]);
    if (!response.ok) throw new Error('Không tải được thư gốc để trả lời.');
    const { messageId, references } = threadHeaders(await response.text());
    const next = replyRecipients(selected, { all, sentFolder: folder === 'sent', own: ownAddresses() });
    setTo(next.to.join(', '));
    setCc(next.cc.join(', '));
    setBcc('');
    setShowCopies(next.cc.length > 0);
    setSubject(replySubject(selected.subject));
    setFromIdentity(sendableMailbox);
    setReplyRefs(messageId ? { inReplyTo: messageId, references } : null);
    setDraftId('');
    setAttachment(null);
    setManaging(false);
    setNotice('');
    setBodyHtml(quotedReplyHtml(selected, body));
    setComposing(true);
    setEditorFocus((value) => value + 1);
  }
  async function send() {
    const response = await fetch(`${API_BASE}/mail/send`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify({
        ...recipients(),
        subject,
        ...content(),
        draftId: draftId || undefined,
        attachments: attachment ? [attachment] : [],
        fromIdentity: fromIdentity || sendableMailbox || undefined,
        ...(replyRefs ? { ...replyRefs, mailbox: mailbox || undefined } : {}),
      }),
    });
    if (!response.ok) throw new Error('Mail server chưa xác nhận gửi.');
    setNotice('Mail server đã nhận thư.');
    setDraftId('');
    setReplyRefs(null);
    setAttachment(null);
    setTo('');
    setCc('');
    setBcc('');
    setShowCopies(false);
    setSubject('');
    setBodyHtml('');
    setComposing(false);
    setFolder('sent');
    await queryClient.invalidateQueries({ queryKey: ['mail'] });
  }
  async function post(path: string, payload: unknown) {
    return json(path, { method: 'POST', headers: headers(true), body: JSON.stringify(payload) });
  }
  async function addLabel() {
    const row = await post(`/mail/labels${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { name: labelName, color: '#0f6cbd' });
    setLabelName('');
    setNotice(`Đã tạo nhãn ${row.name}.`);
    await labels.refetch();
  }
  async function applyLabel(name: string) {
    if (!selected) return;
    await json(`/mail/messages/${selected.id}/labels${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ labels: [...new Set([...(selected.labels ?? []), name])] }) });
    setNotice(`Đã gán nhãn ${name}.`);
    await messages.refetch();
  }
  async function createFilter() {
    await post('/mail/filters', { name: `Lọc ${filterValue}`, field: 'subject', operator: 'contains', value: filterValue, addLabels: labels.data?.[0] ? [labels.data[0].name] : [], moveToFolder: 'inbox', stop: true });
    setFilterValue('');
    setNotice('Đã bật bộ lọc thư đến.');
  }
  async function createAlias() {
    await post('/mail/aliases', { address: aliasAddress, displayName: aliasAddress.split('@')[0] });
    setAliasAddress('');
    setNotice('Đã tạo alias gửi; alias không phải hộp thư nhóm.');
    await aliases.refetch();
  }
  async function createShared() {
    await post('/mail/shared-mailboxes', { address: sharedAddress, name: sharedName });
    setSharedAddress('');
    setSharedName('');
    setNotice('Đã tạo hộp thư nhóm với quyền tách biệt.');
    await shared.refetch();
  }
  async function setMember(box: SharedMailbox, roles: string[]) {
    await json(`/mail/shared-mailboxes/${box.id}/members`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ email: memberEmail, roles }) });
    setNotice(roles.length ? 'Đã cập nhật quyền thành viên.' : 'Đã thu hồi quyền thành viên ngay.');
    await shared.refetch();
  }
  /** `part` lấy từ GET /body, cùng chỉ số với save-to-drive. */
  async function saveAttachmentToDrive(item: MailBodyAttachment) {
    if (!selected) return;
    const target = (spaces.data ?? []).find((space) => space.role === 'manager');
    if (!target) throw new Error('Bạn chưa có không gian Drive được phép ghi.');
    const row = await post(`/mail/messages/${selected.id}/attachments/${item.part}/save-to-drive${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`, { spaceId: target.id });
    setNotice(`Đã lưu ${row.name} vào ${target.name}; hash ${row.contentSha256.slice(0, 12)}…`);
  }
  const openFolder = useCallback((next: Folder) => {
    setFolder(next);
    setMailbox('');
    setSelectedId('');
    setComposing(false);
    setManaging(false);
    setNotice('');
  }, []);
  const openCompose = useCallback(() => {
    setManaging(false);
    setReplyRefs(null);
    setComposing(true);
    setNotice('');
  }, []);
  const openManage = useCallback(() => {
    setManaging(true);
    setComposing(false);
  }, []);
  const openMailbox = useCallback((address: string) => {
    setMailbox(address);
    setFolder('inbox');
    setManaging(false);
  }, []);
  const folderTitle = folder === 'inbox' ? 'Hộp thư đến' : 'Đã gửi';
  const fromOptions = [
    { value: '', label: 'Địa chỉ cá nhân' },
    ...(aliases.data ?? []).map((item) => ({ value: item.address, label: item.address })),
    ...(shared.data ?? []).filter((box) => box.currentRoles.includes('send')).map((box) => ({ value: box.address, label: `${box.name} — ${box.address}` })),
  ];

  return (
    <div className="mail-page">
      <header className="mail-titlebar">
        <div>
          <p className="mail-eyebrow">VCworkspace Mail</p>
          <h1>Email</h1>
        </div>
        <Input allowClear prefix={<SearchOutlined />} aria-label="Tìm kiếm thư" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong thư" />
        <Button icon={<ReloadOutlined />} aria-label="Làm mới danh sách" onClick={() => void messages.refetch()} style={{ justifySelf: 'end' }} />
      </header>
      <div className="mail-shell">
        <FolderNav folder={folder} mailbox={mailbox} managing={managing} shared={shared.data ?? NO_SHARED} onCompose={openCompose} onOpenFolder={openFolder} onManage={openManage} onMailbox={openMailbox} />
        <section className="mail-list-pane" aria-label={folderTitle}>
          <div className="mail-list-header">
            <div>
              <h2>{folderTitle}</h2>
              <p>{filtered.length} thư</p>
            </div>
          </div>
          {messages.isLoading && (
            <div className="mail-state">
              <Spin size="small" /> Đang tải thư…
            </div>
          )}
          {messages.error && (
            <div className="mail-state is-error">
              <ErrorBox error={new Error('Không tải được danh sách thư.')} onRetry={() => void messages.refetch()} />
            </div>
          )}
          {!messages.isLoading && !messages.error && filtered.length === 0 && (
            <Empty className="mail-state" image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? 'Không tìm thấy kết quả phù hợp.' : 'Chưa có thư. Thư mới sẽ xuất hiện tại đây.'} />
          )}
          <div className="mail-message-list">
            {filtered.map((message) => {
              const isSelected = selected?.id === message.id && !composing;
              return (
                <Button
                  key={message.id}
                  block
                  type="text"
                  color={isSelected ? 'primary' : 'default'}
                  variant={isSelected ? 'filled' : 'text'}
                  className={`mail-message-row ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedId(message.id);
                    setComposing(false);
                  }}
                >
                  <Avatar size="small" className="mail-avatar is-small">
                    {initials(folder === 'inbox' ? message.from : message.to[0])}
                  </Avatar>
                  <span className="mail-message-copy">
                    <span className="mail-message-meta">
                      <strong>{folder === 'inbox' ? message.from : `Đến: ${message.to.join(', ')}`}</strong>
                      <time>{new Date(message.sentAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</time>
                    </span>
                    <span className="mail-message-subject">{message.subject || '(Không có tiêu đề)'}</span>
                    <span className="mail-message-preview">{message.deliveryStatus === 'accepted' ? 'Mail server đã nhận thư' : 'Chưa gửi thành công'}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
        <main className="mail-reading-pane">
          {managing ? (
            <section className="mail-management" aria-label="Quản lý email">
              <div className="mail-pane-toolbar">
                <div>
                  <p className="mail-eyebrow">Quản trị cá nhân</p>
                  <h2>Nhãn, bộ lọc và danh tính</h2>
                </div>
              </div>
              <Notice notice={notice} error={error} />
              <Row gutter={[16, 16]} style={{ padding: 16 }}>
                <Col xs={24} md={12}>
                  <Card size="small" title="Nhãn nhiều lựa chọn">
                    <Typography.Paragraph type="secondary">Nhãn độc lập với thư mục và có thể gán nhiều nhãn cho một thư.</Typography.Paragraph>
                    <Form component="form" onFinish={() => void run(addLabel)}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input aria-label="Tên nhãn" value={labelName} onChange={(event) => setLabelName(event.target.value)} required />
                        <Button htmlType="submit">Tạo nhãn</Button>
                      </Space.Compact>
                    </Form>
                    {(labels.data ?? []).length > 0 && (
                      <Space wrap style={{ marginTop: 12 }}>
                        {(labels.data ?? []).map((label) => (
                          <Button size="small" key={label.id} onClick={() => void run(() => applyLabel(label.name))}>
                            {label.name}
                          </Button>
                        ))}
                      </Space>
                    )}
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="Bộ lọc thư đến">
                    <Typography.Paragraph type="secondary">Khớp tiêu đề, tự gán nhãn đầu tiên; không chuyển tiếp nên không tạo vòng lặp.</Typography.Paragraph>
                    <Form component="form" onFinish={() => void run(createFilter)}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input aria-label="Chuỗi tiêu đề cần lọc" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} required />
                        <Button htmlType="submit">Tạo bộ lọc</Button>
                      </Space.Compact>
                    </Form>
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="Alias gửi">
                    <Typography.Paragraph type="secondary">Alias là danh tính gửi của cá nhân, không tạo hộp thư dùng chung.</Typography.Paragraph>
                    <Form component="form" onFinish={() => void run(createAlias)}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input aria-label="Địa chỉ alias" type="email" value={aliasAddress} onChange={(event) => setAliasAddress(event.target.value)} placeholder="alias@vcworkspace.test" required />
                        <Button htmlType="submit">Tạo alias</Button>
                      </Space.Compact>
                    </Form>
                    <ul>
                      {(aliases.data ?? []).map((item) => (
                        <li key={item.id}>{item.address}</li>
                      ))}
                    </ul>
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="Hộp thư nhóm">
                    <Typography.Paragraph type="secondary">Quyền đọc, gửi và quản lý được cấp riêng.</Typography.Paragraph>
                    <Form component="form" onFinish={() => void run(createShared)}>
                      <Space orientation="vertical" style={{ width: '100%' }}>
                        <Input aria-label="Tên hộp thư nhóm" value={sharedName} onChange={(event) => setSharedName(event.target.value)} placeholder="Tên hộp thư" required />
                        <Space.Compact style={{ width: '100%' }}>
                          <Input aria-label="Địa chỉ hộp thư nhóm" type="email" value={sharedAddress} onChange={(event) => setSharedAddress(event.target.value)} placeholder="nhom@vcworkspace.test" required />
                          <Button htmlType="submit">Tạo hộp thư</Button>
                        </Space.Compact>
                      </Space>
                    </Form>
                  </Card>
                </Col>
                {(shared.data ?? []).map((box) => (
                  <Col xs={24} md={12} key={box.id}>
                    <Card size="small" title={box.name} extra={<Typography.Text type="secondary">{box.address}</Typography.Text>}>
                      <Input aria-label={`Thành viên ${box.name}`} type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="nguoi@vcworkspace.test" />
                      <Space wrap style={{ marginTop: 8 }}>
                        <Button size="small" onClick={() => void run(() => setMember(box, ['read']))}>
                          Chỉ đọc
                        </Button>
                        <Button size="small" onClick={() => void run(() => setMember(box, ['read', 'send']))}>
                          Đọc + gửi
                        </Button>
                        <Button size="small" onClick={() => void run(() => setMember(box, ['read', 'send', 'manage']))}>
                          Quản lý
                        </Button>
                        <Button size="small" danger onClick={() => void run(() => setMember(box, []))}>
                          Thu hồi
                        </Button>
                      </Space>
                      <ul>
                        {box.members.map((member) => (
                          <li key={member.email}>
                            {member.email}: {member.roles.join(', ')}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Col>
                ))}
              </Row>
            </section>
          ) : composing ? (
            <section className="mail-compose" aria-label="Soạn thư mới">
              <div className="mail-pane-toolbar">
                <div>
                  <p className="mail-eyebrow">Soạn thư</p>
                  <h2>{draftId ? 'Bản nháp' : replyRefs ? 'Trả lời' : 'Thư mới'}</h2>
                </div>
                <Button type="text" icon={<CloseOutlined />} aria-label="Đóng soạn thư" onClick={() => setComposing(false)} />
              </div>
              <Form layout="horizontal" component={false} colon={false} labelCol={{ flex: '72px' }} wrapperCol={{ flex: 1 }} className="mail-compose-fields">
                <Form.Item label="Gửi từ" htmlFor="mail-from">
                  <Select id="mail-from" value={fromIdentity} onChange={setFromIdentity} options={fromOptions} />
                </Form.Item>
                <Form.Item label="Đến" htmlFor="mail-to">
                  <Flex gap={8}>
                    <Input id="mail-to" value={to} onChange={(event) => setTo(event.target.value)} placeholder="ten@vcworkspace.test, ..." />
                    <Button type="text" aria-expanded={showCopies} aria-controls="mail-copy-fields" onClick={() => setShowCopies((value) => !value)}>
                      Cc/Bcc
                    </Button>
                  </Flex>
                </Form.Item>
                {showCopies && (
                  <div id="mail-copy-fields">
                    <Form.Item label="Cc" htmlFor="mail-cc">
                      <Input id="mail-cc" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="Phân cách bằng dấu phẩy hoặc chấm phẩy" />
                    </Form.Item>
                    <Form.Item label="Bcc" htmlFor="mail-bcc">
                      <Input id="mail-bcc" value={bcc} onChange={(event) => setBcc(event.target.value)} placeholder="Người nhận ẩn, không ai khác thấy" />
                    </Form.Item>
                  </div>
                )}
                <Form.Item label="Tiêu đề" htmlFor="mail-subject">
                  <Input id="mail-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Thêm tiêu đề" />
                </Form.Item>
                <div className="mail-body-field">
                  <RichTextEditor value={bodyHtml} onChange={setBodyHtml} onError={setError} label="Nội dung" placeholder="Nhập nội dung thư…" focusKey={editorFocus} />
                </div>
              </Form>
              {attachment && (
                <div className="mail-attachment-box">
                  <Tag icon={<PaperClipOutlined />} closable onClose={() => setAttachment(null)} closeIcon={<CloseOutlined aria-label={`Bỏ tệp ${attachment.filename}`} />}>
                    <span>{attachment.filename}</span>
                  </Tag>
                </div>
              )}
              <Notice notice={notice} error={error} />
              <Flex gap={8} wrap align="center" className="mail-compose-actions">
                <Button type="primary" icon={<SendOutlined aria-hidden />} disabled={!parseAddressList(to).length || !subject} onClick={() => void run(send)}>
                  Gửi
                </Button>
                <AttachButton onFile={choose} />
                <Button type="text" onClick={() => void run(saveDraft)}>
                  Lưu nháp
                </Button>
                <Button type="text" disabled={!draftId} onClick={() => void run(reopen)}>
                  Mở lại
                </Button>
              </Flex>
            </section>
          ) : selected ? (
            <article className="mail-reader">
              <div className="mail-pane-toolbar">
                <div>
                  <p className="mail-eyebrow">{folderTitle}</p>
                  <h2>{selected.subject || '(Không có tiêu đề)'}</h2>
                </div>
                <Space wrap>
                  <Button icon={<Icon component={ReplySvg} aria-hidden />} onClick={() => void run(() => replySelected(false))}>
                    Trả lời
                  </Button>
                  <Button icon={<Icon component={ReplyAllSvg} aria-hidden />} onClick={() => void run(() => replySelected(true))}>
                    Trả lời tất cả
                  </Button>
                  <Button icon={<SendOutlined aria-hidden />} onClick={() => void run(forwardSelected)}>
                    Chuyển tiếp
                  </Button>
                  <Button icon={<DownloadOutlined aria-hidden />} href={`${API_BASE}/mail/messages/${selected.id}/raw${mailbox ? `?mailbox=${encodeURIComponent(mailbox)}` : ''}`}>
                    Tải MIME
                  </Button>
                </Space>
              </div>
              <div className="mail-sender">
                <Avatar className="mail-avatar">{initials(selected.from)}</Avatar>
                <div>
                  <strong>{selected.from}</strong>
                  <p>Đến {selected.to.join(', ')}</p>
                  {selected.cc?.length ? <p>Cc {selected.cc.join(', ')}</p> : null}
                  {selected.bcc?.length ? <p>Bcc {selected.bcc.join(', ')}</p> : null}
                </div>
                <time>{new Date(selected.sentAt).toLocaleString('vi-VN')}</time>
              </div>
              {selected.labels?.length || selected.deliveryStatus !== 'accepted' ? (
                <Space wrap className="mail-reader-labels">
                  {selected.labels?.map((label) => (
                    <Tag key={label} color="processing" variant="filled">
                      {label}
                    </Tag>
                  ))}
                  {selected.deliveryStatus !== 'accepted' && (
                    <Tag color="error" variant="filled">
                      Gửi chưa thành công
                    </Tag>
                  )}
                </Space>
              ) : null}
              <MessageBody key={`${selected.id}:${mailbox}`} messageId={selected.id} mailbox={mailbox} onSaveAttachment={(item) => void run(() => saveAttachmentToDrive(item))} />
              <Notice notice={notice} error={error} />
            </article>
          ) : (
            <div className="mail-empty-reader">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>Chọn một thư để đọc, hoặc bắt đầu cuộc trò chuyện mới với đồng nghiệp.</span>}>
                <Button type="primary" icon={<EditOutlined aria-hidden />} onClick={openCompose}>
                  Thư mới
                </Button>
              </Empty>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
