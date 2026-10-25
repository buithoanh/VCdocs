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
    /** disabled: route lifecycle trả 503, không có cổng nào chạm Authentik/Nextcloud (mặc định production). */
    mode: 'fake' | 'local' | 'disabled';
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
  /** Chat14 Flow: nhận webhook Nextcloud webhook_listeners, journal + worker nền */
  flow: FlowConfig;
}

export type FlowRule =
  | { id: string; kind: 'forms.submission-to-deck'; runner: string; formId: number; boardId: number; stackId: number; allowSharedBoard?: boolean }
  | { id: string; kind: 'tables.row-notify'; runner: string; tableId: number; recipients: string[] }
  | { id: string; kind: 'files.verify-tag'; runner: string; folderPath: string; tagName: string };

export interface FlowConfig {
  /** Tắt mặc định; route trả 503 khi tắt */
  enabled: boolean;
  /** Công ty nhận event của instance Nextcloud này (không lấy từ payload) */
  companyId?: string;
  /** Bí mật header X-VCW-Flow-Token; phần tử đầu là bản hiện hành, các phần tử sau còn nhận trong lúc xoay vòng */
  webhookSecrets: string[];
  nextcloud: {
    baseUrl?: string;
    timeoutMs: number;
    /** runner → app password của chính người chạy flow (không dùng admin) */
    credentials: Record<string, { username: string; password: string }>;
    /** uid Nextcloud bất biến → email tài khoản VCworkspace nhận thông báo */
    userBindings: Record<string, string>;
  };
  rules: FlowRule[];
  /** Nhịp worker nền (ms); 0 = không tự chạy (test gọi drain) */
  workerPollMs: number;
  /** Hạn giữ việc đang chạy; quá hạn thì worker khác (sau restart) lấy lại */
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  /** Nhịp đối soát bù event bị lỡ (Nextcloud không gửi lại); 0 = tắt */
  reconcileMs: number;
}

const FLOW_RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NC_UID = /^[A-Za-z0-9._@-]{1,64}$/;

function flowRules(v: string | undefined): FlowRule[] {
  if (!v) return [];
  const parsed = JSON.parse(v);
  if (!Array.isArray(parsed)) throw new Error('FLOW_RULES_JSON phải là mảng');
  return parsed as FlowRule[];
}

function stringMap(v: string | undefined, name: string): Record<string, string> {
  if (!v) return {};
  const parsed = JSON.parse(v);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((x) => typeof x !== 'string')) {
    throw new Error(`${name} phải là object chuỗi → chuỗi`);
  }
  return parsed as Record<string, string>;
}

const posInt = (x: unknown) => Number.isSafeInteger(x) && (x as number) > 0;

