import { Schema } from 'mongoose';

/**
 * Chốt an toàn đa công ty: mọi truy vấn trên collection có companyId phải lọc
 * theo companyId (hợp đồng mục 1 "gắn vào mọi truy vấn"). Thiếu → ném lỗi ngay
 * thay vì lộ dữ liệu công ty khác. Truy vấn hệ thống cố ý bỏ qua thì đặt
 * option { skipTenant: true }.
 */
const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'countDocuments',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'distinct',
  'replaceOne',
] as const;

export class TenantViolation extends Error {}

export function tenantPlugin(schema: Schema): void {
  if (!schema.path('companyId')) return;
  for (const op of QUERY_OPS) {
    schema.pre(op as any, function (this: any) {
      if (this.getOptions?.().skipTenant) return;
      const filter = this.getFilter ? this.getFilter() : this.getQuery();
      if (!filter || filter.companyId === undefined || filter.companyId === null) {
        throw new TenantViolation(`Truy vấn ${op} trên ${this.model?.modelName} thiếu companyId`);
      }
    });
  }
  schema.pre('aggregate', function (this: any) {
    if (this.options?.skipTenant) return;
    const first = this.pipeline()[0];
    if (!first || !first.$match || first.$match.companyId === undefined) {
      throw new TenantViolation('aggregate phải bắt đầu bằng $match có companyId');
    }
  });
}
