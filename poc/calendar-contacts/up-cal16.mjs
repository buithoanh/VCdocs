// Chat16: start the compose.cal16.yaml overlay. The Stalwart recovery admin is
// passed through the child environment only (never argv, never printed).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { calRoot, secret } from './lib.mjs';

const args = process.argv.slice(2);
const allowed = [['up', '-d'], ['restart'], ['ps'], ['stop']];
if (!allowed.some((a) => a.join(' ') === args.slice(0, a.length).join(' '))) throw new Error(`UNSUPPORTED:${args.join(' ')}`);
const env = { ...process.env, STALWART_RECOVERY_ADMIN: `admin16:${await secret('stalwart_recovery_password')}` };
const result = spawnSync('docker', ['compose', '-f', join(calRoot, 'compose.cal16.yaml'), ...args], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
