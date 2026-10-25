// Chat16 helpers for the isolated Stalwart (mail16): JMAP admin calls with the
// recovery admin, and JMAP mailbox reads as a local test mailbox owner.
// Only the loopback relay http://127.0.0.1:18160 is used.
import { secret } from './lib.mjs';

export const mailBase = process.env.CAL16_MAIL_BASE || 'http://127.0.0.1:18160';
export const mailSecretName = (address) => `mail_${address.replace(/[@.]/g, '_')}`;
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function session(authorization) {
  const response = await fetch(`${mailBase}/jmap/session`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`JMAP_SESSION_${response.status}`);
  return response.json();
}

export async function jmapAs(authorization) {
  const s = await session(authorization);
  const apiUrl = `${mailBase}${new URL(s.apiUrl, mailBase).pathname}`;
  const using = Object.keys(s.capabilities);
  const call = async (methodCalls, { allowErrors = false } = {}) => {
    const response = await fetch(apiUrl, { method: 'POST', headers: { Authorization: authorization, 'content-type': 'application/json' }, body: JSON.stringify({ using, methodCalls }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`JMAP_HTTP_${response.status}:${(await response.text()).slice(0, 300)}`);
    const json = await response.json();
    if (!allowErrors && json.methodResponses?.some((x) => x[0] === 'error' || x[1]?.notCreated || x[1]?.notUpdated || x[1]?.notDestroyed)) {
      throw new Error(`JMAP_REJECTED:${JSON.stringify(json.methodResponses).slice(0, 1200)}`);
    }
    return json.methodResponses;
  };
  return { session: s, call, primaryAccount: s.primaryAccounts?.['urn:ietf:params:jmap:mail'] };
}

export async function adminJmap() {
  return jmapAs(basic('admin16', await secret('stalwart_recovery_password')));
}

export async function mailboxJmap(address) {
  return jmapAs(basic(address, await secret(mailSecretName(address))));
}

/** List messages of a test mailbox: [{id, subject, from, to, receivedAt, hasCalendar, calendar}]. */
export async function listMessages(address, { limit = 50 } = {}) {
  const { call, primaryAccount } = await mailboxJmap(address);
  const responses = await call([
    ['Email/query', { accountId: primaryAccount, sort: [{ property: 'receivedAt', isAscending: false }], limit }, 'q'],
    ['Email/get', { accountId: primaryAccount, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['id', 'subject', 'from', 'to', 'replyTo', 'receivedAt', 'bodyStructure', 'textBody', 'bodyValues', 'messageId', 'headers'], fetchTextBodyValues: true, fetchAllBodyValues: true }, 'g'],
  ]);
  const list = responses.find((x) => x[0] === 'Email/get')?.[1]?.list ?? [];
  const flatten = (part, acc = []) => { if (!part) return acc; acc.push(part); for (const sub of part.subParts ?? []) flatten(sub, acc); return acc; };
  const out = [];
  for (const message of list) {
    const parts = flatten(message.bodyStructure);
    const calendarPart = parts.find((p) => /text\/calendar/i.test(p.type ?? ''));
    let calendar = null;
    if (calendarPart?.blobId) calendar = await downloadBlob(address, primaryAccount, calendarPart.blobId);
    out.push({
      id: message.id,
      subject: message.subject,
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      receivedAt: message.receivedAt,
      partTypes: parts.map((p) => p.type),
      calendarMethodParam: calendarPart ? (/method=([A-Z]+)/i.exec(calendarPart.type ?? '')?.[1] ?? null) : null,
      calendar,
      text: Object.values(message.bodyValues ?? {}).map((v) => v.value).join('\n'),
      headers: message.headers,
    });
  }
  return out;
}

async function downloadBlob(address, accountId, blobId) {
  const { session: s } = await mailboxJmap(address);
  const url = s.downloadUrl.replace('{accountId}', accountId).replace('{blobId}', blobId).replace('{name}', 'invite.ics').replace('{type}', 'text/calendar');
  const response = await fetch(`${mailBase}${new URL(url, mailBase).pathname}${new URL(url, mailBase).search}`, { headers: { Authorization: basic(address, await secret(mailSecretName(address))) } });
  return response.ok ? response.text() : null;
}
