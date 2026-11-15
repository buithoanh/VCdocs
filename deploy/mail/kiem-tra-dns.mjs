#!/usr/bin/env node
// Kiểm bản ghi DNS của tên miền thư sau khi nhập ở nhà quản lý DNS (ví dụ iNET). Chỉ tra cứu, không sửa gì.
//   node kiem-tra-dns.mjs --domain vcparts.vn --host mail.vcparts.vn --ip 203.0.113.10 \
//        --dkim v1-ed25519-20261114,v1-rsa-20261114
// Tuỳ chọn:
//   --resolver 1.1.1.1    hỏi thẳng một máy phân giải công cộng (mặc định dùng của máy đang chạy)
//   --gui-qua-tram        thư gửi ra đi qua trạm chuyển tiếp (Amazon SES…): PTR chỉ còn là "nên có"
// Tên selector DKIM lấy từ Stalwart: Management › Domains › Domains › View Zone File.
// Mã thoát 1 nếu còn mục bắt buộc chưa đạt.
import { Resolver } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';

const chuan = (name) => String(name ?? '').trim().toLowerCase().replace(/\.$/, '');
const batDau = (records, tienTo) => records.filter((r) => r.trim().toLowerCase().startsWith(tienTo));

/**
 * Đánh giá kết quả tra cứu. Phần thuần (không gọi mạng) để test được.
 * `tra`: { a: string[], mx: {exchange, priority}[], txtDomain: string[], txtHost: string[], dmarc: string[],
 *          dkim: {[selector]: string[]}, ptr: string[], mtaSts: string[], autoconfig: string[], loi: {[muc]: string} }
 * Trả về các dòng { ten, muc: 'bat-buoc' | 'nen-co', dat, chiTiet }.
 */
