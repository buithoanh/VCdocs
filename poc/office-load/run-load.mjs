// Đo tải engine soạn thảo ONLYOFFICE / Euro-Office bằng nhiều phiên trình duyệt thật.
//
// Một tiến trình làm ba việc:
//   1. Máy chủ tài liệu nhỏ trên 127.0.0.1: phục vụ DOCX nguồn, trang nhúng editor
//      (config ký JWT HS256) và nhận callback lưu tệp.
//   2. Điều khiển N phiên Chromium headless (playwright-core), mỗi phiên một người
//      dùng: mở tài liệu, chờ chế độ sửa, gõ marker định kỳ vào đoạn của mình.
//   3. Lấy mẫu `docker stats` của container Document Server và RAM/CPU trình duyệt.
// Kết thúc: đóng phiên, chờ callback status 2, tải tệp cuối và kiểm đủ marker.
//
// Biến môi trường bắt buộc:
//   OFFICE_LOAD_SECRETS_DIR  thư mục chứa onlyoffice.env / eurooffice.env (JWT_SECRET=...)
//   PLAYWRIGHT_CORE_PATH     đường dẫn tới playwright-core/index.mjs (cài ngoài repo)
//   CHROMIUM_PATH            tệp chạy chrome-headless-shell
// Ví dụ: node poc/office-load/run-load.mjs --engine onlyoffice --docs 12 --users 4

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------- tham số ----------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const ENGINES = {
  onlyoffice: { origin: 'http://127.0.0.1:18083', container: 'vcworkspace-office-load-onlyoffice', secretFile: 'onlyoffice.env' },
  eurooffice: { origin: 'http://127.0.0.1:18084', container: 'vcworkspace-office-load-eurooffice', secretFile: 'eurooffice.env' },
};
const engineName = arg('engine');
const engine = ENGINES[engineName];
if (!engine) throw new Error('--engine phải là onlyoffice hoặc eurooffice');
const DOCS = Number(arg('docs', '12'));
const USERS = Number(arg('users', '4'));
const TYPE_SECONDS = Number(arg('type-seconds', '180'));
const INTERVAL_MS = Number(arg('interval-ms', '5000'));
const RAMP_MS = Number(arg('ramp-ms', '1000'));
const KEY_DELAY_MS = Number(arg('key-delay', '25'));
// Thử phục hồi khi mất mạng: sau OFFLINE_AT giây gõ, cắt mạng (context.setOffline) các phiên
// có thứ tự trong tài liệu thuộc OFFLINE_SLOTS trong OFFLINE_FOR giây, họ vẫn tiếp tục gõ.
// Cần mỗi phiên một context riêng (không dùng --shared-context).
const OFFLINE_AT = Number(arg('offline-at', '0'));
const OFFLINE_FOR = Number(arg('offline-for', '0'));
const OFFLINE_SLOTS = String(arg('offline-slots', '')).split(',').filter(Boolean).map(Number);
const PORT = Number(arg('port', '18190'));
// Tiết kiệm RAM máy chạy client: mọi trang chung một BrowserContext để Chromium dùng
// chung tiến trình renderer (giới hạn bằng --process-limit). Không ảnh hưởng phía máy chủ:
// mỗi trang vẫn là một kết nối editor riêng với user id riêng.
const SHARED_CONTEXT = argv.includes('--shared-context');
const PROCESS_LIMIT = Number(arg('process-limit', '0'));
// Client gọn: tắt plugin và kiểm tra chính tả. Cả hai chạy trong trình duyệt người dùng
// (plugin là iframe phía client, spellcheck là worker WASM phía client), nên chỉ giảm
// RAM máy chạy đo, không đổi lưu lượng hay công việc của Document Server.
const LEAN_CLIENT = argv.includes('--lean-client');
// Chốt an toàn: dừng sớm nếu RAM trống của máy host (free+inactive+speculative) dưới ngưỡng.
const MIN_FREE_GIB = Number(arg('min-free-gib', '1.0'));
const OUT = arg('out', join(tmpdir(), `office-load-${engineName}-${now()}`));
const RUN_ID = `${engineName}-${now().toString(36)}`;
const TOTAL = DOCS * USERS;

