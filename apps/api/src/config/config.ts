import * as path from 'path';
import * as fs from 'fs';

/** Cấu hình đọc từ biến môi trường (.env). Không ghi khoá thật vào mã nguồn. */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  mongoUri: string;
  /** Gốc công khai của API, vd http://localhost:4000 (dùng ghép redirect_uri OAuth) */
  publicApiOrigin: string;
  /** Gốc giao diện web, vd http://localhost:3000 (CORS, chuyển về sau đăng nhập, link QR) */
  webOrigin: string;
  allowedDomain: string;
  cookieSecure: boolean;
  sessionHours: number;
  googleMode: 'fake' | 'real';
  google: {
    clientId?: string;
    clientSecret?: string;
    /** JSON tài khoản máy ghi (chuỗi JSON, base64 hoặc đường dẫn file) */
    saWriteKey?: string;
    /** JSON tài khoản máy chỉ đọc */
    saReadKey?: string;
    /** Email quản trị để uỷ quyền toàn tên miền (Admin SDK) */
    adminSubject?: string;
    /** Hộp thư gửi thông báo */
    mailFrom: string;
    fakeStateFile?: string;
  };
  vaultDir: string;
  uploadTmpDir: string;
  stampFontPath?: string;
  jobsPollMs: number;
  schedulerEnabled: boolean;
  seedDemo: boolean;
  rules: {
    approvalDueDays: number;
    remindMinHours: number;
    reviewPeriodMonths: number;
    minorUnlockDays: number;
    backdateMaxWorkingDays: number;
    shareMaxDays: number;
    shareRemindDays: number;
    delegationMaxAmount: number;
    accountingDeptCodes: string[];
    hrDeptCodes: string[];
    internalOpsBlockCode: string;
  };
  rateLimit: { perMinute: number; searchPerMinute: number };
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function num(v: string | undefined, d: number): number {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Biến môi trường không phải số: ${v}`);
  return n;
}
function list(v: string | undefined, d: string[]): string[] {
  if (!v) return d;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadDotEnv(): void {
  // Đọc apps/api/.env nếu có; biến đã đặt sẵn trong môi trường được ưu tiên.
  const file = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(file)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: file });
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const googleMode = (env.GOOGLE_MODE || 'fake') as 'fake' | 'real';
  if (!['fake', 'real'].includes(googleMode)) throw new Error('GOOGLE_MODE phải là fake hoặc real');
  const cfg: AppConfig = {
    nodeEnv,
    port: num(env.PORT, 4000),
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vcdocs',
    publicApiOrigin: env.PUBLIC_API_ORIGIN || 'http://localhost:4000',
    webOrigin: env.WEB_ORIGIN || 'http://localhost:3000',
    allowedDomain: env.ALLOWED_DOMAIN || 'vcprosperous.com',
    cookieSecure: bool(env.COOKIE_SECURE, nodeEnv === 'production'),
    sessionHours: num(env.SESSION_HOURS, 8),
    googleMode,
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      saWriteKey: env.GOOGLE_SA_WRITE_KEY,
      saReadKey: env.GOOGLE_SA_READ_KEY,
      adminSubject: env.GOOGLE_ADMIN_SUBJECT,
      mailFrom: env.MAIL_FROM || 'vcdocs@vcprosperous.com',
      // Chạy local với Google giả: mặc định lưu trạng thái ra .vcdocs-dev/ để khởi động lại vẫn còn
      fakeStateFile:
        env.FAKE_GOOGLE_STATE_FILE === 'none'
          ? undefined
          : env.FAKE_GOOGLE_STATE_FILE || (googleMode === 'fake' && nodeEnv !== 'test' ? path.resolve(process.cwd(), '.vcdocs-dev', 'fake-google.json') : undefined),
    },
    vaultDir: env.VAULT_DIR || path.resolve(process.cwd(), '.vault'),
    uploadTmpDir: env.UPLOAD_TMP_DIR || path.resolve(process.cwd(), '.uploads'),
    stampFontPath: env.STAMP_FONT_PATH || undefined,
    jobsPollMs: num(env.JOBS_POLL_MS, 1000),
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
    seedDemo: bool(env.SEED_DEMO, googleMode === 'fake' && nodeEnv !== 'production'),
    rules: {
      approvalDueDays: num(env.APPROVAL_DUE_DAYS, 3),
      remindMinHours: num(env.APPROVAL_REMIND_MIN_HOURS, 24),
      reviewPeriodMonths: num(env.REVIEW_PERIOD_MONTHS, 12),
      minorUnlockDays: num(env.MINOR_UNLOCK_DAYS, 3),
      backdateMaxWorkingDays: num(env.BACKDATE_MAX_WORKING_DAYS, 3),
      shareMaxDays: num(env.SHARE_MAX_DAYS, 30),
      shareRemindDays: num(env.SHARE_REMIND_DAYS, 3),
      delegationMaxAmount: num(env.DELEGATION_MAX_AMOUNT, 500_000_000),
      accountingDeptCodes: list(env.ACCOUNTING_DEPT_CODES, ['TCKT', 'LT']),
      hrDeptCodes: list(env.HR_DEPT_CODES, ['HCNS']),
      internalOpsBlockCode: env.INTERNAL_OPS_BLOCK_CODE || 'VHNB',
    },
    rateLimit: { perMinute: num(env.RATE_LIMIT_PER_MINUTE, 600), searchPerMinute: num(env.RATE_LIMIT_SEARCH_PER_MINUTE, 60) },
    ...overrides,
  };
  if (cfg.nodeEnv === 'production' && cfg.googleMode === 'fake') {
    throw new Error('Không được chạy GOOGLE_MODE=fake ở production');
  }
  return cfg;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
