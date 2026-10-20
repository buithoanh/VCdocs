import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AuditTools } from '@/components/AuditTools';
import { auditLog, auditorAccess, errorBody, evidencePack, ids, people } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { navFor } from '@/lib/permissions';
import { auditQuery, AuditLogView, objectHref } from './AuditLogView';
import { EvidencePackView } from './goi-bang-chung/[id]/EvidencePackView';
import { AuditorAccessView, validateGrant } from './quyen-xem-tam/AuditorAccessView';

const page = (items: unknown[]) => ({ page: 1, limit: 50, total: items.length, people, items });
const anchor = {
  lastSeq: 1024,
  lastHash: 'b'.repeat(64),
  lastAt: '2026-10-19T10:00:00+07:00',
  verification: { status: 'ok', checkedAt: '2026-10-20T01:00:00+07:00', count: 1024 },
  latestAnchor: { at: '2026-10-19T07:00:00+07:00', seq: 1000, hash: 'f'.repeat(64), sentTo: ['bdh@vcprosperous.com'] },
};

describe('nhật ký – tham số lọc', () => {
  it('ngày lọc là trọn ngày giờ Việt Nam, bỏ trường trống', () => {
    const q = auditQuery({ objectType: 'record', objectId: ' ', actorId: '', action: 'record.finalize', departmentId: '', from: '2026-10-01', to: '2026-10-19', sort: '-seq' }, 2);
    expect(q).toEqual({
      objectType: 'record',
      objectId: undefined,
      actorId: undefined,
      action: 'record.finalize',
      departmentId: undefined,
      from: '2026-10-01T00:00:00+07:00',
      to: '2026-10-19T23:59:59+07:00',
      sort: '-seq',
      page: 2,
      limit: 50,
    });
  });

  it('đối tượng dẫn tới đúng trang', () => {
    expect(objectHref('record', 'x')).toBe('/ho-so/x');
    expect(objectHref('handover', 'y')).toBe('/ban-giao/y');
    expect(objectHref('code', 'z')).toBeUndefined();
  });

  it('menu: nhật ký cho R1–R4, R9 và kiểm toán viên; quyền xem tạm chỉ R1, R3', () => {
    expect(navFor(['R6']).map((i) => i.href)).not.toContain('/nhat-ky');
    expect(navFor(['R6'], { auditor: true }).map((i) => i.href)).toContain('/nhat-ky');
    expect(navFor(['R4']).map((i) => i.href)).toContain('/nhat-ky');
    expect(navFor(['R4']).map((i) => i.href)).not.toContain('/nhat-ky/quyen-xem-tam');
    expect(navFor(['R1']).map((i) => i.href)).toContain('/nhat-ky/quyen-xem-tam');
    expect(navFor(['R7']).map((i) => i.href)).toContain('/ban-giao');
  });
});

