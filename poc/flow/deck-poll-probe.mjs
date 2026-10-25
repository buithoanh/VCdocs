// Chat14: Deck làm nguồn event? Deck 1.17.8 không có event tương thích webhook
// (chat13: đăng ký CardCreatedEvent bị từ chối) → thử hai cách polling bằng
// quyền chủ board (successor-a), poller chạy theo nhịp riêng 1 s, member-a
// tạo/sửa thẻ ở thời điểm ngẫu nhiên:
//   A. GET /boards/{id}/stacks với If-Modified-Since (Deck trả thẻ đổi từ mốc, độ
//      phân giải giây → cửa sổ chồng 2 s, khử trùng theo (cardId, lastModified))
//   B. Activity API /activity/api/v2/activity/deck?since=<activityId>
// Đo độ trễ phát hiện, số request/byte; xác nhận lại webhook Deck bị từ chối.
import { adminRequest, client, expectStatus, ocsData, readWork13Evidence, resetBruteforce, sleep, writeEvidence } from './lib.mjs';
import { deckApi, stats } from './flow-helpers.mjs';

await resetBruteforce();
const deck = await readWork13Evidence('acceptance-deck.json');
const { boardId, stackId } = deck.resources;
const owner = await client('successor-a');
const member = await client('member-a');
const admin = await adminRequest();
const marker = `flow14-deck-${Date.now()}`;
const N = Number(process.env.FLOW14_SAMPLES || 5);
const intervalMs = 1000;

const webhookTry = await admin('POST', '/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks?format=json', {
  httpMethod: 'POST', uri: 'http://hook-sink:8080/deck', event: 'OCA\\Deck\\Event\\CardCreatedEvent', authMethod: 'none',
});
if (webhookTry.status === 200) await admin('DELETE', `/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks/${ocsData(webhookTry).id}?format=json`);

const counters = { stacks: { requests: 0, bytes: 0, deltaItems: 0, uniqueChanges: 0 }, activity: { requests: 0, bytes: 0 } };
const httpDate = (ms) => new Date(Math.floor(ms / 1000) * 1000).toUTCString();
const seenChange = new Set();
const firstSeen = { create: new Map(), edit: new Map(), activity: new Map() };
let running = true;
let stacksSince = Date.now() - 2000;
let activityCursor = 0;
{
  const r = await owner.request('GET', '/ocs/v2.php/apps/activity/api/v2/activity/deck?format=json&limit=1&sort=desc');
  activityCursor = (ocsData(r) ?? [])[0]?.activity_id ?? 0;
}
const poller = (async () => {
  while (running) {
    const tick = Date.now();
    const a = await owner.request('GET', `${deckApi}/boards/${boardId}/stacks`, { headers: { 'If-Modified-Since': httpDate(stacksSince) }, raw: true });
    counters.stacks.requests += 1;
    counters.stacks.bytes += a.bytes.length;
    const seenAt = Date.now();
    for (const card of JSON.parse(a.bytes.toString('utf8')).flatMap((stack) => stack.cards ?? [])) {
      counters.stacks.deltaItems += 1;
      const key = `${card.id}:${card.lastModified}`;
      if (seenChange.has(key)) continue;
      seenChange.add(key);
      counters.stacks.uniqueChanges += 1;
      if (!firstSeen.create.has(card.id)) firstSeen.create.set(card.id, seenAt);
      if (String(card.title).endsWith('(sửa)') && !firstSeen.edit.has(card.id)) firstSeen.edit.set(card.id, seenAt);
    }
    stacksSince = tick - 2000;
    const b = await owner.request('GET', `/ocs/v2.php/apps/activity/api/v2/activity/deck?format=json&since=${activityCursor}&limit=50&sort=asc`, { raw: true });
    counters.activity.requests += 1;
    counters.activity.bytes += b.bytes.length;
    if (b.status === 200) {
      const items = JSON.parse(b.bytes.toString('utf8'))?.ocs?.data ?? [];
      for (const item of items) {
        activityCursor = Math.max(activityCursor, item.activity_id);
        if (item.object_type === 'deck_card' && !firstSeen.activity.has(Number(item.object_id))) firstSeen.activity.set(Number(item.object_id), { at: Date.now(), type: item.type, byMember: item.user === member.uid });
      }
    }
    await sleep(Math.max(0, intervalMs - (Date.now() - tick)));
  }
})();

