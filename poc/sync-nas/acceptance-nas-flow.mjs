// Chat15 × Flow chat14 on the SMB mount NAS-TeamA/Flow14-HoSo:
//  (a) member-a uploads through Nextcloud (WebDAV) → Node*Event webhook → receiver
//      tag_verified; Flow core tags + access control apply on the SMB storage.
//  (b) nas-member-a writes directly on the NAS (SMB) → does any webhook fire?
//      (captured unfiltered on the internal hook-sink) → Flow core tag? access?
//      → receiver folder reconciliation (chat15) picks it up: tag_missing.
//  (c) rename on the NAS → new fileid → reconciled again.
//  (d) NAS-filesystem write + `occ files:scan` (notify stopped) → webhook?
// Receiver: chat14 gated Jest spec (Google giả, MongoDB local 127.0.0.1:18141).
import { adminRequest, ocsData } from '../flow/lib.mjs';
import { receiverEnv, startReceiver, vcLogin } from '../flow/receiver-lib.mjs';
import { registerWebhooks } from '../flow/register-webhooks.mjs';
import { client, davPath, docker, fileId, nasContainer, notifyContainer, occ, resetBruteforce, sleep, smb, smbClientContainer, stats, waitUntil, writeEvidence } from './lib.mjs';

await resetBruteforce();
const m = `flow15-${Date.now()}`;
const folder = 'NAS-TeamA/Flow14-HoSo';
const owner = await client('successor-a');
const member = await client('member-a');
const managerB = await client('manager-b');
const outsider = await client('outsider');
await owner.request('MKCOL', davPath(owner, folder));

// Webhook phụ, không lọc, tới hook-sink nội bộ: chỉ để xem Nextcloud phát gì khi thay đổi đến từ NAS
const admin = await adminRequest();
const api = '/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks';
const sinkUri = 'http://hook-sink:8080/sync15-capture';
for (const hook of ocsData(await admin('GET', `${api}?format=json`)) ?? []) if (hook.uri === sinkUri) await admin('DELETE', `${api}/${hook.id}?format=json`);
const sinkHooks = {};
for (const event of ['OCP\\Files\\Events\\Node\\NodeCreatedEvent', 'OCP\\Files\\Events\\Node\\NodeWrittenEvent', 'OCP\\Files\\Events\\Node\\NodeRenamedEvent', 'OCP\\Files\\Events\\Node\\NodeDeletedEvent', 'OCP\\Files\\Events\\NodeAddedToCache', 'OCP\\Files\\Events\\FileCacheUpdated', 'OCP\\Files\\Events\\NodeRemovedFromCache']) {
  const r = await admin('POST', `${api}?format=json`, { httpMethod: 'POST', uri: sinkUri, event, authMethod: 'none' });
  sinkHooks[event.split('\\').pop()] = r.status === 200 ? { registered: true, id: ocsData(r).id } : { registered: false, status: r.status, message: String(JSON.stringify(r.data)).slice(0, 160) };
}
const sinkLog = async () => (await docker('exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log').catch(() => ({ stdout: '' }))).stdout;
const sinkStart = (await sinkLog()).length;
const sinkSince = async () => (await sinkLog()).slice(sinkStart);

