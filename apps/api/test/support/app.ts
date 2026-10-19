import * as fs from 'fs';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { loadConfig, AppConfig } from '../../src/config/config';
import { Db } from '../../src/db/db.service';
import { GOOGLE } from '../../src/google/ports';
import { FakeGoogle } from '../../src/google/fake/fake-google';
import { JobsService } from '../../src/jobs/jobs.service';
import { DemoIds, seedDemo } from '../../src/seed/demo-seed';
import { getContract } from '../../src/contract/openapi';
import { randomToken } from '../../src/common/util';

const PREFIX = '/api/v1';
const hits = new Set<string>();
let dbCounter = 0;

/** Ghép đường dẫn thật với mẫu trong hợp đồng: /documents/abc/submit → /documents/{id}/submit */
export function matchOperation(method: string, urlPath: string): string | undefined {
  const ops = getContract()
    .operations()
    .filter((o) => o.method === method.toUpperCase());
  const candidates = ops
    .map((o) => {
      const re = new RegExp('^' + o.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, '[^/]+') + '$');
      return { o, re, params: (o.path.match(/\{/g) || []).length };
    })
    .filter((c) => c.re.test(urlPath))
    .sort((a, b) => a.params - b.params);
  return candidates[0]?.o.path;
}

const undeclared = new Set<string>();
function recordHit(key: string) {
  hits.add(key);
  const dir = process.env.TEST_COVERAGE_DIR;
  if (dir) fs.writeFileSync(path.join(dir, `${process.pid}-${(globalThis as any).__covId ??= randomToken(6)}.json`), JSON.stringify({ hits: [...hits], undeclared: [...undeclared] }));
}

/** Kiểm thân phản hồi khớp schema của hợp đồng cho đúng mã trạng thái */
export function expectContract(method: string, url: string, res: request.Response) {
  const p = url.split('?')[0].replace(PREFIX, '');
  const oas = matchOperation(method, p);
  if (!oas) throw new Error(`Không có ${method} ${p} trong hợp đồng`);
  const isJson = (res.headers['content-type'] || '').includes('application/json');
  const r = getContract().validateResponse(method, oas, res.status, isJson ? res.body : undefined);
  if (r.undeclared) undeclared.add(`${method.toUpperCase()} ${oas} → ${res.status}`);
  recordHit(`${method.toUpperCase()} ${oas}`);
  if (!r.ok) {
    throw new Error(`Phản hồi ${method} ${p} (${res.status}) lệch hợp đồng:\n${r.errors.join('\n')}\nThân: ${JSON.stringify(res.body).slice(0, 2000)}`);
  }
  if (res.headers['x-request-id'] === undefined) throw new Error('Thiếu header X-Request-Id');
  if (['POST', 'PATCH', 'DELETE'].includes(method.toUpperCase()) && res.status < 300 && !res.headers['x-audit-id']) {
    throw new Error(`Thiếu header X-Audit-Id ở ${method} ${p}`);
  }
}

export interface Client {
  email: string;
  csrf: string;
  agent: ReturnType<typeof request.agent>;
  get(url: string): Promise<request.Response>;
  post(url: string, body?: any, opts?: { idem?: string; noCsrf?: boolean; headers?: Record<string, string> }): Promise<request.Response>;
  patch(url: string, body?: any): Promise<request.Response>;
  upload(url: string, fields: Record<string, string>, file?: { name: string; type: string; content: Buffer }, opts?: { idem?: string }): Promise<request.Response>;
}

