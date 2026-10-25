// Chat14: (re)register the webhook_listeners webhooks that feed the NestJS
// receiver through the internal relay, authenticated by the current secret
// header. Scoped with eventFilter (not userIdFilter, which never fires for
// app-password API requests, chat13). PHPMongoQuery has no $regex, so file
// events are scoped to Team A users and the receiver filters the folder by
// readback. Optional: also mirror FormSubmittedEvent to the chat13 sink so a
// real delivered body can be replayed (FLOW14_MIRROR_FORMS=1).
import { adminRequest, ocsData, personas, readEvidence, receiverUriForNextcloud, writeEvidence } from './lib.mjs';
import { webhookSecrets } from './receiver-lib.mjs';

export async function registerWebhooks({ mirrorForms = false, secretOverride } = {}) {
  const admin = await adminRequest();
  const resources = await readEvidence('resources.json');
  const people = await personas();
  const { current } = await webhookSecrets();
  const token = secretOverride ?? current;
  const api = '/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks';
  const sinkUri = 'http://hook-sink:8080/flow14-mirror';
  for (const hook of ocsData(await admin('GET', `${api}?format=json`)) ?? []) {
    if (hook.uri === receiverUriForNextcloud || hook.uri === sinkUri) await admin('DELETE', `${api}/${hook.id}?format=json`);
  }
  const teamA = ['successor-a', 'member-a'].map((name) => people[name].nextcloudUserId);
  const wanted = [
    { event: 'OCA\\Forms\\Events\\FormSubmittedEvent', eventFilter: { 'event.form.id': resources.forms.formId } },
    { event: 'OCA\\Tables\\Event\\RowAddedEvent', eventFilter: { 'event.tableId': resources.tables.tableId } },
    { event: 'OCP\\Files\\Events\\Node\\NodeCreatedEvent', eventFilter: { 'user.uid': { $in: teamA } } },
    { event: 'OCP\\Files\\Events\\Node\\NodeWrittenEvent', eventFilter: { 'user.uid': { $in: teamA } } },
  ];
  const created = [];
  for (const hook of wanted) {
    const response = await admin('POST', `${api}?format=json`, { httpMethod: 'POST', uri: receiverUriForNextcloud, ...hook, authMethod: 'header', authData: { 'X-VCW-Flow-Token': token } });
    if (response.status !== 200) throw new Error(`REGISTER_${hook.event}_${response.status}:${JSON.stringify(response.data).slice(0, 300)}`);
    created.push({ id: ocsData(response).id, event: hook.event, eventFilter: hook.eventFilter, uri: receiverUriForNextcloud, authMethod: 'header' });
  }
  if (mirrorForms) {
    const response = await admin('POST', `${api}?format=json`, { httpMethod: 'POST', uri: sinkUri, event: wanted[0].event, eventFilter: wanted[0].eventFilter, authMethod: 'header', authData: { 'X-VCW-Flow-Token': token } });
    created.push({ id: ocsData(response).id, event: wanted[0].event, uri: sinkUri, mirror: true });
  }
  await writeEvidence('webhooks.json', { webhooks: created, note: 'authData là header bí mật hiện hành; giá trị không ghi vào evidence' });
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const created = await registerWebhooks({ mirrorForms: process.env.FLOW14_MIRROR_FORMS === '1' });
  console.log(created.map((hook) => `${hook.id} ${hook.event}${hook.mirror ? ' (mirror)' : ''}`).join('\n'));
}
