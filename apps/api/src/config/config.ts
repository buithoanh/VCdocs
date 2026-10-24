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
  authMode: 'google' | 'oidc';
  oidc: {
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    companyDomain?: string;
    groupRoleMap: Record<string, string[]>;
    projectionMaxAgeSeconds: number;
  };
  identityLifecycle: {
    mode: 'fake' | 'local';
    authentikBaseUrl?: string;
    authentikToken?: string;
    nextcloudBaseUrl?: string;
    nextcloudAdminUser?: string;
    nextcloudAdminPassword?: string;
    nextcloudControlUrl?: string;
    nextcloudControlToken?: string;
    timeoutMs: number;
  };
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
  workspaceStorage: {
    mode: 'fake' | 'nextcloud';
    baseUrl?: string;
    credentials: Record<string, { username: string; password: string }>;
    timeoutMs: number;
  };
  mailEngine: {
    mode: 'fake' | 'stalwart'; host: string; smtpPort: number; imapPort: number; sievePort: number; controlPort: number; controlToken: string;
    credentials: Record<string, { username: string; password: string }>;
    management?: { baseUrl: string; username: string; password: string };
  };
  documentEditor: {
    publicOrigin: string;
    internalOrigin: string;
    apiOriginForEditor: string;
    jwtSecret: string;
    enabled: boolean;
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

function storageCredentials(v: string | undefined) {
  if (!v) return {};
  const parsed = JSON.parse(v);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('WORKSPACE_STORAGE_CREDENTIALS_JSON phải là object');
  }
  return parsed as Record<string, { username: string; password: string }>;
}

