import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const token = (await readFile(join(root, 'secrets', 'portal_control_token'), 'utf8')).trim();
const compose = ['compose', '-p', 'vcworkspace-identity12', '-f', join(root, 'compose.yaml'), 'exec', '-T', '-u', 'www-data', 'nextcloud', 'php', 'occ'];
async function occ(args) { return exec('docker', [...compose, ...args], { timeout: 15_000, maxBuffer: 1024 * 1024 }); }
async function list(userId) {
  const { stdout } = await occ(['user:auth-tokens:list', '--output=json', '--no-interaction', userId]);
  const parsed = JSON.parse(stdout || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/revoke' || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(request.headers.authorization ? 404 : 401).end(); return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { userId } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!/^[a-f0-9]{64}$/.test(String(userId))) throw new Error('USER_ID_INVALID');
    const before = await list(userId);
    for (const item of before) {
      if (!Number.isInteger(item.id)) throw new Error('TOKEN_ID_INVALID');
      await occ(['user:auth-tokens:delete', '--no-interaction', userId, String(item.id)]);
    }
    const remaining = await list(userId);
    // Nextcloud PublicKeyTokenProvider giữ invalid-token cache tối đa 10 giây.
    // Chỉ ACK coordinator sau khi cửa sổ cache cũ đã qua.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ userId, revokedTokens: before.length, remainingTokens: remaining.length, cacheSettled: true }));
  } catch (error) {
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 'NEXTCLOUD_TOKEN_CONTROL_FAILED' }));
  }
});
server.listen(18127, '127.0.0.1', () => console.log('Nextcloud token control ready on 127.0.0.1:18127; no secret printed.'));
