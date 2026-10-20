import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { HandoverDetail } from '@/api/types';
import { ids, makeHandover, people } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { navigation } from '@/test/setup';
import { canExecuteOn, HandoverView, isLate } from './[id]/HandoverView';
import { countsText, HandoverList } from './HandoverList';

const PAST = '2026-01-05';
const FUTURE = '2099-12-31';

function useHandover(h: HandoverDetail) {
  server.use(http.get(`${API}/handovers/${ids.handover}`, () => HttpResponse.json(h)));
}

function listOf(h: HandoverDetail) {
  const { items: _items, people: _people, ...summary } = h;
  return { page: 1, limit: 50, total: 1, people, items: [summary] };
}

describe('bàn giao – quy tắc ngày (BR-25)', () => {
  it('kiểm tra sau ngày làm việc cuối là trễ; chuyển quyền từ đúng ngày đó', () => {
    expect(isLate('2026-10-20', '2026-10-20')).toBe(false);
    expect(isLate('2026-10-20', '2026-10-21')).toBe(true);
    expect(canExecuteOn('2026-10-20', '2026-10-19')).toBe(false);
    expect(canExecuteOn('2026-10-20', '2026-10-20')).toBe(true);
  });

  it('tiến độ đọc từ counts', () => {
    expect(countsText({ total: 0, pending: 0, done: 0, skipped: 0, failed: 0 })).toBe('Chưa có mục nào');
    expect(countsText({ total: 10, pending: 2, done: 6, skipped: 1, failed: 1 })).toBe('6/10 đã làm · 1 lỗi · 1 bỏ qua');
  });
});

describe('danh sách bàn giao', () => {
  it('hiện biên bản, tên người từ people; chỉ R3 thấy nút lập', async () => {
    server.use(http.get(`${API}/handovers`, () => HttpResponse.json(listOf(makeHandover()))));
    renderApp(<HandoverList />, { roles: ['R4'] });
    expect(await screen.findByText('Phạm Văn Nghỉ')).toBeInTheDocument();
    expect(screen.getByText('Chờ người nhận', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('0/3 đã làm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lập biên bản' })).toBeNull();
  });

  it('R3 lập biên bản: POST /handovers kèm Idempotency-Key, mở biên bản vừa tạo', async () => {
    let body: Record<string, unknown> | undefined;
    let key: string | null = null;
    server.use(
      http.get(`${API}/handovers`, () => HttpResponse.json({ page: 1, limit: 50, total: 0, people: {}, items: [] })),
      http.get(`${API}/users/lookup`, () => HttpResponse.json({ items: [people[ids.leaver]] })),
      http.post(`${API}/handovers`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ jobId: ids.job, handoverId: ids.handover }, { status: 202 });
      }),
    );
    renderApp(<HandoverList />, { roles: ['R3'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Lập biên bản' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Tìm người nghỉ việc'), 'Nghỉ');
    await within(dialog).findByRole('option', { name: /Phạm Văn Nghỉ/ });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Người nghỉ việc/), ids.leaver);
    await userEvent.type(within(dialog).getByLabelText(/^Ngày làm việc cuối/), '2026-10-31');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lập biên bản' }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/ban-giao/${ids.handover}`));
    expect(body).toEqual({ userId: ids.leaver, lastWorkingDay: '2026-10-31' });
    expect(key).toBeTruthy();
  });
});

