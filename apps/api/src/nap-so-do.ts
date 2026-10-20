import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';
import { loadConfig, loadDotEnv } from './config/config';
import { registerModels } from './db/models';
import { createRealGoogle } from './google/real/real-google';
import { docSoDo, inKetQuaNap, napSoDo } from './seed/so-do-to-chuc';

/**
 * Nạp sơ đồ tổ chức (khối, phòng, division, vai trò) từ file vào CSDL.
 *   pnpm --filter api run nap-so-do -- --file so-do-to-chuc.yaml [--thu]
 * Mẫu file: apps/api/so-do-to-chuc.mau.yaml. Cần GOOGLE_MODE=real (đọc drive, Directory).
 * Chạy lại không tạo trùng; --thu chỉ in việc sẽ làm.
 */
export function docThamSoSoDo(argv: string[]): { file?: string; thu: boolean; ra?: string } {
  const out: { file?: string; thu: boolean; ra?: string } = { thu: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--thu') {
      out.thu = true;
      continue;
    }
    const m = /^--(file|ra)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Tham số lạ: ${a}`);
    const v = m[2] ?? argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`Thiếu giá trị cho --${m[1]}`);
    out[m[1] as 'file' | 'ra'] = v;
  }
  return out;
}

/** Đường dẫn tương đối tính từ thư mục gọi lệnh, rồi tới apps/api (pnpm --filter chạy ở apps/api) */
export function timFile(p: string): string {
  const cands = [path.resolve(process.env.INIT_CWD ?? process.cwd(), p), path.resolve(process.cwd(), p)];
  const f = cands.find((c) => fs.existsSync(c));
  if (!f) throw new Error(`Không thấy file ${p}`);
  return f;
}

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const args = docThamSoSoDo(process.argv.slice(2));
  if (!args.file) throw new Error('Thiếu --file <so-do-to-chuc.yaml> (mẫu: apps/api/so-do-to-chuc.mau.yaml)');
  if (cfg.googleMode !== 'real') throw new Error('Lệnh này đọc Google thật: đặt GOOGLE_MODE=real');
  const sd = docSoDo(fs.readFileSync(timFile(args.file), 'utf8'), cfg.allowedDomain);
  const conn = await mongoose.createConnection(cfg.mongoUri).asPromise();
  try {
    const m = registerModels(conn);
    await Promise.all(Object.values(m).map((x) => x.init()));
    const kq = await napSoDo(m, createRealGoogle(cfg), cfg, sd, { thu: args.thu });
    // eslint-disable-next-line no-console
    console.log(inKetQuaNap(kq));
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
