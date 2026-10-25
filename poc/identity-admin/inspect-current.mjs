import { api, results } from './authentik-api.mjs';

const [flows, mappings, keys] = await Promise.all([
  api('/flows/instances/?page_size=100'),
  api('/propertymappings/provider/scope/?page_size=100'),
  api('/crypto/certificatekeypairs/?page_size=100'),
]);
console.log('FLOWS');
for (const item of results(flows)) console.log(item.slug, item.designation, item.pk);
console.log('MAPPINGS');
for (const item of results(mappings)) console.log(item.name, item.scope_name, item.pk);
console.log('KEYS');
for (const item of results(keys)) console.log(item.name, item.pk, item.has_key);