describe('chi tiết biên bản', () => {
  it('nút theo allowedActions; liệt kê các mục và cách xử lý', async () => {
    useHandover(makeHandover());
    renderApp(<HandoverView id={ids.handover} />);
    expect(await screen.findByText('QT-MKT-01 Quy trình SEO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xác nhận đã nhận' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất BM-VCPV-08' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kiểm tra (HCNS)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chuyển quyền' })).toBeNull();
    expect(screen.getByText('Chuyển sở hữu Google')).toBeInTheDocument();
    // dòng "Đổi người" mặc định giao cho người nhận của biên bản
    expect(screen.getAllByText('Trần Thị B').length).toBeGreaterThan(0);
  });

  it('sửa một mục: chỉ cho cách xử lý hợp loại, gửi PATCH items', async () => {
    let body: Record<string, unknown> | undefined;
    useHandover(makeHandover());
    server.use(
      http.patch(`${API}/handovers/${ids.handover}/items/${ids.item3}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeHandover());
      }),
    );
    renderApp(<HandoverView id={ids.handover} />);
    await userEvent.click(await screen.findByRole('button', { name: /Sửa cách xử lý 11-mkt-dong-gop/ }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText(/^Cách xử lý/);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['— Chọn —', 'Gỡ khỏi nhóm', 'Để nguyên']);
    await userEvent.selectOptions(select, 'keep');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toEqual({ action: 'keep' }));
  });

  it('HCNS kiểm tra sau ngày làm việc cuối phải ghi lý do trễ', async () => {
    let body: Record<string, unknown> | undefined;
    useHandover(makeHandover({ status: 'received', lastWorkingDay: PAST, allowedActions: ['verify'] }));
    server.use(
      http.post(`${API}/handovers/${ids.handover}/verify`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeHandover({ status: 'verified' }));
      }),
    );
    renderApp(<HandoverView id={ids.handover} />, { roles: ['R3'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra (HCNS)' }));
    const dialog = screen.getByRole('dialog');
    const ok = within(dialog).getByRole('button', { name: 'Đã kiểm tra' });
    expect(ok).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Lý do kiểm tra trễ/), 'Người nghỉ báo muộn');
    await userEvent.click(ok);
    await waitFor(() => expect(body).toEqual({ lateReason: 'Người nghỉ báo muộn' }));
  });

  it('chuyển quyền hỏi hai lần, gửi một lần kèm Idempotency-Key', async () => {
    let calls = 0;
    let key: string | null = null;
    useHandover(makeHandover({ status: 'verified', lastWorkingDay: PAST, allowedActions: ['execute', 'export'] }));
    server.use(
      http.post(`${API}/handovers/${ids.handover}/execute`, ({ request }) => {
        calls++;
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ jobId: ids.job }, { status: 202 });
      }),
    );
    renderApp(<HandoverView id={ids.handover} />, { roles: ['R9'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Chuyển quyền' }));
    expect(screen.getByText('Việc này không đảo ngược được.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    const confirm = screen.getByRole('button', { name: 'Chuyển quyền ngay' });
    expect(confirm).toBeDisabled();
    expect(calls).toBe(0);
    await userEvent.click(screen.getByLabelText(/không lấy lại được/));
    await userEvent.click(confirm);
    await waitFor(() => expect(calls).toBe(1));
    expect(key).toBeTruthy();
    expect(await screen.findAllByText('Xong')).not.toHaveLength(0);
  });

  it('chưa tới ngày làm việc cuối thì không chuyển quyền được', async () => {
    useHandover(makeHandover({ status: 'verified', lastWorkingDay: FUTURE, allowedActions: ['execute'] }));
    renderApp(<HandoverView id={ids.handover} />, { roles: ['R9'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Chuyển quyền' }));
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
    expect(screen.getByText(/Chưa tới ngày làm việc cuối/)).toBeInTheDocument();
  });

  it('huỷ biên bản phải có lý do', async () => {
    let body: Record<string, unknown> | undefined;
    useHandover(makeHandover());
    server.use(
      http.post(`${API}/handovers/${ids.handover}/cancel`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeHandover({ status: 'cancelled' }));
      }),
    );
    renderApp(<HandoverView id={ids.handover} />, { roles: ['R3'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ biên bản' }));
    const dialog = screen.getByRole('dialog');
    const ok = within(dialog).getByRole('button', { name: 'Huỷ biên bản' });
    expect(ok).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Lý do huỷ/), 'Nhân viên ở lại');
    await userEvent.click(ok);
    await waitFor(() => expect(body).toEqual({ reason: 'Nhân viên ở lại' }));
  });

  it('xuất BM-VCPV-08 theo dõi việc nền, xong thì có link file', async () => {
    useHandover(makeHandover());
    server.use(
      http.post(`${API}/handovers/${ids.handover}/export`, () => HttpResponse.json({ jobId: ids.job }, { status: 202 })),
      http.get(`${API}/jobs/:id`, () =>
        HttpResponse.json({
          id: ids.job,
          companyId: ids.company,
          createdAt: '2026-10-20T08:00:00+07:00',
          updatedAt: '2026-10-20T08:00:00+07:00',
          type: 'handover.export',
          status: 'done',
          progress: 100,
          steps: [],
          requestedBy: ids.me,
          people: {},
          result: { fileId: 'bm08-file' },
        }),
      ),
    );
    renderApp(<HandoverView id={ids.handover} />, { roles: ['R3'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Xuất BM-VCPV-08' }));
    const link = await screen.findByRole('link', { name: 'Mở file trên Drive' });
    expect(link).toHaveAttribute('href', expect.stringContaining('bm08-file'));
  });

  it('đang liệt kê thì hiện tiến độ việc handover.list', async () => {
    useHandover(makeHandover({ status: 'listing', items: [], allowedActions: [] }));
    renderApp(<HandoverView id={ids.handover} />);
    expect(await screen.findByText('Đang liệt kê việc của người nghỉ')).toBeInTheDocument();
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });
});
