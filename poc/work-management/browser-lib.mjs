import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { connectCdpTarget } from './cdp-client.mjs';
import { akBase, ncBase, root, secret } from './lib.mjs';

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdpPort = process.env.CDP_PORT || '19241';

// Fresh headless Chrome with its own git-ignored profile, CDP bound to loopback.
export async function launchChrome() {
  const profile = join(root, 'chrome-profile');
  await mkdir(profile, { recursive: true });
  const child = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connectCdpTarget(target);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  return { cdp, close: () => { cdp.socket.close(); child.kill('SIGTERM'); } };
}

export async function waitFor(cdp, predicate, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await cdp.evaluate(predicate);
      if (value) return value;
    } catch { /* page navigating */ }
    await sleep(250);
  }
  const where = await cdp.evaluate('location.href + " | " + document.title + " | " + (document.body?.innerText || "").slice(0, 300)').catch(() => 'unknown');
  throw new Error(`BROWSER_TIMEOUT:${label}:${where}`);
}

const visibleInput = (name) => `(() => { const all=[]; const walk=r=>{for(const e of r.querySelectorAll('*')){all.push(e);if(e.shadowRoot)walk(e.shadowRoot)}};walk(document);return all.some(e=>e.matches?.('input[name="${name}"]') && e.offsetParent !== null) })()`;
const fillAndSubmit = (name, value) => `(() => {
  const all = [];
  const walk = (root) => { for (const element of root.querySelectorAll('*')) { all.push(element); if (element.shadowRoot) walk(element.shadowRoot); } };
  walk(document);
  const input = all.find((element) => element.matches?.('input[name="${name}"]') && element.offsetParent !== null);
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  const button = all.find((element) => element.matches?.('button[type="submit"]') && element.offsetParent !== null);
  if (!button) return false;
  button.click();
  return true;
})()`;

export async function clearBrowser(cdp) {
  // Leave the app page first: its in-flight XHRs could otherwise re-set a
  // session cookie after the clear and break the next OIDC state check.
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  await cdp.send('Network.clearBrowserCookies');
  for (const origin of [ncBase, akBase]) await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
}

// Authorization-code login through Authentik's real form; returns the
// Nextcloud OCS view of the signed-in account.
export async function loginNextcloud(cdp, username) {
  await clearBrowser(cdp);
  const password = await secret(username === 'outsider' ? 'persona_outsider_password' : `persona_${username}_password`);
  await cdp.send('Page.navigate', { url: `${ncBase}/apps/user_oidc/login/1` });
  await waitFor(cdp, visibleInput('uidField'), `${username}-identifier`);
  if (!await cdp.evaluate(fillAndSubmit('uidField', username))) throw new Error(`IDENTIFIER_NOT_FILLED:${username}`);
  await waitFor(cdp, visibleInput('password'), `${username}-password`);
  if (!await cdp.evaluate(fillAndSubmit('password', password))) throw new Error(`PASSWORD_NOT_FILLED:${username}`);
  await waitFor(cdp, `location.hostname === 'nc13.localtest.me' && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/apps/user_oidc')`, `${username}-callback`, 40000);
  return currentUser(cdp);
}

export async function currentUser(cdp) {
  const response = await cdp.evaluate(`fetch('/ocs/v2.php/cloud/user?format=json', {headers:{'OCS-APIRequest':'true'}}).then(async r => ({status:r.status, body: r.status === 200 ? await r.json() : null}))`);
  const data = response.body?.ocs?.data;
  return { status: response.status, id: data?.id, email: data?.email, displayName: data?.['display-name'] ?? data?.displayname, groups: data?.groups ?? [] };
}

// Same-origin fetch from the signed-in page: cookie session + CSRF request token,
// exactly what the app UI itself would send.
export async function pageFetch(cdp, method, path, body) {
  return cdp.evaluate(`(async () => { try {
    const token = window.OC?.requestToken || document.head.dataset.requesttoken || '';
    const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'same-origin', cache: 'no-store',
      headers: { requesttoken: token, 'OCS-APIRequest': 'true', Accept: 'application/json', ${body ? "'Content-Type': 'application/json'" : ''} },
      ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''} signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    return { status: r.status, text: text.slice(0, 2000) };
  } catch (error) { return { status: 0, text: String(error) }; } })()`);
}

export async function screenshot(cdp) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(shot.data, 'base64');
}
