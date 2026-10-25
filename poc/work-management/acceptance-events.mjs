// Event probe for chat 14 (Flow): register webhook_listeners webhooks for the
// Work management events Nextcloud marks webhook-compatible, trigger them as
// member-a over the API (app password), run background jobs and read what the
// internal sink received. Two scoping modes are compared:
//   A. userIdFilter = member uid (the documented per-user filter)
//   B. no userIdFilter, eventFilter {"user.uid": member uid} (Mongo-style query)
// Deck CardCreatedEvent is registered too, to prove whether Deck emits it.
import { chmod, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { client, execFileAsync, expectStatus, ncBase, ncContainer, ocsData, readEvidence, resetBruteforce, root, secret, writeEvidence } from './lib.mjs';

await resetBruteforce();
const sinkUri = 'http://hook-sink:8080/work13';
const tokenPath = join(root, 'secrets', 'webhook_token');
const token = randomBytes(24).toString('base64url');
await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
await chmod(tokenPath, 0o600);

const admin = `Basic ${Buffer.from(`admin13:${await secret('nc_admin_password')}`).toString('base64')}`;
async function adminOcs(method, path, json) {
  const response = await fetch(`${ncBase}/ocs/v2.php/apps/webhook_listeners/api/v1${path}?format=json`, {
    method, headers: { Authorization: admin, 'OCS-APIRequest': 'true', Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
const sinkLog = async () => (await execFileAsync('docker', ['exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log'])).stdout;
const runJobs = async () => {
  for (let round = 0; round < 3; round += 1) await execFileAsync('docker', ['exec', '-u', 'www-data', ncContainer, 'php', '-f', '/var/www/html/cron.php']);
};
const removeProbeHooks = async () => {
  for (const hook of ocsData(await adminOcs('GET', '/webhooks')) ?? []) {
    if (hook.uri === sinkUri) await adminOcs('DELETE', `/webhooks/${hook.id}`);
  }
};

const member = await client('member-a');
const manager = await client('manager-a');
const forms = await readEvidence('acceptance-forms.json');
const tables = await readEvidence('acceptance-tables.json');
const notes = await readEvidence('acceptance-notes.json');
const deck = await readEvidence('acceptance-deck.json');
// The acceptance form allows one response per person; let the probe re-submit.
expectStatus('allow multiple submissions', await manager.request('PATCH', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}`, { json: { keyValuePairs: { submitMultiple: true } } }), [200]);
const events = {
  forms: 'OCA\\Forms\\Events\\FormSubmittedEvent',
  tables: 'OCA\\Tables\\Event\\RowAddedEvent',
  files: 'OCP\\Files\\Events\\Node\\NodeWrittenEvent',
  deck: 'OCA\\Deck\\Event\\CardCreatedEvent',
};

async function triggerAll(marker) {
  expectStatus('member submit form', await member.request('POST', `/ocs/v2.php/apps/forms/api/v3/forms/${forms.resources.formId}/submissions`, { json: { answers: { [forms.resources.textQuestionId]: [`Event ${marker}`] } } }), [200, 201]);
  expectStatus('member add row', await member.request('POST', `/index.php/apps/tables/api/1/tables/${tables.resources.tableId}/rows`, { json: { data: { [tables.resources.columnId]: `Event ${marker}` } } }), [200]);
  const notePath = `/remote.php/dav/files/${encodeURIComponent(member.uid)}/${encodeURIComponent(notes.resources.memberTarget)}/${encodeURIComponent(notes.resources.noteFile)}`;
  const noteNow = await member.request('GET', notePath, { raw: true });
  expectStatus('member write note', await member.request('PUT', notePath, { body: `${noteNow.bytes.toString()}\nEvent ${marker}\n` }), [204]);
  expectStatus('member create card', await member.request('POST', `/index.php/apps/deck/api/v1.0/boards/${deck.resources.boardId}/stacks/${deck.resources.stackId}/cards`, { json: { title: `Event ${marker}`, type: 'plain', order: 3 } }), [200]);
}

function parse(raw, marker) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  let payload = null;
  try { payload = JSON.parse(body); } catch { /* keep null */ }
  return {
    requestLine: head.split('\r\n')[0],
    tokenHeaderMatches: head.split('\r\n').some((line) => line === `X-Work13-Token: ${token}` || line === `x-work13-token: ${token}`),
    event: payload?.event?.class ?? null,
    userId: payload?.user?.uid ?? null,
    time: payload?.time ?? null,
    payloadKeys: payload?.event ? Object.keys(payload.event) : [],
    containsMarker: body.includes(marker),
  };
}

async function probe(mode) {
  await removeProbeHooks();
  const registration = {};
  for (const [name, event] of Object.entries(events)) {
    const scope = mode === 'userIdFilter' ? { userIdFilter: member.uid } : { eventFilter: { 'user.uid': member.uid } };
    const response = await adminOcs('POST', '/webhooks', { httpMethod: 'POST', uri: sinkUri, event, ...scope, authMethod: 'header', authData: { 'X-Work13-Token': token } });
    registration[name] = { status: response.status, message: response.data?.ocs?.meta?.message ?? null };
  }
  await runJobs();
  const offset = (await sinkLog()).length;
  const marker = `work13-events-${mode}-${Date.now()}`;
  await triggerAll(marker);
  await runJobs();
  const parsed = (await sinkLog()).slice(offset).split('--END--').map((item) => item.trim()).filter(Boolean).map((raw) => parse(raw, marker));
  const summary = Object.fromEntries(Object.entries(events).map(([name, event]) => {
    const items = parsed.filter((item) => item.event === event);
    return [name, {
      registered: registration[name].status === 200,
      registrationMessage: registration[name].status === 200 ? null : registration[name].message,
      delivered: items.length,
      allTokenHeader: items.every((item) => item.tokenHeaderMatches),
      allUserIdIsImmutableId: items.every((item) => item.userId === member.uid),
      payloadContainsChangedData: items.some((item) => item.containsMarker),
      payloadKeys: [...new Set(items.flatMap((item) => item.payloadKeys))],
    }];
  }));
  await removeProbeHooks();
  return { marker, summary, requests: parsed.map(({ requestLine, event, userId, time, tokenHeaderMatches, containsMarker }) => ({ requestLine, event, userId, time, tokenHeaderMatches, containsMarker })) };
}

const userIdFilter = await probe('userIdFilter');
const eventFilter = await probe('eventFilter');
for (const name of ['forms', 'tables', 'files']) {
  const item = eventFilter.summary[name];
  if (!item.delivered || !item.allTokenHeader || !item.allUserIdIsImmutableId) throw new Error(`EVENT_${name.toUpperCase()}_NOT_DELIVERED:${JSON.stringify(item)}`);
}
await writeEvidence('acceptance-events.json', {
  sinkUri,
  userIdFilterMode: userIdFilter,
  eventFilterMode: eventFilter,
  notes: [
    'Delivery is asynchronous: webhook calls are queued background jobs (cron.php was run explicitly).',
    'Auth is a static header configured by an admin; the payload has no HMAC signature or replay nonce.',
    'Probe webhooks were removed after each mode.',
  ],
  result: 'LOCAL PASS for Forms/Tables/Files events with eventFilter; see userIdFilterMode and deck for gaps',
});
console.log(`userIdFilter: ${JSON.stringify(userIdFilter.summary)}\neventFilter: ${JSON.stringify(eventFilter.summary)}`);