const ncLogFailures = async () => (await docker('exec', 'vcworkspace-work13-nextcloud-1', 'grep', '-c', 'flow-receiver-relay', '/var/www/html/data/nextcloud.log').catch((e) => ({ stdout: e.stdout ?? '0' }))).stdout.trim();
const failuresBefore = Number(await ncLogFailures());
const base = await receiverEnv();
const rules = JSON.parse(base.FLOW14_RULES_JSON);
rules.push({ id: 'nas-hoso', kind: 'files.verify-tag', runner: 'runner', folderPath: folder, tagName: 'flow14-hoso', reconcile: true });
const receiver = await startReceiver({ FLOW14_RULES_JSON: JSON.stringify(rules), FLOW14_RECONCILE_MS: '2000', FLOW14_RETRY_BASE_MS: '500' });
const result = { marker: m, folder, sinkHooks };
try {
  const it = await vcLogin('it@vcprosperous.com');
  await registerWebhooks();
  const journal = async (id) => (await it(`/flow/events?resourceKey=${encodeURIComponent(`files:node:${id}`)}&limit=20&sort=receivedAt`)).data?.items ?? [];
  const finalOf = async (id, timeoutMs = 30_000) => (await waitUntil(`journal ${id}`, async () => {
    const items = await journal(id);
    return items.length && items.every((e) => ['done', 'skipped', 'failed'].includes(e.status)) ? items : null;
  }, { timeoutMs, intervalMs: 200 })).value ?? await journal(id);
  const summarize = (items) => items.map((e) => ({ source: e.source, eventClass: e.eventClass.split('\\').pop(), status: e.status, outcomes: e.results.map((r) => `${r.ruleId}:${r.outcome}`) }));
  const tagsOf = async (id) => [...String((await owner.request('PROPFIND', `/remote.php/dav/systemtags-relations/files/${id}`, { body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:display-name/></d:prop></d:propfind>', headers: { Depth: '1', 'Content-Type': 'application/xml' } })).data).matchAll(/<oc:display-name>([^<]*)<\/oc:display-name>/g)].map((x) => x[1]);
  await sleep(3000); // lượt đối soát đầu = ảnh chụp gốc

  // (a) qua Nextcloud
  const viaNc = {};
  for (const name of [`${m}-webdav.txt`, `${m}-webdav-mat.txt`]) {
    const t0 = Date.now();
    const put = await member.request('PUT', davPath(member, `${folder}/${name}`), { body: `webdav ${name}\n` });
    const id = await fileId(owner, `${folder}/${name}`);
    const items = await finalOf(id);
    viaNc[name.endsWith('-mat.txt') ? 'mat' : 'plain'] = { put: put.status, fileId: id, journal: summarize(items), doneAfterMs: Math.max(...items.map((e) => Date.parse(e.finishedAt) - t0)) };
  }
  await resetBruteforce();
  const read = async (actor, name) => (await actor.request('GET', davPath(actor, `${folder}/${name}`), { raw: true })).status;
  viaNc.access = {
    ownerMat: await read(owner, `${m}-webdav-mat.txt`), memberMat: await read(member, `${m}-webdav-mat.txt`), memberPlain: await read(member, `${m}-webdav.txt`),
    managerB: (await managerB.request('GET', davPath(managerB, `${folder}/${m}-webdav.txt`), { raw: true })).status,
    outsider: (await outsider.request('GET', davPath(outsider, `${folder}/${m}-webdav.txt`), { raw: true })).status,
  };
  result.viaNextcloud = viaNc;

  // (b) trực tiếp trên NAS qua SMB (notify đang chạy)
  const viaNas = {};
  for (const name of [`${m}-nas.txt`, `${m}-nas-mat.txt`]) {
    await docker('exec', smbClientContainer, 'dd', 'if=/dev/urandom', `of=/work/${name}`, 'bs=1024', 'count=2', 'status=none');
    const t0 = Date.now();
    await smb('nas-member-a', 'team-a', `cd Flow14-HoSo; put /work/${name} ${name}`);
    const seen = await waitUntil('visible', async () => fileId(owner, `${folder}/${name}`), { timeoutMs: 20_000, intervalMs: 200 });
    const items = await finalOf(seen.value, 30_000);
    viaNas[name.endsWith('-mat.txt') ? 'mat' : 'plain'] = { discoveredBy: 'notify + PROPFIND Depth 0 trên đúng file (URL chứa /Flow14-HoSo/)', fileId: seen.value, tags: await tagsOf(seen.value), visibleInNextcloudMs: seen.ms, journal: summarize(items), reconciledDoneAfterMs: items.length ? Math.max(...items.map((e) => Date.parse(e.finishedAt) - t0)) : null };
  }
  await resetBruteforce();
  viaNas.access = {
    memberReadsNasMatViaWebdav: await read(member, `${m}-nas-mat.txt`),
    ownerReadsNasMatViaWebdav: await read(owner, `${m}-nas-mat.txt`),
    nasMemberReadsWebdavMatViaSmb: (await smb('nas-member-a', 'team-a', `cd Flow14-HoSo; get ${m}-webdav-mat.txt /work/leak.txt`)).ok ? 'ALLOWED (SMB không qua Flow core)' : 'DENIED',
    managerB: (await managerB.request('GET', davPath(managerB, `${folder}/${m}-nas.txt`), { raw: true })).status,
  };
  result.viaNasSmb = viaNas;

  // (c) đổi tên trên NAS
  {
    const before = viaNas.plain.fileId;
    await smb('nas-member-a', 'team-a', `cd Flow14-HoSo; rename ${m}-nas.txt ${m}-nas-renamed.txt`);
    const seen = await waitUntil('renamed visible', async () => fileId(owner, `${folder}/${m}-nas-renamed.txt`), { timeoutMs: 20_000, intervalMs: 200 });
    const items = await finalOf(seen.value, 30_000);
    result.renameOnNas = { fileIdBefore: before, fileIdAfter: seen.value, newFileId: seen.value !== before, journalNewId: summarize(items) };
  }

  // (d) ghi trên filesystem NAS khi notify tắt, rồi occ files:scan (CLI: không có URL request)
  // (e) ghi qua SMB rồi được phát hiện bởi PROPFIND Depth:infinity từ NAS-TeamA (URL không chứa thư mục)
  {
    await docker('stop', notifyContainer);
    const discovered = {};
    try {
      for (const name of [`${m}-scan.txt`, `${m}-scan-mat.txt`]) {
        await docker('exec', '-u', 'nas-member-a', nasContainer, 'dd', 'if=/dev/urandom', `of=/srv/nas/team-a/Flow14-HoSo/${name}`, 'bs=1024', 'count=1', 'status=none');
      }
      const t0 = Date.now();
      await occ('files:scan', `--path=/${owner.uid}/files/${folder}`);
      const scanMs = Date.now() - t0;
      for (const name of [`${m}-scan.txt`, `${m}-scan-mat.txt`]) {
        const id = await fileId(owner, `${folder}/${name}`);
        discovered[name.endsWith('-mat.txt') ? 'scanMat' : 'scanPlain'] = { discoveredBy: 'occ files:scan', scanMs, fileId: id, tags: await tagsOf(id), journal: summarize(await finalOf(id, 30_000)), memberRead: await read(member, name) };
      }
      await sleep(1100);
      for (const name of [`${m}-deep.txt`, `${m}-deep-mat.txt`]) {
        await docker('exec', smbClientContainer, 'dd', 'if=/dev/urandom', `of=/work/${name}`, 'bs=1024', 'count=1', 'status=none');
        await smb('nas-member-a', 'team-a', `cd Flow14-HoSo; put /work/${name} ${name}`);
      }
      await sleep(1100);
      const deep = await member.request('PROPFIND', davPath(member, 'NAS-TeamA'), { headers: { Depth: 'infinity' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' });
      for (const name of [`${m}-deep.txt`, `${m}-deep-mat.txt`]) {
        const id = await fileId(owner, `${folder}/${name}`);
        discovered[name.endsWith('-mat.txt') ? 'deepMat' : 'deepPlain'] = { discoveredBy: `PROPFIND Depth:infinity /NAS-TeamA (${deep.status}) bởi member-a, notify tắt`, fileId: id, tags: await tagsOf(id), journal: summarize(await finalOf(id, 30_000)), memberRead: await read(member, name) };
      }
    } finally {
      await docker('start', notifyContainer);
    }
    result.discoveryPaths = discovered;
  }

  await sleep(3000);
  const captured = await sinkSince();
  const mentions = (needle) => captured.split('--END--').filter((b) => b.includes(needle)).map((b) => /"class":"([^"]+)"/.exec(b.replaceAll('\\\\', '\\'))?.[1] ?? 'unknown');
  result.webhooksCapturedOnSink = {
    viaWebdavPlain: mentions(`${m}-webdav.txt`),
    viaNasSmbPlain: mentions(`${m}-nas.txt`),
    viaNasSmbMat: mentions(`${m}-nas-mat.txt`),
    viaNasRename: mentions(`${m}-nas-renamed.txt`),
    viaNasFsScan: [...mentions(`${m}-scan.txt`), ...mentions(`${m}-scan-mat.txt`)],
    viaDeepPropfind: [...mentions(`${m}-deep.txt`), ...mentions(`${m}-deep-mat.txt`)],
  };
  const nasEvents = Object.entries(result.webhooksCapturedOnSink).filter(([k]) => k !== 'viaWebdavPlain').flatMap(([, v]) => v);
  const outcome = (entry, rule) => entry.journal.flatMap((e) => e.outcomes).find((o) => o.startsWith(`${rule}:`))?.split(':')[1];
  const checks = {
    webdavTagVerified: outcome(viaNc.plain, 'nas-hoso') === 'tag_verified' && outcome(viaNc.mat, 'nas-hoso') === 'tag_verified',
    flowCoreDenyOnSmbMount: viaNc.access.memberMat >= 400 && viaNc.access.ownerMat === 200 && viaNc.access.memberPlain === 200,
    teamBOutsiderDenied: viaNc.access.managerB === 404 && viaNc.access.outsider === 404 && viaNas.access.managerB === 404,
    nasChangesEmitNoNodeWebhook: nasEvents.every((c) => !c.includes('\\Node\\')),
    nasChangesReconciled: [viaNas.plain, viaNas.mat, ...Object.values(result.discoveryPaths)].every((x) => x.journal.some((e) => e.source === 'reconcile') && ['tag_verified', 'tag_missing'].includes(outcome(x, 'nas-hoso'))),
    renameReconciled: result.renameOnNas.newFileId && result.renameOnNas.journalNewId.some((e) => e.source === 'reconcile'),
  };
  const d = result.discoveryPaths;
  result.findings = {
    smbBypassesFlowCore: viaNas.access.nasMemberReadsWebdavMatViaSmb.startsWith('ALLOWED'),
    // Flow core gắn tag lúc Nextcloud "thấy" file: điều kiện RequestURL chỉ khớp khi request phát hiện có URL chứa thư mục
    tagsByDiscoveryPath: Object.fromEntries([['notifyThenFilePropfind', viaNas.plain], ['notifyThenFilePropfindMat', viaNas.mat], ...Object.entries(d)].map(([k, v]) => [k, { tags: v.tags, receiver: outcome(v, 'nas-hoso'), memberRead: v.memberRead ?? null }])),
    receiverFlagsMissingTag: Object.values(d).some((v) => outcome(v, 'nas-hoso') === 'tag_missing'),
  };
  result.latency = { webdavDoneMs: stats([viaNc.plain.doneAfterMs, viaNc.mat.doneAfterMs]), nasReconciledDoneMs: stats([viaNas.plain.reconciledDoneAfterMs, viaNas.mat.reconciledDoneAfterMs]) };
  result.webhookDeliveryFailuresDuringRun = Number(await ncLogFailures()) - failuresBefore;
  result.checks = checks;
  result.result = Object.values(checks).every(Boolean) ? 'LOCAL PASS' : 'FAIL';
} finally {
  await receiver.stop();
  for (const hook of Object.values(sinkHooks)) if (hook.registered) await admin('DELETE', `${api}/${hook.id}?format=json`);
}
await writeEvidence('acceptance-nas-flow.json', result);
console.log(JSON.stringify(result, null, 1));
if (result.result !== 'LOCAL PASS') throw new Error('NAS_FLOW_FAILED');
