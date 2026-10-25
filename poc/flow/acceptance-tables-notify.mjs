// Chat14 flow (b): Tables row added → receiver NestJS → thông báo trong ứng dụng
// VCworkspace (không email). member-a thêm dòng vào bảng của successor-a (share
// trực tiếp read+create). Rule gửi cho 4 uid: successor-a, member-a (có quyền
// đọc bảng) và manager-b, outsider (không có quyền) → 2 bị từ chối ở điểm
// quyết định cuối. Kiểm hộp thông báo của từng người qua API VCworkspace.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { client, expectStatus, flowRoot, readEvidence, resetBruteforce, writeEvidence } from './lib.mjs';
import { stats, tablesApi, waitEvent } from './flow-helpers.mjs';
import { startReceiver, vcLogin } from './receiver-lib.mjs';
import { registerWebhooks } from './register-webhooks.mjs';

const N = Number(process.env.FLOW14_SAMPLES || 10);
await resetBruteforce();
const resources = await readEvidence('resources.json');
const { tableId, columnId } = resources.tables;
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const marker = `flow14-b-${Date.now()}`;
const fakeGoogleState = join(flowRoot, '.runtime', 'fake-google.json');
const outboxSize = async () => (existsSync(fakeGoogleState) ? JSON.parse(await readFile(fakeGoogleState, 'utf8')).outbox?.length ?? 0 : 0);

const receiver = await startReceiver();
try {
  const it = await vcLogin('it@vcprosperous.com');
  await registerWebhooks();
  const inbox = {};
  for (const [persona, email] of [['successor-a', 'tp.mkt'], ['member-a', 'nv.mkt'], ['manager-b', 'tp.kd'], ['outsider', 'nv.kd']]) inbox[persona] = await vcLogin(`${email}@vcprosperous.com`);
  const countFlow = async (api) => ((await api('/notifications?limit=200')).data?.items ?? []).filter((n) => n.type === 'flow.tables.row_added' && String(n.body).includes(marker));
  const outboxBefore = await outboxSize();
  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const value = `Sự cố ${i} ${marker}`;
    const t0 = Date.now();
    const row = expectStatus('member add row', await member.request('POST', `${tablesApi}/tables/${tableId}/rows`, { json: { data: { [columnId]: value } } }), [200]).data;
    const t1 = Date.now();
    const [ev] = await waitEvent(it, `tables:row:${tableId}:${row.id}`);
    samples.push({
      rowId: row.id,
      status: ev.status,
      outcome: ev.results[0]?.outcome,
      delivered: ev.results[0]?.delivered,
      denied: ev.results[0]?.denied?.map((d) => d.reason),
      addRowMs: t1 - t0,
      doneAfterActionStartMs: Date.parse(ev.finishedAt) - t0,
      receivedAfterActionStartMs: Date.parse(ev.receivedAt) - t0,
      processingMs: ev.processingMs,
    });
  }
  const notifications = {};
  for (const [persona, api] of Object.entries(inbox)) notifications[persona] = (await countFlow(api)).length;
  const sampleNote = (await countFlow(inbox['member-a']))[0];
  await resetBruteforce();
  const deny = {
    'manager-b': { addRow: (await otherTeam.request('POST', `${tablesApi}/tables/${tableId}/rows`, { json: { data: { [columnId]: `deny ${marker}` } } })).status, readRow: (await otherTeam.request('GET', `${tablesApi}/rows/${samples[0].rowId}`)).status },
    outsider: { addRow: (await outsider.request('POST', `${tablesApi}/tables/${tableId}/rows`, { json: { data: { [columnId]: `deny ${marker}` } } })).status, readRow: (await outsider.request('GET', `${tablesApi}/rows/${samples[0].rowId}`)).status },
  };
  const journalForDeniedRows = ((await it(`/flow/events?ruleId=table-notify&limit=200`)).data?.items ?? []).filter((e) => e.receivedAt > new Date(Date.now() - 60_000).toISOString()).length;
  const outboxAfter = await outboxSize();
  const result = {
    marker,
    samples,
    latency: {
      doneAfterActionStartMs: stats(samples.map((x) => x.doneAfterActionStartMs)),
      receivedAfterActionStartMs: stats(samples.map((x) => x.receivedAfterActionStartMs)),
      processingMs: stats(samples.map((x) => x.processingMs)),
    },
    notifications,
    notificationShape: sampleNote ? { type: sampleNote.type, title: sampleNote.title, hasBody: Boolean(sampleNote.body), link: sampleNote.link } : null,
    deny,
    recentJournalRows: journalForDeniedRows,
    email: { fakeOutboxBefore: outboxBefore, fakeOutboxAfter: outboxAfter, sent: outboxAfter - outboxBefore },
  };
  const pass = samples.every((x) => x.outcome === 'notified' && x.delivered === 2 && JSON.stringify(x.denied) === JSON.stringify(['no_table_read', 'no_table_read']))
    && notifications['successor-a'] === N && notifications['member-a'] === N && notifications['manager-b'] === 0 && notifications.outsider === 0
    && Object.values(deny).every((d) => d.addRow >= 400 && d.readRow >= 400)
    && result.email.sent === 0;
  await writeEvidence('acceptance-tables-notify.json', { ...result, result: pass ? 'LOCAL PASS' : 'FAIL' });
  console.log(JSON.stringify({ latency: result.latency, notifications, deny, email: result.email, pass }, null, 1));
  if (!pass) throw new Error('TABLES_NOTIFY_ACCEPTANCE_FAILED');
} finally {
  await receiver.stop();
}
