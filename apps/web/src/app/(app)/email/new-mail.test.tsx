import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { AppShell } from '@/components/AppShell';
import EmailPage from './page';

const message = (id: string, subject: string, unread?: boolean) => ({
  id, threadId: `thread-${id}`, from: 'nv.mkt@vcworkspace.test', to: ['tp.mkt@vcworkspace.test'], subject,
  sentAt: '2026-11-14T08:00:00.000Z', deliveryStatus: 'accepted', ...(unread === undefined ? {} : { unread }),
});
function mailboxHandlers(list: () => unknown[]) {
  return [
    http.get(`${API}/mail/messages/:id/body`, () => HttpResponse.json({ text: 'Nội dung', hasRemoteContent: false, truncated: false, attachments: [] })),
    http.get(`${API}/mail/messages`, () => HttpResponse.json({ items: list() })),
    http.get(`${API}/mail/labels`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/mail/aliases`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/mail/shared-mailboxes`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/spaces`, () => HttpResponse.json({ items: [] })),
  ];
}

describe('Email: báo thư mới', () => {
  afterEach(() => vi.useRealTimers());

  it('mục Email của menu hiện số thư mới chưa mở; không có thư mới thì không hiện huy hiệu', async () => {
    server.use(http.get(`${API}/mail/unread-count`, () => HttpResponse.json({ count: 3 })));
    const first = renderApp(<AppShell><p>nội dung</p></AppShell>);
    // jsdom không có breakpoint lg nên menu nằm trong ngăn kéo: mở ra rồi mới thấy mục Email.
    await userEvent.click(await screen.findByRole('button', { name: 'Mở menu' }));
    const link = await screen.findByRole('link', { name: 'Email, 3 thư mới' });
    expect(link).toHaveAttribute('href', '/email');
    expect(within(link).getByText('3')).toBeInTheDocument();
    first.unmount();

    server.use(http.get(`${API}/mail/unread-count`, () => HttpResponse.json({ count: 0 })));
    renderApp(<AppShell><p>nội dung</p></AppShell>);
    await userEvent.click(await screen.findByRole('button', { name: 'Mở menu' }));
    expect(await screen.findByRole('link', { name: 'Email' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /thư mới/ })).toBeNull();
  });

  it('thư chưa đọc được đánh dấu; mở thư thì bỏ dấu và hỏi lại số thư mới', async () => {
    let counts = 0;
    server.use(
      ...mailboxHandlers(() => [message('mail-1', 'Báo giá tháng 11', true), message('mail-2', 'Lịch họp', true), message('mail-3', 'Đã đọc từ trước', false)]),
      http.get(`${API}/mail/unread-count`, () => { counts++; return HttpResponse.json({ count: 2 }); }),
    );
    renderApp(<AppShell><EmailPage /></AppShell>);
    // Thư đầu được chọn sẵn và tải nội dung: hết chưa đọc; thư thứ hai vẫn chưa đọc.
    expect(await screen.findByText('Nội dung')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('3 thư · 1 chưa đọc')).toBeInTheDocument());
    const rows = screen.getAllByRole('button').filter((b) => b.classList.contains('mail-message-row'));
    expect(rows.map((row) => row.classList.contains('is-unread'))).toEqual([false, true, false]);
    expect(within(rows[1]).getByText('Chưa đọc:')).toBeInTheDocument();
    // Lần đầu khi dựng menu, lần hai sau khi mở thư.
    await waitFor(() => expect(counts).toBeGreaterThanOrEqual(2));
  });

  it('danh sách tự làm mới mỗi phút: thư mới hiện ra mà không bấm Làm mới, thư đang đọc không bị đổi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let items = [message('mail-1', 'Thư cũ')];
    let calls = 0;
    server.use(...mailboxHandlers(() => { calls++; return items; }));
    renderApp(<EmailPage />);
    expect(await screen.findByRole('heading', { name: 'Thư cũ' })).toBeInTheDocument();
    expect(calls).toBe(1);
    items = [message('mail-2', 'Thư vừa đến', true), ...items];
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    const arrived = await screen.findByText('Thư vừa đến');
    expect(calls).toBe(2);
    expect(arrived.closest('.mail-message-row')).toHaveClass('is-unread');
    expect(screen.getByRole('heading', { name: 'Thư cũ' })).toBeInTheDocument();
    expect(screen.getByText('2 thư · 1 chưa đọc')).toBeInTheDocument();
  });
});
