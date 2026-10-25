/**
 * Audit 4/12: nhập tài liệu ngoài theo url không được tải địa chỉ nội bộ.
 * Chỉ dùng fixture trên 127.0.0.1 do test tự dựng, chứng chỉ tự ký tạo riêng cho test; không gọi Internet.
 */
import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { isBlockedAddress, safeFetch, urlProblem } from '../src/common/safe-url';

const MARKER = 'NOI-BO-BI-LO-audit04';

type Fixture = { server: http.Server | https.Server; port: number; hits: string[] };

function listen(server: http.Server | https.Server, onRequest: (req: http.IncomingMessage, res: http.ServerResponse, f: Fixture) => void): Promise<Fixture> {
  const f: Fixture = { server, port: 0, hits: [] };
  server.on('request', (req, res) => {
    f.hits.push(req.url || '');
    onRequest(req, res, f);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ ...f, port: (server.address() as AddressInfo).port, hits: f.hits })));
}

function makeCert(dir: string, names: string[]) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const san = names.map((n) => (/^[\d.]+$/.test(n) ? `IP:${n}` : `DNS:${n}`)).join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=audit04.test', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

/**
 * Gọi RealGoogle.urls.fetch trong tiến trình con: fetch của Node chỉ tin chứng chỉ tự ký qua NODE_EXTRA_CA_CERTS
 * (đặt lúc khởi động), thay cho chứng chỉ công khai hợp lệ mà kẻ tấn công có thể có.
 */
const CHILD = `
import { generateKeyPairSync } from 'crypto';
import { createRealGoogle } from ${JSON.stringify(path.resolve(__dirname, '../src/google/real/real-google'))};
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = JSON.stringify({ client_email: 'audit04@fixture.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const g = createRealGoogle({ google: { saWriteKey: sa, mailFrom: 'noreply@fixture.invalid', adminSubject: 'admin@fixture.invalid' }, allowedDomain: 'fixture.invalid' } as any);
g.urls.fetch(process.argv[2]).then(
  (r) => console.log(JSON.stringify({ ok: true, body: r.content.toString('utf8') })),
  (e) => console.log(JSON.stringify({ ok: false, error: String(e && e.message) })),
);
`;