describe('tra nhật ký', () => {
  it('hiện dòng nhật ký; lọc gửi đúng tham số', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(`${API}/audit-logs`, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(page([auditLog]));
      }),
    );
    renderApp(<AuditLogView />, { roles: ['R4'] });
    expect(await screen.findByText('record.finalize')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Hồ sơ/ })).toHaveAttribute('href', `/ho-so/${ids.record}`);
    // R4 không thấy mã băm neo
    expect(screen.queryByText('Tính toàn vẹn của nhật ký')).toBeNull();
    await userEvent.type(screen.getByLabelText('Thao tác'), 'handover.execute');
    await userEvent.type(screen.getByLabelText('Từ ngày'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Lọc' }));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('action')).toBe('handover.execute'));
    expect(urls.at(-1)?.searchParams.get('from')).toBe('2026-10-01T00:00:00+07:00');
    expect(urls.at(-1)?.searchParams.get('sort')).toBe('-seq');
  });

  it('dòng bị che (isRedacted) không hiện giá trị trước, sau', async () => {
    const { before: _b, after: _a, ...rest } = auditLog;
    server.use(http.get(`${API}/audit-logs`, () => HttpResponse.json(page([{ ...rest, isRedacted: true }]))));
    renderApp(<AuditLogView />, { roles: ['R9'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Chi tiết dòng 1024' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/không được xem nên không hiện/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/finalized/)).toBeNull();
  });

  it('kiểm toán viên thấy phạm vi và hạn quyền xem tạm', async () => {
    server.use(http.get(`${API}/audit-logs`, () => HttpResponse.json(page([]))));
    renderApp(<AuditLogView />, { roles: [], me: { auditorAccess: { id: ids.access, departmentIds: [ids.dept], expiresAt: '2026-11-15T23:59:59+07:00' } } });
    expect(await screen.findByText(/quyền xem tạm của kiểm toán viên/)).toBeInTheDocument();
    expect(await screen.findByText('11 MKT')).toBeInTheDocument();
  });

  it('R3 xem mã băm neo, kiểm chuỗi ngay (202 → theo dõi việc)', async () => {
    let posted = 0;
    server.use(
      http.get(`${API}/audit-logs`, () => HttpResponse.json(page([]))),
      http.get(`${API}/audit-logs/anchor`, () => HttpResponse.json(anchor)),
      http.post(`${API}/audit-logs/verify`, () => {
        posted++;
        return HttpResponse.json({ jobId: ids.job }, { status: 202 });
      }),
    );
    renderApp(<AuditLogView />, { roles: ['R3'] });
    expect(await screen.findByText('Chuỗi nguyên vẹn')).toBeInTheDocument();
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm chuỗi ngay' }));
    await waitFor(() => expect(posted).toBe(1));
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });

  it('chuỗi lệch thì cảnh báo dòng đầu tiên bị lệch', async () => {
    server.use(
      http.get(`${API}/audit-logs`, () => HttpResponse.json(page([]))),
      http.get(`${API}/audit-logs/anchor`, () => HttpResponse.json({ ...anchor, verification: { status: 'broken', checkedAt: '2026-10-20T01:00:00+07:00', count: 900, brokenAtSeq: 901 } })),
    );
    renderApp(<AuditLogView />, { roles: ['R1'] });
    expect(await screen.findByText(/Chuỗi bị lệch từ dòng số 901/)).toBeInTheDocument();
  });
});

describe('quyền xem tạm của kiểm toán viên', () => {
  const opts = { domain: 'vcprosperous.com', today: '2026-10-20', maxDate: '2026-11-19' };
  it('kiểm email trong công ty, có phòng, hạn trong giới hạn', () => {
    const ok = { email: 'kiemtoan@vcprosperous.com', departmentIds: [ids.dept], expires: '2026-11-01' };
    expect(validateGrant(ok, opts)).toEqual({});
    expect(validateGrant({ ...ok, email: 'kt@gmail.com' }, opts).email).toMatch(/vcprosperous/);
    expect(validateGrant({ ...ok, departmentIds: [] }, opts).departmentIds).toBeTruthy();
    expect(validateGrant({ ...ok, expires: '2026-11-20' }, opts).expires).toBeTruthy();
    expect(validateGrant({ ...ok, expires: '2026-10-20' }, opts).expires).toBeTruthy();
  });

  it('R1 cấp quyền: POST kèm Idempotency-Key, hạn cuối ngày giờ Việt Nam', async () => {
    let body: Record<string, unknown> | undefined;
    let key: string | null = null;
    server.use(
      http.get(`${API}/auditor-access`, () => HttpResponse.json(page([]))),
      http.post(`${API}/auditor-access`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json(auditorAccess, { status: 201 });
      }),
    );
    renderApp(<AuditorAccessView />, { roles: ['R1'], me: { user: { ...people[ids.me], companyId: ids.company, createdAt: '', updatedAt: '', allowedActions: [], status: 'active', systemRoles: ['R1'], email: 'bdh@vcprosperous.com' } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Cấp quyền xem tạm' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Email kiểm toán viên/), 'KiemToan@vcprosperous.com');
    await userEvent.click(await within(dialog).findByLabelText(/11 MKT – Marketing/));
    await userEvent.type(within(dialog).getByLabelText(/^Lý do/), 'Kiểm toán năm');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cấp quyền' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ email: 'kiemtoan@vcprosperous.com', departmentIds: [ids.dept], reason: 'Kiểm toán năm' });
    expect(String(body?.expiresAt)).toMatch(/T23:59:59\+07:00$/);
    expect(key).toBeTruthy();
  });

  it('R3 chỉ xem: không có nút cấp; thu hồi theo allowedActions', async () => {
    let deleted = false;
    server.use(
      http.get(`${API}/auditor-access`, () => HttpResponse.json(page([auditorAccess, { ...auditorAccess, id: '6712f0c2a1b2c3d4e5f607d2', status: 'revoked', allowedActions: [] }]))),
      http.delete(`${API}/auditor-access/${ids.access}`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(<AuditorAccessView />, { roles: ['R3'] });
    expect(await screen.findAllByText('Đỗ Kiểm Toán')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Cấp quyền xem tạm' })).toBeNull();
    const revoke = screen.getAllByRole('button', { name: 'Thu hồi' });
    expect(revoke).toHaveLength(1);
    await userEvent.click(revoke[0]);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Thu hồi' }));
    await waitFor(() => expect(deleted).toBe(true));
  });
});

describe('gói bằng chứng', () => {
  it('hiện nội dung, mã băm và link tải ZIP', async () => {
    server.use(http.get(`${API}/evidence-pack/${ids.pack}`, () => HttpResponse.json(evidencePack)));
    renderApp(<EvidencePackView id={ids.pack} />);
    expect(await screen.findByText('pdf/HS-2026-000123.pdf')).toBeInTheDocument();
    expect(screen.getByText('200,0 KB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tải gói ZIP' })).toHaveAttribute('href', `/api/v1/evidence-pack/${ids.pack}/download`);
    expect(screen.getByRole('link', { name: 'Mở hồ sơ' })).toHaveAttribute('href', `/ho-so/${ids.record}`);
  });

  it('gói hết hạn (404) thì báo đã tự xoá', async () => {
    server.use(http.get(`${API}/evidence-pack/${ids.pack}`, () => HttpResponse.json(errorBody('NOT_FOUND', 'Không tìm thấy'), { status: 404 })));
    renderApp(<EvidencePackView id={ids.pack} />);
    expect(await screen.findByText(/Gói không còn/)).toBeInTheDocument();
  });

  it('lập gói từ trang hồ sơ: R3 và kiểm toán viên đúng phòng thấy nút; nhân viên thì không', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API}/evidence-pack`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ jobId: ids.job }, { status: 202 });
      }),
    );
    const { unmount } = renderApp(<AuditTools target={{ recordId: ids.record }} departmentId={ids.dept} />, { roles: ['R6'] });
    expect(screen.queryByRole('button', { name: 'Lập gói bằng chứng' })).toBeNull();
    unmount();
    const auditor = { auditorAccess: { id: ids.access, departmentIds: [ids.dept2], expiresAt: '2099-01-01T00:00:00+07:00' } };
    const r2 = renderApp(<AuditTools target={{ recordId: ids.record }} departmentId={ids.dept} />, { roles: [], me: auditor });
    expect(screen.queryByRole('button', { name: 'Lập gói bằng chứng' })).toBeNull();
    r2.unmount();
    renderApp(<AuditTools target={{ recordId: ids.record }} departmentId={ids.dept} />, { roles: ['R3'] });
    expect(screen.getByRole('link', { name: 'Xem nhật ký' })).toHaveAttribute('href', `/nhat-ky?objectType=record&objectId=${ids.record}`);
    await userEvent.click(screen.getByRole('button', { name: 'Lập gói bằng chứng' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lập gói' }));
    await waitFor(() => expect(body).toEqual({ recordId: ids.record }));
  });
});
