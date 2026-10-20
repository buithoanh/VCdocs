import { Errors } from './errors';

export interface PageQuery {
  page: number;
  limit: number;
  skip: number;
  sort: Record<string, 1 | -1>;
}

/**
 * Phân trang chung: ?page=1&limit=50 (tối đa 200), ?sort=-createdAt,title.
 * Chỉ cho sắp xếp theo các trường được phép; trường lạ → 400.
 */
export function parsePage(q: Record<string, any>, allowedSort: string[], defaultSort = '-createdAt'): PageQuery {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const sort: Record<string, 1 | -1> = {};
  const raw = (q.sort as string) || defaultSort;
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const desc = part.startsWith('-');
    const field = desc ? part.slice(1) : part;
    if (!allowedSort.includes(field)) {
      throw Errors.validation('Không sắp xếp được theo trường này', [{ field: 'sort', issue: `unknown_field:${field}` }]);
    }
    sort[field === 'id' ? '_id' : field] = desc ? -1 : 1;
  }
  if (!('_id' in sort)) sort._id = -1;
  return { page, limit, skip: (page - 1) * limit, sort };
}

export function pageResult<T>(items: T[], p: PageQuery, total: number) {
  return { items, page: p.page, limit: p.limit, total };
}
