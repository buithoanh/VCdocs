import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, results, root, secret } from './authentik-api.mjs';

async function find(path, predicate) {
  return results(await api(`${path}?page_size=100`)).find(predicate);
}

async function ensureGroup(name, is_superuser = false) {
  const current = await find('/core/groups/', (item) => item.name === name);
  if (current) return current;
  return api('/core/groups/', { method: 'POST', body: { name, is_superuser, attributes: { tenant: 'tenant-a.test' } } });
}

async function ensureUser(definition, groups) {
  let user = await find('/core/users/', (item) => item.username === definition.username);
  const body = {
    username: definition.username,
    name: definition.name,
    email: definition.email,
    is_active: true,
    path: 'users/vcworkspace-test',
    type: 'internal',
    groups: groups.map((group) => group.pk),
    attributes: { tenant: definition.tenant, immutable_subject: definition.subject },
  };
  if (!user) user = await api('/core/users/', { method: 'POST', body });
  else user = await api(`/core/users/${user.pk}/`, { method: 'PATCH', body });
  await api(`/core/users/${user.pk}/set_password/`, {
    method: 'POST',
    body: { password: await secret(definition.passwordSecret) },
    expected: [204],
  });
  return user;
}

async function ensureProvider(definition, common) {
  let provider = await find('/providers/oauth2/', (item) => item.name === definition.name);
  const body = {
    name: definition.name,
    authorization_flow: common.authorization.pk,
    invalidation_flow: common.invalidation.pk,
    authentication_flow: common.authentication.pk,
    property_mappings: common.mappings.map((item) => item.pk),
    client_type: 'confidential',
    grant_types: ['authorization_code', 'refresh_token'],
    client_id: definition.clientId,
    client_secret: await secret(definition.clientSecret),
    include_claims_in_id_token: true,
    signing_key: common.signingKey.pk,
    redirect_uris: definition.redirectUris.map((url) => ({ matching_mode: 'strict', url })),
    access_code_validity: 'minutes=2',
    access_token_validity: 'minutes=5',
    refresh_token_validity: 'hours=1',
  };
  if (!provider) provider = await api('/providers/oauth2/', { method: 'POST', body });
  else provider = await api(`/providers/oauth2/${provider.pk}/`, { method: 'PATCH', body });
  let application = await find('/core/applications/', (item) => item.slug === definition.slug);
  const appBody = { name: definition.appName, slug: definition.slug, provider: provider.pk, policy_engine_mode: 'any' };
  if (!application) application = await api('/core/applications/', { method: 'POST', body: appBody });
  else application = await api(`/core/applications/${definition.slug}/`, { method: 'PATCH', body: appBody });
  return { provider, application };
}

const [authorization, invalidation, authentication] = await Promise.all([
  find('/flows/instances/', (item) => item.slug === 'default-provider-authorization-implicit-consent'),
  find('/flows/instances/', (item) => item.slug === 'default-provider-invalidation-flow'),
  find('/flows/instances/', (item) => item.slug === 'default-authentication-flow'),
]);
const mappings = results(await api('/propertymappings/provider/scope/?page_size=100')).filter((item) =>
  ['openid', 'profile', 'email', 'offline_access'].includes(item.scope_name),
);
const signingKey = results(await api('/crypto/certificatekeypairs/?page_size=100')).find((item) => item.name === 'authentik Self-signed Certificate');
if (!authorization || !invalidation || !authentication || mappings.length < 3 || !signingKey) throw new Error('Authentik defaults missing');

const [admins, teamA, outsiders] = await Promise.all([
  ensureGroup('vcw-admins', true),
  ensureGroup('vcw-team-a'),
  ensureGroup('vcw-outsiders-b'),
]);
const personas = [];
personas.push(await ensureUser({ username: 'admin12', name: 'Admin 12', email: 'admin@tenant-a.test', tenant: 'tenant-a', subject: 'vcw-admin-0001', passwordSecret: 'persona_admin_password' }, [admins]));
personas.push(await ensureUser({ username: 'manager-a', name: 'Manager A', email: 'manager@tenant-a.test', tenant: 'tenant-a', subject: 'vcw-manager-a-0001', passwordSecret: 'persona_manager_password' }, [teamA]));
personas.push(await ensureUser({ username: 'member-a', name: 'Member A', email: 'member@tenant-a.test', tenant: 'tenant-a', subject: 'vcw-member-a-0001', passwordSecret: 'persona_member_password' }, [teamA]));
personas.push(await ensureUser({ username: 'outsider-b', name: 'Outsider B', email: 'outsider@tenant-b.test', tenant: 'tenant-b', subject: 'vcw-outsider-b-0001', passwordSecret: 'persona_outsider_password' }, [outsiders]));

const common = { authorization, invalidation, authentication, mappings, signingKey };
const portal = await ensureProvider({
  name: 'VCworkspace Portal Test', slug: 'vcworkspace-portal-test', appName: 'VCworkspace Portal Test', clientId: 'vcworkspace-portal-test',
  clientSecret: 'oidc_portal_client_secret', redirectUris: [
    'http://portal.localtest.me:18122/callback',
    'http://portal.localtest.me:18122/logged-out',
  ],
}, common);
const nextcloud = await ensureProvider({
  name: 'Nextcloud 33 Test', slug: 'nextcloud-33-test', appName: 'Nextcloud 33 Test', clientId: 'nextcloud-33-test',
  clientSecret: 'oidc_nc_client_secret', redirectUris: ['http://nextcloud.localtest.me:18120/apps/user_oidc/code'],
}, common);
const vcworkspace = await ensureProvider({
  name: 'VCworkspace Application Test', slug: 'vcworkspace-application-test', appName: 'VCworkspace Application Test', clientId: 'vcworkspace-application-test',
  clientSecret: 'oidc_app_client_secret', redirectUris: [
    'http://app.localtest.me:18126/api/v1/auth/oidc/callback',
  ],
}, common);

const evidence = {
  generatedAt: new Date().toISOString(),
  groups: [admins, teamA, outsiders].map(({ pk, name, is_superuser }) => ({ pk, name, is_superuser })),
  personas: personas.map(({ pk, uid, username, email, is_active, groups }) => ({ pk, uid, username, email, is_active, groups })),
  applications: [portal, nextcloud, vcworkspace].map(({ provider, application }) => ({
    providerId: provider.pk,
    applicationSlug: application.slug,
    clientId: provider.client_id,
    redirectUris: provider.redirect_uris,
  })),
  secretsIncluded: false,
};
await mkdir(join(root, 'evidence'), { recursive: true });
await writeFile(join(root, 'evidence', 'provisioning.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Provisioned ${evidence.groups.length} groups, ${evidence.personas.length} personas and ${evidence.applications.length} OIDC applications without logging secrets.`);
