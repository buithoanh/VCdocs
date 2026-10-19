import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { expressToOas, getContract, OperationInfo } from '../contract/openapi';
import { Errors } from './errors';
import { getCtx } from './context';

export function operationOf(req: Request): OperationInfo | undefined {
  const routePath: string | undefined = (req as any).route?.path;
  if (!routePath) return undefined;
  return getContract().find(req.method, expressToOas(routePath));
}

/**
 * Kiểm dữ liệu vào theo đúng schema trong contract/openapi.yaml: tham số path,
 * query (ép kiểu, giá trị mặc định), Idempotency-Key, thân JSON (loại trường lạ).
 * Thân multipart kiểm trong controller sau khi multer đọc xong.
 */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = getCtx(req);
    const info = operationOf(req);
    if (!info) return next.handle();
    const contract = getContract();

    const pathRes = contract.validateParams(info, 'path', req.params || {});
    if (!pathRes.ok) throw Errors.validation('Tham số đường dẫn không hợp lệ', pathRes.errors);

    const rawQuery: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.query || {})) rawQuery[k] = v;
    const q = contract.validateParams(info, 'query', rawQuery);
    if (!q.ok) throw Errors.validation('Tham số lọc không hợp lệ', q.errors);
    ctx.query = q.data;

    if (info.hasIdempotency) {
      const key = req.header('idempotency-key');
      if (!key || key.length < 8 || key.length > 128) {
        throw Errors.validation('Thiếu Idempotency-Key (8–128 ký tự)', [{ field: 'header.Idempotency-Key', issue: 'required' }]);
      }
    }

    const isMultipart = req.is('multipart/form-data');
    if (!isMultipart && contract.bodySchema(info)) {
      if (req.body === undefined || req.body === null || (typeof req.body === 'object' && !Object.keys(req.body).length && !contract.bodyRequired(info))) {
        req.body = req.body ?? {};
      }
      if (typeof req.body !== 'object' || Array.isArray(req.body)) throw Errors.validation('Thân yêu cầu phải là đối tượng JSON');
      const r = contract.validateBody(info, req.body);
      if (!r.ok) throw Errors.validation('Dữ liệu gửi lên không hợp lệ', r.errors);
    }
    return next.handle();
  }
}
