import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import EmailPage from './page';
import { htmlToPlainText, parseAddressList, safeLinkUrl } from './rich-text';

describe('Email workspace', () => {
  it('chuyển tiếp bằng cách đính kèm nguyên MIME của thư thuộc mailbox', async () => {
    server.use(
      http.get(`${API}/mail/messages`, () => HttpResponse.json({ items: [{
        id: 'mail-1', threadId: 'thread-1', from: 'nv.mkt@vcworkspace.test',
        to: ['tp.mkt@vcworkspace.test'], subject: 'Báo cáo tuần',
        sentAt: '2026-10-23T08:00:00.000Z', deliveryStatus: 'accepted',
      }] })),
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
  function mailboxHandlers(items: unknown[] = []) {
    return [
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

  it('khung đọc hiện Cc của thư và không render HTML thư', async () => {
    server.use(...mailboxHandlers([{ id: 'mail-2', threadId: 'thread-2', from: 'nv.mkt@vcworkspace.test', to: ['tp.mkt@vcworkspace.test'], cc: ['xem.mkt@vcworkspace.test', 'nv.kd@vcworkspace.test'], subject: 'Có Cc', sentAt: '2026-10-23T08:00:00.000Z', deliveryStatus: 'accepted' }]));
    renderApp(<EmailPage />);
    expect(await screen.findByRole('heading', { name: 'Có Cc' })).toBeInTheDocument();
    expect(screen.getByText('Cc xem.mkt@vcworkspace.test, nv.kd@vcworkspace.test')).toBeInTheDocument();
    expect(screen.queryByText(/^Bcc/)).not.toBeInTheDocument();
  });

  it('tiện ích soạn thư: tách địa chỉ, chữ thuần và link an toàn', () => {
    expect(parseAddressList(' a@vcworkspace.test; b@vcworkspace.test,,A@vcworkspace.test\nc@vcworkspace.test ')).toEqual(['a@vcworkspace.test', 'b@vcworkspace.test', 'c@vcworkspace.test']);
    expect(htmlToPlainText('<div>Xin <b>chào</b></div><ul><li>một</li><li>hai</li></ul><ol><li>ba</li></ol><blockquote>trích</blockquote><div><a href="https://x.test/">link</a></div><script>bad()</script>'))
      .toBe('Xin chào\n- một\n- hai\n1. ba\n> trích\nlink <https://x.test/>');
    expect(safeLinkUrl('mailto:a@vcworkspace.test')).toBe('mailto:a@vcworkspace.test');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test', '/relative', 'https://u:p@x.test']) expect(safeLinkUrl(bad)).toBeNull();
  });
});
