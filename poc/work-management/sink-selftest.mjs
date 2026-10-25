// Self-test of the internal webhook sink: POST a probe from the Nextcloud
// container (same network path a webhook uses) and read it back.
import { execFileAsync, ncContainer } from './lib.mjs';

const probe = `sink-probe-${Date.now()}`;
const { stdout: reply } = await execFileAsync('docker', ['exec', ncContainer, 'curl', '-s', '-m', '5', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify({ probe }), 'http://hook-sink:8080/selftest']);
const { stdout: log } = await execFileAsync('docker', ['exec', 'vcworkspace-work13-hook-sink-1', 'cat', '/sink/requests.log']);
const entry = log.split('--END--').find((item) => item.includes(probe));
if (reply !== 'ok' || !entry || !entry.includes('\r\n\r\n')) throw new Error(`SINK_SELFTEST_FAILED:${JSON.stringify(reply)}:${Boolean(entry)}`);
console.log('Sink self-test PASS: request headers and JSON body recorded, 200 returned.');
