// Chat14: độ trễ giao webhook khi KHÔNG có worker riêng (chỉ cron) so với worker.
// Dừng container webhook-worker của chat14, nộp form: job WebhookCall nằm chờ
// trong hàng đợi (không có gì giao) cho tới khi cron.php chạy. Docker image
// Nextcloud không tự chạy cron: production thường đặt cron 5 phút → trễ tới ~300 s.
// Sau đó bật lại worker. Không đổi cấu hình Nextcloud.
import { client, execFileAsync, expectStatus, ncContainer, ocsData, readEvidence, resetBruteforce, sleep, writeEvidence } from './lib.mjs';
import { formsApi, waitEvent } from './flow-helpers.mjs';
import { startReceiver, vcLogin } from './receiver-lib.mjs';
import { registerWebhooks } from './register-webhooks.mjs';

await resetBruteforce();
const resources = await readEvidence('resources.json');
const { formId, titleQuestionId } = resources.forms;
const owner = await client('successor-a');
const member = await client('member-a');
const worker = 'vcworkspace-flow14-webhook-worker-1';
const marker = `flow14-cron-${Date.now()}`;
const receiver = await startReceiver();
const out = { marker };
try {
  const it = await vcLogin('it@vcprosperous.com');
  await registerWebhooks();
  await execFileAsync('docker', ['stop', worker]);
  const title = `Flow14 CRON ${marker}`;
  const t0 = Date.now();
  expectStatus('submit', await member.request('POST', `${formsApi}/forms/${formId}/submissions`, { json: { answers: { [titleQuestionId]: [title] } } }), [200, 201]);
  const sid = ocsData(await owner.request('GET', `${formsApi}/forms/${formId}/submissions`)).submissions.find((s) => s.answers.some((a) => a.text === title)).id;
  const key = `forms:submission:${formId}:${sid}`;
  await sleep(10_000);
  const before = (await it(`/flow/events?resourceKey=${encodeURIComponent(key)}`)).data.total;
  const queued = (await execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-ansi', 'background-job:list', '--class=OCA\\WebhookListeners\\BackgroundJobs\\WebhookCall', '--output=json'])).stdout;
  const tCron = Date.now();
  await execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', '-f', '/var/www/html/cron.php']);
  const tCronDone = Date.now();
  const [ev] = await waitEvent(it, key, { timeoutMs: 30_000 });
  Object.assign(out, {
    workerStopped: true,
    journalRowsAfter10sWithoutWorker: before,
    queuedWebhookJobs: JSON.parse(queued).length,
    cronRunMs: tCronDone - tCron,
    deliveredAfterCronMs: Date.parse(ev.receivedAt) - tCron,
    totalFromSubmitMs: Date.parse(ev.finishedAt) - t0,
    status: ev.status,
    outcome: ev.results[0]?.outcome,
    note: 'Không có worker: thời gian chờ = khoảng tới lượt cron kế tiếp (cron 5 phút → 0–300 s). Có worker (interval 1 s): xem acceptance-forms-deck.json.',
  });
} finally {
  await execFileAsync('docker', ['start', worker]).catch(() => undefined);
  await receiver.stop();
}
const pass = out.journalRowsAfter10sWithoutWorker === 0 && out.status === 'done';
await writeEvidence('latency-cron-vs-worker.json', { ...out, result: pass ? 'LOCAL PASS' : 'FAIL' });
console.log(JSON.stringify(out, null, 1));
if (!pass) throw new Error('CRON_VS_WORKER_FAILED');
