import type { Models } from '../db/models';

export interface KhoiTaoCongTyKetQua {
  daTao: boolean;
  id: string;
  name: string;
  domain: string;
}

/**
 * Tạo bản ghi Company (name, domain, settings: {}) nếu tên miền chưa có.
 * Chạy lại nhiều lần không sao: đã có thì giữ nguyên, không ghi đè tên.
 */
export async function khoiTaoCongTy(m: Models, input: { ten: string; mien: string }): Promise<KhoiTaoCongTyKetQua> {
  const name = input.ten.trim();
  const domain = input.mien.trim().toLowerCase().replace(/^@/, '');
  if (!name) throw new Error('Thiếu tên công ty (--ten)');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error(`Tên miền không hợp lệ: ${input.mien}`);
  // upsert + $setOnInsert: hai lệnh chạy cùng lúc cũng chỉ ra một bản ghi (domain unique)
  const res = await m.Company.findOneAndUpdate(
    { domain },
    { $setOnInsert: { name, domain, settings: {} } },
    { upsert: true, new: true, includeResultMetadata: true },
  ).lean<any>();
  const doc = res.value!;
  return { daTao: !res.lastErrorObject?.updatedExisting, id: String(doc._id), name: doc.name, domain: doc.domain };
}