function groupRoleMap(v: string | undefined): Record<string, string[]> {
  if (!v) return {};
  const parsed = JSON.parse(v);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OIDC_GROUP_ROLE_MAP_JSON phải là object');
  for (const [group, roles] of Object.entries(parsed)) {
    if (!group || !Array.isArray(roles) || roles.some((role) => !/^R[1-9]$/.test(String(role)))) {
      throw new Error('OIDC_GROUP_ROLE_MAP_JSON chỉ nhận group -> R1..R9[]');
    }
  }
  return parsed as Record<string, string[]>;
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
    authMode: (env.AUTH_MODE || 'google') as 'google' | 'oidc',
    oidc: {
      issuer: env.OIDC_ISSUER,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      companyDomain: env.OIDC_COMPANY_DOMAIN,
      groupRoleMap: groupRoleMap(env.OIDC_GROUP_ROLE_MAP_JSON),
      projectionMaxAgeSeconds: num(env.OIDC_PROJECTION_MAX_AGE_SECONDS, 300),
    },
    identityLifecycle: {
      mode: (env.IDENTITY_LIFECYCLE_MODE || 'fake') as 'fake' | 'local',
      authentikBaseUrl: env.IDENTITY_AUTHENTIK_BASE_URL,
      authentikToken: env.IDENTITY_AUTHENTIK_TOKEN,
      nextcloudBaseUrl: env.IDENTITY_NEXTCLOUD_BASE_URL,
      nextcloudAdminUser: env.IDENTITY_NEXTCLOUD_ADMIN_USER,
      nextcloudAdminPassword: env.IDENTITY_NEXTCLOUD_ADMIN_PASSWORD,
      nextcloudControlUrl: env.IDENTITY_NEXTCLOUD_CONTROL_URL,
      nextcloudControlToken: env.IDENTITY_NEXTCLOUD_CONTROL_TOKEN,
      timeoutMs: num(env.IDENTITY_LIFECYCLE_TIMEOUT_MS, 5_000),
    },
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
    workspaceStorage: {
      mode: (env.WORKSPACE_STORAGE_MODE || 'fake') as 'fake' | 'nextcloud',
      baseUrl: env.WORKSPACE_STORAGE_BASE_URL,
      credentials: storageCredentials(env.WORKSPACE_STORAGE_CREDENTIALS_JSON),
      timeoutMs: num(env.WORKSPACE_STORAGE_TIMEOUT_MS, 15_000),
    },
    mailEngine: {
      mode: (env.MAIL_ENGINE_MODE || 'fake') as 'fake' | 'stalwart',
      host: env.MAIL_ENGINE_HOST || '127.0.0.1', smtpPort: num(env.MAIL_ENGINE_SMTP_PORT, 18465), imapPort: num(env.MAIL_ENGINE_IMAP_PORT, 18993), sievePort: num(env.MAIL_ENGINE_SIEVE_PORT, 14190), controlPort: num(env.MAIL_ENGINE_CONTROL_PORT, 19090), controlToken: env.MAIL_ENGINE_CONTROL_TOKEN || '',
      credentials: storageCredentials(env.MAIL_ENGINE_CREDENTIALS_JSON),
      management: env.MAIL_ENGINE_MANAGEMENT_URL && env.MAIL_ENGINE_MANAGEMENT_USER && env.MAIL_ENGINE_MANAGEMENT_PASSWORD ? {
        baseUrl: env.MAIL_ENGINE_MANAGEMENT_URL,
        username: env.MAIL_ENGINE_MANAGEMENT_USER,
        password: env.MAIL_ENGINE_MANAGEMENT_PASSWORD,
      } : undefined,
    },
    documentEditor: {
      publicOrigin: env.DOCUMENT_EDITOR_PUBLIC_ORIGIN || 'http://127.0.0.1:18082',
      internalOrigin: env.DOCUMENT_EDITOR_INTERNAL_ORIGIN || 'http://127.0.0.1:18082',
      apiOriginForEditor: env.DOCUMENT_EDITOR_API_ORIGIN || env.PUBLIC_API_ORIGIN || 'http://host.docker.internal:4000',
      jwtSecret: env.DOCUMENT_EDITOR_JWT_SECRET || 'vcworkspace-test-editor-secret',
      enabled: bool(env.DOCUMENT_EDITOR_ENABLED, nodeEnv !== 'production'),
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
  if (!['google', 'oidc'].includes(cfg.authMode)) throw new Error('AUTH_MODE phải là google hoặc oidc');
  if (cfg.authMode === 'oidc' && (!cfg.oidc.issuer || !cfg.oidc.clientId || !cfg.oidc.clientSecret || !cfg.oidc.companyDomain)) {
    throw new Error('OIDC cần issuer, client id, client secret và company domain tường minh');
  }
  if (cfg.authMode === 'oidc' && (!Number.isFinite(cfg.oidc.projectionMaxAgeSeconds) || cfg.oidc.projectionMaxAgeSeconds <= 0)) {
    throw new Error('OIDC_PROJECTION_MAX_AGE_SECONDS phải lớn hơn 0');
  }
  if (cfg.nodeEnv === 'production' && cfg.authMode === 'oidc') {
    if (new URL(cfg.oidc.issuer!).protocol !== 'https:' || new URL(cfg.publicApiOrigin).protocol !== 'https:' || new URL(cfg.webOrigin).protocol !== 'https:' || !cfg.cookieSecure) {
      throw new Error('OIDC production bắt buộc HTTPS cho issuer/API/web và COOKIE_SECURE=true');
    }
  }
  if (!['fake', 'local'].includes(cfg.identityLifecycle.mode)) throw new Error('IDENTITY_LIFECYCLE_MODE phải là fake hoặc local');
  if (cfg.identityLifecycle.mode === 'local') {
    const i = cfg.identityLifecycle;
    if (!i.authentikBaseUrl || !i.authentikToken || !i.nextcloudBaseUrl || !i.nextcloudAdminUser || !i.nextcloudAdminPassword || !i.nextcloudControlUrl || !i.nextcloudControlToken) {
      throw new Error('Identity lifecycle local cần đủ Authentik và Nextcloud configuration');
    }
    if (![i.authentikBaseUrl, i.nextcloudBaseUrl, i.nextcloudControlUrl].every((value) => ['127.0.0.1', 'localhost', 'authentik.localtest.me', 'nextcloud.localtest.me'].includes(new URL(value!).hostname))) {
      throw new Error('Identity lifecycle chat12B chỉ được phép gọi local test endpoints');
    }
  }
  if (!['fake', 'nextcloud'].includes(cfg.workspaceStorage.mode)) {
    throw new Error('WORKSPACE_STORAGE_MODE phải là fake hoặc nextcloud');
  }
  if (!['fake', 'stalwart'].includes(cfg.mailEngine.mode)) throw new Error('MAIL_ENGINE_MODE phải là fake hoặc stalwart');
  if (cfg.mailEngine.mode === 'stalwart' && !['127.0.0.1', 'localhost', '::1'].includes(cfg.mailEngine.host)) throw new Error('Mail engine chat07 chỉ được phép loopback');
  return cfg;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
