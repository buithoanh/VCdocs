// Wait until Authentik accepts the bootstrap token and Nextcloud answers
// status.php through the loopback relays (max 6 minutes).
import { akBase, ncBase, secret } from './lib.mjs';

const deadline = Date.now() + 360000;
const token = await secret('ak_bootstrap_token');
async function ready() {
  try {
    const ak = await fetch(`${akBase}/api/v3/core/users/me/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    const nc = await fetch(`${ncBase}/status.php`, { signal: AbortSignal.timeout(5000) });
    return ak.status === 200 && nc.status === 200 && (await nc.json()).installed === true;
  } catch { return false; }
}
while (!(await ready())) {
  if (Date.now() > deadline) throw new Error('STACK_NOT_READY');
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
console.log('Stack ready: Authentik API and Nextcloud status.php answer through loopback.');
