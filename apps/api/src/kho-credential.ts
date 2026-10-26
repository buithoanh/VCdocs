import mongoose from 'mongoose';
import { loadConfig, loadDotEnv } from './config/config';
import { Db } from './db/db.service';
import { registerModels, Models } from './db/models';
import { StorageCredentialStore } from './modules/drive-basic/storage-credential.store';

/**
 * Quản lý app password Nextcloud mã hoá trong CSDL (docs/ke-hoach/vcworkspace-21-b1-drive-office-production.md, P1).
 * Bí mật chỉ đọc từ stdin, không nhận qua tham số dòng lệnh (lộ trong lịch sử shell và ps):
 *   read -rs P; printf %s "$P" | pnpm --filter @vcdocs/api run kho-credential -- nap --email a@x.com --uid a; unset P
 *   pnpm --filter @vcdocs/api run kho-credential -- thu-hoi --email a@x.com
 *   pnpm --filter @vcdocs/api run kho-credential -- den-han --domain x.com
 *   pnpm --filter @vcdocs/api run kho-credential -- ma-hoa-lai --domain x.com
 */
export function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] === undefined) throw new Error(`Tham số không hợp lệ: ${rest[i]}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  if (!['nap', 'thu-hoi', 'den-han', 'ma-hoa-lai'].includes(command)) throw new Error('Lệnh: nap | thu-hoi | den-han | ma-hoa-lai');
  if ('password' in flags || 'mat-khau' in flags) throw new Error('Không truyền bí mật qua tham số; dùng stdin');
  return { command, flags };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Truyền app password qua stdin (xem hướng dẫn đầu file)');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function company(m: Models, domain: string) {
  const row = await m.Company.findOne({ domain: domain.toLowerCase() }).lean<any>();
  if (!row) throw new Error(`Không có công ty tên miền ${domain}`);
  return String(row._id);
}

export async function run(m: Models, store: StorageCredentialStore, argv: string[], stdin = readStdin) {
  const { command, flags } = parseArgs(argv);
  const domain = flags.domain || flags.email?.split('@')[1];
  if (!domain) throw new Error('Cần --email hoặc --domain');
  const companyId = await company(m, domain);
  if (command === 'den-han' || command === 'ma-hoa-lai') {
    return command === 'den-han' ? store.dueForRotation(companyId) : { reencrypted: await store.reencrypt(companyId) };
  }
  if (!flags.email) throw new Error('Cần --email');
  const user = await m.User.findOne({ companyId, email: flags.email.toLowerCase() }).lean<any>();
  if (!user) throw new Error(`Không có người dùng ${flags.email}`);
  if (command === 'thu-hoi') return { revoked: await store.revoke(companyId, String(user._id)) };
  if (!flags.uid) throw new Error('Cần --uid (uid Nextcloud)');
  await store.save({ companyId, userId: String(user._id), email: user.email, ncUid: flags.uid, password: await stdin() });
  return { saved: user.email, ncUid: flags.uid };
}

async function main() {
  loadDotEnv();
  const cfg = loadConfig();
  if (cfg.workspaceStorage.credentialSource !== 'store') throw new Error('Đặt WORKSPACE_STORAGE_CREDENTIAL_SOURCE=store');
  const conn = await mongoose.createConnection(cfg.mongoUri).asPromise();
  try {
    const m = registerModels(conn);
    const out = await run(m, new StorageCredentialStore(cfg, { m } as Db), process.argv.slice(2));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
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
