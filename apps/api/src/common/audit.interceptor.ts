import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditService } from '../audit/audit.service';
import { getCtx } from './context';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Mọi POST/PATCH/DELETE ghi audit_logs và trả header X-Audit-Id. Dịch vụ tự ghi
 * dòng chi tiết (trước – sau); không ghi thì interceptor ghi một dòng chung.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!MUTATING.has(req.method)) return next.handle();
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            const ctx = getCtx(req);
            if (!ctx.companyId) return body;
            if (!ctx.auditIds.length) {
              const route = (req as any).route?.path ?? req.path;
              await this.audit.record(ctx, {
                action: `${req.method} ${route.replace(/^\/api\/v1/, '')}`,
                objectType: route.split('/')[3],
                objectId: req.params?.id as string | undefined,
              });
            }
            if (!res.headersSent) res.setHeader('X-Audit-Id', ctx.auditIds[ctx.auditIds.length - 1]);
            return body;
          })(),
        ),
      ),
    );
  }
}
