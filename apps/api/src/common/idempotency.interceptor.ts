import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { Db } from '../db/db.service';
import { canonical } from '../audit/audit.service';
import { Errors } from './errors';
import { getCtx } from './context';
import { operationOf } from './contract.interceptor';
import { sha256 } from './util';

const TTL_MS = 24 * 3600_000;

/**
 * Chống lặp (hợp đồng mục 1): POST có Idempotency-Key gửi lại trong 24 giờ
 * nhận đúng kết quả cũ, không làm hai lần. Key gắn theo người gọi.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ctx = getCtx(req);
    const info = operationOf(req);
    if (!info?.hasIdempotency || !ctx.user) return next.handle();
    const key = req.header('idempotency-key')!;
    const M = this.db.m.Idempotency;
    const companyId = new Types.ObjectId(ctx.companyId);
    const userId = new Types.ObjectId(ctx.user.id);
    const path = req.originalUrl.split('?')[0];
    const bodyHash = sha256(canonical(req.body ?? {}));

    return from(
      (async () => {
        try {
          await M.create({ companyId, userId, key, method: req.method, path, bodyHash, state: 'pending', expiresAt: new Date(Date.now() + TTL_MS) });
          return { fresh: true as const };
        } catch (e: any) {
          if (e?.code !== 11000) throw e;
          const old = await M.findOne({ companyId, userId, key }).lean<any>();
          if (!old) throw Errors.state('Yêu cầu đang được xử lý, vui lòng thử lại');
          if (old.path !== path || old.method !== req.method || old.bodyHash !== bodyHash) {
            throw Errors.duplicate('Idempotency-Key này đã dùng cho một yêu cầu khác');
          }
          if (old.state !== 'done') throw Errors.state('Yêu cầu trước với cùng Idempotency-Key đang được xử lý');
          return { fresh: false as const, old };
        }
      })(),
    ).pipe(
      mergeMap((r) => {
        if (!r.fresh) {
          res.status(r.old.status);
          res.setHeader('Idempotent-Replayed', 'true');
          if (r.old.auditId) res.setHeader('X-Audit-Id', r.old.auditId);
          return of(r.old.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(
              M.updateOne(
                { companyId, userId, key },
                { $set: { state: 'done', status: res.statusCode, body, auditId: ctx.auditIds[ctx.auditIds.length - 1] } },
              ).then(() => body),
            ),
          ),
          catchError((err) =>
            // Lỗi thì xoá key để người dùng sửa rồi gửi lại
            from(M.deleteOne({ companyId, userId, key }).then(() => Promise.reject(err))),
          ),
        );
      }),
    );
  }
}
