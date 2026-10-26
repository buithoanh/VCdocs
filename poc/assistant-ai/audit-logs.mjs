// Chat19 audit/privacy check (read-only): what does each layer record about
// "who asked what" and "which sources were returned"?
//  - Nextcloud admin_audit (data/audit.log + admin_audit lines in nextcloud.log)
//  - nextcloud.log (prompt/answer text?)
//  - DB rows (read-only transaction): oc_taskprocessing_tasks (input/output,
//    user, app, customId, timestamps), Assistant chat tables, integration_openai
//    quota table
//  - host Ollama server.log (prompt text?)
//  - this PoC's harness audit (evidence/rag-audit.jsonl)
// Marker strings are fake Team A data. Only counts/samples of fake data are
// written to evidence/audit-logs.json.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { aiRoot, docker, ncContainer, occ, writeEvidence } from './lib.mjs';

const marker = 'SH-7731';
const injection = 'INJECTION-OK';
const dbContainer = 'vcworkspace-work13-nc-db-1';
const sql = async (q) => (await docker('exec', dbContainer, 'psql', '-U', 'nextcloud', '-d', 'nextcloud', '-At', '-F', '\t', '-c', `SET default_transaction_read_only = on; ${q}`)).stdout.trim().split('\n').filter((l) => l !== 'SET');
const cat = async (path) => (await docker('exec', ncContainer, 'cat', path).catch(() => ({ stdout: '' }))).stdout;

