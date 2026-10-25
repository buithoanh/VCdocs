// Chat14 flow (a): Form → thẻ Deck, so sánh forms_deck 0.7.0 với receiver NestJS.
// member-a nộp form (submit share Team A) → Nextcloud webhook_listeners →
// worker riêng → relay → receiver → đọc câu trả lời qua Forms API bằng app
// password của successor-a (chủ form/board) → tạo thẻ ở cột "NestJS receiver".
// Đồng thời forms_deck tạo thẻ ở cột "forms_deck" trong cùng request nộp.
// Đo độ trễ, kiểm ACL người xem thẻ, deny Team B/outsider, so sánh khi board
// bị chia sẻ rộng hơn quyền xem kết quả form.
import { client, expectStatus, ocsData, readEvidence, readWork13Evidence, resetBruteforce, sleep, writeEvidence } from './lib.mjs';
import { deckApi, formsApi, stats, waitEvent } from './flow-helpers.mjs';
import { startReceiver, vcLogin } from './receiver-lib.mjs';
import { registerWebhooks } from './register-webhooks.mjs';

const N = Number(process.env.FLOW14_SAMPLES || 10);
await resetBruteforce();
const resources = await readEvidence('resources.json');
const { federatedGroups } = await readWork13Evidence('nextcloud-config.json');
const { formId, titleQuestionId, detailQuestionId } = resources.forms;
const { boardId, formsDeckStackId, nestStackId } = resources.deck;
const owner = await client('successor-a');
const member = await client('member-a');
const otherTeam = await client('manager-b');
const outsider = await client('outsider');
const marker = `flow14-a-${Date.now()}`;

const setMapping = async (enabled) => expectStatus(`forms_deck mapping enabled=${enabled}`, await owner.request('PUT', `/index.php/apps/forms_deck/mappings/${resources.formsDeckMapping.id}`, {
  json: { formId, boardId, stackId: formsDeckStackId, titleParts: [`q:${titleQuestionId}`], titleSeparator: ' - ', enabled, attachFiles: false },
}), [200]);
const findSubmission = async (text) => {
  const list = ocsData(await owner.request('GET', `${formsApi}/forms/${formId}/submissions`));
  return list.submissions.find((s) => s.answers.some((a) => a.text === text));
};
const stackCards = async (stackId) => (await owner.request('GET', `${deckApi}/boards/${boardId}/stacks/${stackId}`)).data?.cards ?? [];

