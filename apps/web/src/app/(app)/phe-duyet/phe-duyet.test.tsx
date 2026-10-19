import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { approval, errorBody } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import ApprovalsPage from './page';

describe('hộp duyệt', () => {
  it('phiếu có quyền decide hiện Đồng ý và Yêu cầu sửa', async () => {
    renderApp(<ApprovalsPage />, { roles: ['R4'] });
    expect(await screen.findByText('QT-MKT-01 Quy trình SEO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đồng ý' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yêu cầu sửa' })).toBeInTheDocument();
  });

  it('phiếu không có quyền thì không có nút duyệt', async () => {
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json({ page: 1, limit: 20, total: 1, items: [{ ...approval, allowedActions: [] }] })));
    renderApp(<ApprovalsPage />);
    expect(await screen.findByText('QT-MKT-01 Quy trình SEO')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đồng ý' })).toBeNull();
  });

  it('yêu cầu sửa bắt buộc ghi nội dung, gửi đúng thân và Idempotency-Key', async () => {
    let body: unknown;
    let headers: Headers | undefined;
    server.use(
      http.post(`${API}/approvals/:id/decide`, async ({ request }) => {
        body = await request.json();
        headers = request.headers;
        return HttpResponse.json({ ...approval, status: 'changes_requested', allowedActions: [] });
      }),
    );
    renderApp(<ApprovalsPage />, { roles: ['R4'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Yêu cầu sửa' }));
    const confirm = screen.getAllByRole('button', { name: 'Yêu cầu sửa' }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Nội dung cần sửa/), 'Bổ sung bước kiểm tra');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(body).toEqual({ result: 'changes_requested', comment: 'Bổ sung bước kiểm tra' }));
    expect(headers?.get('Idempotency-Key')).toBeTruthy();
    expect(headers?.get('X-CSRF-Token')).toBe('csrf-mau-123');
  });

  it('file đã đổi sau khi trình (409) thì báo phiếu mất hiệu lực', async () => {
    server.use(http.post(`${API}/approvals/:id/decide`, () => HttpResponse.json(errorBody('STATE_INVALID', 'Phiên bản file khác bản đã trình'), { status: 409 })));
    renderApp(<ApprovalsPage />, { roles: ['R4'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Đồng ý' }).at(-1)!);
    expect(await screen.findByText('Phiên bản file khác bản đã trình')).toBeInTheDocument();
    expect(screen.getByText(/phiếu không còn hiệu lực/)).toBeInTheDocument();
  });
});
