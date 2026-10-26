import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import EmailPage from './page';
import { replySubject, threadHeaders } from './reply';
import { htmlToPlainText, parseAddressList, safeLinkUrl } from './rich-text';

describe('Email workspace', () => {
  it('chuyển tiếp bằng cách đính kèm nguyên MIME của thư thuộc mailbox', async () => {
    server.use(
      http.get(`${API}/mail/messages`, () => HttpResponse.json({ items: [{
        id: 'mail-1', threadId: 'thread-1', from: 'nv.mkt@vcworkspace.test',
        to: ['tp.mkt@vcworkspace.test'], subject: 'Báo cáo tuần',
        sentAt: '2026-10-23T08:00:00.000Z', deliveryStatus: 'accepted',
      }] })),
      http.get(`${API}/mail/messages/mail-1/body`, () => HttpResponse.json({ text: 'Nội dung gốc', hasRemoteContent: false, truncated: false, attachments: [] })),
      http.get(`${API}/mail/messages/mail-1/raw`, () => new HttpResponse(
        'From: nv.mkt@vcworkspace.test\r\nSubject: Báo cáo tuần\r\n\r\nNội dung gốc',
        { headers: { 'Content-Type': 'message/rfc822' } },
      )),
      http.get(`${API}/mail/labels`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/aliases`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/shared-mailboxes`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/spaces`, () => HttpResponse.json({ items: [{ id:'space-1', name:'Cá nhân', role:'manager' }] })),
    );

    renderApp(<EmailPage />);
    expect(await screen.findByRole('heading', { name: 'Báo cáo tuần' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Chuyển tiếp' }));

    expect(await screen.findByDisplayValue('Fwd: Báo cáo tuần')).toBeInTheDocument();
    expect(screen.getByText('forwarded-message.eml')).toBeInTheDocument();
    expect(screen.getByText('Đã đính kèm thư gốc để chuyển tiếp.')).toBeInTheDocument();
  });

  it('tạo nhãn qua API và phân biệt alias với hộp thư nhóm', async () => {
    let created = '';
    server.use(
      http.get(`${API}/mail/messages`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/labels`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/aliases`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/shared-mailboxes`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/spaces`, () => HttpResponse.json({ items: [{ id:'space-1', name:'Cá nhân', role:'manager' }] })),
      http.post(`${API}/mail/labels`, async ({ request }) => { created = String((await request.json() as any).name); return HttpResponse.json({ id: 'label-1', name: created, color: '#0f6cbd' }, { status: 201 }); }),
    );
    renderApp(<EmailPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Quản lý mail' }));
    expect(await screen.findByText('Alias là danh tính gửi của cá nhân, không tạo hộp thư dùng chung.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thư mới' }));
    expect(await screen.findByRole('heading', { name: 'Thư mới' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quản lý mail' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Tên nhãn' }), 'Ưu tiên');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo nhãn' }));
    expect(created).toBe('Ưu tiên');
    expect(await screen.findByText('Đã tạo nhãn Ưu tiên.')).toBeInTheDocument();
  });
  function mailboxHandlers(items: unknown[] = [], body: Record<string, unknown> = { text: '', hasRemoteContent: false, truncated: false, attachments: [] }) {
    return [
      http.get(`${API}/mail/messages/:id/body`, () => HttpResponse.json(body)),
      http.get(`${API}/mail/messages`, () => HttpResponse.json({ items })),
      http.get(`${API}/mail/labels`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/aliases`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/mail/shared-mailboxes`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/spaces`, () => HttpResponse.json({ items: [{ id:'space-1', name:'Cá nhân', role:'manager' }] })),
    ];
  }
  /** Chọn đúng một đoạn chữ trong trình soạn thảo (jsdom không kéo chuột chọn được). */
  function selectText(editor: HTMLElement, word: string) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(word);
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + word.length);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      return;
    }
    throw new Error(`Không thấy "${word}" trong trình soạn thảo`);
  }

  it('gửi Cc/Bcc và nội dung đậm: html có <strong>, text là chữ thuần', async () => {
    let sent: any;
    server.use(...mailboxHandlers(), http.post(`${API}/mail/send`, async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ id: 'sent-1', mailboxOwner: 'tp.mkt@vcworkspace.test', threadId: 't', from: 'tp.mkt@vcworkspace.test', to: sent.to, cc: sent.cc, bcc: sent.bcc, subject: sent.subject, sentAt: '2026-10-25T08:00:00.000Z', folder: 'sent', deliveryStatus: 'accepted' }, { status: 201 });
    }));
    renderApp(<EmailPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Thư mới' }))[0]);
    expect(screen.queryByRole('textbox', { name: 'Cc' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Đến' }), 'nv.mkt@vcworkspace.test');
    await userEvent.click(screen.getByRole('button', { name: 'Cc/Bcc' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Cc' }), 'xem.mkt@vcworkspace.test; nv.kd@vcworkspace.test');
    await userEvent.type(screen.getByRole('textbox', { name: 'Bcc' }), 'tp.kd@vcworkspace.test');
    await userEvent.type(screen.getByRole('textbox', { name: 'Tiêu đề' }), 'Họp tuần');
    const editor = screen.getByRole('textbox', { name: 'Nội dung' });
    await userEvent.click(editor);
    await userEvent.keyboard('Xin chào cả nhóm');
    selectText(editor, 'chào');
    await userEvent.click(screen.getByRole('button', { name: 'Đậm' }));
    expect(editor.innerHTML).toMatch(/<(strong|b)>chào<\/(strong|b)>/);
    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ to: ['nv.mkt@vcworkspace.test'], cc: ['xem.mkt@vcworkspace.test', 'nv.kd@vcworkspace.test'], bcc: ['tp.kd@vcworkspace.test'], subject: 'Họp tuần', text: 'Xin chào cả nhóm' });
    expect(sent.html).toMatch(/<(strong|b)>chào<\/(strong|b)>/);
    expect(sent.text).not.toMatch(/</);
  });

  it('phím tắt Ctrl+I in nghiêng và bản nháp gửi kèm Cc/Bcc', async () => {
    let draft: any;
    server.use(...mailboxHandlers(), http.post(`${API}/mail/drafts`, async ({ request }) => {
      draft = await request.json();
      return HttpResponse.json({ id: 'draft-1', ownerEmail: 'tp.mkt@vcworkspace.test', ...draft, createdAt: '2026-10-25T08:00:00.000Z', updatedAt: '2026-10-25T08:00:00.000Z' }, { status: 201 });
    }));
    renderApp(<EmailPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Thư mới' }))[0]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Đến' }), 'a@vcworkspace.test, b@vcworkspace.test');
    await userEvent.click(screen.getByRole('button', { name: 'Cc/Bcc' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Bcc' }), 'c@vcworkspace.test');
    const editor = screen.getByRole('textbox', { name: 'Nội dung' });
    await userEvent.click(editor);
    await userEvent.keyboard('Ghi chú quan trọng');
    selectText(editor, 'quan trọng');
    await userEvent.keyboard('{Control>}i{/Control}');
    expect(editor.innerHTML).toMatch(/<(em|i)>quan trọng<\/(em|i)>/);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByText('Đã lưu bản nháp.')).toBeInTheDocument();
    expect(draft).toMatchObject({ to: ['a@vcworkspace.test', 'b@vcworkspace.test'], cc: [], bcc: ['c@vcworkspace.test'], text: 'Ghi chú quan trọng' });
    expect(draft.html).toMatch(/<(em|i)>quan trọng<\/(em|i)>/);
  });

  it('nút liên kết từ chối javascript: và chỉ chèn http/https/mailto', async () => {
    server.use(...mailboxHandlers());
    renderApp(<EmailPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Thư mới' }))[0]);
    const editor = screen.getByRole('textbox', { name: 'Nội dung' });
    await userEvent.click(editor);
    await userEvent.keyboard('Xem tài liệu');
    const prompt = vi.spyOn(window, 'prompt');
    try {
      prompt.mockReturnValueOnce('javascript:alert(1)');
      selectText(editor, 'tài liệu');
      await userEvent.click(screen.getByRole('button', { name: 'Chèn liên kết' }));
      expect(await screen.findByText('Liên kết chỉ nhận địa chỉ http://, https:// hoặc mailto:.')).toBeInTheDocument();
      expect(editor.querySelector('a')).toBeNull();
      prompt.mockReturnValueOnce('  JaVaScRiPt:alert(1)');
      await userEvent.click(screen.getByRole('button', { name: 'Chèn liên kết' }));
      expect(editor.querySelector('a')).toBeNull();
      prompt.mockReturnValueOnce('https://vcworkspace.test/tai-lieu');
      selectText(editor, 'tài liệu');
      await userEvent.click(screen.getByRole('button', { name: 'Chèn liên kết' }));
      const link = editor.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('https://vcworkspace.test/tai-lieu');
      expect(link.textContent).toBe('tài liệu');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    } finally { prompt.mockRestore(); }
  });

  const READER_MESSAGE = { id: 'mail-9', threadId: 'thread-9', from: 'nv.mkt@vcworkspace.test', to: ['tp.mkt@vcworkspace.test'], subject: 'Thư có nội dung', sentAt: '2026-10-26T08:00:00.000Z', deliveryStatus: 'accepted' };

  it('khung đọc: HTML nằm trong iframe sandbox không script/same-origin, srcDoc có CSP; đính kèm lưu Drive theo part', async () => {
    let saved: { part?: string; body?: any } = {};
    server.use(...mailboxHandlers([READER_MESSAGE], {
      text: 'Xin chào', html: '<p>Xin <strong>chào</strong></p><script>alert(1)</script><img src="https://t.test/p.gif" onerror="x()">', hasRemoteContent: true, truncated: false,
      attachments: [{ part: 0, filename: 'logo.png', contentType: 'image/png', size: 512 }, { part: 1, filename: 'bao-cao.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 2560 }],
    }), http.post(`${API}/mail/messages/mail-9/attachments/:part/save-to-drive`, async ({ params, request }) => {
      saved = { part: String(params.part), body: await request.json() };
      return HttpResponse.json({ id: 'file-1', name: 'bao-cao.docx', contentSha256: 'a'.repeat(64) }, { status: 201 });
    }));
    renderApp(<EmailPage />);
    const frame = await screen.findByTitle('Nội dung thư');
    expect(frame.tagName).toBe('IFRAME');
    const sandbox = frame.getAttribute('sandbox')!;
    expect(sandbox).not.toBeNull();
    expect(sandbox.split(/\s+/).sort()).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox']);
    expect(sandbox).not.toMatch(/allow-scripts|allow-same-origin/);
    const doc = frame.getAttribute('srcdoc')!;
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`);
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('<p>Xin <strong>chào</strong></p>');
    // Lọc lại phía trình duyệt (phòng thủ nhiều lớp) dù server đã lọc.
    expect(doc).not.toMatch(/<script|<img|onerror|t\.test/);
    expect(screen.getByText('Đã chặn hình ảnh và nội dung tải từ bên ngoài để bảo vệ bạn.')).toBeInTheDocument();
    expect(screen.getByText('2 tệp đính kèm')).toBeInTheDocument();
    expect(screen.getByText('bao-cao.docx')).toBeInTheDocument();
    expect(screen.getByText(/^2,5 KB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lưu bao-cao.docx vào Drive' }));
    expect(await screen.findByText(/Đã lưu bao-cao\.docx vào Cá nhân/)).toBeInTheDocument();
    expect(saved).toEqual({ part: '1', body: { spaceId: 'space-1' } });
  });

  it('khung đọc: thư chữ thuần hiện bằng văn bản giữ xuống dòng, không dùng iframe hay HTML', async () => {
    server.use(...mailboxHandlers([READER_MESSAGE], { text: 'Dòng một\nDòng hai <b>không đậm</b>', hasRemoteContent: false, truncated: false, attachments: [] }));
    const { container } = renderApp(<EmailPage />);
    const body = await screen.findByText(/Dòng một/);
    expect(body).toHaveClass('mail-body-text');
    expect(body.textContent).toBe('Dòng một\nDòng hai <b>không đậm</b>');
    expect(body.querySelector('b')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(/tệp đính kèm/)).not.toBeInTheDocument();
  });

  it('khung đọc: lỗi tải nội dung hiện thông báo và thử lại được', async () => {
    let calls = 0;
    server.use(http.get(`${API}/mail/messages/mail-9/body`, () => (++calls === 1
      ? HttpResponse.json({ error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }, { status: 500 })
      : HttpResponse.json({ text: 'Đã tải lại', hasRemoteContent: false, truncated: false, attachments: [] }))), ...mailboxHandlers([READER_MESSAGE]));
    renderApp(<EmailPage />);
    expect(await screen.findByText('Không tải được nội dung thư.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã tải lại')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('khung đọc hiện Cc của thư, không hiện Bcc', async () => {
    server.use(...mailboxHandlers([{ id: 'mail-2', threadId: 'thread-2', from: 'nv.mkt@vcworkspace.test', to: ['tp.mkt@vcworkspace.test'], cc: ['xem.mkt@vcworkspace.test', 'nv.kd@vcworkspace.test'], subject: 'Có Cc', sentAt: '2026-10-23T08:00:00.000Z', deliveryStatus: 'accepted' }]));
    renderApp(<EmailPage />);
    expect(await screen.findByRole('heading', { name: 'Có Cc' })).toBeInTheDocument();
    expect(screen.getByText('Cc xem.mkt@vcworkspace.test, nv.kd@vcworkspace.test')).toBeInTheDocument();
    expect(screen.queryByText(/^Bcc/)).not.toBeInTheDocument();
  });

  /** Thư gốc có Message-ID và References gấp dòng; người dùng test là nhanvien@vcprosperous.com → nhanvien@vcworkspace.test. */
  const RAW_ORIGINAL = 'Message-ID: <goc-1@vcworkspace.test>\r\nReferences: <dau-0@vcworkspace.test>\r\n <giua-1@vcworkspace.test>\r\nFrom: nv.mkt@vcworkspace.test\r\nSubject: x\r\n\r\nMessage-ID: <khong-phai-header@x>';
  function replyHandlers(items: unknown[], body: Record<string, unknown>, options: { aliases?: unknown[]; shared?: unknown[] } = {}) {
    const sent: { body?: any } = {};
    return { sent, handlers: [
      http.get(`${API}/mail/messages/:id/raw`, () => new HttpResponse(RAW_ORIGINAL, { headers: { 'Content-Type': 'message/rfc822' } })),
      http.get(`${API}/mail/aliases`, () => HttpResponse.json({ items: options.aliases ?? [] })),
      http.get(`${API}/mail/shared-mailboxes`, () => HttpResponse.json({ items: options.shared ?? [] })),
      http.post(`${API}/mail/send`, async ({ request }) => {
        sent.body = await request.json();
        return HttpResponse.json({ id: 'reply-1', mailboxOwner: 'nhanvien@vcworkspace.test', threadId: 'thread-r', from: 'nhanvien@vcworkspace.test', to: sent.body.to, subject: sent.body.subject, sentAt: '2026-10-26T09:00:00.000Z', folder: 'sent', deliveryStatus: 'accepted' }, { status: 201 });
      }),
      ...mailboxHandlers(items, body),
    ] };
  }
  const REPLY_SOURCE = { id: 'mail-r', mailboxOwner: 'nhanvien@vcworkspace.test', threadId: 'thread-r', from: 'nv.mkt@vcworkspace.test', to: ['nhanvien@vcworkspace.test', 'tp.kd@vcworkspace.test'], cc: ['xem.mkt@vcworkspace.test', 'Ban.Toi@vcworkspace.test'], subject: 'Re: RE: Kế hoạch quý', sentAt: '2026-10-26T08:00:00.000Z', deliveryStatus: 'accepted' };

  it('Trả lời: Đến là người gửi, tiêu đề một "Re:", trích dẫn đã lọc, focus ở đầu, gửi inReplyTo/references', async () => {
    const { sent, handlers } = replyHandlers([REPLY_SOURCE], { text: 'Nội dung gốc', html: '<p>Nội dung <strong>gốc</strong></p><script>alert(1)</script><img src="x" onerror="steal()"><a href="javascript:alert(2)">bấm</a>', hasRemoteContent: false, truncated: false, attachments: [] });
    server.use(...handlers);
    renderApp(<EmailPage />);
    expect(await screen.findByRole('heading', { name: 'Re: RE: Kế hoạch quý' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Trả lời' }));
    expect(await screen.findByRole('heading', { name: 'Trả lời' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Đến' })).toHaveValue('nv.mkt@vcworkspace.test');
    expect(screen.getByRole('textbox', { name: 'Tiêu đề' })).toHaveValue('Re: Kế hoạch quý');
    expect(screen.queryByRole('textbox', { name: 'Cc' })).not.toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Nội dung' });
    await waitFor(() => expect(editor.querySelector('blockquote')).not.toBeNull());
    expect(editor.firstElementChild?.outerHTML).toBe('<p><br></p>');
    expect(editor.textContent).toContain(`Vào ${new Date(REPLY_SOURCE.sentAt).toLocaleString('vi-VN')}, nv.mkt@vcworkspace.test đã viết:`);
    expect(editor.querySelector('blockquote')!.innerHTML).toContain('<p>Nội dung <strong>gốc</strong></p>');
    expect(editor.innerHTML).not.toMatch(/<script|<img|onerror|javascript:/);
    expect(document.activeElement).toBe(editor);
    const caret = window.getSelection()!.getRangeAt(0);
    expect(caret.collapsed).toBe(true);
    expect(editor.firstElementChild!.contains(caret.startContainer)).toBe(true);
    await userEvent.keyboard('Đã nhận');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(sent.body).toBeDefined());
    expect(sent.body).toMatchObject({ to: ['nv.mkt@vcworkspace.test'], cc: [], bcc: [], subject: 'Re: Kế hoạch quý', inReplyTo: 'goc-1@vcworkspace.test', references: ['dau-0@vcworkspace.test', 'giua-1@vcworkspace.test', 'goc-1@vcworkspace.test'] });
    expect(sent.body.fromIdentity).toBeUndefined();
    expect(sent.body.text).toMatch(/^Đã nhận\n/);
    expect(sent.body.text).toContain('> Nội dung gốc');
    expect(sent.body.html).toContain('<blockquote>');
    expect(sent.body.html).not.toMatch(/<script|onerror|javascript:/);
  });

  it('Trả lời tất cả: thêm To gốc, giữ Cc, loại địa chỉ của mình và alias, bỏ trùng', async () => {
    const { sent, handlers } = replyHandlers([REPLY_SOURCE], { text: 'Chữ thuần <b>không đậm</b>', hasRemoteContent: false, truncated: false, attachments: [] }, { aliases: [{ id: 'al-1', address: 'ban.toi@vcworkspace.test' }] });
    server.use(...handlers);
    renderApp(<EmailPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Trả lời tất cả' }));
    expect(await screen.findByRole('textbox', { name: 'Đến' })).toHaveValue('nv.mkt@vcworkspace.test, tp.kd@vcworkspace.test');
    expect(screen.getByRole('textbox', { name: 'Cc' })).toHaveValue('xem.mkt@vcworkspace.test');
    expect(screen.getByRole('textbox', { name: 'Bcc' })).toHaveValue('');
    const editor = screen.getByRole('textbox', { name: 'Nội dung' });
    await waitFor(() => expect(editor.querySelector('blockquote')).not.toBeNull());
    // Thư chữ thuần được escape, không thành thẻ HTML.
    expect(editor.querySelector('blockquote b')).toBeNull();
    expect(editor.querySelector('blockquote')!.textContent).toBe('Chữ thuần <b>không đậm</b>');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(sent.body).toBeDefined());
    expect(sent.body).toMatchObject({ to: ['nv.mkt@vcworkspace.test', 'tp.kd@vcworkspace.test'], cc: ['xem.mkt@vcworkspace.test'], bcc: [], inReplyTo: 'goc-1@vcworkspace.test' });
  });

  it('Trả lời tất cả trong Đã gửi: trả lời tới To gốc, giữ Cc, không chép Bcc', async () => {
    const own = { ...REPLY_SOURCE, id: 'mail-s', from: 'nhanvien@vcworkspace.test', to: ['a@vcworkspace.test', 'b@vcworkspace.test'], cc: ['c@vcworkspace.test'], bcc: ['an@vcworkspace.test'], subject: 'Fwd: Tài liệu', folder: 'sent' };
    const { sent, handlers } = replyHandlers([own], { text: 'x', hasRemoteContent: false, truncated: false, attachments: [] });
    server.use(...handlers);
    renderApp(<EmailPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Đã gửi' }));
    expect(await screen.findByText('Bcc an@vcworkspace.test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Trả lời' }));
    expect(await screen.findByRole('textbox', { name: 'Đến' })).toHaveValue('a@vcworkspace.test, b@vcworkspace.test');
    expect(screen.getByRole('textbox', { name: 'Tiêu đề' })).toHaveValue('Re: Fwd: Tài liệu');
    await userEvent.click(screen.getByRole('button', { name: 'Đóng soạn thư' }));
    await userEvent.click(screen.getByRole('button', { name: 'Trả lời tất cả' }));
    expect(await screen.findByRole('textbox', { name: 'Cc' })).toHaveValue('c@vcworkspace.test');
    expect(screen.getByRole('textbox', { name: 'Bcc' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(sent.body).toBeDefined());
    expect(sent.body).toMatchObject({ to: ['a@vcworkspace.test', 'b@vcworkspace.test'], cc: ['c@vcworkspace.test'], bcc: [] });
    expect(JSON.stringify(sent.body)).not.toContain('an@vcworkspace.test');
  });

  it('Trả lời trong hộp nhóm: gửi từ hộp nhóm khi có quyền gửi, không thì từ địa chỉ cá nhân', async () => {
    const box = (roles: string[]) => ({ id: 'box-1', address: 'mkt-team@vcworkspace.test', name: 'Nhóm MKT', currentRoles: roles, members: [] });
    const inbound = { ...REPLY_SOURCE, mailboxOwner: 'mkt-team@vcworkspace.test', to: ['mkt-team@vcworkspace.test'], cc: [], subject: 'Hỏi nhóm' };
    for (const [roles, expected] of [[['read'], undefined], [['read', 'send'], 'mkt-team@vcworkspace.test']] as const) {
      const { sent, handlers } = replyHandlers([inbound], { text: 'x', hasRemoteContent: false, truncated: false, attachments: [] }, { shared: [box([...roles])] });
      server.use(...handlers);
      const view = renderApp(<EmailPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Nhóm MKT' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Trả lời tất cả' }));
      expect(await screen.findByRole('textbox', { name: 'Đến' })).toHaveValue('nv.mkt@vcworkspace.test');
      await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));
      await waitFor(() => expect(sent.body).toBeDefined());
      expect(sent.body.fromIdentity).toBe(expected);
      expect(sent.body).toMatchObject({ to: ['nv.mkt@vcworkspace.test'], cc: [], mailbox: 'mkt-team@vcworkspace.test', inReplyTo: 'goc-1@vcworkspace.test' });
      view.unmount();
    }
  });

  it('tiện ích trả lời: không chồng "Re:", đọc Message-ID/References gấp dòng', () => {
    expect(replySubject('Re: Re: Họp')).toBe('Re: Họp');
    expect(replySubject('RE: re:Họp')).toBe('Re: Họp');
    expect(replySubject('Re[2]: Re : Họp')).toBe('Re: Họp');
    expect(replySubject('Fwd: Họp')).toBe('Re: Fwd: Họp');
    expect(replySubject('Re: Fwd: Họp')).toBe('Re: Fwd: Họp');
    expect(replySubject('Họp')).toBe('Re: Họp');
    expect(threadHeaders(RAW_ORIGINAL)).toEqual({ messageId: 'goc-1@vcworkspace.test', references: ['dau-0@vcworkspace.test', 'giua-1@vcworkspace.test', 'goc-1@vcworkspace.test'] });
    expect(threadHeaders('message-id:<a@b>\nReferences: <a@b>\n\nbody')).toEqual({ messageId: 'a@b', references: ['a@b'] });
    expect(threadHeaders('Subject: x\r\n\r\nMessage-ID: <body@x>')).toEqual({ messageId: '', references: [] });
  });

  it('tiện ích soạn thư: tách địa chỉ, chữ thuần và link an toàn', () => {
    expect(parseAddressList(' a@vcworkspace.test; b@vcworkspace.test,,A@vcworkspace.test\nc@vcworkspace.test ')).toEqual(['a@vcworkspace.test', 'b@vcworkspace.test', 'c@vcworkspace.test']);
    expect(htmlToPlainText('<div>Xin <b>chào</b></div><ul><li>một</li><li>hai</li></ul><ol><li>ba</li></ol><blockquote>trích</blockquote><div><a href="https://x.test/">link</a></div><script>bad()</script>'))
      .toBe('Xin chào\n- một\n- hai\n1. ba\n> trích\nlink <https://x.test/>');
    expect(safeLinkUrl('mailto:a@vcworkspace.test')).toBe('mailto:a@vcworkspace.test');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test', '/relative', 'https://u:p@x.test']) expect(safeLinkUrl(bad)).toBeNull();
  });
});
