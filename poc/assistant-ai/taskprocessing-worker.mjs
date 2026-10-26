// Chat19: dedicated TaskProcessing worker (docs: "regularly restart the worker
// with --timeout"). Without it, Assistant tasks only run with the cron
// background job (every 5 min in work13). Runs `occ taskprocessing:worker -t 300`
// in a loop inside the work13 Nextcloud container until killed; logs one line
// per processed task (task id / type, no input or output) to stdout.
import { spawn } from 'node:child_process';
import { ncContainer } from './lib.mjs';

let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
while (!stop) {
  await new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-u', 'www-data', ncContainer, 'php', 'occ', '--no-ansi', 'taskprocessing:worker', '-t', '300', '-i', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => process.stdout.write(`[${new Date().toISOString()}] ${d}`));
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('exit', resolve);
  });
}