/** Kiểm cấu hình Flow ngay lúc khởi động: thiếu/sai thì dừng, không chạy nửa vời. */
export function validateFlowConfig(f: FlowConfig, nodeEnv: string): void {
  if (!f.enabled) return;
  if (!f.companyId || !/^[a-f0-9]{24}$/.test(f.companyId)) throw new Error('FLOW_COMPANY_ID phải là ObjectId công ty');
  if (!f.webhookSecrets.length || f.webhookSecrets.some((s) => Buffer.byteLength(s) < 32 || Buffer.byteLength(s) > 256 || /[\s,]/.test(s))) {
    throw new Error('FLOW_WEBHOOK_SECRETS cần ít nhất một bí mật 32–256 byte, không khoảng trắng');
  }
  if (!f.nextcloud.baseUrl) throw new Error('FLOW_NEXTCLOUD_BASE_URL bắt buộc khi bật Flow');
  const base = new URL(f.nextcloud.baseUrl);
  if (base.username || base.password || base.search || base.hash) throw new Error('FLOW_NEXTCLOUD_BASE_URL không được chứa thông tin đăng nhập, query hay fragment');
  if (nodeEnv === 'production' ? base.protocol !== 'https:' : !['https:', 'http:'].includes(base.protocol)) {
    throw new Error('FLOW_NEXTCLOUD_BASE_URL production bắt buộc https');
  }
  if (nodeEnv !== 'production' && base.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(base.hostname) && !base.hostname.endsWith('.localtest.me')) {
    throw new Error('Flow http chỉ được phép tới Nextcloud thử local');
  }
  const ids = new Set<string>();
  for (const r of f.rules as any[]) {
    if (!r || typeof r !== 'object' || !FLOW_RULE_ID.test(String(r.id)) || ids.has(r.id)) throw new Error('Rule Flow cần id duy nhất [a-z0-9-]');
    ids.add(r.id);
    if (!f.nextcloud.credentials[r.runner]) throw new Error(`Rule ${r.id}: runner chưa có credential`);
    if (r.kind === 'forms.submission-to-deck') {
      if (![r.formId, r.boardId, r.stackId].every(posInt)) throw new Error(`Rule ${r.id}: formId/boardId/stackId phải là số nguyên dương`);
    } else if (r.kind === 'tables.row-notify') {
      if (!posInt(r.tableId) || !Array.isArray(r.recipients) || !r.recipients.length || r.recipients.some((u: unknown) => typeof u !== 'string' || !NC_UID.test(u))) {
        throw new Error(`Rule ${r.id}: tableId và recipients (uid Nextcloud) bắt buộc`);
      }
    } else if (r.kind === 'files.verify-tag') {
      if (typeof r.folderPath !== 'string' || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(r.folderPath) || typeof r.tagName !== 'string' || !r.tagName.trim()) {
        throw new Error(`Rule ${r.id}: folderPath (ASCII, tương đối) và tagName bắt buộc`);
      }
    } else {
      throw new Error(`Rule ${r.id}: kind không hỗ trợ`);
    }
  }
  for (const [uid, email] of Object.entries(f.nextcloud.userBindings)) {
    if (!NC_UID.test(uid) || !email.includes('@')) throw new Error('FLOW_NEXTCLOUD_USER_BINDINGS_JSON: uid → email');
  }
  if (!(f.leaseMs >= 1000) || !(f.maxAttempts >= 1 && f.maxAttempts <= 20) || !(f.retryBaseMs >= 0) || !(f.workerPollMs >= 0) || !(f.reconcileMs >= 0)) {
    throw new Error('Tham số worker Flow không hợp lệ');
  }
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

const DEFAULT_EDITOR_SECRET = 'vcworkspace-test-editor-secret';

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
      mode: (env.IDENTITY_LIFECYCLE_MODE || (nodeEnv === 'production' ? 'disabled' : 'fake')) as 'fake' | 'local' | 'disabled',
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
      jwtSecret: env.DOCUMENT_EDITOR_JWT_SECRET || DEFAULT_EDITOR_SECRET,
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
    flow: {
      enabled: bool(env.FLOW_ENABLED, false),
      companyId: env.FLOW_COMPANY_ID,
      webhookSecrets: list(env.FLOW_WEBHOOK_SECRETS, []),
      nextcloud: {
        baseUrl: env.FLOW_NEXTCLOUD_BASE_URL,
        timeoutMs: num(env.FLOW_NEXTCLOUD_TIMEOUT_MS, 10_000),
        credentials: storageCredentials(env.FLOW_NEXTCLOUD_CREDENTIALS_JSON),
        userBindings: stringMap(env.FLOW_NEXTCLOUD_USER_BINDINGS_JSON, 'FLOW_NEXTCLOUD_USER_BINDINGS_JSON'),
      },
      rules: flowRules(env.FLOW_RULES_JSON),
      workerPollMs: num(env.FLOW_WORKER_POLL_MS, 500),
      leaseMs: num(env.FLOW_LEASE_MS, 60_000),
      maxAttempts: num(env.FLOW_MAX_ATTEMPTS, 5),
      retryBaseMs: num(env.FLOW_RETRY_BASE_MS, 2_000),
      reconcileMs: num(env.FLOW_RECONCILE_MS, 0),
    },
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
  if (!['fake', 'local', 'disabled'].includes(cfg.identityLifecycle.mode)) throw new Error('IDENTITY_LIFECYCLE_MODE phải là fake, local hoặc disabled');
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
  validateFlowConfig(cfg.flow, cfg.nodeEnv);
  if (cfg.mailEngine.mode === 'stalwart' && !['127.0.0.1', 'localhost', '::1'].includes(cfg.mailEngine.host)) throw new Error('Mail engine chat07 chỉ được phép loopback');
  if (cfg.nodeEnv === 'production') {
    // Bản giả/khoá mặc định chỉ dành cho local/test; production phải cấu hình tường minh.
    if (cfg.workspaceStorage.mode === 'fake') throw new Error('Không được chạy WORKSPACE_STORAGE_MODE=fake ở production');
    if (cfg.mailEngine.mode === 'fake') throw new Error('Không được chạy MAIL_ENGINE_MODE=fake ở production');
    // Cổng giả báo done mà không chạm Authentik/Nextcloud; lần đăng nhập OIDC sau sẽ lấy lại quyền từ IdP (audit 8/12).
    if (cfg.identityLifecycle.mode === 'fake') throw new Error('Không được chạy IDENTITY_LIFECYCLE_MODE=fake ở production');
    if (cfg.documentEditor.enabled && (cfg.documentEditor.jwtSecret === DEFAULT_EDITOR_SECRET || Buffer.byteLength(cfg.documentEditor.jwtSecret) < 32)) {
      throw new Error('DOCUMENT_EDITOR_JWT_SECRET phải đặt riêng, tối thiểu 32 byte ở production');
    }
  }
  return cfg;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