export interface TestApp {
  app: INestApplication;
  db: Db;
  fake: FakeGoogle;
  jobs: JobsService;
  ids: DemoIds;
  cfg: AppConfig;
  http: () => ReturnType<typeof request>;
  login(userKey: string): Promise<Client>;
  loginEmail(email: string): Promise<Client>;
  /** Chạy hết việc nền đang chờ */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const base = process.env.TEST_MONGO_URI!;
  const dbName = `t${process.pid}_${Date.now()}_${dbCounter++}`;
  const uri = base.replace(/\/?(\?|$)/, `/${dbName}$1`);
  const cfg = loadConfig(
    { NODE_ENV: 'test', GOOGLE_MODE: 'fake' } as any,
    { mongoUri: uri, jobsPollMs: 0, schedulerEnabled: false, seedDemo: false, vaultDir: ':memory:', cookieSecure: false, uploadTmpDir: path.join(require('os').tmpdir(), `vcdocs-up-${process.pid}`), ...overrides },
  );
  const app = await createApp(cfg, { logger: false });
  const db = app.get(Db);
  const fake = app.get(GOOGLE) as FakeGoogle;
  const ids = await seedDemo(db.m, fake);
  const server = app.getHttpServer();

  const loginEmail = async (email: string): Promise<Client> => {
    const agent = request.agent(server);
    const start = await agent.get(`${PREFIX}/auth/google`);
    expectContract('GET', `${PREFIX}/auth/google`, start);
    const loc = new URL(start.headers.location);
    const state = loc.searchParams.get('state')!;
    const nonce = loc.searchParams.get('nonce')!;
    const cbUrl = `${PREFIX}/auth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`fake|${email}|${nonce}`)}`;
    const cb = await agent.get(cbUrl);
    expectContract('GET', cbUrl, cb);
    if (cb.status !== 302) throw new Error(`Đăng nhập ${email} lỗi: ${cb.status} ${JSON.stringify(cb.body)}`);
    const me = await agent.get(`${PREFIX}/me`);
    expectContract('GET', `${PREFIX}/me`, me);
    const csrf = me.body.csrfToken;
    const wrap = async (method: string, url: string, r: Promise<request.Response>) => {
      const res = await r;
      expectContract(method, `${PREFIX}${url}`, res);
      return res;
    };
    const needsIdem = (method: string, url: string) => {
      const oas = matchOperation(method, url.split('?')[0]);
      return !!(oas && getContract().find(method, oas)?.hasIdempotency);
    };
    return {
      email,
      csrf,
      agent,
      get: (url) => wrap('GET', url, agent.get(`${PREFIX}${url}`).set('X-Request-Id', randomToken(6)).set('User-Agent', 'vcdocs-e2e')),
      post: (url, body, opts = {}) => {
        let r = agent.post(`${PREFIX}${url}`).set('X-Request-Id', randomToken(6)).set('User-Agent', 'vcdocs-e2e');
        if (!opts.noCsrf) r = r.set('X-CSRF-Token', csrf);
        if (opts.idem || needsIdem('POST', url)) r = r.set('Idempotency-Key', opts.idem ?? randomToken(12));
        for (const [k, v] of Object.entries(opts.headers ?? {})) r = r.set(k, v);
        return wrap('POST', url, body === undefined ? r : r.send(body));
      },
      patch: (url, body) => wrap('PATCH', url, agent.patch(`${PREFIX}${url}`).set('X-CSRF-Token', csrf).send(body)),
      upload: (url, fields, file, opts = {}) => {
        let r = agent.post(`${PREFIX}${url}`).set('X-CSRF-Token', csrf);
        if (opts.idem || needsIdem('POST', url)) r = r.set('Idempotency-Key', opts.idem ?? randomToken(12));
        for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
        if (file) r = r.attach('file', file.content, { filename: file.name, contentType: file.type });
        return wrap('POST', url, r);
      },
    };
  };

  return {
    app,
    db,
    fake,
    jobs: app.get(JobsService),
    ids,
    cfg,
    http: () => request(server),
    loginEmail,
    login: (key) => loginEmail(ids.emails[key] ?? key),
    drain: async () => {
      await app.get(JobsService).drain();
    },
    close: async () => {
      await db.conn.dropDatabase().catch(() => undefined);
      await app.close();
    },
  };
}

/** Gọi không đăng nhập (kiểm 401) có kiểm hợp đồng */
export async function anon(t: TestApp, method: 'get' | 'post' | 'patch', url: string) {
  const res = await (t.http() as any)[method](`${PREFIX}${url}`);
  expectContract(method.toUpperCase(), `${PREFIX}${url}`, res);
  return res;
}