for (const k of ['OFFICE_LOAD_SECRETS_DIR', 'PLAYWRIGHT_CORE_PATH', 'CHROMIUM_PATH']) {
  if (!process.env[k]) throw new Error(`thiếu biến môi trường ${k}`);
}
const secretText = await readFile(join(process.env.OFFICE_LOAD_SECRETS_DIR, engine.secretFile), 'utf8');
const SECRET = /^JWT_SECRET=(.+)$/m.exec(secretText)?.[1]?.trim();
if (!SECRET) throw new Error('không đọc được JWT_SECRET từ tệp khoá thử');

// ---------- JWT HS256 ----------
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function signJwt(payload) {
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const body = b64u(payload);
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (head.alg !== 'HS256') return null;
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

// ---------- DOCX nguồn ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (text, bold = false) =>
  `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
async function makeDocx(path) {
  const body = [];
  for (let u = 1; u <= USERS; u++) body.push(para(`Phần của người dùng ${u}:`, true));
  const sentences = [
    'Biên bản họp giao ban tuần ghi nhận tiến độ hợp đồng và kế hoạch tuần tới của từng phòng.',
    'Các trưởng phòng cập nhật số liệu doanh thu, công nợ và tồn kho trước buổi họp thứ hai.',
    'Phòng kế toán đối chiếu chứng từ, kiểm tra hoá đơn đầu vào và lập báo cáo thuế tháng.',
    'Bộ phận kỹ thuật tổng hợp lịch bảo dưỡng xe, phụ tùng cần đặt và thời gian bàn giao.',
    'Nhân sự rà soát hồ sơ tuyển dụng, lịch phỏng vấn và kế hoạch đào tạo nhân viên mới.',
  ];
  for (let i = 0; i < 60; i++) body.push(para(`${i + 1}. ${sentences[i % sentences.length]}`));
  const dir = await mkdtemp(join(tmpdir(), 'office-load-docx-'));
  await mkdir(join(dir, '_rels'), { recursive: true });
  await mkdir(join(dir, 'word'), { recursive: true });
  await writeFile(join(dir, '[Content_Types].xml'),
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  await writeFile(join(dir, '_rels', '.rels'),
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  await writeFile(join(dir, 'word', 'document.xml'),
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>');
  await exec('zip', ['-X', '-q', path, '[Content_Types].xml', '_rels/.rels', 'word/document.xml'], { cwd: dir });
  await rm(dir, { recursive: true, force: true });
  return readFile(path);
}

// ---------- trạng thái đo ----------
const events = [];
const mark = (type, data = {}) => events.push({ t: now(), type, ...data });
const docs = Array.from({ length: DOCS }, (_, d) => ({
  id: `d${String(d + 1).padStart(2, '0')}`,
  key: `${RUN_ID}-d${d + 1}`,
  fetches: 0,
  callbacks: [],
  closedAt: null,
  savedAt: null,
  saveStatus: null,
  finalPath: null,
  missing: null,
}));
const docById = Object.fromEntries(docs.map((d) => [d.id, d]));
const sessions = [];
for (let d = 0; d < DOCS; d++) {
  for (let u = 1; u <= USERS; u++) {
    sessions.push({ n: sessions.length + 1, doc: docs[d].id, slot: u, openMs: null, mode: null, warnings: [], errors: [], consoleErrors: 0, crashed: false, markers: [], typeMs: [] });
  }
}

// ---------- máy chủ tài liệu ----------
let sourceDocx;
const editorHtml = (s) => {
  const doc = docById[s.doc];
  const config = {
    document: {
      fileType: 'docx',
      key: doc.key,
      title: `${doc.id}.docx`,
      url: `http://host.docker.internal:${PORT}/doc/${doc.id}`,
      permissions: { edit: true, comment: true, download: true },
    },
    documentType: 'word',
    editorConfig: {
      mode: 'edit',
      lang: 'vi',
      callbackUrl: `http://host.docker.internal:${PORT}/callback/${doc.id}`,
      user: { id: `u${String(s.n).padStart(2, '0')}`, name: `Người dùng ${s.n}` },
      coEditing: { mode: 'fast', change: false },
      customization: {
        autosave: true, forcesave: false, compactHeader: true, uiTheme: 'theme-light',
        ...(LEAN_CLIENT ? { plugins: false, macros: false, features: { spellcheck: { mode: false, change: false } } } : {}),
      },
      ...(LEAN_CLIENT ? { plugins: { autostart: [], pluginsData: [] } } : {}),
    },
    type: 'desktop',
    width: '100%',
    height: '100%',
  };
  config.token = signJwt(config);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${doc.id}-u${s.n}</title>
