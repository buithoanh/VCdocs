import { HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'STATE_INVALID'
  | 'RULE_VIOLATION'
  | 'LOCKED'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'DRIVE_ERROR'
  | 'MAINTENANCE'
  | 'INTERNAL';

export interface ErrorDetail {
  field: string;
  issue: string;
}

/** Lỗi nghiệp vụ; bộ lọc lỗi đổi thành thân Error của hợp đồng. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly rule?: string,
    public readonly details?: ErrorDetail[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const Errors = {
  validation: (message = 'Dữ liệu gửi lên không hợp lệ', details?: ErrorDetail[]) =>
    new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION', message, undefined, details),
  unauthenticated: (message = 'Bạn chưa đăng nhập hoặc phiên đã hết hạn') =>
    new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message),
  forbidden: (message = 'Bạn không có quyền thực hiện thao tác này') =>
    new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  notFound: (message = 'Không tìm thấy') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message),
  duplicate: (message: string, details?: ErrorDetail[]) =>
    new AppError(HttpStatus.CONFLICT, 'DUPLICATE', message, undefined, details),
  state: (message: string) => new AppError(HttpStatus.CONFLICT, 'STATE_INVALID', message),
  rule: (rule: string | undefined, message: string, details?: ErrorDetail[]) =>
    new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'RULE_VIOLATION', message, rule, details),
  tooLarge: (message = 'Dữ liệu gửi lên quá lớn (thân JSON tối đa 1 MB, file tối đa 100 MB)') =>
    new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', message),
  locked: (message = 'File đang khoá') => new AppError(HttpStatus.LOCKED, 'LOCKED', message),
  rateLimited: (retryAfterSec: number, message = 'Bạn thao tác quá nhanh, vui lòng thử lại sau') =>
    new AppError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, undefined, undefined, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
    }),
  drive: (message = 'Google Drive trả lỗi, vui lòng thử lại sau') =>
    new AppError(HttpStatus.BAD_GATEWAY, 'DRIVE_ERROR', message),
  internal: (message = 'Lỗi hệ thống, vui lòng thử lại sau') =>
    new AppError(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', message),
};

/** Lỗi từ lớp chuyển đổi Google; dịch vụ bắt lại thành 502 DRIVE_ERROR. */
export class GoogleError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}
