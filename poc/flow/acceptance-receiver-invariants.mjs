// Chat14: bất biến của receiver trên stack thật.
//  1. Xác thực/allowlist trực tiếp: thiếu/sai header → 401, lớp Deck → 422, không ghi journal.
//  2. Replay đúng body Nextcloud đã gửi (bản sao qua sink nội bộ) → duplicate, không thêm thẻ.
//  3. Xoay vòng bí mật: receiver nhận cả bản cũ và mới; Nextcloud đổi sang bản mới;
//     gỡ bản cũ → bản cũ 401.
//  4. Restart giữa chừng: receiver tự SIGKILL ngay sau khi Deck tạo thẻ (trước khi ghi
//     effect); khởi động lại → lease hết hạn, readback thấy marker → card_recovered, 1 thẻ.
//  5. Receiver tắt: webhook_listeners không gửi lại (log "call failed"); bật lại với đối soát
//     → bù đúng một thẻ và một lượt thông báo.
import { client, execFileAsync, expectStatus, ncContainer, ocsData, readEvidence, resetBruteforce, sleep, writeEvidence } from './lib.mjs';
import { deckApi, formsApi, tablesApi, waitEvent, waitFor } from './flow-helpers.mjs';
import { dropPreviousSecret, postWebhook, rotateSecret, startReceiver, vcLogin, webhookSecrets } from './receiver-lib.mjs';
import { registerWebhooks } from './register-webhooks.mjs';

await resetBruteforce();
const resources = await readEvidence('resources.json');
const { formId, titleQuestionId, detailQuestionId } = resources.forms;
const { boardId, nestStackId } = resources.deck;
const owner = await client('successor-a');
const member = await client('member-a');
const marker = `flow14-inv-${Date.now()}`;
const out = {};

const submit = async (label) => {
  const title = `Flow14 ${label} ${marker}`;
  expectStatus(`submit ${label}`, await member.request('POST', `${formsApi}/forms/${formId}/submissions`, { json: { answers: { [titleQuestionId]: [title], [detailQuestionId]: [label] } } }), [200, 201]);
  const list = ocsData(await owner.request('GET', `${formsApi}/forms/${formId}/submissions`));
  return list.submissions.find((s) => s.answers.some((a) => a.text === title)).id;
};
const nestCards = async (sid) => ((await owner.request('GET', `${deckApi}/boards/${boardId}/stacks/${nestStackId}`)).data?.cards ?? [])
  .filter((card) => String(card.description).split('\n').includes(`vcw-flow:form-deck:${formId}:${sid}`));
const sinkLog = async () => (await execFileAsync('docker', ['exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log']).catch(() => ({ stdout: '' }))).stdout;
const ncLogSince = async (since) => {
  const { stdout } = await execFileAsync('docker', ['exec', ncContainer, 'tail', '-n', '400', '/var/www/html/data/nextcloud.log'], { maxBuffer: 20 * 1024 * 1024 });
  return stdout.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((entry) => entry && Date.parse(entry.time) >= since);
};