<style>html,body{margin:0;height:100%}#ed{height:100vh}</style>
<script src="${engine.origin}/web-apps/apps/api/documents/api.js"></script></head>
<body><div id="ed"></div><script>
window.__load = { events: [] };
const push = (type, data) => window.__load.events.push({ type, t: Date.now(), data: data === undefined ? null : data });
const cfg = ${JSON.stringify(config)};
cfg.events = {
  onAppReady: () => push('appReady'),
  onDocumentReady: () => push('documentReady'),
  onInfo: (e) => push('info', e && e.data),
  onWarning: (e) => push('warning', e && e.data),
  onError: (e) => push('error', e && e.data),
  onRequestEditRights: () => push('requestEditRights'),
};
if (!window.DocsAPI) push('error', { message: 'api.js không nạp được' });
else window.docEditor = new DocsAPI.DocEditor('ed', cfg);
</script></body></html>`;
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function onCallback(doc, req, res) {
  const raw = await readBody(req);
  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch { /* giữ rỗng */ }
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : body.token;
  const claims = verifyJwt(token);
  const signed = claims && (claims.payload || claims);
  if (!signed || signed.key !== doc.key) {
    mark('callback-rejected', { doc: doc.id });
    res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":1}');
    return;
  }
  doc.callbacks.push({ t: now(), status: signed.status, users: signed.users || [] });
  mark('callback', { doc: doc.id, status: signed.status });
  if ((signed.status === 2 || signed.status === 3) && !doc.savedAt) {
    doc.savedAt = now();
    doc.saveStatus = signed.status;
    if (signed.status === 2 && signed.url) {
      try {
        const r = await fetch(signed.url);
        const buf = Buffer.from(await r.arrayBuffer());
        doc.finalPath = join(OUT, `${doc.id}-final.docx`);
        await writeFile(doc.finalPath, buf);
        doc.finalBytes = buf.length;
      } catch (e) {
        doc.downloadError = String(e.message || e);
      }
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"error":0}');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const [, kind, id] = url.pathname.split('/');
    if (req.method === 'GET' && kind === 'doc' && docById[id]) {
      docById[id].fetches++;
      if (!req.headers.authorization) mark('doc-fetch-without-jwt', { doc: id });
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).end(sourceDocx);
      return;
    }
    if (req.method === 'GET' && kind === 'editor') {
      const s = sessions[Number(url.searchParams.get('s')) - 1];
      if (!s) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(editorHtml(s));
      return;
    }
    if (req.method === 'POST' && kind === 'callback' && docById[id]) { await onCallback(docById[id], req, res); return; }
    res.writeHead(404).end();
  } catch (e) {
    mark('server-error', { message: String(e.message || e) });
    if (!res.headersSent) res.writeHead(500).end();
  }
});

// ---------- lấy mẫu tài nguyên ----------
const dsSamples = [];
const clientSamples = [];
const toMiB = (s) => {
  const m = /([\d.]+)\s*([KMG]i?B|B)/.exec(s || '');
  if (!m) return null;
  const f = { B: 1 / 1048576, KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }[m[2]] ?? 1;
  return Number(m[1]) * f;
};
function startDockerStats() {
  const p = spawn('docker', ['stats', '--format', '{{json .}}', engine.container], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  p.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const json = /\{.*\}/.exec(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''))?.[0];
      if (!json) continue;
      try {
        const o = JSON.parse(json);
        dsSamples.push({ t: now(), cpu: parseFloat(o.CPUPerc), memMiB: toMiB(String(o.MemUsage).split('/')[0]), pids: Number(o.PIDs) });
      } catch { /* bỏ dòng hỏng */ }
    }
  });
  return p;
}
let clientTimer;
let lowMemStreak = 0;
let abortReason = null;
async function hostFreeGiB() {
  const { stdout } = await exec('vm_stat');
  const page = Number(/page size of (\d+)/.exec(stdout)?.[1] || 16384);
  const get = (label) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] || 0);
  return {
    freeGiB: ((get('Pages free') + get('Pages inactive') + get('Pages speculative')) * page) / 2 ** 30,
    compressorGiB: (get('Pages occupied by compressor') * page) / 2 ** 30,
  };
}
function startClientStats() {
  clientTimer = setInterval(async () => {
    try {
      const { stdout } = await exec('ps', ['-A', '-o', 'rss=,pcpu=,comm=']);
      let rss = 0, cpu = 0, procs = 0;
      for (const line of stdout.split('\n')) {
        if (!/chrome-headless-shell/.test(line)) continue;
        const [r, c] = line.trim().split(/\s+/);
        rss += Number(r) || 0; cpu += Number(c) || 0; procs++;
      }
      const host = await hostFreeGiB();
      clientSamples.push({ t: now(), rssMiB: rss / 1024, cpu, procs, hostFreeGiB: host.freeGiB, hostCompressorGiB: host.compressorGiB });
      lowMemStreak = host.freeGiB < MIN_FREE_GIB ? lowMemStreak + 1 : 0;
      if (lowMemStreak >= 3 && !abortReason) {
        abortReason = `RAM trống máy host < ${MIN_FREE_GIB} GiB trong 15 giây`;
        mark('abort', { reason: abortReason });
        console.log(`DỪNG SỚM: ${abortReason}`);
      }
    } catch { /* bỏ mẫu */ }
  }, 5000);
}

// ---------- phiên trình duyệt ----------
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
let sharedCtx = null;
async function openSession(browser, s) {
  if (abortReason) { s.openError = 'bỏ qua vì đã dừng sớm'; return; }
  const ctxOptions = { viewport: { width: 1280, height: 860 }, userAgent: UA, locale: 'vi-VN' };
  if (SHARED_CONTEXT && !sharedCtx) sharedCtx = await browser.newContext(ctxOptions);
  const ctx = SHARED_CONTEXT ? sharedCtx : await browser.newContext(ctxOptions);
  const page = await ctx.newPage();
  s.ctx = SHARED_CONTEXT ? null : ctx; s.page = page;
  page.on('console', (m) => { if (m.type() === 'error') s.consoleErrors++; });
  page.on('crash', () => { s.crashed = true; mark('page-crash', { s: s.n }); });
  const t0 = now();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/editor?s=${s.n}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__load.events.some((e) => e.type === 'documentReady' || e.type === 'error'), null, { timeout: 420000, polling: 500 });
    s.openMs = now() - t0;
  } catch (e) {
    s.openError = String(e.message || e).split('\n')[0];
  }
  try {
    const ev = await page.evaluate(() => window.__load.events);
    s.mode = ev.find((e) => e.type === 'info')?.data?.mode ?? null;
    s.warnings = ev.filter((e) => e.type === 'warning').map((e) => e.data);
    s.errors = ev.filter((e) => e.type === 'error').map((e) => e.data);
    s.ready = ev.some((e) => e.type === 'documentReady');
  } catch (e) {
    s.openError = s.openError || String(e.message || e).split('\n')[0];
  }
}

async function focusOwnParagraph(s) {
  const frame = s.page.frame({ name: 'frameEditor' });
  if (!frame) throw new Error('không thấy iframe editor');
  await frame.locator('#editor_sdk').click({ position: { x: 400, y: 300 }, timeout: 30000 });
  await s.page.keyboard.press('Control+Home');
  for (let i = 1; i < s.slot; i++) await s.page.keyboard.press('ArrowDown');
  await s.page.keyboard.press('End');
}

async function typeLoop(s, endAt) {
  await sleep(Math.floor(Math.random() * INTERVAL_MS));
  let k = 0;
  while (now() < endAt && !s.crashed && !abortReason) {
    const marker = `U${String(s.n).padStart(2, '0')}K${String(k).padStart(3, '0')}`;
    const t = now();
    try {
      await s.page.keyboard.type(` ${marker}`, { delay: KEY_DELAY_MS });
      s.markers.push(marker);
      s.typeMs.push(now() - t);
    } catch (e) {
      s.typeError = String(e.message || e).split('\n')[0];
      break;
    }
    k++;
    await sleep(Math.max(0, INTERVAL_MS - (now() - t)));
  }
}

// ---------- thống kê ----------
const pct = (arr, p) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};
const avg = (arr) => { const a = arr.filter(Number.isFinite); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
function phaseStats(from, to) {
  const ds = dsSamples.filter((x) => x.t >= from && x.t <= to && Number.isFinite(x.cpu));
  const cl = clientSamples.filter((x) => x.t >= from && x.t <= to);
  return {
    seconds: round((to - from) / 1000, 0),
    dsCpuAvg: round(avg(ds.map((x) => x.cpu))),
    dsCpuP95: round(pct(ds.map((x) => x.cpu), 95)),
    dsCpuMax: round(Math.max(...ds.map((x) => x.cpu), 0)),
    dsMemMaxMiB: round(Math.max(...ds.map((x) => x.memMiB ?? 0), 0), 0),
    dsPidsMax: Math.max(...ds.map((x) => x.pids || 0), 0),
    clientRssMaxMiB: round(Math.max(...cl.map((x) => x.rssMiB), 0), 0),
    clientCpuAvg: round(avg(cl.map((x) => x.cpu))),
    samples: ds.length,
  };
}

async function finalText(path) {
  const { stdout } = await exec('unzip', ['-p', path, 'word/document.xml'], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.replace(/<[^>]+>/g, '');
}

// ---------- chạy ----------
await mkdir(OUT, { recursive: true });
sourceDocx = await makeDocx(join(OUT, 'source.docx'));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_PATH);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [
    '--disable-gpu', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(PROCESS_LIMIT > 0 ? [`--renderer-process-limit=${PROCESS_LIMIT}`] : []),
    ...(argv.includes('--v8-small') ? ['--js-flags=--optimize-for-size'] : []),
  ],
});
const stats = startDockerStats();
startClientStats();
const phases = {};
console.log(`[${RUN_ID}] ${TOTAL} phiên = ${DOCS} tài liệu × ${USERS} người, gõ ${TYPE_SECONDS}s, mỗi ${INTERVAL_MS}ms; out=${OUT}`);

await sleep(5000);
phases.idle = [now() - 5000, now()];

// Mở phiên theo nhịp ramp, không chờ phiên trước xong.
phases.open = [now()];
const opening = [];
for (const s of sessions) {
  opening.push(openSession(browser, s));
  await sleep(RAMP_MS);
}
await Promise.all(opening);
phases.open.push(now());
const ready = sessions.filter((s) => s.ready);
console.log(`mở xong: ${ready.length}/${TOTAL} sẵn sàng, chế độ edit ${sessions.filter((s) => s.mode === 'edit').length}`);

// Đặt con trỏ vào đoạn riêng (mọi phiên xong rồi mới gõ để tránh lệch dòng).
for (const s of ready) {
  try { await focusOwnParagraph(s); } catch (e) { s.focusError = String(e.message || e).split('\n')[0]; }
}

phases.edit = [now()];
const endAt = now() + TYPE_SECONDS * 1000;
const offlineTask = (async () => {
  if (!(OFFLINE_AT > 0 && OFFLINE_FOR > 0 && OFFLINE_SLOTS.length)) return;
  if (SHARED_CONTEXT) throw new Error('--offline-* cần mỗi phiên một context');
  await sleep(OFFLINE_AT * 1000);
  const targets = ready.filter((s) => OFFLINE_SLOTS.includes(s.slot) && s.ctx);
  mark('offline-start', { sessions: targets.map((s) => s.n) });
  await Promise.all(targets.map((s) => s.ctx.setOffline(true).then(() => { s.wentOffline = now(); })));
  await sleep(OFFLINE_FOR * 1000);
  await Promise.all(targets.map((s) => s.ctx.setOffline(false).then(() => { s.backOnline = now(); })));
  mark('offline-end', { sessions: targets.map((s) => s.n) });
})();
await Promise.all([offlineTask, ...ready.filter((s) => !s.focusError).map((s) => typeLoop(s, endAt))]);
phases.edit.push(now());
console.log(`gõ xong: ${sessions.reduce((n, s) => n + s.markers.length, 0)} marker`);

await sleep(15000); // để thay đổi cuối kịp gửi

// Chụp nội dung các đoạn nhãn mà từng trình duyệt đang thấy (mô hình tài liệu sdkjs trong
// iframe editor). Dùng để phân biệt mất ký tự phía client (chưa từng vào tài liệu cục bộ)
// với mất phía máy chủ (có ở client nhưng không có trong tệp lưu), và kiểm hội tụ co-editing.
for (const s of ready) {
  try {
    const frame = s.page.frame({ name: 'frameEditor' });
    s.view = await frame.evaluate((n) => {
      const doc = window.editor && window.editor.WordControl && window.editor.WordControl.m_oLogicDocument;
      if (!doc || !doc.Content) return null;
      const out = [];
      for (let i = 0; i < n; i++) out.push(doc.Content[i] && doc.Content[i].GetText ? doc.Content[i].GetText() : null);
      return out;
    }, USERS);
  } catch (e) {
    s.viewError = String(e.message || e).split('\n')[0];
  }
}
phases.save = [now()];
for (const s of sessions) {
  try { if (s.ctx) await s.ctx.close(); else await s.page?.close(); } catch { /* bỏ qua */ }
}
try { await sharedCtx?.close(); } catch { /* bỏ qua */ }
const closedAt = now();
for (const d of docs) d.closedAt = closedAt;
const saveDeadline = now() + 600000;
while (now() < saveDeadline && docs.some((d) => !d.savedAt)) await sleep(1000);
phases.save.push(now());
await browser.close();
stats.kill();
clearInterval(clientTimer);

// Kiểm marker trong tệp cuối.
for (const d of docs) {
  const expected = sessions.filter((s) => s.doc === d.id).flatMap((s) => s.markers);
  d.expectedMarkers = expected.length;
  if (!d.finalPath) { d.missing = expected.length; continue; }
  const text = await finalText(d.finalPath);
  d.missingList = expected.filter((m) => !text.includes(m));
  d.missing = d.missingList.length;
  // Phân loại marker thiếu: không có ở chính trình duyệt người gõ = mất phía client.
  const viewers = sessions.filter((s) => s.doc === d.id && Array.isArray(s.view));
  d.missingClientSide = d.missingList.filter((m) => {
    const author = sessions.find((s) => s.doc === d.id && s.markers.includes(m));
    return author && Array.isArray(author.view) && !author.view.join('\n').includes(m);
  }).length;
  // Hội tụ: mọi trình duyệt của tài liệu thấy cùng nội dung các đoạn nhãn.
  const views = viewers.map((s) => JSON.stringify(s.view));
  d.viewsCaptured = viewers.length;
  d.viewsConverged = views.length > 0 && views.every((v) => v === views[0]);
}
server.close();

const open = sessions.map((s) => s.openMs);
const typeMs = sessions.flatMap((s) => s.typeMs);
const summary = {
  runId: RUN_ID,
  engine: engineName,
  container: engine.container,
  startedAt: new Date(phases.idle[0]).toISOString(),
  sessions: TOTAL,
  docs: DOCS,
  usersPerDoc: USERS,
  typeSeconds: TYPE_SECONDS,
  intervalMs: INTERVAL_MS,
  rampMs: RAMP_MS,
  keyDelayMs: KEY_DELAY_MS,
  offline: OFFLINE_AT > 0 ? { at: OFFLINE_AT, for: OFFLINE_FOR, slots: OFFLINE_SLOTS } : null,
  sharedContext: SHARED_CONTEXT,
  leanClient: LEAN_CLIENT,
  processLimit: PROCESS_LIMIT,
  abortReason,
  hostFreeMinGiB: round(Math.min(...clientSamples.map((x) => x.hostFreeGiB ?? Infinity)), 2),
  ready: ready.length,
  editMode: sessions.filter((s) => s.mode === 'edit').length,
  viewMode: sessions.filter((s) => s.mode === 'view').length,
  warnings: sessions.reduce((n, s) => n + s.warnings.length, 0),
  editorErrors: sessions.reduce((n, s) => n + s.errors.length, 0),
  openErrors: sessions.filter((s) => s.openError).length,
  focusErrors: sessions.filter((s) => s.focusError).length,
  typeErrors: sessions.filter((s) => s.typeError).length,
  crashes: sessions.filter((s) => s.crashed).length,
  consoleErrors: sessions.reduce((n, s) => n + s.consoleErrors, 0),
  openMs: { p50: pct(open, 50), p95: pct(open, 95), max: Math.max(...open.filter(Number.isFinite), 0) },
  typeBurstMs: { p50: pct(typeMs, 50), p95: pct(typeMs, 95), max: Math.max(...typeMs, 0) },
  markersTyped: sessions.reduce((n, s) => n + s.markers.length, 0),
  markersMissing: docs.reduce((n, d) => n + (d.missing ?? 0), 0),
  markersMissingClientSide: docs.reduce((n, d) => n + (d.missingClientSide ?? 0), 0),
  viewsCaptured: docs.reduce((n, d) => n + (d.viewsCaptured ?? 0), 0),
  docsConverged: docs.filter((d) => d.viewsConverged).length,
  docsSaved: docs.filter((d) => d.saveStatus === 2 && d.finalPath).length,
  saveAfterCloseMs: { p50: pct(docs.map((d) => d.savedAt && d.savedAt - d.closedAt), 50), max: Math.max(...docs.map((d) => (d.savedAt ? d.savedAt - d.closedAt : 0))) },
  docFetches: docs.reduce((n, d) => n + d.fetches, 0),
  phases: Object.fromEntries(Object.entries(phases).map(([k, [a, b]]) => [k, phaseStats(a, b)])),
};
const detail = {
  summary,
  sessions: sessions.map(({ ctx, page, ...s }) => ({ ...s, markers: s.markers.length, typeMs: undefined })),
  docs: docs.map(({ key, ...d }) => d),
  events,
  dsSamples,
  clientSamples,
};
await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
await writeFile(join(OUT, 'detail.json'), JSON.stringify(detail));
console.log(JSON.stringify(summary, null, 2));
