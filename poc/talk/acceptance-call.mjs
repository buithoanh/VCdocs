// Chat17 acceptance: WebRTC calls between headless browsers on this machine
// (Google Chrome already installed; nothing downloaded), Talk internal
// signaling, no HPB, no STUN/TURN (host candidates only). Measures connection
// setup time; no load test.
//  A. 1-1 style call in the Team A group room: successor-a ↔ member-a, 5 rounds.
//  B. Small group call (mesh of 3): successor-a, member-a + one password guest
//     in a temporary public room.
//  C. Signaling ACL while a call runs: a non-member (manager-b) injects a
//     well-formed offer naming the callee's session → must not arrive.
// Each browser: own process + profile (git-ignored), CDP on loopback, fake
// camera/mic, Authorization injected by CDP for personas (guest: none).
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { connectCdpTarget } from '../work-management/cdp-client.mjs';
import { assert, client, ncBase, ocsData, readEvidence, resetBruteforce, secret, sessionClient, sleep, stats, talk, talkRoot, uidOf, writeEvidence } from './lib.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const harness = await readFile(join(talkRoot, 'call-harness.js'), 'utf8');
const conv = await readEvidence('conversations.json');
const run = Date.now().toString(36);
const ev = { run, browser: null };
const children = [];

async function launch(label, port, persona) {
  const profile = join(talkRoot, `chrome-profile-${label}`);
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });
  const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-features=MediaRouter,OptimizationHints', 'about:blank'], { stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ }
    await sleep(200);
  }
  if (!ev.browser) ev.browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connectCdpTarget(target);
  await cdp.send('Network.enable');
  if (persona) {
    const auth = `Basic ${Buffer.from(`${await uidOf(persona)}:${await secret(`app_password_${persona}`)}`).toString('base64')}`;
    await cdp.send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });
  }
  await cdp.send('Page.navigate', { url: `${ncBase}/status.php` });
  await sleep(800);
  await cdp.evaluate(harness);
  return { label, persona, cdp, close: () => { cdp.socket.close(); child.kill('SIGTERM'); } };
}
const js = (b, expr) => b.cdp.evaluate(expr);
const waitFor = async (b, expr, label, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await js(b, expr).catch(() => null); if (v) return v; await sleep(50); }
  throw new Error(`TIMEOUT:${label}:${JSON.stringify(await js(b, '({log: __talk17.log.map(l => ({at: l.at, what: l.what})), errors: __talk17.errors, received: __talk17.received.map(r => r.type), cand: Object.values(__talk17.peers).map(p => p.candidateTypes)})').catch(() => null)).slice(0, 3000)}`);
};
const nowIn = (b) => js(b, 'Math.round(performance.now() - __talk17.t0)');

