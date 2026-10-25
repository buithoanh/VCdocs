import { akApi, results, secret, writeEvidence } from './lib.mjs';

async function find(path, predicate) {
  return results(await akApi(`${path}?page_size=100`)).find(predicate);
}

async function ensureGroup(name, tenant) {
  const current = await find('/core/groups/', (item) => item.name === name);
  if (current) return current;
  return akApi('/core/groups/', { method: 'POST', body: { name, is_superuser: false, attributes: { tenant } } });
}

async function ensureUser(definition, group) {
  let user = await find('/core/users/', (item) => item.username === definition.username);
  const body = {
    username: definition.username,
    name: definition.name,
    email: definition.email,
    is_active: true,
    path: 'users/vcworkspace-work13',
    type: 'internal',
    groups: [group.pk],
    attributes: { tenant: definition.tenant },
  };
  if (!user) user = await akApi('/core/users/', { method: 'POST', body });
  else user = await akApi(`/core/users/${user.pk}/`, { method: 'PATCH', body });
  await akApi(`/core/users/${user.pk}/set_password/`, {
    method: 'POST',
    body: { password: await secret(definition.passwordSecret) },
    expected: [204],
  });
  return user;
}

const [authorization, invalidation, authentication] = await Promise.all([
  find('/flows/instances/', (item) => item.slug === 'default-provider-authorization-implicit-consent'),
  find('/flows/instances/', (item) => item.slug === 'default-provider-invalidation-flow'),
  find('/flows/instances/', (item) => item.slug === 'default-authentication-flow'),
]);
const mappings = results(await akApi('/propertymappings/provider/scope/?page_size=100')).filter((item) =>
  ['openid', 'profile', 'email', 'offline_access'].includes(item.scope_name),
);
const signingKey = results(await akApi('/crypto/certificatekeypairs/?page_size=100')).find((item) => item.name === 'authentik Self-signed Certificate');
if (!authorization || !invalidation || !authentication || mappings.length < 3 || !signingKey) throw new Error('Authentik defaults missing');

const groups = {
  'vcw-team-a': await ensureGroup('vcw-team-a', 'tenant-a'),
  'vcw-team-b': await ensureGroup('vcw-team-b', 'tenant-b'),
  'vcw-outsiders': await ensureGroup('vcw-outsiders', 'external'),
};
const definitions = [
  { username: 'manager-a', name: 'Manager A', email: 'manager-a@team-a.test', tenant: 'tenant-a', group: 'vcw-team-a' },
  { username: 'member-a', name: 'Member A', email: 'member-a@team-a.test', tenant: 'tenant-a', group: 'vcw-team-a' },
  // Receives manager-a's resources in the ownership-transfer/offboard case.
  { username: 'successor-a', name: 'Successor A', email: 'successor-a@team-a.test', tenant: 'tenant-a', group: 'vcw-team-a' },
  { username: 'manager-b', name: 'Manager B', email: 'manager-b@team-b.test', tenant: 'tenant-b', group: 'vcw-team-b' },
  { username: 'member-b', name: 'Member B', email: 'member-b@team-b.test', tenant: 'tenant-b', group: 'vcw-team-b' },
  // Same local-part as a Team A persona on purpose: identity must follow the
  // immutable subject, never the email local-part.
  { username: 'outsider', name: 'Outsider', email: 'manager-a@outsider.test', tenant: 'external', group: 'vcw-outsiders' },
];
const users = [];
for (const definition of definitions) {
  const passwordSecret = definition.username === 'outsider' ? 'persona_outsider_password' : `persona_${definition.username}_password`;
  users.push(await ensureUser({ ...definition, passwordSecret }, groups[definition.group]));
}

let provider = await find('/providers/oauth2/', (item) => item.name === 'Nextcloud 33 Work13');
const providerBody = {
  name: 'Nextcloud 33 Work13',
  authorization_flow: authorization.pk,
  invalidation_flow: invalidation.pk,
  authentication_flow: authentication.pk,
  property_mappings: mappings.map((item) => item.pk),
  client_type: 'confidential',
  grant_types: ['authorization_code', 'refresh_token'],
  client_id: 'nextcloud-work13',
  client_secret: await secret('oidc_nc_client_secret'),
  include_claims_in_id_token: true,
  signing_key: signingKey.pk,
  redirect_uris: [{ matching_mode: 'strict', url: 'http://nc13.localtest.me:18130/apps/user_oidc/code' }],
  access_code_validity: 'minutes=2',
  access_token_validity: 'minutes=5',
  refresh_token_validity: 'hours=1',
};
if (!provider) provider = await akApi('/providers/oauth2/', { method: 'POST', body: providerBody });
else provider = await akApi(`/providers/oauth2/${provider.pk}/`, { method: 'PATCH', body: providerBody });
let application = await find('/core/applications/', (item) => item.slug === 'nextcloud-work13');
const appBody = { name: 'Nextcloud 33 Work13', slug: 'nextcloud-work13', provider: provider.pk, policy_engine_mode: 'any' };
if (!application) application = await akApi('/core/applications/', { method: 'POST', body: appBody });
else application = await akApi('/core/applications/nextcloud-work13/', { method: 'PATCH', body: appBody });

await writeEvidence('provisioning.json', {
  groups: Object.values(groups).map(({ pk, name }) => ({ pk, name })),
  personas: users.map(({ pk, uid, username, email, is_active, groups: memberOf }) => ({ pk, uid, username, email, is_active, groups: memberOf })),
  application: { slug: application.slug, clientId: provider.client_id, redirectUris: provider.redirect_uris },
});
console.log(`Provisioned ${Object.keys(groups).length} groups, ${users.length} personas and 1 OIDC application; no secret printed.`);
