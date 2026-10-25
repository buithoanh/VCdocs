import { api } from './authentik-api.mjs';

const schema = await api('/schema/?format=json');
const wanted = Object.keys(schema.paths).filter((path) =>
  /core\/(users|groups|applications)|providers\/oauth2|propertymappings\/provider\/scope|flows\/instances/.test(path),
);
for (const path of wanted.sort()) {
  console.log(path, Object.keys(schema.paths[path]).filter((key) => key !== 'parameters').join(','));
}
for (const path of ['/core/groups/', '/core/users/', '/providers/oauth2/', '/core/applications/']) {
  const requestSchema = schema.paths[path]?.post?.requestBody?.content?.['application/json']?.schema;
  const name = requestSchema?.$ref?.split('/').at(-1);
  console.log(`SCHEMA ${path}`, JSON.stringify(name ? schema.components.schemas[name] : requestSchema));
}