const actions = [];
for (let i = 0; i < N; i += 1) {
  await sleep(300 + Math.floor(Math.random() * 1500));
  const t0 = Date.now();
  const card = expectStatus('member create card', await member.request('POST', `${deckApi}/boards/${boardId}/stacks/${stackId}/cards`, { json: { title: `Deck ${marker} #${i}`, type: 'plain', order: 99 } }), [200]).data;
  await sleep(1200 + Math.floor(Math.random() * 1000));
  const t1 = Date.now();
  expectStatus('member edit card', await member.request('PUT', `${deckApi}/boards/${boardId}/stacks/${stackId}/cards/${card.id}`, { json: { title: `Deck ${marker} #${i} (sửa)`, type: 'plain', order: 99, owner: member.uid, description: 'sửa' } }), [200]);
  actions.push({ cardId: card.id, createdAt: t0, editedAt: t1 });
}
await sleep(3500);
running = false;
await poller;

const results = actions.map((a) => ({
  cardId: a.cardId,
  detectCreateViaStacksMs: firstSeen.create.has(a.cardId) ? firstSeen.create.get(a.cardId) - a.createdAt : null,
  detectEditViaStacksMs: firstSeen.edit.has(a.cardId) ? firstSeen.edit.get(a.cardId) - a.editedAt : null,
  detectCreateViaActivityMs: firstSeen.activity.has(a.cardId) ? firstSeen.activity.get(a.cardId).at - a.createdAt : null,
  activityType: firstSeen.activity.get(a.cardId)?.type ?? null,
  activityByMember: firstSeen.activity.get(a.cardId)?.byMember ?? null,
}));
await resetBruteforce();
const outsider = await client('outsider');
const outsiderPoll = (await outsider.request('GET', `${deckApi}/boards/${boardId}/stacks`, { headers: { 'If-Modified-Since': httpDate(Date.now() - 60_000) } })).status;
const outsiderActivity = JSON.stringify(ocsData(await outsider.request('GET', '/ocs/v2.php/apps/activity/api/v2/activity/deck?format=json&limit=50')) ?? []).includes(marker);
const out = {
  marker,
  boardId,
  webhookRegistration: { status: webhookTry.status, message: webhookTry.data?.ocs?.meta?.message ?? null },
  pollIntervalMs: intervalMs,
  results,
  latency: {
    createViaStacksMs: stats(results.map((r) => r.detectCreateViaStacksMs)),
    editViaStacksMs: stats(results.map((r) => r.detectEditViaStacksMs)),
    createViaActivityMs: stats(results.map((r) => r.detectCreateViaActivityMs)),
  },
  cost: counters,
  deny: { outsiderPollStatus: outsiderPoll, outsiderActivitySeesMarker: outsiderActivity },
  conclusion: 'Deck không phát event webhook; polling bằng quyền chủ board phát hiện được tạo/sửa thẻ với độ trễ ≈ nhịp poll, đổi lại request liên tục (cả khi không có thay đổi). Đề xuất chat14: Deck chỉ làm ĐÍCH; nếu cần nguồn thì poller If-Modified-Since + checkpoint + khử trùng (cardId, lastModified), không viết app Nextcloud riêng.',
};
await writeEvidence('deck-polling-probe.json', out);
console.log(JSON.stringify({ webhook: out.webhookRegistration, latency: out.latency, cost: counters, deny: out.deny, results }, null, 1));
