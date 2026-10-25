// Chat14 (dev aid): start the receiver, register webhooks, submit one form as
// member-a and print the journal row once processed. Stops the receiver.
import { client, readEvidence, resetBruteforce, sleep } from './lib.mjs';
import { startReceiver, vcLogin } from './receiver-lib.mjs';
import { registerWebhooks } from './register-webhooks.mjs';

await resetBruteforce();
const resources = await readEvidence('resources.json');
const receiver = await startReceiver({ FLOW14_LOGGER: '1' });
try {
  await registerWebhooks();
  const member = await client('member-a');
  const response = await member.request('POST', `/ocs/v2.php/apps/forms/api/v3/forms/${resources.forms.formId}/submissions`, {
    json: { answers: { [resources.forms.titleQuestionId]: [`Smoke ${Date.now()}`], [resources.forms.detailQuestionId]: ['Smoke'] } },
  });
  console.log('submit', response.status);
  const it = await vcLogin('it@vcprosperous.com');
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const page = await it('/flow/events?limit=3');
    const first = page.data?.items?.[0];
    if (first && ['done', 'skipped', 'failed'].includes(first.status)) {
      console.log(JSON.stringify(first, null, 1));
      break;
    }
  }
} finally {
  await receiver.stop();
  console.log(receiver.logs.filter((line) => /Flow|ERROR|WARN/i.test(line)).slice(-20).join('\n'));
}
