import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API, server } from '@/test/server';
import { errorBody } from '@/test/fixtures';
import { ApiError, api, errorText, getPerson, idem, setCsrfToken, setUnauthorizedHandler, unwrap } from './client';

describe('lớp gọi API', () => {
  it('gửi X-Request-Id cho mọi yêu cầu, không gửi CSRF cho GET', async () => {
    let headers: Headers | undefined;
    server.use(http.get(`${API}/drives`, ({ request }) => ((headers = request.headers), HttpResponse.json({ items: [] }))));
    setCsrfToken('tok');
    await unwrap(api.GET('/drives'));
    expect(headers?.get('X-Request-Id')).toBeTruthy();
    expect(headers?.get('X-CSRF-Token')).toBeNull();
  });

  it('POST kèm X-CSRF-Token lấy từ /me và Idempotency-Key khi truyền', async () => {
    let headers: Headers | undefined;
    server.use(http.post(`${API}/blocks`, ({ request }) => ((headers = request.headers), HttpResponse.json({}, { status: 201 }))));
    setCsrfToken('csrf-mau-123');
    await unwrap(api.POST('/blocks', { body: { code: 'KD', name: 'Khối Kinh doanh' }, ...idem('khoa-chong-lap-1') }));
    expect(headers?.get('X-CSRF-Token')).toBe('csrf-mau-123');
    expect(headers?.get('Idempotency-Key')).toBe('khoa-chong-lap-1');
    expect(headers?.get('X-Request-Id')).toBeTruthy();
  });

  it('401 gọi xử lý về trang đăng nhập', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    server.use(http.get(`${API}/drives`, () => HttpResponse.json(errorBody('UNAUTHENTICATED', 'Chưa đăng nhập'), { status: 401 })));
    await expect(unwrap(api.GET('/drives'))).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('lỗi hiện error.message; 422 kèm mã BR', async () => {
    server.use(
      http.post(`${API}/documents`, () => HttpResponse.json(errorBody('RULE_VIOLATION', 'Quy định chỉ được đăng ký ở cấp VCPV', 'BR-02'), { status: 422 })),
    );
    const err = await unwrap(
      api.POST('/documents', { body: { type: 'QD', level: 'DEPT', title: 'x', departmentId: 'a', drafterId: 'b' }, ...idem('12345678') }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(errorText(err)).toBe('Quy định chỉ được đăng ký ở cấp VCPV (Quy tắc BR-02)');
  });

  it('429 báo chờ theo Retry-After', async () => {
    server.use(http.get(`${API}/search`, () => HttpResponse.json(errorBody('RATE_LIMITED', 'Quá nhiều yêu cầu'), { status: 429, headers: { 'Retry-After': '12' } })));
    const err = await unwrap(api.GET('/search', { params: { query: { q: 'x' } } })).catch((e) => e);
    expect(err.retryAfter).toBe(12);
    expect(errorText(err)).toBe('Bạn thao tác quá nhanh, vui lòng thử lại sau 12 giây.');
  });

  it('413 báo file quá lớn theo giới hạn', () => {
    expect(errorText(new ApiError(413, { code: 'PAYLOAD_TOO_LARGE', message: 'x', requestId: 'r' }))).toBe('File hoặc nội dung quá lớn (tối đa 100 MB).');
  });

  it('gom people từ trang danh sách và từ từng dòng', async () => {
    server.use(
      http.get(`${API}/approvals`, () =>
        HttpResponse.json({ page: 1, limit: 50, total: 0, items: [{ people: { b: { id: 'b', name: 'B', email: 'b@x' } } }], people: { a: { id: 'a', name: 'A', email: 'a@x' } } }),
      ),
    );
    await unwrap(api.GET('/approvals'));
    expect(getPerson('a')?.name).toBe('A');
    expect(getPerson('b')?.name).toBe('B');
  });

  it('lỗi không có thân dùng câu mặc định tiếng Việt', () => {
    expect(errorText(new ApiError(403))).toBe('Bạn không có quyền làm việc này.');
    expect(errorText(new ApiError(409, { message: 'Hồ sơ đã chốt', code: 'STATE_INVALID', requestId: 'x' }))).toBe('Hồ sơ đã chốt');
  });
});
