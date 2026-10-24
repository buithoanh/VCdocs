import { api, results } from './authentik-api.mjs';

const username = process.argv[2];
if (!['admin12', 'manager-a', 'member-a', 'outsider-b'].includes(username)) throw new Error('TEST_PERSONA_REQUIRED');
const users = results(await api('/core/users/?page_size=100'));
const user = users.find((item) => item.username === username);
if (!user) throw new Error('TEST_PERSONA_NOT_FOUND');
const sessions = results(await api('/core/authenticated_sessions/?page_size=100')).filter((item) => item.user === user.pk);
for (const session of sessions) await api(`/core/authenticated_sessions/${session.uuid}/`, { method: 'DELETE' });
console.log(`Cleared ${sessions.length} local test session(s) for ${username}; no secret printed.`);
