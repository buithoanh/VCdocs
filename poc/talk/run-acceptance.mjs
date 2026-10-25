// Chat17: run the live acceptance scripts in order (after setup), stop at the
// first failure. Restart/backup/restore are separate (see README).
import { execFileSync } from 'node:child_process';
import { talkRoot } from './lib.mjs';

const scripts = ['acceptance-chat.mjs', 'acceptance-files.mjs', 'acceptance-guest.mjs', 'acceptance-calendar.mjs', 'acceptance-flow-events.mjs', 'acceptance-call.mjs', ['verify-acl.mjs', 'live'], 'acceptance-offboard.mjs', 'verify-isolation.mjs'];
for (const s of scripts) {
  const args = Array.isArray(s) ? s : [s];
  const t0 = Date.now();
  try {
    execFileSync('node', args, { cwd: talkRoot, stdio: ['ignore', 'ignore', 'pipe'] });
    console.log(`PASS ${args.join(' ')} (${Date.now() - t0} ms)`);
  } catch (error) {
    console.log(`FAIL ${args.join(' ')}: ${String(error.stderr ?? error.message).split('\n').filter((l) => /Error|ASSERT/.test(l)).slice(0, 3).join(' | ').slice(0, 1500)}`);
    process.exit(1);
  }
}
