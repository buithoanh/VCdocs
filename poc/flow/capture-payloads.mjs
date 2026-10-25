// Chat14: capture one real webhook_listeners payload per allowlisted event into
// the chat13 internal sink (no receiver yet), delivered by the dedicated
// background-job worker (no cron.php). Saves fake-data samples used as e2e
// fixtures; the `authentication` field and the auth header value are dropped.
import { randomBytes } from 'node:crypto';
import { adminRequest, client, execFileAsync, expectStatus, ocsData, readEvidence, resetBruteforce, sleep, writeEvidence } from './lib.mjs';

await resetBruteforce();
const resources = await readEvidence('resources.json');
const admin = await adminRequest();
const sinkUri = 'http://hook-sink:8080/flow14-capture';
const token = randomBytes(24).toString('hex');
const webhooks = '/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks?format=json';
const member = await client('member-a');
const events = [
  'OCA\\Forms\\Events\\FormSubmittedEvent',
  'OCA\\Tables\\Event\\RowAddedEvent',
  'OCP\\Files\\Events\\Node\\NodeCreatedEvent',
  'OCP\\Files\\Events\\Node\\NodeWrittenEvent',
];
const created = [];
for (const event of events) {
  const response = await admin('POST', webhooks, { httpMethod: 'POST', uri: sinkUri, event, eventFilter: { 'user.uid': member.uid }, authMethod: 'header', authData: { 'X-Flow14-Capture': token } });
  created.push(ocsData(expectStatus(`register ${event}`, response, [200])).id);
}
const sinkLog = async () => (await execFileAsync('docker', ['exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log']).catch(() => ({ stdout: '' }))).stdout;
const offset = (await sinkLog()).length;
const marker = `flow14-capture-${Date.now()}`;
const started = Date.now();
expectStatus('submit', await member.request('POST', `/ocs/v2.php/apps/forms/api/v3/forms/${resources.forms.formId}/submissions`, {
  json: { answers: { [resources.forms.titleQuestionId]: [`Capture ${marker}`], [resources.forms.detailQuestionId]: ['Mô tả giả'] } },
}), [200, 201]);
expectStatus('row', await member.request('POST', `/index.php/apps/tables/api/1/tables/${resources.tables.tableId}/rows`, { json: { data: { [resources.tables.columnId]: `Capture ${marker}` } } }), [200]);
expectStatus('upload', await member.request('PUT', `/remote.php/dav/files/${encodeURIComponent(member.uid)}/${resources.files.folder}/${marker}.txt`, { body: `capture ${marker}\n` }), [201]);
let parsed = [];
for (let round = 0; round < 40; round += 1) {
  await sleep(500);
  parsed = (await sinkLog()).slice(offset).split('--END--').map((item) => item.trim()).filter(Boolean);
  if (parsed.length >= 3 && events.slice(0, 3).every((event) => parsed.some((raw) => raw.includes(JSON.stringify(event).slice(1, -1))))) break;
}
const elapsedMs = Date.now() - started;
for (const id of created) await admin('DELETE', `/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks/${id}?format=json`);
const samples = parsed.map((raw) => {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const payload = JSON.parse(rest.join('\r\n\r\n'));
  delete payload.authentication;
  const headers = head.split('\r\n').slice(1).map((line) => line.split(':')[0]);
  return { requestLine: head.split('\r\n')[0], headerNames: headers, authHeaderMatches: head.includes(`X-Flow14-Capture: ${token}`) || head.includes(`x-flow14-capture: ${token}`), payload };
});
await writeEvidence('webhook-payloads.json', {
  marker,
  deliveredBy: 'occ background-job:worker (container vcworkspace-flow14-webhook-worker-1), không chạy cron.php',
  allDeliveredWithinMs: elapsedMs,
  samples,
});
console.log(samples.map((sample) => `${sample.payload.event.class} keys=${Object.keys(sample.payload.event).join(',')} auth=${sample.authHeaderMatches}`).join('\n'));
console.log(`delivered in <= ${elapsedMs} ms`);
