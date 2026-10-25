import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/config';
import { Db } from '../src/db/db.service';
import { FakeGoogle } from '../src/google/fake/fake-google';
import { GOOGLE } from '../src/google/ports';
import { FlowService } from '../src/modules/flow/flow.service';
import { NextcloudFlowClient } from '../src/modules/flow/nextcloud-flow.client';
import { seedDemo } from '../src/seed/demo-seed';

// Chat14 PoC: chạy receiver Flow thật (Google giả, MongoDB local riêng) cho stack
// Nextcloud work13 trên loopback. Không đọc .env; mọi giá trị thử lấy từ biến môi
// trường do poc/flow/acceptance-flows.mjs truyền vào. Chạy:
// RUN_FLOW14_RECEIVER=1 ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/flow-nextcloud-server.spec.ts
const enabled = process.env.RUN_FLOW14_RECEIVER === '1';
const hold = Number(process.env.FLOW14_HOLD_MS || 1_800_000);

(enabled ? describe : describe.skip)('Chat14 Flow receiver trên Nextcloud local', () => {
  let app: INestApplication;

  beforeAll(async () => {
    for (const name of ['FLOW14_MONGO_URI', 'FLOW14_WEBHOOK_SECRETS', 'FLOW14_NC_BASE', 'FLOW14_RUNNER_UID', 'FLOW14_RUNNER_PASSWORD', 'FLOW14_RULES_JSON', 'FLOW14_USER_BINDINGS_JSON']) {
      if (!process.env[name]) throw new Error(`Thiếu biến thử ${name}`);
    }
    const mongoUri = process.env.FLOW14_MONGO_URI!;
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+$/.test(mongoUri)) throw new Error('FLOW14_MONGO_URI chỉ được là MongoDB loopback');
    const port = Number(process.env.FLOW14_PORT || 18140);
    const cfg = loadConfig({ NODE_ENV: 'test', GOOGLE_MODE: 'fake' } as any, {
      mongoUri,
      port,
      jobsPollMs: 0,
      schedulerEnabled: false,
      seedDemo: false,
      vaultDir: ':memory:',
      cookieSecure: false,
      publicApiOrigin: `http://127.0.0.1:${port}`,
      webOrigin: 'http://127.0.0.1:13140',
      flow: {
        enabled: true,
        companyId: '000000000000000000000000',
        webhookSecrets: process.env.FLOW14_WEBHOOK_SECRETS!.split(','),
        nextcloud: {
          baseUrl: process.env.FLOW14_NC_BASE,
          timeoutMs: 10_000,
          credentials: { runner: { username: process.env.FLOW14_RUNNER_UID!, password: process.env.FLOW14_RUNNER_PASSWORD! } },
          userBindings: JSON.parse(process.env.FLOW14_USER_BINDINGS_JSON!),
        },
        rules: JSON.parse(process.env.FLOW14_RULES_JSON!),
        workerPollMs: Number(process.env.FLOW14_WORKER_POLL_MS || 200),
        leaseMs: Number(process.env.FLOW14_LEASE_MS || 5_000),
        maxAttempts: 5,
        retryBaseMs: Number(process.env.FLOW14_RETRY_BASE_MS || 1_000),
        reconcileMs: Number(process.env.FLOW14_RECONCILE_MS || 0),
      },
    });
    // Google giả lưu trạng thái ra file cạnh CSDL thử để restart vẫn đăng nhập được
    if (process.env.FLOW14_FAKE_GOOGLE_STATE) cfg.google.fakeStateFile = process.env.FLOW14_FAKE_GOOGLE_STATE;
    app = await createApp(cfg, { logger: process.env.FLOW14_LOGGER === '1' });
    const db = app.get(Db);
    let company = await db.m.Company.findOne({}).lean<any>();
    if (!company) {
      await seedDemo(db.m, app.get(GOOGLE) as FakeGoogle);
      company = await db.m.Company.findOne({}).lean<any>();
    }
    cfg.flow.companyId = String(company._id);
    if (process.env.FLOW14_CRASH_AFTER_CARD === '1') {
      // Giả tiến trình chết ngay sau khi Deck đã tạo thẻ, trước khi ghi effect/journal
      const original = NextcloudFlowClient.prototype.createCard;
      jest.spyOn(NextcloudFlowClient.prototype, 'createCard').mockImplementationOnce(async function (this: NextcloudFlowClient, ...args: Parameters<NextcloudFlowClient['createCard']>) {
        const card = await original.apply(this, args);
        console.log(`FLOW14_CRASHING_AFTER_CARD card=${card?.id}`);
        process.kill(process.pid, 'SIGKILL');
        return card;
      });
    }
    await app.listen(port, '127.0.0.1');
    app.get(FlowService).kick();
    console.log(`FLOW14_RECEIVER_READY port=${port} company=${cfg.flow.companyId} secrets=${cfg.flow.webhookSecrets.length}`);
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('giữ receiver chạy cho nghiệm thu', async () => {
    await new Promise((resolve) => setTimeout(resolve, hold));
  }, hold + 30_000);
});