const receiver = await startReceiver();
let it;
const samples = [];
const comparison = { mappingEnabledSubmitMs: [], mappingDisabledSubmitMs: [] };
let acl;
let shared;
try {
  it = await vcLogin('it@vcprosperous.com');
  await registerWebhooks();
  await setMapping(true);
  async function submitOne(label, actor = member) {
    const title = `Flow14 ${label} ${marker}`;
    const t0 = Date.now();
    const response = await actor.request('POST', `${formsApi}/forms/${formId}/submissions`, { json: { answers: { [titleQuestionId]: [title], [detailQuestionId]: [`Chi tiết ${label}`] } } });
    const t1 = Date.now();
    return { title, t0, t1, status: response.status };
  }
  for (let i = 0; i < N; i += 1) {
    const s = await submitOne(`A${i}`);
    expectStatus('member submit', { status: s.status, data: null }, [200, 201]);
    const sub = await findSubmission(s.title);
    const formsDeckCardAtResponse = (await stackCards(formsDeckStackId)).find((card) => String(card.description).includes(`NC-Form-${formId}-${sub.id}`));
    const [ev] = await waitEvent(it, `forms:submission:${formId}:${sub.id}`);
    const nestCard = (await owner.request('GET', `${deckApi}/boards/${boardId}/stacks/${nestStackId}/cards/${ev.results[0]?.cardId}`)).data;
    samples.push({
      submissionId: sub.id,
      submitMs: s.t1 - s.t0,
      formsDeckCardPresentRightAfterSubmit: Boolean(formsDeckCardAtResponse),
      receiverStatus: ev.status,
      outcome: ev.results[0]?.outcome,
      nestCardId: nestCard?.id,
      nestCardTitleMatches: nestCard?.title === s.title,
      nestCardHasAnswers: String(nestCard?.description).includes(`Chi tiết A${i}`),
      nestCardMarker: String(nestCard?.description).split('\n').includes(`vcw-flow:form-deck:${formId}:${sub.id}`),
      receivedAfterSubmitStartMs: Date.parse(ev.receivedAt) - s.t0,
      doneAfterSubmitStartMs: Date.parse(ev.finishedAt) - s.t0,
      doneAfterSubmitResponseMs: Date.parse(ev.finishedAt) - s.t1,
      processingMs: ev.processingMs,
    });
    comparison.mappingEnabledSubmitMs.push(s.t1 - s.t0);
  }
  // Chi phí của forms_deck trong request nộp: tắt mapping, đo lại thời gian nộp
  await setMapping(false);
  for (let i = 0; i < Math.max(3, Math.floor(N / 2)); i += 1) {
    const s = await submitOne(`B${i}`);
    comparison.mappingDisabledSubmitMs.push(s.t1 - s.t0);
    const sub = await findSubmission(s.title);
    await waitEvent(it, `forms:submission:${formId}:${sub.id}`);
    if ((await stackCards(formsDeckStackId)).some((card) => String(card.description).includes(`NC-Form-${formId}-${sub.id}`))) throw new Error('FORMS_DECK_STILL_ACTIVE');
  }
  await setMapping(true);

  // ACL người xem thẻ: board không có ACL → chỉ chủ board đọc được câu trả lời
  const lastSample = samples[samples.length - 1];
  const fdCard = (await stackCards(formsDeckStackId)).find((card) => String(card.description).includes(`NC-Form-${formId}-${lastSample.submissionId}`));
  await resetBruteforce();
  const access = {};
  for (const actor of [owner, member, otherTeam, outsider]) {
    access[actor.username] = {
      board: (await actor.request('GET', `${deckApi}/boards/${boardId}`)).status,
      nestCard: (await actor.request('GET', `${deckApi}/boards/${boardId}/stacks/${nestStackId}/cards/${lastSample.nestCardId}`)).status,
      formsDeckCard: (await actor.request('GET', `${deckApi}/boards/${boardId}/stacks/${formsDeckStackId}/cards/${fdCard?.id}`)).status,
      listBoardsContains: JSON.stringify((await actor.request('GET', `${deckApi}/boards`)).data ?? []).includes(`"id":${boardId},`),
    };
  }
  const memberOwn = ocsData(await member.request('GET', `${formsApi}/forms/${formId}/submissions`));
  const memberSeesOnlyOwn = memberOwn.submissions.every((s) => s.userId === member.uid);
  const outsiderSubmit = (await outsider.request('POST', `${formsApi}/forms/${formId}/submissions`, { json: { answers: { [titleQuestionId]: [`outsider ${marker}`] } } })).status;
  const otherSubmit = (await otherTeam.request('POST', `${formsApi}/forms/${formId}/submissions`, { json: { answers: { [titleQuestionId]: [`teamB ${marker}`] } } })).status;

  // Board bị chia sẻ (xem) cho Team A: forms_deck vẫn chép câu trả lời, receiver từ chối
  acl = expectStatus('share board view-only to Team A', await owner.request('POST', `${deckApi}/boards/${boardId}/acl`, {
    json: { type: 1, participant: federatedGroups['vcw-team-a'], permissionEdit: false, permissionShare: false, permissionManage: false },
  }), [200]).data;
  // successor-a nộp, member-a đọc: lộ câu trả lời của người khác nếu board rộng hơn quyền xem kết quả
  const s = await submitOne('SHARED', owner);
  const sub = await findSubmission(s.title);
  const [ev] = await waitEvent(it, `forms:submission:${formId}:${sub.id}`);
  const fdShared = (await stackCards(formsDeckStackId)).find((card) => String(card.description).includes(`NC-Form-${formId}-${sub.id}`));
  const memberReadsFdShared = await member.request('GET', `${deckApi}/boards/${boardId}/stacks/${formsDeckStackId}/cards/${fdShared?.id}`);
  shared = {
    boardAcl: 'vcw-team-a view-only',
    receiverOutcome: ev.results[0]?.outcome,
    receiverCreatedCard: (await stackCards(nestStackId)).some((card) => String(card.description).includes(`:${formId}:${sub.id}`)),
    formsDeckCreatedCard: Boolean(fdShared),
    memberReadsFormsDeckCard: memberReadsFdShared.status,
    memberSeesOtherAnswerViaDeck: memberReadsFdShared.status === 200 && String(memberReadsFdShared.data?.description).includes('Chi tiết SHARED'),
  };
  expectStatus('remove board ACL', await owner.request('DELETE', `${deckApi}/boards/${boardId}/acl/${acl.id}`), [200]);
  acl = null;

  const nestCards = await stackCards(nestStackId);
  const markers = nestCards.map((card) => String(card.description).split('\n').find((line) => line.startsWith('vcw-flow:'))).filter(Boolean);
  const result = {
    marker,
    samples,
    latency: {
      receiverDoneAfterSubmitStartMs: stats(samples.map((x) => x.doneAfterSubmitStartMs)),
      receiverReceivedAfterSubmitStartMs: stats(samples.map((x) => x.receivedAfterSubmitStartMs)),
      receiverDoneAfterSubmitResponseMs: stats(samples.map((x) => x.doneAfterSubmitResponseMs)),
      receiverProcessingMs: stats(samples.map((x) => x.processingMs)),
      submitMsWithFormsDeck: stats(comparison.mappingEnabledSubmitMs),
      submitMsWithoutFormsDeck: stats(comparison.mappingDisabledSubmitMs),
    },
    formsDeckSynchronous: samples.every((x) => x.formsDeckCardPresentRightAfterSubmit),
    access,
    memberSeesOnlyOwnSubmissions: memberSeesOnlyOwn,
    denySubmit: { outsider: outsiderSubmit, 'manager-b': otherSubmit },
    sharedBoardComparison: shared,
    duplicatesInNestStack: markers.length - new Set(markers).size,
  };
  const pass = samples.every((x) => x.outcome === 'card_created' && x.nestCardTitleMatches && x.nestCardHasAnswers && x.nestCardMarker)
    && result.formsDeckSynchronous
    && access['successor-a'].nestCard === 200 && ['member-a', 'manager-b', 'outsider'].every((name) => access[name].board >= 400 && access[name].nestCard >= 400 && access[name].formsDeckCard >= 400 && !access[name].listBoardsContains)
    && memberSeesOnlyOwn && outsiderSubmit >= 400 && otherSubmit >= 400
    && shared.receiverOutcome === 'board_wider_than_results' && !shared.receiverCreatedCard
    && result.duplicatesInNestStack === 0;
  await writeEvidence('acceptance-forms-deck.json', { ...result, result: pass ? 'LOCAL PASS' : 'FAIL' });
  console.log(JSON.stringify({ latency: result.latency, access, shared, pass }, null, 1));
  if (!pass) throw new Error('FORMS_DECK_ACCEPTANCE_FAILED');
} finally {
  if (acl) await owner.request('DELETE', `${deckApi}/boards/${boardId}/acl/${acl.id}`);
  await sleep(200);
  await receiver.stop();
}
