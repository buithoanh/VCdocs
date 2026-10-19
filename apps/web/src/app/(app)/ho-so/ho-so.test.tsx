import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorBody, ids, record } from '@/test/fixtures';
import { RecordView } from './[id]/RecordView';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { navigation } from '@/test/setup';
import { NewRecordForm } from './moi/NewRecordForm';

async function fillBasics() {
  await screen.findByRole('option', { name: /Báo cáo tuần SEO/ });
  await userEvent.selectOptions(screen.getByLabelText(/^Loại hồ sơ/), ids.rtApproved);
  await waitFor(() => expect(screen.getByRole('option', { name: /SEO-PTDA/ })).toBeInTheDocument());
  await userEvent.selectOptions(screen.getByLabelText(/^Mã chức năng/), 'SEO-PTDA');
  await userEvent.type(screen.getByLabelText(/^Nội dung ngắn/), 'Báo cáo tuần 42');
}

describe('lập hồ sơ', () => {
  it('loại hồ sơ chưa duyệt thời hạn không chọn được', async () => {
    renderApp(<NewRecordForm />);
    const opt = await screen.findByRole('option', { name: /chưa duyệt thời hạn/ });
    expect(opt).toBeDisabled();
  });

  it('lập từ biểu mẫu: gửi POST /records kèm Idempotency-Key, theo dõi việc, xong thì mở hồ sơ', async () => {
    let body: Record<string, unknown> | undefined;
    let headers: Headers | undefined;
    server.use(
      http.post(`${API}/records`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        headers = request.headers;
        return HttpResponse.json({ jobId: ids.job }, { status: 202 });
      }),
    );
    renderApp(<NewRecordForm />);
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: 'Lập hồ sơ' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ recordTypeId: ids.rtApproved, kind: 'BC', functionCode: 'SEO-PTDA', subject: 'Báo cáo tuần 42' });
    expect(body?.backdateReason).toBeUndefined();
    expect(headers?.get('Idempotency-Key')).toBeTruthy();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/ho-so/${ids.record}`));
  });

  it('tải file lên gửi multipart tới /records/upload', async () => {
    let contentType = '';
    let idemKey: string | null = null;
    server.use(
      http.post(`${API}/records/upload`, async ({ request }) => {
        // jsdom + undici treo khi đọc thân có File: chỉ kiểm tra đầu yêu cầu; nội dung FormData đã test ở lib/records.
        contentType = request.headers.get('content-type') ?? '';
        idemKey = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ jobId: ids.job }, { status: 202 });
      }),
    );
    renderApp(<NewRecordForm />);
    await fillBasics();
    await userEvent.click(screen.getByLabelText(/Tải file lên/));
    await userEvent.upload(screen.getByLabelText(/Chọn file/), new File(['%PDF'], 'hoa-don.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lập hồ sơ' }));
    await waitFor(() => expect(contentType).toMatch(/^multipart\/form-data; boundary=/));
    expect(idemKey).toBeTruthy();
  });

  it('thiếu nội dung thì không gửi và báo lỗi tại ô', async () => {
    let called = false;
    server.use(http.post(`${API}/records`, () => ((called = true), HttpResponse.json({ jobId: ids.job }, { status: 202 }))));
    renderApp(<NewRecordForm />);
    await screen.findByLabelText(/^Loại hồ sơ/);
    await userEvent.click(screen.getByRole('button', { name: 'Lập hồ sơ' }));
    expect(await screen.findByText('Nhập nội dung ngắn.')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('máy chủ từ chối (422) thì hiện message kèm mã BR', async () => {
    server.use(http.post(`${API}/records`, () => HttpResponse.json(errorBody('RULE_VIOLATION', 'Mã chức năng chưa được duyệt', 'BR-12'), { status: 422 })));
    renderApp(<NewRecordForm />);
    await fillBasics();
    await userEvent.click(screen.getByRole('button', { name: 'Lập hồ sơ' }));
    expect(await screen.findByText('Mã chức năng chưa được duyệt (Quy tắc BR-12)')).toBeInTheDocument();
  });
});

describe('chi tiết hồ sơ', () => {
  it('người lập hiện tên từ people; giữ lại phải chọn lý do và ghi diễn giải', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/records/:id`, () => HttpResponse.json(record)),
      http.post(`${API}/records/:id/hold`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...record, status: 'held', allowedActions: ['release-hold'] });
      }),
    );
    renderApp(<RecordView id={ids.record} />, { roles: ['R4'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Giữ lại' }));
    expect(screen.getAllByText('Nguyễn Văn A').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Chốt hồ sơ' })).toBeNull();
    const confirm = screen.getAllByRole('button', { name: 'Giữ lại' }).at(-1)!;
    await userEvent.type(screen.getByLabelText(/Diễn giải/), 'Khách khiếu nại hoá đơn');
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/^Lý do/), 'dispute');
    await userEvent.click(confirm);
    await waitFor(() => expect(body).toEqual({ reasonType: 'dispute', reason: 'Khách khiếu nại hoá đơn' }));
  });
});
