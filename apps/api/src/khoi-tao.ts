import mongoose from 'mongoose';
import { loadConfig, loadDotEnv } from './config/config';
import { registerModels } from './db/models';
import { khoiTaoCongTy } from './seed/khoi-tao-cong-ty';

/**
 * Lệnh khởi tạo CSDL trống (chế độ Google thật): tạo bản ghi công ty.
 *   pnpm --filter api run khoi-tao -- --ten "Công ty TNHH VC Phồn Vinh" --mien vcprosperous.com
 * Thiếu --mien thì lấy ALLOWED_DOMAIN. Chạy lại không tạo trùng.
 */
export function docThamSo(argv: string[]): { ten?: string; mien?: string } {
  const out: { ten?: string; mien?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--(ten|mien)(?:=(.*))?$/.exec(a);
    if (!m) {
      if (a === '--') continue;
      throw new Error(`Tham số lạ: ${a}`);
    }
    const v = m[2] ?? argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`Thiếu giá trị cho --${m[1]}`);
    out[m[1] as 'ten' | 'mien'] = v;
  }
  return out;
}

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const args = docThamSo(process.argv.slice(2));
  if (!args.ten) throw new Error('Thiếu --ten "Tên công ty"');
  const mien = args.mien ?? cfg.allowedDomain;
  if (mien.toLowerCase() !== cfg.allowedDomain.toLowerCase()) {
    // eslint-disable-next-line no-console
    console.warn(`Cảnh báo: --mien ${mien} khác ALLOWED_DOMAIN ${cfg.allowedDomain}; đăng nhập chỉ tìm công ty theo ALLOWED_DOMAIN.`);
  }
  const conn = await mongoose.createConnection(cfg.mongoUri).asPromise();
  try {
    const m = registerModels(conn);
    await m.Company.init();
    const kq = await khoiTaoCongTy(m, { ten: args.ten, mien });
    // eslint-disable-next-line no-console
    console.log(
      kq.daTao
        ? `Đã tạo công ty "${kq.name}" (${kq.domain}), id ${kq.id}`
        : `Công ty ${kq.domain} đã có ("${kq.name}", id ${kq.id}), không đổi gì`,
    );
  } finally {
    await conn.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
