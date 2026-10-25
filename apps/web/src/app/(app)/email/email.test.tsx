import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import EmailPage from './page';

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
});
