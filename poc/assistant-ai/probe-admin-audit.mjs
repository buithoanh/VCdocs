// Chat19: what does admin_audit record for AI use? admin_audit writes at INFO
// (Action::log → logger->info, DOC) and the work13 instance runs the default
// loglevel 2, so audit.log stays silent. This probe sets loglevel=1 for the
// duration of one file-action summary (member-a), one denied attempt (member-b),
// one Talk summary and one RAG ask, then restores loglevel (deleted = default 2)
// in `finally`, and records the new audit.log / nextcloud.log lines (fake data).
import { client, docker, ncContainer, occ, ocs, tp, writeEvidence } from './lib.mjs';
import { ask } from './rag-lib.mjs';
import { readEvidence } from './lib.mjs';

const cat = async (p) => (await docker('exec', ncContainer, 'cat', p).catch(() => ({ stdout: '' }))).stdout;
const corpus = await readEvidence('corpus.json');
const planA = corpus.files['ai19-team-a/ke-hoach-du-an-song-hong.md'].fileId;
const A = await client('member-a');
const B = await client('member-b');
const before = { audit: (await cat('/var/www/html/data/audit.log')).split('\n').filter(Boolean).length, nc: (await cat('/var/www/html/data/nextcloud.log')).split('\n').filter(Boolean).length };
const prev = (await occ('config:system:get', 'loglevel').catch(() => ({ stdout: '' }))).stdout.trim();
const waitTask = async (c, id) => { for (let i = 0; i < 600; i += 1) { const t = ocs(await c.request('GET', tp(`/task/${id}`)))?.task; if (t && /SUCCESSFUL|FAILED/.test(t.status)) return t; await new Promise((r) => setTimeout(r, 500)); } return null; };
const actions = [];
try {
  await occ('config:system:set', 'loglevel', '--type=integer', '--value=1');
  const t0 = new Date().toISOString();
  const fa = await A.request('POST', `/ocs/v2.php/apps/assistant/api/v1/file-action/${planA}/core:text2text:summary`);
  const list = ocs(await A.request('GET', tp(`/tasks?customId=${encodeURIComponent(`file-action:${planA}`)}`)))?.tasks ?? [];
  const faTask = await waitTask(A, list.sort((x, y) => y.id - x.id)[0].id);
  actions.push({ who: 'member-a', what: 'file-action summary Team A plan', http: fa.status, taskId: faTask?.id });
  const denied = await B.request('POST', `/ocs/v2.php/apps/assistant/api/v1/file-action/${planA}/core:text2text:summary`);
  actions.push({ who: 'member-b', what: 'file-action summary Team A plan (denied)', http: denied.status });
  const ts = await A.request('POST', `/ocs/v2.php/apps/spreed/api/v1/chat/${corpus.talk.A.token}/summarize`, { json: { fromMessageId: 0 } });
  const tsTask = ocs(ts)?.taskId ? await waitTask(A, ocs(ts).taskId) : null;
  actions.push({ who: 'member-a', what: 'Talk summarize Team A room', http: ts.status, taskId: tsTask?.id });
  const rag = await ask(B, 'Ngân sách của dự án Sông Hồng là bao nhiêu?');
  actions.push({ who: 'member-b', what: 'RAG ask (harness)', taskId: rag.taskId, sources: rag.sources.map((s) => s.title) });
  await new Promise((r) => setTimeout(r, 2000));
  actions.push({ startedAt: t0 });
} finally {
  if (prev) await occ('config:system:set', 'loglevel', '--type=integer', `--value=${prev}`);
  else await occ('config:system:delete', 'loglevel');
}
const auditNew = (await cat('/var/www/html/data/audit.log')).split('\n').filter(Boolean).slice(before.audit);
const ncNew = (await cat('/var/www/html/data/nextcloud.log')).split('\n').filter(Boolean).slice(before.nc);
const parse = (l) => { try { const j = JSON.parse(l); return { app: j.app, level: j.level, user: j.user ? `${String(j.user).slice(0, 12)}…` : j.user, url: j.url, message: String(j.message).slice(0, 220) }; } catch { return { raw: l.slice(0, 220) }; } };
const out = {
  loglevelDuringProbe: 1,
  loglevelRestoredTo: (await occ('config:system:get', 'loglevel').catch(() => ({ stdout: '(unset = 2)' }))).stdout.trim() || '(unset = 2)',
  actions,
  auditLogNewLines: auditNew.length,
  auditLogNewLoginLines: auditNew.filter((l) => /Login (attempt|successful)/.test(l)).length,
  auditLogNewNonLogin: auditNew.filter((l) => !/Login (attempt|successful)/.test(l)).map(parse),
  auditMentionsTaskOrAssistant: auditNew.filter((l) => /assistant|taskprocessing|summar/i.test(l)).length,
  auditMentionsTeamAFile: auditNew.filter((l) => /ke-hoach-du-an-song-hong/.test(l)).map(parse),
  nextcloudLogNewLines: ncNew.length,
  nextcloudLogNewAiLines: ncNew.filter((l) => /integration_openai|assistant|TaskProcessing|spreed/i.test(l)).map(parse).slice(0, 20),
  nextcloudLogNewContainsPrompt: ncNew.some((l) => /SH-7731|Mỹ Khê|Sông Hồng/.test(l)),
};
await writeEvidence('admin-audit-probe.json', out);
console.log(JSON.stringify(out, null, 1).slice(0, 5000));
