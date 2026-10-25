// Print the last N Nextcloud log entries (time, level, url, message) for debugging.
import { execFileAsync, ncContainer } from './lib.mjs';

const lines = process.argv[2] || '30';
const { stdout } = await execFileAsync('docker', ['exec', ncContainer, 'tail', '-n', lines, '/var/www/html/data/nextcloud.log'], { maxBuffer: 20 * 1024 * 1024 });
for (const line of stdout.split('\n')) {
  try {
    const entry = JSON.parse(line);
    console.log(entry.time, entry.level, entry.url?.slice(0, 60), entry.message?.slice(0, 240), entry.exception?.Message?.slice(0, 200) ?? '');
  } catch { /* partial line */ }
}