let receiver = await startReceiver();
try {
  let it = await vcLogin('it@vcprosperous.com');
  let { current } = await webhookSecrets();

  // 1. Xác thực + allowlist trực tiếp
  const before = (await it('/flow/events?limit=1')).data.total;
  const forged = { event: { class: 'OCA\\Forms\\Events\\FormSubmittedEvent', form: { id: formId }, submission: { id: 999999, formId } }, user: { uid: member.uid }, time: Math.floor(Date.now() / 1000) };
  out.auth = {
    noToken: (await postWebhook(forged)).status,
    wrongToken: (await postWebhook(forged, 'f'.repeat(64))).status,
    deckEventWithToken: (await postWebhook({ event: { class: 'OCA\\Deck\\Event\\CardCreatedEvent', card: { id: 1 } }, time: Math.floor(Date.now() / 1000) }, current)).status,
    journalUnchanged: (await it('/flow/events?limit=1')).data.total === before,
  };

  // 2. Replay đúng body đã giao (bản sao FormSubmitted qua sink nội bộ)
  await registerWebhooks({ mirrorForms: true });
  const offset = (await sinkLog()).length;
  const sidReplay = await submit('REPLAY');
  const [first] = await waitEvent(it, `forms:submission:${formId}:${sidReplay}`);
  const raw = await waitFor('mirror body', async () => (await sinkLog()).slice(offset).split('--END--').map((x) => x.trim()).find((x) => x.includes(`"id":${sidReplay},`)));
  const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  const replay = await postWebhook(body, current);
  const replay2 = await postWebhook(body, current);
  await sleep(1500);
  out.replay = {
    firstJournalId: first.id,
    replayStatus: replay.status,
    replayBody: replay.data,
    secondReplayDuplicate: replay2.data?.duplicate,
    cards: (await nestCards(sidReplay)).length,
    replayCount: (await it(`/flow/events/${first.id}`)).data.replayCount,
  };
  await registerWebhooks();

  // 3. Xoay vòng bí mật
  const rotated = await rotateSecret();
  await receiver.stop();
  receiver = await startReceiver();
  it = await vcLogin('it@vcprosperous.com');
  const sidOldSecret = await submit('ROTATE-OLD'); // Nextcloud vẫn gửi bí mật cũ
  const [oldEv] = await waitEvent(it, `forms:submission:${formId}:${sidOldSecret}`);
  await registerWebhooks(); // Nextcloud chuyển sang bí mật mới
  const sidNewSecret = await submit('ROTATE-NEW');
  const [newEv] = await waitEvent(it, `forms:submission:${formId}:${sidNewSecret}`);
  await dropPreviousSecret();
  await receiver.stop();
  receiver = await startReceiver();
  it = await vcLogin('it@vcprosperous.com');
  current = (await webhookSecrets()).current;
  const sidAfterDrop = await submit('ROTATE-AFTER');
  const [afterEv] = await waitEvent(it, `forms:submission:${formId}:${sidAfterDrop}`);
  out.rotation = {
    acceptedWithOldSecretDuringRotation: oldEv.status === 'done',
    acceptedWithNewSecret: newEv.status === 'done',
    oldSecretAfterDrop: (await postWebhook(forged, rotated.previous)).status,
    newSecretAfterDrop: afterEv.status === 'done',
  };

  // 4. Restart giữa chừng (SIGKILL sau khi Deck tạo thẻ)
  await receiver.stop();
  receiver = await startReceiver({ FLOW14_CRASH_AFTER_CARD: '1', FLOW14_LEASE_MS: '3000' });
  const crashed = receiver;
  const sidCrash = await submit('CRASH');
  const exit = await Promise.race([crashed.exited, sleep(30_000).then(() => null)]);
  const cardsAfterCrash = (await nestCards(sidCrash)).length;
  receiver = await startReceiver({ FLOW14_LEASE_MS: '3000' });
  it = await vcLogin('it@vcprosperous.com');
  const [crashEv] = await waitEvent(it, `forms:submission:${formId}:${sidCrash}`, { timeoutMs: 60_000 });
  out.restart = {
    crashExit: exit,
    crashLogged: crashed.logs.some((line) => line.includes('FLOW14_CRASHING_AFTER_CARD')),
    cardsRightAfterCrash: cardsAfterCrash,
    statusAfterRestart: crashEv.status,
    outcome: crashEv.results[0]?.outcome,
    attempts: crashEv.attempts,
    cardsAfterRestart: (await nestCards(sidCrash)).length,
  };

  // 5. Receiver tắt: event mất, đối soát bù
  await receiver.stop();
  const downSince = Date.now();
  const sidDown = await submit('DOWN');
  const row = expectStatus('row while down', await member.request('POST', `${tablesApi}/tables/${resources.tables.tableId}/rows`, { json: { data: { [resources.tables.columnId]: `Receiver tắt ${marker}` } } }), [200]).data;
  await sleep(5000);
  const failures = (await ncLogSince(downSince - 2000)).filter((entry) => String(entry.message).includes('call failed'));
  receiver = await startReceiver({ FLOW14_RECONCILE_MS: '1000' });
  it = await vcLogin('it@vcprosperous.com');
  const [downEv] = await waitEvent(it, `forms:submission:${formId}:${sidDown}`, { timeoutMs: 60_000 });
  const [rowEv] = await waitEvent(it, `tables:row:${resources.tables.tableId}:${row.id}`, { timeoutMs: 60_000 });
  await sleep(2500); // thêm vài nhịp đối soát: không được tạo thêm
  out.missedDelivery = {
    nextcloudLoggedCallFailed: failures.length,
    nextcloudFailureSample: failures[0] ? String(failures[0].message).slice(0, 160) : null,
    formSource: downEv.source,
    formOutcome: downEv.results[0]?.outcome,
    rowSource: rowEv.source,
    rowOutcome: rowEv.results[0]?.outcome,
    cards: (await nestCards(sidDown)).length,
    journalRowsForSubmission: (await it(`/flow/events?resourceKey=${encodeURIComponent(`forms:submission:${formId}:${sidDown}`)}`)).data.total,
  };
  const audit = (await it(`/flow/events/${downEv.id}`)).data;
  out.auditCorrelation = { correlationId: audit.correlationId };

  const pass = out.auth.noToken === 401 && out.auth.wrongToken === 401 && out.auth.deckEventWithToken === 422 && out.auth.journalUnchanged
    && out.replay.replayStatus === 202 && out.replay.replayBody?.duplicate === true && out.replay.replayBody?.journalId === first.id && out.replay.secondReplayDuplicate === true && out.replay.cards === 1 && out.replay.replayCount === 2
    && out.rotation.acceptedWithOldSecretDuringRotation && out.rotation.acceptedWithNewSecret && out.rotation.oldSecretAfterDrop === 401 && out.rotation.newSecretAfterDrop
    && out.restart.crashExit?.signal === 'SIGKILL' && out.restart.cardsRightAfterCrash === 1 && out.restart.statusAfterRestart === 'done' && out.restart.outcome === 'card_recovered' && out.restart.cardsAfterRestart === 1
    && out.missedDelivery.nextcloudLoggedCallFailed >= 2 && out.missedDelivery.formSource === 'reconcile' && out.missedDelivery.formOutcome === 'card_created' && out.missedDelivery.rowOutcome === 'notified' && out.missedDelivery.cards === 1 && out.missedDelivery.journalRowsForSubmission === 1;
  await writeEvidence('acceptance-receiver-invariants.json', { marker, ...out, result: pass ? 'LOCAL PASS' : 'FAIL' });
  console.log(JSON.stringify({ ...out, pass }, null, 1));
  if (!pass) throw new Error('RECEIVER_INVARIANTS_FAILED');
} finally {
  await registerWebhooks().catch(() => undefined);
  await receiver.stop();
}