export function danhGia(tra, { domain, host, ip, dkim = [], guiQuaTram = false }) {
  const rows = [];
  const them = (ten, muc, dat, chiTiet) => rows.push({ ten, muc, dat, chiTiet });
  const loi = tra.loi ?? {};
  const h = chuan(host);

  if (loi.a) them(`A ${h}`, 'bat-buoc', false, `không tra được: ${loi.a}`);
  else if (!tra.a.length) them(`A ${h}`, 'bat-buoc', false, 'chưa có bản ghi A');
  else if (ip && !tra.a.includes(ip)) them(`A ${h}`, 'bat-buoc', false, `đang trỏ ${tra.a.join(', ')}, cần ${ip}`);
  else them(`A ${h}`, 'bat-buoc', true, tra.a.join(', '));

  if (loi.mx) them(`MX ${domain}`, 'bat-buoc', false, `không tra được: ${loi.mx}`);
  else {
    const mx = tra.mx.map((m) => ({ ...m, exchange: chuan(m.exchange) }));
    const khac = mx.filter((m) => m.exchange !== h).map((m) => m.exchange);
    if (!mx.some((m) => m.exchange === h)) them(`MX ${domain}`, 'bat-buoc', false, mx.length ? `đang trỏ ${khac.join(', ')}, chưa có ${h}` : 'chưa có bản ghi MX');
    // MX khác còn tồn tại nghĩa là một phần thư vẫn chạy về máy chủ cũ.
    else them(`MX ${domain}`, 'bat-buoc', true, khac.length ? `${h} (còn MX khác: ${khac.join(', ')} – thư có thể vẫn về máy cũ)` : h);
  }

  const spf = batDau(tra.txtDomain, 'v=spf1');
  if (loi.txtDomain) them(`SPF ${domain}`, 'bat-buoc', false, `không tra được: ${loi.txtDomain}`);
  else if (!spf.length) them(`SPF ${domain}`, 'bat-buoc', false, 'chưa có bản ghi TXT v=spf1');
  // Hai bản ghi SPF trên cùng một tên làm máy nhận coi SPF là lỗi (RFC 7208 mục 4.5).
  else if (spf.length > 1) them(`SPF ${domain}`, 'bat-buoc', false, `có ${spf.length} bản ghi v=spf1, phải gộp thành một`);
  else them(`SPF ${domain}`, 'bat-buoc', true, spf[0]);

  if (!dkim.length) them('DKIM', 'bat-buoc', false, 'chưa kiểm: truyền --dkim <selector,…> lấy từ View Zone File của Stalwart');
  for (const selector of dkim) {
    const ten = `DKIM ${selector}._domainkey.${domain}`;
    const records = batDau(tra.dkim?.[selector] ?? [], 'v=dkim1');
    if (loi[`dkim:${selector}`]) them(ten, 'bat-buoc', false, `không tra được: ${loi[`dkim:${selector}`]}`);
    else if (!records.length) them(ten, 'bat-buoc', false, 'chưa có bản ghi TXT v=DKIM1');
    else if (!/(^|;)\s*p=[A-Za-z0-9+/]/.test(records[0].replace(/\s+/g, ''))) them(ten, 'bat-buoc', false, 'bản ghi thiếu khoá công khai (p=)');
    else them(ten, 'bat-buoc', true, 'có khoá công khai');
  }

  const dmarc = batDau(tra.dmarc, 'v=dmarc1');
  if (loi.dmarc) them(`DMARC _dmarc.${domain}`, 'bat-buoc', false, `không tra được: ${loi.dmarc}`);
  else if (!dmarc.length) them(`DMARC _dmarc.${domain}`, 'bat-buoc', false, 'chưa có bản ghi TXT v=DMARC1');
  else if (dmarc.length > 1) them(`DMARC _dmarc.${domain}`, 'bat-buoc', false, `có ${dmarc.length} bản ghi v=DMARC1, chỉ được một`);
  else {
    const p = /(^|;)\s*p=(none|quarantine|reject)\b/i.exec(dmarc[0])?.[2];
    them(`DMARC _dmarc.${domain}`, 'bat-buoc', Boolean(p), p ? `p=${p.toLowerCase()}` : 'thiếu chính sách p=none|quarantine|reject');
  }

  const mucPtr = guiQuaTram ? 'nen-co' : 'bat-buoc';
  const ipKiem = ip ?? tra.a[0];
  if (!ipKiem) them('PTR', mucPtr, false, 'chưa biết IP để kiểm (truyền --ip hoặc tạo bản ghi A trước)');
  else if (loi.ptr) them(`PTR ${ipKiem}`, mucPtr, false, `không tra được: ${loi.ptr}`);
  else if (!tra.ptr.map(chuan).includes(h)) them(`PTR ${ipKiem}`, mucPtr, false, tra.ptr.length ? `đang là ${tra.ptr.join(', ')}, cần ${h} (đặt ở nơi cấp IP, không phải ở DNS tên miền)` : `chưa có; đặt ${h} ở nơi cấp IP`);
  else them(`PTR ${ipKiem}`, mucPtr, true, h);

  const spfHost = batDau(tra.txtHost, 'v=spf1');
  them(`SPF ${h}`, 'nen-co', spfHost.length === 1, spfHost.length === 1 ? spfHost[0] : spfHost.length ? 'nhiều hơn một bản ghi v=spf1' : 'chưa có (Stalwart gợi ý "v=spf1 a -all")');
  const sts = batDau(tra.mtaSts, 'v=stsv1');
  them(`MTA-STS _mta-sts.${domain}`, 'nen-co', sts.length === 1, sts.length === 1 ? sts[0] : 'chưa có');
  const auto = (tra.autoconfig ?? []).map(chuan);
  them(`CNAME autoconfig.${domain}`, 'nen-co', auto.includes(h), auto.includes(h) ? h : 'chưa có (client tự dò cấu hình sẽ không chạy)');
  return rows;
}

export function inBang(rows) {
  const nhan = (r) => (r.dat ? 'ĐẠT     ' : r.muc === 'bat-buoc' ? 'THIẾU   ' : 'NÊN CÓ  ');
  return rows.map((r) => `${nhan(r)} ${r.ten}\n          ${r.chiTiet}`).join('\n');
}