try {
  await resetBruteforce();
  const a = await launch('a', 19271, 'successor-a');
  const b = await launch('b', 19272, 'member-a');
  const token = conv.teamA.token;
  ev.settings = await js(a, `__talk17.prepare(${JSON.stringify(token)})`);
  const prepB = await js(b, `__talk17.prepare(${JSON.stringify(token)})`);
  if (ev.settings.error || prepB.error) throw new Error(`PREPARE_FAILED:${JSON.stringify({ a: ev.settings, b: prepB })}`);

  // A. five rounds 1-1 in the group room.
  const rounds = [];
  for (let i = 0; i < 5; i += 1) {
    const tJoin = Date.now();
    const ja = await js(a, `__talk17.join(${JSON.stringify(token)})`);
    const jb = await js(b, `__talk17.join(${JSON.stringify(token)})`);
    const sessB = await js(b, '__talk17.session');
    await waitFor(a, `__talk17.users.some(u => u.sessionId === ${JSON.stringify(sessB)} && (u.inCall & 1))`, 'a-sees-b-in-call', 40000);
    const seenMs = Date.now() - tJoin;
    let intrusion = null;
    if (i === 0) {
      // C. signaling injection by a non-member while the call is being set up.
      const intruder = await sessionClient('manager-b');
      const fn = JSON.stringify({ to: sessB, sid: 'x', roomType: 'video', type: 'offer', payload: { type: 'offer', sdp: 'v=0\r\n' } });
      const body = new URLSearchParams({ messages: JSON.stringify([{ ev: 'message', fn, sessionId: sessB }]) }).toString();
      const res = await intruder.request('POST', talk.signaling(`/${token}`), { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const pull = await intruder.request('GET', talk.signaling(`/${token}`), { timeoutMs: 5000 }).catch((e) => ({ status: `ERR:${e.name}` }));
      intrusion = { postStatus: res.status, intruderPullStatus: pull.status };
    }
    const tOfferA = await nowIn(a);
    const tOfferWall = Date.now();
    await js(a, `__talk17.offer(${JSON.stringify(token)}, ${JSON.stringify(sessB)})`);
    await waitFor(a, `Object.values(__talk17.peers).some(p => p.pc.connectionState === 'connected')`, 'a-connected');
    const connectedMs = Date.now() - tOfferWall;
    await waitFor(b, `(async () => { const s = await __talk17.stats(); return Object.values(s).some(x => (x.inbound.video?.frames ?? 0) > 0); })()`, 'b-video-frames');
    const firstFrameMs = Date.now() - tOfferWall;
    await sleep(1500);
    const statsA = await js(a, '__talk17.stats()');
    const statsB = await js(b, '__talk17.stats()');
    const logA = await js(a, '__talk17.log');
    const recvB = await js(b, '__talk17.received');
    const pickA = (w) => logA.filter((l) => l.at >= tOfferA).find((l) => l.what === w)?.at;
    rounds.push({
      round: i + 1, roomJoin: ja.room, callJoin: ja.call, peerJoin: jb.call,
      joinUntilPeerVisibleMs: seenMs,
      offerToAnswerMs: pickA('answer-received') != null ? pickA('answer-received') - tOfferA : null,
      offerToConnectedMs: connectedMs,
      offerToFirstRemoteVideoFrameMs: firstFrameMs,
      joinToConnectedMs: seenMs + connectedMs,
      selectedPair: Object.values(statsA)[0]?.selectedPair ?? null,
      inboundB: Object.values(statsB)[0]?.inbound ?? null,
      candidateTypesA: Object.values(statsA)[0]?.candidateTypes ?? null,
      ...(intrusion ? { intrusion: { ...intrusion, calleeReceivedFrom: [...new Set(recvB.map((r) => r.from))].length, calleeReceivedTypes: recvB.map((r) => r.type) } } : {}),
    });
    await js(a, `__talk17.leave(${JSON.stringify(token)})`);
    await js(b, `__talk17.leave(${JSON.stringify(token)})`);
    await js(a, `__talk17.prepare(${JSON.stringify(token)})`);
    await js(b, `__talk17.prepare(${JSON.stringify(token)})`);
    await sleep(1500);
  }
  ev.oneToOne = {
    rounds,
    offerToConnectedMs: stats(rounds.map((r) => r.offerToConnectedMs)),
    offerToFirstRemoteVideoFrameMs: stats(rounds.map((r) => r.offerToFirstRemoteVideoFrameMs)),
    joinUntilPeerVisibleMs: stats(rounds.map((r) => r.joinUntilPeerVisibleMs)),
    joinToConnectedMs: stats(rounds.map((r) => r.joinToConnectedMs)),
  };

  // B. 3-party mesh with a password guest in a temporary public room.
  const owner = await client('successor-a');
  const pw = `Talk17-Goi-${run}-Pw!`;
  const room = ocsData(await owner.request('POST', talk.room(), { json: { roomType: 3, roomName: `talk17-goi-nhom-${run}`, password: pw } }));
  await owner.request('POST', talk.room(`/${room.token}/participants`), { json: { newParticipant: await uidOf('member-a'), source: 'users' } });
  const g = await launch('guest', 19273, null);
  const party = [a, b, g];
  for (const p of party) await js(p, `__talk17.prepare(${JSON.stringify(room.token)})`);
  const tGroup = Date.now();
  for (const p of party) await js(p, `__talk17.join(${JSON.stringify(room.token)}, ${p === g ? JSON.stringify(pw) : 'undefined'})`);
  const sessions = [];
  for (const p of party) sessions.push(await js(p, '__talk17.session'));
  await waitFor(a, `__talk17.users.filter(u => u.inCall & 1).length >= 3`, 'three-in-call', 40000);
  const tMesh = Date.now();
  await js(a, `__talk17.offer(${JSON.stringify(room.token)}, ${JSON.stringify(sessions[1])})`);
  await js(a, `__talk17.offer(${JSON.stringify(room.token)}, ${JSON.stringify(sessions[2])})`);
  await js(b, `__talk17.offer(${JSON.stringify(room.token)}, ${JSON.stringify(sessions[2])})`);
  for (const p of party) await waitFor(p, `Object.values(__talk17.peers).filter(x => x.pc.connectionState === 'connected').length >= 2`, `${p.label}-mesh`, 30000);
  const meshMs = Date.now() - tMesh;
  await sleep(1500);
  const meshStats = {};
  for (const p of party) meshStats[p.label] = Object.values(await js(p, '__talk17.stats()')).map((s) => ({ state: s.connectionState, videoFrames: s.inbound.video?.frames ?? 0, audioPackets: s.inbound.audio?.packets ?? 0, pair: s.selectedPair?.localType }));
  ev.groupCall = { participants: ['successor-a', 'member-a', 'guest (password)'], joinToAllVisibleMs: tMesh - tGroup, firstOfferToFullMeshMs: meshMs, streamsPerParticipant: 2, meshStats };
  for (const p of party) await js(p, `__talk17.leave(${JSON.stringify(room.token)})`);
  await owner.request('DELETE', talk.room(`/${room.token}`));
  await writeEvidence('acceptance-call.json', ev);
  console.log(JSON.stringify({ browser: ev.browser, settings: ev.settings, oneToOne: { ...ev.oneToOne, rounds: ev.oneToOne.rounds.map((r) => ({ r: r.round, peer: r.joinUntilPeerVisibleMs, ans: r.offerToAnswerMs, conn: r.offerToConnectedMs, frame: r.offerToFirstRemoteVideoFrameMs, pair: r.selectedPair, intr: r.intrusion })) }, groupCall: ev.groupCall }, null, 1));
  assert(rounds.every((r) => r.selectedPair && (r.inboundB?.video?.frames ?? 0) > 0), 'media flows host-to-host', rounds);
  // Only the caller's session ever reached the callee, with exactly one offer
  // (the caller's); the intruder's offer naming the callee was dropped.
  assert(rounds[0].intrusion.calleeReceivedFrom === 1 && rounds[0].intrusion.calleeReceivedTypes.filter((t) => t === 'offer').length === 1 && rounds[0].intrusion.intruderPullStatus === 404, 'intruder offer not delivered', rounds[0].intrusion);
  assert(Object.values(meshStats).every((list) => list.length === 2 && list.every((s) => s.state === 'connected' && s.videoFrames > 0)), 'mesh of 3 connected', meshStats);
} finally {
  for (const c of children) c.kill('SIGTERM');
  await sleep(500);
  for (const label of ['a', 'b', 'guest']) await rm(join(talkRoot, `chrome-profile-${label}`), { recursive: true, force: true });
}
