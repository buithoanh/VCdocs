import * as fs from 'fs';
import mongoose from 'mongoose';
import { loadConfig, loadDotEnv } from './config/config';
import { registerModels } from './db/models';
import { createRealGoogle } from './google/real/real-google';
import { inKetQuaNhanCay, nhanCayThuMuc } from './seed/nhan-cay-thu-muc';

/**
 * Nhận cây thư mục có sẵn trên shared drive của các phòng vào sổ VCdocs.
 *   pnpm --filter api run nhan-cay-thu-muc -- [--drive 11] [--thu] [--ra bao-cao.md]
 * Cần sơ đồ phòng đã nạp (nap-so-do) và GOOGLE_MODE=real. Chỉ đọc Drive, không đổi tên,
 * không di chuyển gì. Thư mục sai mẫu tên chỉ báo cáo. Chạy lại không tạo trùng.
 */
export function docThamSoNhanCay(argv: string[]): { drive?: string; thu: boolean; ra?: string } {
  const out: { drive?: string; thu: boolean; ra?: string } = { thu: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--thu') {
      out.thu = true;
      continue;
    }
    const m = /^--(drive|ra)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Tham số lạ: ${a}`);
    const v = m[2] ?? argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`Thiếu giá trị cho --${m[1]}`);
    out[m[1] as 'drive' | 'ra'] = v;
  }
  return out;
}

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const args = docThamSoNhanCay(process.argv.slice(2));
  if (cfg.googleMode !== 'real') throw new Error('Lệnh này đọc Google thật: đặt GOOGLE_MODE=real');
  const conn = await mongoose.createConnection(cfg.mongoUri).asPromise();
  let text: string;
  try {
    const m = registerModels(conn);
    await Promise.all(Object.values(m).map((x) => x.init()));
    text = inKetQuaNhanCay(await nhanCayThuMuc(m, createRealGoogle(cfg), { mien: cfg.allowedDomain, thu: args.thu, drive: args.drive }));
  } finally {
    await conn.close();
  }
  if (args.ra) fs.writeFileSync(args.ra, text + '\n');
  // eslint-disable-next-line no-console
  console.log(args.ra ? `${text.split('\n').slice(0, 3).join('\n')}\nĐã ghi báo cáo đủ vào ${args.ra}` : text);
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