function fetchInChild(dir: string, url: string): Promise<{ ok: boolean; body?: string; error?: string }> {
  const script = path.join(dir, 'child-fetch.ts');
  if (!fs.existsSync(script)) fs.writeFileSync(script, CHILD);
  const tsx = path.resolve(__dirname, '../node_modules/.bin/tsx');
  return new Promise((resolve, reject) =>
    execFile(tsx, [script, url], { env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(dir, 'cert.pem') }, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${err.message}\n${stderr}`));
      resolve(JSON.parse(stdout.trim().split('\n').pop()!));
    }),
  );
}

describe('Audit 4/12: tải url của tài liệu ngoài không chạm địa chỉ nội bộ', () => {
  let dir: string;
  let tls: { key: Buffer; cert: Buffer };
  let internal: Fixture;
  let entry: Fixture;
  let redirectTo = '';
  let bigSent = 0;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit04-'));
    tls = makeCert(dir, ['127.0.0.1', 'entry.test', 'rebind.test']);
    // Dịch vụ nội bộ chỉ nói http, như web:3000 / api:4000 trong compose
    internal = await listen(http.createServer(), (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(MARKER);
    });
    // Máy chủ https "bên ngoài" của kẻ tấn công: /direct trả nội dung, /redirect chuyển hướng
    entry = await listen(https.createServer({ key: tls.key, cert: tls.cert }), (req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: redirectTo });
        return res.end();
      }
      if (req.url === '/loop') {
        res.writeHead(301, { location: '/loop' });
        return res.end();
      }
      if (req.url === '/big-len') {
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(150 * 1024 * 1024) });
        return res.end();
      }
      if (req.url === '/big-stream') {
        // Không có content-length: phải chặn khi đang đọc, không đợi tải hết
        res.writeHead(200, { 'content-type': 'application/pdf' });
        const chunk = Buffer.alloc(64 * 1024, 1);
        bigSent = 0;
        const pump = () => {
          if (res.destroyed || bigSent >= 200) return res.end();
          bigSent++;
          res.write(chunk, () => setImmediate(pump));
        };
        return pump();
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(MARKER);
    });
  });

  afterAll(async () => {
    await new Promise((r) => internal.server.close(r));
    await new Promise((r) => entry.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('RealGoogle.urls.fetch', () => {
    it('từ chối url https trỏ thẳng vào loopback', async () => {
      const before = entry.hits.length;
      const got = await fetchInChild(dir, `https://127.0.0.1:${entry.port}/direct`);
      expect(got.body).not.toBe(MARKER);
      expect(got.ok).toBe(false);
      expect(entry.hits.length).toBe(before);
    }, 30_000);

    it('không đi theo redirect từ https về http nội bộ', async () => {
      redirectTo = `http://127.0.0.1:${internal.port}/internal`;
      const before = internal.hits.length;
      const got = await fetchInChild(dir, `https://127.0.0.1:${entry.port}/redirect`);
      expect(got.body).not.toBe(MARKER);
      expect(got.ok).toBe(false);
      expect(internal.hits.length).toBe(before);
    }, 30_000);
  });
  describe('safeFetch', () => {
    const LOOPBACK_AS_PUBLIC = (ip: string) => ip !== '127.0.0.1' && isBlockedAddress(ip);
    const names: Record<string, string[]> = { 'entry.test': ['127.0.0.1'], 'rebind.test': ['10.0.0.7'], 'mixed.test': ['127.0.0.1', '10.0.0.8'] };
    let lookups: string[];
    const lookup = async (host: string) => {
      lookups.push(host);
      if (!names[host]) throw new Error('ENOTFOUND');
      return names[host].map((address) => ({ address, family: 4 }));
    };
    // Fixture loopback đóng vai máy chủ ngoài: chỉ 127.0.0.1 được coi là công khai, chính sách còn lại giữ nguyên
    const opts = () => ({ lookup, ca: tls.cert, isBlocked: LOOPBACK_AS_PUBLIC });
    beforeEach(() => {
      lookups = [];
    });

    it('tải được url công khai hợp lệ, kết nối vào đúng địa chỉ đã phân giải một lần', async () => {
      const r = await safeFetch(`https://entry.test:${entry.port}/files/T%C3%A0i%20li%E1%BB%87u.pdf`, opts());
      expect(r.content.toString()).toBe(MARKER);
      expect(r.mimeType).toBe('text/plain');
      expect(r.fileName).toBe('Tài liệu.pdf');
      expect(lookups).toEqual(['entry.test']);
    });

    it('chính sách mặc định từ chối loopback, kể cả qua tên miền, mà không kết nối', async () => {
      const before = entry.hits.length;
      await expect(safeFetch(`https://127.0.0.1:${entry.port}/direct`, { ca: tls.cert })).rejects.toThrow('nội bộ');
      await expect(safeFetch(`https://entry.test:${entry.port}/direct`, { ca: tls.cert, lookup })).rejects.toThrow('nội bộ');
      expect(entry.hits.length).toBe(before);
    });

    it('tên miền phân giải ra địa chỉ private (hoặc lẫn một địa chỉ private) bị từ chối', async () => {
      await expect(safeFetch(`https://rebind.test:${entry.port}/direct`, opts())).rejects.toThrow('nội bộ');
      await expect(safeFetch(`https://mixed.test:${entry.port}/direct`, opts())).rejects.toThrow('nội bộ');
    });

    it.each([
      ['http nội bộ', (p: number) => `http://127.0.0.1:${p}/internal`, 'https'],
      ['tên không có dấu chấm', (p: number) => `https://internal:${p}/x`, 'nội bộ'],
      ['tên miền trỏ vào dải private', (p: number) => `https://rebind.test:${p}/x`, 'nội bộ'],
      ['metadata đám mây', () => 'https://169.254.169.254/latest/meta-data/', 'nội bộ'],
      ['IPv4-mapped IPv6', () => 'https://[::ffff:a9fe:a9fe]/x', 'nội bộ'],
      ['localhost', (p: number) => `https://localhost:${p}/x`, 'nội bộ'],
    ])('redirect về %s bị chặn ở bước đó', async (_name, to, msg) => {
      redirectTo = to(internal.port);
      const before = internal.hits.length;
      await expect(safeFetch(`https://entry.test:${entry.port}/redirect`, opts())).rejects.toThrow(msg);
      expect(internal.hits.length).toBe(before);
    });

    it('giới hạn số bước redirect', async () => {
      const before = entry.hits.length;
      await expect(safeFetch(`https://entry.test:${entry.port}/loop`, { ...opts(), maxRedirects: 3 })).rejects.toThrow('quá nhiều');
      expect(entry.hits.length - before).toBe(4);
    });

    it('giới hạn kích thước theo content-length và ngay khi đang đọc luồng', async () => {
      await expect(safeFetch(`https://entry.test:${entry.port}/big-len`, opts())).rejects.toThrow('File quá');
      await expect(safeFetch(`https://entry.test:${entry.port}/big-stream`, { ...opts(), maxBytes: 1024 * 1024 })).rejects.toThrow('File quá');
      await new Promise((r) => setTimeout(r, 200));
      expect(bigSent).toBeLessThan(200);
    });

    it('không tin chứng chỉ không hợp lệ', async () => {
      await expect(safeFetch(`https://entry.test:${entry.port}/direct`, { lookup, isBlocked: LOOPBACK_AS_PUBLIC })).rejects.toThrow('Không tải được');
    });
  });

  describe('kiểm địa chỉ và hình thức url', () => {
    it.each([
      '127.0.0.1', '127.5.6.7', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '100.127.255.255',
      '0.0.0.0', '224.0.0.1', '239.255.255.250', '255.255.255.255', '198.18.0.1',
      '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '::127.0.0.1',
      '64:ff9b::a00:1', '2001:db8::1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', 'fe80::1%en0', 'khong-phai-ip',
    ])('%s bị chặn', (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '203.0.114.1', '2606:4700:4700::1111', '2404:6800:4005:80a::200e', '::ffff:8.8.8.8'])('%s được phép', (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    });

    it.each([
      ['http://example.vn/a.pdf', 'https'],
      ['ftp://example.vn/a.pdf', 'https'],
      ['khong-phai-url', 'không hợp lệ'],
      ['https://user:pw@example.vn/a.pdf', 'không hợp lệ'],
      ['https://api:4000/v1', 'nội bộ'],
      ['https://web/a.pdf', 'nội bộ'],
      ['https://localhost/a.pdf', 'nội bộ'],
      ['https://db.internal/a', 'nội bộ'],
      ['https://127.0.0.1/a.pdf', 'nội bộ'],
      ['https://2130706433/a.pdf', 'nội bộ'],
      ['https://0x7f.1/a.pdf', 'nội bộ'],
      ['https://[::1]/a.pdf', 'nội bộ'],
      ['https://[::ffff:192.168.1.1]/a.pdf', 'nội bộ'],
      ['https://10.0.0.1./a.pdf', 'nội bộ'],
    ])('%s bị từ chối', (u, msg) => {
      expect(urlProblem(u)).toMatch(new RegExp(msg, 'i'));
    });

    it.each(['https://example.vn/luat.pdf', 'https://thuvienphapluat.vn/van-ban/a.pdf?x=1', 'https://8.8.8.8/a.pdf'])('%s hợp lệ', (u) => {
      expect(urlProblem(u)).toBeNull();
    });
  });
});
