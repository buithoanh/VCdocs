import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, ErrorCode, GoogleError } from './errors';
import { getCtx } from './context';
import { AuditService } from '../audit/audit.service';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'STATE_INVALID',
  413: 'VALIDATION',
  422: 'RULE_VIOLATION',
  423: 'LOCKED',
  429: 'RATE_LIMITED',
  502: 'DRIVE_ERROR',
  503: 'MAINTENANCE',
};
const STATUS_MSG: Record<number, string> = {
  400: 'Dữ liệu gửi lên không hợp lệ',
  401: 'Bạn chưa đăng nhập hoặc phiên đã hết hạn',
  403: 'Bạn không có quyền thực hiện thao tác này',
  404: 'Không tìm thấy',
  413: 'Dữ liệu gửi lên quá lớn',
  429: 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
};

/** Mọi lỗi trả đúng schema Error của hợp đồng; message tiếng Việt, code tiếng Anh. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  constructor(private readonly audit?: AuditService) {}

  async catch(exception: any, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    const ctx = getCtx(req);
    let status = 500;
    let code: ErrorCode = 'INTERNAL';
    let message = 'Lỗi hệ thống, vui lòng thử lại sau';
    let rule: string | undefined;
    let details: any[] | undefined;

    if (exception instanceof AppError) {
      ({ status, code, message, rule, details } = exception);
      if (exception.headers) for (const [k, v] of Object.entries(exception.headers)) res.setHeader(k, v);
    } else if (exception instanceof GoogleError) {
      status = 502;
      code = 'DRIVE_ERROR';
      message = 'Google Drive trả lỗi, thao tác chưa thực hiện. Vui lòng thử lại sau';
      this.log.warn(`[${ctx?.requestId}] ${exception.message}`);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      if (status === 413) status = 400;
      code = STATUS_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION');
      message = STATUS_MSG[exception.getStatus()] ?? STATUS_MSG[status] ?? message;
      if (status === 404) message = 'Không tìm thấy đường dẫn';
      if (status === 400 && exception.getStatus() !== 413) {
        const r: any = exception.getResponse();
        if (/JSON/i.test(String(r?.message ?? ''))) message = 'Thân yêu cầu không phải JSON hợp lệ';
      }
    } else if (exception?.code === 11000) {
      status = 409;
      code = 'DUPLICATE';
      message = 'Dữ liệu bị trùng với bản ghi đã có';
    } else if (exception?.name === 'CastError') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'Không tìm thấy';
    } else if (exception?.type === 'entity.too.large') {
      status = 400;
      code = 'VALIDATION';
      message = 'Dữ liệu gửi lên quá lớn (tối đa 1 MB)';
    } else {
      this.log.error(`[${ctx?.requestId}] ${exception?.stack ?? exception}`);
    }

    // Từ chối vì thiếu quyền ghi vào nhật ký (hợp đồng mục 7)
    if (status === 403 && ctx?.companyId && this.audit) {
      try {
        await this.audit.record(ctx, {
          action: `${req.method} ${((req as any).route?.path ?? req.path).replace(/^\/api\/v1/, '')}`,
          objectId: req.params?.id as string | undefined,
          result: 'denied',
          after: { message },
        });
        res.setHeader('X-Audit-Id', ctx.auditIds[ctx.auditIds.length - 1]);
      } catch {
        /* không để lỗi ghi nhật ký che lỗi gốc */
      }
    }

    if (res.headersSent) return;
    const body: any = { error: { code, message, requestId: ctx?.requestId ?? '' } };
    if (rule) body.error.rule = rule;
    if (details?.length) body.error.details = details;
    res.status(status).json(body);
  }
}
