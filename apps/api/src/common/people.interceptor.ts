import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { from, Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Db } from '../db/db.service';
import { getCtx } from './context';
import { isObjectId } from './util';

/** Tên trường chứa id người (đơn hoặc mảng) – D10 */
export const PERSON_KEYS = new Set([
  'createdBy',
  'updatedBy',
  'drafterId',
  'checkerId',
  'approverId',
  'submittedBy',
  'sharedBy',
  'revokedBy',
  'requestedBy',
  'delegateId',
  'directorId',
  'headId',
  'issuedBy',
  'approvedBy',
  'by',
  'reviewerIds',
]);

function collect(v: any, out: Set<string>, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 8) return;
  if (Array.isArray(v)) return v.forEach((x) => collect(x, out, depth + 1));
  for (const [k, val] of Object.entries(v)) {
    if (k === 'people') continue;
    if (PERSON_KEYS.has(k)) {
      for (const id of Array.isArray(val) ? val : [val]) if (isObjectId(id)) out.add(id);
    } else collect(val, out, depth + 1);
  }
}

/**
 * Gắn `people` (id → UserRef) vào phản hồi chi tiết và trang danh sách để FE
 * hiện tên người mà không gọi thêm (hợp đồng mục 9, D10).
 */
@Injectable()
export class PeopleInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            const ctx = getCtx(req);
            if (!ctx?.companyId || !body || typeof body !== 'object' || Array.isArray(body)) return body;
            const isPage = 'items' in body && 'total' in body && 'page' in body;
            const isObj = (x: any) => x && typeof x === 'object' && 'id' in x && 'companyId' in x;
            const items: any[] = Array.isArray(body.items) ? body.items : [];
            if (!isPage && !isObj(body) && !items.some(isObj)) return body;
            const ids = new Set<string>();
            collect(isObj(body) ? body : items, ids);
            const all: Record<string, any> = {};
            if (ids.size) {
              const users = await this.db.m.User.find(
                { companyId: new Types.ObjectId(ctx.companyId), _id: { $in: [...ids].map((x) => new Types.ObjectId(x)) } },
                { name: 1, email: 1, title: 1, departmentId: 1 },
              ).lean<any[]>();
              for (const u of users) {
                const ref: any = { id: String(u._id), name: u.name, email: u.email };
                if (u.title) ref.title = u.title;
                if (u.departmentId) ref.departmentId = String(u.departmentId);
                all[ref.id] = ref;
              }
            }
            const subset = (x: any) => {
              const own = new Set<string>();
              collect(x, own);
              return Object.fromEntries([...own].filter((id) => all[id]).map((id) => [id, all[id]]));
            };
            // Từng đối tượng trong danh sách cũng mang people của riêng nó (schema WithPeople)
            if (items.length) body = { ...body, items: items.map((x) => (isObj(x) ? { ...x, people: subset(x) } : x)) };
            if (isObj(body)) return { ...body, people: subset(body) };
            return isPage ? { ...body, people: all } : body;
          })(),
        ),
      ),
    );
  }
}
