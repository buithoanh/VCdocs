// Chat16: provision the isolated Stalwart (mail16) with fake .test domains and
// local test mailboxes (passwords from secrets/, never printed). Idempotent:
// existing domains/accounts are kept, passwords are re-applied. Readback at end.
// Also scopes the inbound throttle away from local test traffic (chat08 lesson:
// default 25 msg/h sender→recipient rule) without disabling the global limiter.
import { mailboxes } from './mailboxes.mjs';
import { adminJmap, mailSecretName } from './mail-lib.mjs';
import { secret, writeEvidence } from './lib.mjs';

const { call } = await adminJmap();
const getAll = async (object) => {
  const res = await call([[`x:${object}/query`, {}, 'q'], [`x:${object}/get`, { '#ids': { resultOf: 'q', name: `x:${object}/query`, path: '/ids' } }, 'g']]);
  return res.find((x) => x[0] === `x:${object}/get`)[1].list;
};
const domainNames = [...new Set(mailboxes.map((m) => m.split('@')[1]))];
let domains = await getAll('Domain');
const missingDomains = domainNames.filter((name) => !domains.some((d) => d.name === name));
if (missingDomains.length) {
  await call([['x:Domain/set', { create: Object.fromEntries(missingDomains.map((name, i) => [`d${i}`, { name }])) }, 's']]);
  domains = await getAll('Domain');
}
const domainId = Object.fromEntries(domains.map((d) => [d.name, d.id]));
let accounts = await getAll('Account');
const create = {};
const update = {};
for (const address of mailboxes) {
  const [local, domain] = address.split('@');
  const password = await secret(mailSecretName(address));
  const existing = accounts.find((a) => a.name === local && a.domainId === domainId[domain]);
  const credentials = { 0: { '@type': 'Password', secret: password } };
  if (existing) update[existing.id] = { credentials };
  else create[address.replace(/[@.]/g, '_')] = { '@type': 'User', name: local, domainId: domainId[domain], description: `chat16 test ${address}`, credentials };
}
if (Object.keys(create).length || Object.keys(update).length) await call([['x:Account/set', { ...(Object.keys(create).length ? { create } : {}), ...(Object.keys(update).length ? { update } : {}) }, 's']]);
accounts = await getAll('Account');

// Throttle: exclude only local .test → .test traffic from the default sender→rcpt rule.
const throttles = await getAll('MtaInboundThrottle');
const baseRule = throttles.find((x) => x.description === 'Sender address to recipient throttle');
const localExpr = "ends_with(sender_domain, '.test') && ends_with(rcpt, '.test')";
if (baseRule) await call([['x:MtaInboundThrottle/set', { update: { [baseRule.id]: { match: { match: { 0: { if: localExpr, then: 'false' } }, else: 'true' } } } }, 's']]);

const readback = accounts.filter((a) => mailboxes.some((m) => m === `${a.name}@${domains.find((d) => d.id === a.domainId)?.name}`));
if (readback.length !== mailboxes.length) throw new Error(`ACCOUNT_READBACK:${readback.length}/${mailboxes.length}`);
await writeEvidence('stalwart-config.json', {
  image: 'stalwartlabs/stalwart@sha256:c429b311c93db5606598abc1c68225a85a6953183848ae01bee9c6a98885836c (0.16.27, same digest as chat07)',
  volumes: ['vcworkspace_cal16_mail_data (new, chat16 only)'],
  network: 'vcworkspace-work13_work13 (internal: true, no Internet route); host only via 127.0.0.1:18160 relay to HTTP/JMAP',
  domains: domains.map((d) => d.name),
  mailboxes,
  accountsReadback: readback.map((a) => ({ id: a.id, name: a.name, domain: domains.find((d) => d.id === a.domainId)?.name, type: a['@type'], hasCredential: Object.keys(a.credentials ?? {}).length > 0 })),
  throttle: baseRule ? { scopedAwayFromLocalTest: true, expression: localExpr } : 'BASE_RULE_NOT_FOUND',
});
console.log(`domains=${domains.length} accounts=${readback.length} throttle=${Boolean(baseRule)}`);
