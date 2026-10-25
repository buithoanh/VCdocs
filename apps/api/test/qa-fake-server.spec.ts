import { createTestApp, TestApp } from './support/app';

// QA trình duyệt hoàn toàn cô lập: Google, Drive và Email đều giả, MongoDB trong bộ nhớ.
// Chạy: RUN_QA_FAKE_SERVER=1 ALLOW_PARTIAL_COVERAGE=1 pnpm --filter @vcdocs/api run test --runInBand test/qa-fake-server.spec.ts
const enabled = process.env.RUN_QA_FAKE_SERVER === '1';
const describeQa = enabled ? describe : describe.skip;
const holdMs = Number(process.env.QA_HOLD_MS || 1_800_000);
const port = Number(process.env.QA_API_PORT || 14100);
const webOrigin = process.env.QA_WEB_ORIGIN || 'http://localhost:13100';

describeQa('QA fake server', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ port, publicApiOrigin: webOrigin, webOrigin });
    await testApp.app.listen(port, '127.0.0.1');
    console.log(`VCworkspace QA fake server ready at http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  it('giữ server thử cho QA trình duyệt', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, holdMs));
  }, holdMs + 30_000);
});