const out = {};
// admin_audit
const auditLog = await cat('/var/www/html/data/audit.log');
const ncLog = await cat('/var/www/html/data/nextcloud.log');
const auditLines = auditLog.split('\n').filter(Boolean);
const ncAudit = ncLog.split('\n').filter((l) => l.includes('"app":"admin_audit"'));
const today = new Date().toISOString().slice(0, 10);
out.adminAudit = {
  logfileSetting: (await occ('config:app:get', 'admin_audit', 'logfile').catch(() => ({ stdout: '(default data/audit.log)' }))).stdout.trim() || '(default data/audit.log)',
  auditLogLines: auditLines.length,
  auditLogMessagesSample: auditLines.slice(-5).map((l) => { try { return JSON.parse(l).message.slice(0, 160); } catch { return l.slice(0, 160); } }),
  ncLogAdminAuditLinesToday: ncAudit.filter((l) => l.includes(today)).length,
  mentionsTaskProcessing: [...auditLines, ...ncAudit].filter((l) => /taskprocessing|assistant|openai/i.test(l)).length,
  containsMarker: [...auditLines, ...ncAudit].some((l) => l.includes(marker)),
};
// nextcloud.log
const ncLines = ncLog.split('\n').filter(Boolean);
out.nextcloudLog = {
  loglevel: (await occ('config:system:get', 'loglevel').catch(() => ({ stdout: '' }))).stdout.trim() || '2 (default)',
  linesToday: ncLines.filter((l) => l.includes(today)).length,
  linesMentioningOpenaiOrTaskprocessing: ncLines.filter((l) => l.includes(today) && /integration_openai|TaskProcessing|assistant/i.test(l)).length,
  sampleMessages: ncLines.filter((l) => l.includes(today) && /integration_openai|TaskProcessing|assistant/i.test(l)).slice(-4).map((l) => { try { const j = JSON.parse(l); return `${j.app}: ${String(j.message).slice(0, 200)}`; } catch { return l.slice(0, 200); } }),
  containsPromptMarker: ncLines.some((l) => l.includes(marker)),
  linesWithPromptMarker: ncLines.filter((l) => l.includes(marker)).map((l) => { try { const j = JSON.parse(l); return { app: j.app, level: j.level, url: j.url, message: String(j.message).slice(0, 140) }; } catch { return { raw: l.slice(0, 140) }; } }).slice(0, 8),
  topicsProviderErrorLines: ncLines.filter((l) => l.includes('TopicsProvider(dsadsaads)')).length,
  containsInjectionAnswer: ncLines.some((l) => l.includes(injection)),
};
// DB rows
out.db = {
  taskprocessingTasksByApp: await sql("SELECT app_id, type, count(*) FROM oc_taskprocessing_tasks GROUP BY 1,2 ORDER BY 1,2;"),
  tasksWithMarkerInInputByUser: await sql(`SELECT left(user_id, 12) || '…', app_id, count(*) FROM oc_taskprocessing_tasks WHERE input LIKE '%${marker}%' GROUP BY 1,2 ORDER BY 1,2;`),
  tasksWithMarkerInOutput: Number((await sql(`SELECT count(*) FROM oc_taskprocessing_tasks WHERE output LIKE '%${marker}%';`))[0]),
  tasksWithInjectionAnswerInOutput: Number((await sql(`SELECT count(*) FROM oc_taskprocessing_tasks WHERE output LIKE '%${injection}%';`))[0]),
  oneTaskRowShape: (await sql("SELECT id, type, app_id, custom_id, status, length(input), length(output), to_timestamp(scheduled_at), to_timestamp(ended_at), allow_cleanup FROM oc_taskprocessing_tasks ORDER BY id DESC LIMIT 1;"))[0],
  retention: 'RemoveOldTasksBackgroundJob deletes tasks older than Manager::MAX_TASK_AGE_SECONDS = 6 × 31 days (DOC); allow_cleanup per task',
  assistantChat: {
    sessions: Number((await sql('SELECT count(*) FROM oc_assistant_chat_sns;'))[0]),
    messages: Number((await sql('SELECT count(*) FROM oc_assistant_chat_msgs;'))[0]),
    sessionTitlesAreFirstPrompt: Number((await sql("SELECT count(*) FROM oc_assistant_chat_sns WHERE title LIKE 'Tóm tắt%';"))[0]),
    messagesWithMarker: Number((await sql(`SELECT count(*) FROM oc_assistant_chat_msgs WHERE content LIKE '%Sông Hồng%';`))[0]),
  },
  openaiQuotaTable: await sql("SELECT left(user_id, 12) || '…', type, sum(units), count(*) FROM oc_openai_quota_usage GROUP BY 1,2 ORDER BY 1,2;"),
};
// Host Ollama log
try {
  const log = await readFile(join(homedir(), '.ollama', 'logs', 'server.log'), 'utf8');
  const lines = log.split('\n');
  out.ollamaServerLog = {
    path: '~/.ollama/logs/server.log',
    lines: lines.length,
    containsPromptMarker: log.includes(marker),
    containsInjectionAnswer: log.includes(injection),
    requestLineSample: lines.filter((l) => l.includes('[GIN]')).slice(-3).map((l) => l.replace(/\d+\.\d+\.\d+\.\d+/g, '<ip>')),
    // [GIN] date - time | status | latency | client ip | method "path"
    clientsSeen: [...new Set(lines.filter((l) => l.includes('[GIN]')).map((l) => l.split('|')[3]?.trim()).filter(Boolean))],
    statusesSeen: [...new Set(lines.filter((l) => l.includes('[GIN]')).map((l) => l.split('|')[1]?.trim()).filter(Boolean))],
    pathsSeen: [...new Set(lines.filter((l) => l.includes('[GIN]')).map((l) => (/"([^"]+)"/.exec(l) ?? [])[1]).filter(Boolean))],
  };
} catch (e) {
  out.ollamaServerLog = { error: String(e.message).slice(0, 120) };
}
// Harness audit
const harness = (await readFile(join(aiRoot, 'evidence', 'rag-audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
out.harnessAudit = { lines: harness.length, fields: Object.keys(harness[0] ?? {}), example: harness.find((h) => h.persona === 'member-b') };

await writeEvidence('audit-logs.json', out);
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
