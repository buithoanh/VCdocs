import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, root } from './authentik-api.mjs';

const evidence = JSON.parse(await readFile(join(root, 'evidence', 'provisioning.json'), 'utf8'));
const provider = evidence.applications.find((item) => item.applicationSlug === 'nextcloud-33-test');
for (const persona of evidence.personas) {
  const claims = await api(`/providers/oauth2/${provider.providerId}/preview_user/?for_user=${persona.pk}`);
  console.log(persona.username, JSON.stringify(claims));
}
