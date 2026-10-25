// Chat17: the real Talk web client in headless Chrome (no OIDC: the session is
// opened with the persona's app password via HTTP Basic, injected by CDP —
// Nextcloud accepts Basic auth on any route). Member opens /call/<Team A>,
// outsider opens the same link. Screenshots + visible text go to evidence/.
// Then the member and successor click the UI "Start/Join call" buttons and we
// watch RTCPeerConnection objects created by the Talk client itself.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectCdpTarget } from '../work-management/cdp-client.mjs';
import { ncBase, readEvidence, resetBruteforce, secret, sleep, talkRoot, uidOf, writeEvidence } from './lib.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const conv = await readEvidence('conversations.json');
const children = [];
const ev = {};
const hook = `(() => { const O = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push({ pc, at: performance.now() }); return pc; }; window.RTCPeerConnection.prototype = O.prototype; })();`;

async function open(label, port, persona) {
  const profile = join(talkRoot, `chrome-profile-ui-${label}`);
  await rm(profile, { recursive: true, force: true });
  await mkdir(profile, { recursive: true });
  const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* */ } await sleep(200); }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connectCdpTarget(target);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  // Talk flags "HeadlessChrome" as unsupported; present the normal Chrome UA.
  const { userAgent } = await cdp.send('Browser.getVersion');
  await cdp.send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') });
  const auth = `Basic ${Buffer.from(`${await uidOf(persona)}:${await secret(`app_password_${persona}`)}`).toString('base64')}`;
  await cdp.send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });
  return { cdp, label };
}
const text = (b) => b.cdp.evaluate('document.body ? document.body.innerText.slice(0, 2000) : ""');
const shot = async (b, name) => {
  const { data } = await b.cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(talkRoot, 'evidence', name), Buffer.from(data, 'base64'));
};
const clickByText = (b, re, last = false) => b.cdp.evaluate(`(() => { const all=[]; const walk=r=>{for(const e of r.querySelectorAll('button,[role=button]')){all.push(e)} for(const e of r.querySelectorAll('*')) if(e.shadowRoot) walk(e.shadowRoot)}; walk(document); const el = all.${last ? "findLast" : "find"}(e => ${re}.test((e.innerText||e.getAttribute('aria-label')||'').trim()) && e.offsetParent !== null && !e.disabled); if (!el) return null; el.click(); return (el.innerText||el.getAttribute('aria-label')).trim().slice(0,60); })()`);

try {
  await resetBruteforce();
  const member = await open('member', 19281, 'member-a');
  const outsider = await open('outsider', 19282, 'outsider');
  const url = `${ncBase}/call/${conv.teamA.token}`;
  const t0 = Date.now();
  await member.cdp.send('Page.navigate', { url });
  await outsider.cdp.send('Page.navigate', { url });
  let memberText = '';
  for (let i = 0; i < 80 && !memberText.includes('talk17-team-a'); i += 1) { await sleep(250); memberText = await text(member).catch(() => ''); }
  ev.memberUi = { loadedMs: Date.now() - t0, showsRoomName: memberText.includes('talk17-team-a'), title: await member.cdp.evaluate('document.title') };
  await sleep(1500);
  const outsiderText = await text(outsider).catch(() => '');
  ev.outsiderUi = { showsRoomName: outsiderText.includes('talk17-team-a'), showsMessages: outsiderText.includes('talk17'), excerpt: outsiderText.replace(/\s+/g, ' ').slice(0, 240), title: await outsider.cdp.evaluate('document.title') };
  await shot(member, 'browser-member-a-team-a.png');
  await shot(outsider, 'browser-outsider-team-a.png');

  // Real client call: successor-a starts, member-a joins (UI buttons).
  const owner = await open('owner', 19283, 'successor-a');
  await owner.cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i += 1) { await sleep(250); if ((await text(owner).catch(() => '')).includes('talk17-team-a')) break; }
  const clicks = [];
  const tCall = Date.now();
  for (let i = 0; i < 30; i += 1) {
    const c = await clickByText(owner, /^(Start call|Join call|Bắt đầu cuộc gọi|Tham gia cuộc gọi)$/i);
    if (c) { clicks.push(['owner', c]); break; }
    await sleep(500);
  }
  await sleep(1500);
  clicks.push(["owner-dialog", await clickByText(owner, /^(Start call|Join call|Join now|Bắt đầu cuộc gọi|Tham gia cuộc gọi|Tham gia ngay)$/i, true)]);
  await sleep(2500);
  const buttons = (b) => b.cdp.evaluate(`[...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60)`);
  ev.ownerButtonsAfterStart = await buttons(owner);
  for (let i = 0; i < 20; i += 1) {
    const c = await clickByText(member, /^(Join call|Start call|Tham gia cuộc gọi|Bắt đầu cuộc gọi)$/i);
    if (c) { clicks.push(['member', c]); break; }
    await sleep(500);
  }
  await sleep(1500);
  ev.memberButtonsBeforeDialog = await buttons(member);
  clicks.push(["member-dialog", await clickByText(member, /^(Join call|Join now|Start call|Tham gia cuộc gọi|Tham gia ngay|Bắt đầu cuộc gọi)$/i, true)]);
  let pcState = null;
  for (let i = 0; i < 60; i += 1) {
    pcState = await member.cdp.evaluate('window.__pcs.map(p => p.pc.connectionState)').catch(() => null);
    if (pcState?.includes('connected')) break;
    await sleep(250);
  }
  ev.uiCall = { clicks, memberPeerConnections: pcState, ownerPeerConnections: await owner.cdp.evaluate('window.__pcs.map(p => p.pc.connectionState)').catch(() => null), clickToConnectedMs: pcState?.includes('connected') ? Date.now() - tCall : null };
  await shot(member, 'browser-member-a-call.png');
  await writeEvidence('browser-ui.json', ev);
  console.log(JSON.stringify(ev, null, 1));
} finally {
  for (const c of children) c.kill('SIGTERM');
  await sleep(500);
  for (const l of ['member', 'outsider', 'owner']) await rm(join(talkRoot, `chrome-profile-ui-${l}`), { recursive: true, force: true });
}
