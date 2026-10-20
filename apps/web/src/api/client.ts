import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

/**
 * Lớp gọi API chung của VCdocs.
 *
 * - Gọi /api/v1/... cùng tên miền; Next.js chuyển tiếp sang máy chủ API.
 * - Phiên đăng nhập là cookie HttpOnly do máy chủ đặt; giao diện không giữ token.
 * - Mọi yêu cầu: X-Request-Id. POST/PATCH/DELETE: X-CSRF-Token (lấy từ GET /me).
 * - POST cần chống lặp: truyền Idempotency-Key qua `idem(key)`.
 * - 401 → chuyển về trang đăng nhập.
 */

export type Schemas = components['schemas'];
export type ApiErrorBody = Schemas['Error']['error'];
export type Limits = Schemas['Me']['limits'];
type UserRef = Schemas['UserRef'];

/* Header X-CSRF-Token / Idempotency-Key do lớp này tự điền nên bỏ khỏi kiểu bắt buộc. */
type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';
type StripHeader<Op> = Op extends { parameters: infer P }
  ? Omit<Op, 'parameters'> & { parameters: Omit<P, 'header'> & { header?: never } }
  : Op;
export type ClientPaths = {
  [K in keyof paths]: {
    [M in keyof paths[K]]: M extends HttpMethod ? StripHeader<paths[K][M]> : paths[K][M];
  };
};

export const API_BASE = '/api/v1';
export const LOGIN_PATH = '/dang-nhap';

/* Giới hạn cấu hình từ GET /me (D12), để báo trước; máy chủ vẫn quyết định. */
export const DEFAULT_LIMITS: Limits = { shareMaxDays: 30, backdateWorkingDays: 3, approvalDueDays: 3, minorUnlockDays: 3, uploadMaxMb: 100 };
let limits: Limits = DEFAULT_LIMITS;
export function setLimits(l: Limits | undefined) {
  limits = l ?? DEFAULT_LIMITS;
}
export function getLimits() {
  return limits;
}

/* ── Tên người (D10): mọi phản hồi có people (id → UserRef); gom vào một kho chung ── */
const people = new Map<string, UserRef>();
const peopleListeners = new Set<() => void>();
let peopleVersion = 0;
export function rememberPeople(map: Record<string, UserRef> | undefined | null) {
  if (!map) return;
  let changed = false;
  for (const [id, ref] of Object.entries(map)) {
    const old = people.get(id);
    if (!old || old.name !== ref.name || old.email !== ref.email) {
      people.set(id, ref);
      changed = true;
    }
  }
  if (changed) {
    peopleVersion++;
    peopleListeners.forEach((fn) => fn());
  }
}
export function getPerson(id: string | undefined) {
  return id ? people.get(id) : undefined;
}
export function subscribePeople(fn: () => void) {
  peopleListeners.add(fn);
  return () => {
    peopleListeners.delete(fn);
  };
}
export function getPeopleVersion() {
  return peopleVersion;
}
/** Lấy people ở cấp trên cùng, trong items[] và trong result của job. */
export function collectPeople(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const d = data as { people?: Record<string, UserRef>; items?: unknown[] };
  rememberPeople(d.people);
  if (Array.isArray(d.items)) for (const it of d.items) if (it && typeof it === 'object') rememberPeople((it as { people?: Record<string, UserRef> }).people);
}

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export function getCsrfToken() {
  return csrfToken;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/** Tuỳ chọn fetch để gửi Idempotency-Key (giữ nguyên key khi bấm lại cùng một việc). */
export function idem(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

let unauthorizedHandler: () => void = () => {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname.startsWith(LOGIN_PATH)) return;
  const returnTo = encodeURIComponent(pathname + search);
  window.location.assign(`${LOGIN_PATH}?returnTo=${returnTo}`);
};
/** Cho test thay cách xử lý 401. */
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export const headerMiddleware: Middleware = {
  onRequest({ request }) {
    if (!request.headers.has('X-Request-Id')) request.headers.set('X-Request-Id', newId());
    if (MUTATING.has(request.method.toUpperCase()) && csrfToken) {
      request.headers.set('X-CSRF-Token', csrfToken);
    }
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) unauthorizedHandler();
    return response;
  },
};

function resolveBase() {
  // Trong trình duyệt dùng đường dẫn tương đối; khi chạy test (jsdom) có location.origin.
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return `${window.location.origin}${API_BASE}`;
  }
  return `http://localhost${API_BASE}`;
}

export const api = createClient<ClientPaths>({
  baseUrl: resolveBase(),
  credentials: 'same-origin',
  // Lấy fetch lúc gọi (không giữ bản lúc nạp module) để công cụ test chặn được.
  fetch: (req) => globalThis.fetch(req),
});
api.use(headerMiddleware);

/** Lỗi API có message tiếng Việt và mã BR (nếu có). */
export class ApiError extends Error {
  status: number;
  code?: string;
  rule?: string;
  details?: ApiErrorBody['details'];
  requestId?: string;
  /** Số giây chờ khi 429 (header Retry-After). */
  retryAfter?: number;
  constructor(status: number, body?: Partial<ApiErrorBody>, retryAfter?: number) {
    super(body?.message || defaultMessage(status));
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code;
    this.rule = body?.rule;
    this.details = body?.details;
    this.requestId = body?.requestId;
    this.retryAfter = retryAfter;
  }
}

export function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Thông tin nhập chưa đúng.';
    case 401:
      return 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại.';
    case 403:
      return 'Bạn không có quyền làm việc này.';
    case 404:
      return 'Không tìm thấy.';
    case 413:
      return `File hoặc nội dung quá lớn (tối đa ${limits.uploadMaxMb} MB).`;
    case 409:
      return 'Dữ liệu đã thay đổi hoặc bị trùng, vui lòng tải lại trang.';
    case 422:
      return 'Việc này trái quy định.';
    case 423:
      return 'File đang khoá.';
    case 429:
      return 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';
    case 502:
      return 'Google Drive đang gặp lỗi, vui lòng thử lại.';
    case 503:
      return 'Hệ thống đang bảo trì.';
    default:
      return 'Có lỗi xảy ra, vui lòng thử lại.';
  }
}

/** Chuỗi hiển thị cho người dùng: message, kèm mã quy tắc khi 422. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 422 && err.rule) return `${err.message} (Quy tắc ${err.rule})`;
    if (err.status === 429) return `Bạn thao tác quá nhanh, vui lòng thử lại sau ${err.retryAfter ?? 60} giây.`;
    if (err.status === 413) return defaultMessage(413);
    return err.message;
  }
  if (err instanceof Error && err.message) {
    if (err.name === 'TypeError') return 'Không kết nối được máy chủ, vui lòng kiểm tra mạng.';
    return err.message;
  }
  return defaultMessage(0);
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/** Trả data hoặc ném ApiError. */
export async function unwrap<T>(p: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) {
    const body = (error as { error?: ApiErrorBody } | undefined)?.error;
    const ra = Number(response.headers.get('Retry-After'));
    throw new ApiError(response.status, body, Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : undefined);
  }
  collectPeople(data);
  return data as T;
}
