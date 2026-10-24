import fs from 'node:fs';

const [source, target] = process.argv.slice(2);
if (!source || !target || !source.startsWith('/private/tmp/') || !target.startsWith('/private/tmp/')) {
  throw new Error('Chỉ nhận file credential thử trong /private/tmp');
}
const values = Object.fromEntries(fs.readFileSync(source, 'utf8').trim().split('\n').map((line) => {
  const at = line.indexOf('=');
  return [line.slice(0, at), line.slice(at + 1)];
}));
const recovery = values.STALWART_RECOVERY_ADMIN ?? '';
const separator = recovery.indexOf(':');
if (separator < 1 || !values.MAIL_TEST_A_PASSWORD || !values.MAIL_TEST_B_PASSWORD) throw new Error('Credential thử không đầy đủ');
fs.writeFileSync(target, [
  'STALWART_URL=http://host.docker.internal:18084',
  `STALWART_USER=${recovery.slice(0, separator)}`,
  `STALWART_PASSWORD=${recovery.slice(separator + 1)}`,
  `MAIL_TEST_A_PASSWORD=${values.MAIL_TEST_A_PASSWORD}`,
  `MAIL_TEST_B_PASSWORD=${values.MAIL_TEST_B_PASSWORD}`,
  '',
].join('\n'), { mode: 0o600 });
fs.chmodSync(target, 0o600);
const payloadDir = `${target}.d`;
fs.mkdirSync(payloadDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(`${payloadDir}/account-c.json`, JSON.stringify({ credentials: { 0: { '@type': 'Password', secret: values.MAIL_TEST_A_PASSWORD } } }), { mode: 0o600 });
fs.writeFileSync(`${payloadDir}/account-d.json`, JSON.stringify({ credentials: { 0: { '@type': 'Password', secret: values.MAIL_TEST_B_PASSWORD } } }), { mode: 0o600 });
fs.writeFileSync(`${payloadDir}/group-mkt.json`, JSON.stringify({ name: 'mkt-team', domainId: 'b', description: 'VCworkspace chat08 shared mailbox' }), { mode: 0o600 });
console.log('CLI_ENV_READY');
