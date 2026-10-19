import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { hitHref, looksLikeDocumentCode } from '../tra-cuu/SearchView';
import { NewShareForm, validateShare } from './moi/NewShareForm';

const today = '2026-10-19';
const ok = { file: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit', email: 'doitac@example.com', reason: 'Gửi báo giá', expires: '2026-11-01' };

describe('chia sẻ ra ngoài', () => {
  it('đủ thông tin thì hợp lệ', () => {
    expect(validateShare(ok, today)).toEqual({});
  });

  it('phải là một file Drive, email ngoài công ty, có lý do, hết hạn sau hôm nay', () => {
    expect(validateShare({ ...ok, file: 'abc' }, today).file).toBeTruthy();
    expect(validateShare({ ...ok, email: 'a@vcprosperous.com' }, today).email).toBeTruthy();
    expect(validateShare({ ...ok, email: 'sai' }, today).email).toBeTruthy();
    expect(validateShare({ ...ok, reason: '' }, today).reason).toBeTruthy();
    expect(validateShare({ ...ok, expires: today }, today).expires).toBeTruthy();
  });

  it('không có lựa chọn "Bất kỳ ai có liên kết"', () => {
    renderApp(<NewShareForm />);
    expect(screen.queryByText(/Bất kỳ ai/, { selector: 'label' })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('file Mật thì báo chờ trưởng phòng duyệt', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API}/external-shares`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: '6712f0c2a1b2c3d4e5f607b1',
            companyId: '6712f0c2a1b2c3d4e5f60700',
            createdAt: '2026-10-19T09:00:00+07:00',
            updatedAt: '2026-10-19T09:00:00+07:00',
            allowedActions: [],
            fileId: '1AbCdEfGhIjKlMnOp',
            email: 'doitac@example.com',
            role: 'reader',
            reason: 'Gửi báo giá',
            expiresAt: '2026-11-01T23:59:59+07:00',
            status: 'pending_approval',
            source: 'vcdocs',
          },
          { status: 201 },
        );
      }),
    );
    renderApp(<NewShareForm />);
    await userEvent.type(screen.getByLabelText(/^File/), ok.file);
    await userEvent.type(screen.getByLabelText(/^Email đối tác/), ok.email);
    await userEvent.type(screen.getByLabelText(/^Lý do/), ok.reason);
    await userEvent.click(screen.getByRole('button', { name: 'Chia sẻ' }));
    expect(await screen.findByText(/đã gửi trưởng phòng duyệt/)).toBeInTheDocument();
    await waitFor(() => expect(body).toMatchObject({ fileId: '1AbCdEfGhIjKlMnOp', email: 'doitac@example.com', role: 'reader' }));
    expect(String(body?.expiresAt)).toMatch(/T23:59:59\+07:00$/);
  });
});

describe('tra cứu', () => {
  it('nhận ra mã tài liệu để mở bản hiệu lực', () => {
    expect(looksLikeDocumentCode('QT-MKT-01')).toBe(true);
    expect(looksLikeDocumentCode('qd-vcpv-3')).toBe(true);
    expect(looksLikeDocumentCode('báo cáo tuần')).toBe(false);
    expect(looksLikeDocumentCode('HS-2026-000123')).toBe(false);
  });

  it('kết quả dẫn tới đúng trang', () => {
    expect(hitHref({ objectType: 'document', id: 'a', title: 't' })).toBe('/tai-lieu/a');
    expect(hitHref({ objectType: 'record', id: 'b', title: 't' })).toBe('/ho-so/b');
  });
});
