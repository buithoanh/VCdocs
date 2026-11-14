import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * WebDAV giả tối thiểu trên loopback: đủ PROPFIND/MKCOL/PUT/GET/MOVE cho Drive cơ bản.
 * `accounts` là uid → app password đang hợp lệ (đổi được giữa test để giả lập xoay/thu hồi).
 */
export function fakeWebdav(accounts: Record<string, string>) {
  const objects = new Map<string, Buffer | 'dir'>();
  const auth: string[] = [];
  const body = (req: IncomingMessage) => new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const server: Server = createServer(async (req, res) => {
    auth.push(String(req.headers.authorization));
    const path = decodeURI(new URL(req.url!, 'http://x').pathname);
    const bytes = await body(req);
    const done = (status: number, data?: Buffer) => { res.statusCode = status; res.end(data); };
    const [user, pass] = Buffer.from(String(req.headers.authorization).replace(/^Basic /, ''), 'base64').toString().split(':');
    if (!user || accounts[user] === undefined || accounts[user] !== pass || !path.startsWith(`/remote.php/dav/files/${user}/`)) return done(401);
    if (req.method === 'PROPFIND') return done(objects.has(path) ? 207 : 404);
    if (req.method === 'MKCOL') { if (objects.has(path)) return done(405); objects.set(path, 'dir'); return done(201); }
    if (req.method === 'PUT') { if (objects.has(path)) return done(412); objects.set(path, bytes); return done(201); }
    if (req.method === 'GET') { const v = objects.get(path); return v && v !== 'dir' ? done(200, v) : done(404); }
    if (req.method === 'MOVE') {
      const to = decodeURI(new URL(String(req.headers.destination)).pathname);
      for (const [k, v] of [...objects]) if (k === path || k.startsWith(path + '/')) { objects.delete(k); objects.set(to + k.slice(path.length), v); }
      return done(201);
    }
    done(405);
  });
  return {
    server, objects, auth, accounts,
    start: () => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))),
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}
