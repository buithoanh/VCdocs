import * as fs from 'fs';
import mongoose from 'mongoose';
import { loadConfig, loadDotEnv } from './config/config';
import { registerModels } from './db/models';
import { createRealGoogle } from './google/real/real-google';
import { docSoDo, soDoTuCsdl } from './seed/so-do-to-chuc';
import { baoCaoNhomC1, inBaoCaoC1 } from './seed/nhom-c1';
import { docThamSoSoDo, timFile } from './nap-so-do';

/**
 * Báo cáo nhóm Google theo mẫu C1: thiếu / thừa / chưa gắn drive / thiếu người.
 * Chỉ đọc Google thật, không tạo nhóm.
 *   pnpm --filter api run nhom-c1 -- [--file so-do-to-chuc.yaml] [--ra bao-cao.md]
 * Không có --file thì lấy sơ đồ đã nạp trong CSDL.
 */
async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  const args = docThamSoSoDo(process.argv.slice(2));
  if (args.thu) throw new Error('Lệnh này vốn chỉ đọc, không cần --thu');
  if (cfg.googleMode !== 'real') throw new Error('Lệnh này đọc Google thật: đặt GOOGLE_MODE=real');
  let sd;
  if (args.file) sd = docSoDo(fs.readFileSync(timFile(args.file), 'utf8'), cfg.allowedDomain);
  else {
    const conn = await mongoose.createConnection(cfg.mongoUri).asPromise();
    try {
      sd = await soDoTuCsdl(registerModels(conn), cfg.allowedDomain);
    } finally {
      await conn.close();
    }
    if (!sd.phong.length) throw new Error('CSDL chưa có phòng nào: chạy nap-so-do trước hoặc dùng --file');
  }
  const text = inBaoCaoC1(await baoCaoNhomC1(createRealGoogle(cfg), sd, cfg.allowedDomain));
  if (args.ra) {
    fs.writeFileSync(args.ra, text + '\n');
    // eslint-disable-next-line no-console
    console.log(`Đã ghi ${args.ra}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(text);
  }
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