export function thamSo(argv) {
  const out = { dkim: [], guiQuaTram: false };
  for (let i = 0; i < argv.length; i++) {
    const giaTri = () => { const v = argv[++i]; if (!v || v.startsWith('--')) throw new Error(`Thiếu giá trị cho ${argv[i - 1]}`); return v; };
    if (argv[i] === '--domain') out.domain = chuan(giaTri());
    else if (argv[i] === '--host') out.host = chuan(giaTri());
    else if (argv[i] === '--ip') out.ip = giaTri();
    else if (argv[i] === '--dkim') out.dkim = giaTri().split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--resolver') out.resolver = giaTri();
    else if (argv[i] === '--gui-qua-tram') out.guiQuaTram = true;
    else throw new Error(`Tham số lạ: ${argv[i]}`);
  }
  if (!out.domain || !out.host) throw new Error('Cần --domain <tên miền thư> và --host <tên máy chủ thư>');
  return out;
}

/**
 * Tên miền nào đang tồn tại cũng có SOA ở chính nó hoặc ở vùng cha. Không lấy được SOA nào nghĩa là tên miền
 * không tồn tại, hoặc máy phân giải lọc truy vấn (có mạng chỉ trả bản ghi A). Khi đó mọi mục sẽ hiện "chưa có"
 * một cách sai lệch, nên dừng hẳn thay vì in bảng.
 */
export async function kiemMayPhanGiai(hoiSoa, domain) {
  const nhan = chuan(domain).split('.');
  for (let i = 0; i < nhan.length - 1; i++) {
    try { await hoiSoa(nhan.slice(i).join('.')); return; } catch { /* thử vùng cha */ }
  }
  throw new Error(`Không lấy được SOA của ${domain} hay vùng cha: tên miền không tồn tại, hoặc máy phân giải đang dùng lọc truy vấn. Thử --resolver 1.1.1.1 hoặc chạy từ mạng khác.`);
}

async function traCuu({ domain, host, ip, dkim, resolver }) {
  const dns = new Resolver({ timeout: 5000, tries: 2 });
  if (resolver) dns.setServers([resolver]);
  await kiemMayPhanGiai((name) => dns.resolveSoa(name), domain);
  const loi = {};
  // "Không có bản ghi" là kết quả hợp lệ (mảng rỗng); lỗi khác (hết giờ, bị chặn) phải báo riêng để không nhầm thành "chưa có".
  const hoi = async (muc, fn) => { try { return await fn(); } catch (e) { if (!['ENODATA', 'ENOTFOUND'].includes(e.code)) loi[muc] = e.code ?? e.message; return []; } };
  const txt = (muc, name) => hoi(muc, async () => (await dns.resolveTxt(name)).map((chunks) => chunks.join('')));
  const tra = {
    a: await hoi('a', () => dns.resolve4(host)),
    mx: await hoi('mx', () => dns.resolveMx(domain)),
    txtDomain: await txt('txtDomain', domain),
    txtHost: await txt('txtHost', host),
    dmarc: await txt('dmarc', `_dmarc.${domain}`),
    mtaSts: await txt('mtaSts', `_mta-sts.${domain}`),
    autoconfig: await hoi('autoconfig', () => dns.resolveCname(`autoconfig.${domain}`)),
    dkim: {},
    ptr: [],
    loi,
  };
  for (const selector of dkim) tra.dkim[selector] = await txt(`dkim:${selector}`, `${selector}._domainkey.${domain}`);
  const ipKiem = ip ?? tra.a[0];
  if (ipKiem) tra.ptr = await hoi('ptr', () => dns.reverse(ipKiem));
  return tra;
}

async function main() {
  const o = thamSo(process.argv.slice(2));
  const rows = danhGia(await traCuu(o), o);
  console.log(inBang(rows));
  const thieu = rows.filter((r) => r.muc === 'bat-buoc' && !r.dat).length;
  console.log(thieu ? `\nCòn ${thieu} mục bắt buộc chưa đạt.` : '\nCác mục bắt buộc đều đạt.');
  process.exit(thieu ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(`THẤT BẠI: ${error.message}`); process.exit(2); });
}
