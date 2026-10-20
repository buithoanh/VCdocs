import { execFile } from 'child_process';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { createTestApp, expectContract, TestApp } from './support/app';
import { khoiTaoCongTy } from '../src/seed/khoi-tao-cong-ty';
import { docThamSo } from '../src/khoi-tao';

/** Bắt đầu đăng nhập rồi gọi callback cho email (Google giả) */
async function callback(t: TestApp, email: string) {
  const agent = require('supertest').agent(t.app.getHttpServer());
  const start = await agent.get('/api/v1/auth/google');
  const loc = new URL(start.headers.location);
  const url = `/api/v1/auth/google/callback?state=${loc.searchParams.get('state')}&code=${encodeURIComponent(`fake|${email}|${loc.searchParams.get('nonce')}`)}`;
  const cb = await agent.get(url);
  expectContract('GET', url, cb);
  return cb;
}

describe('Khởi tạo công ty (chế độ Google thật, CSDL trống)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('khoiTaoCongTy: tạo khi chưa có, chạy lại không tạo trùng, không ghi đè tên', async () => {
    await t.db.m.Company.deleteMany({});
    const a = await khoiTaoCongTy(t.db.m, { ten: 'Công ty TNHH VC Phồn Vinh', mien: 'VCprosperous.com' });
    expect(a).toMatchObject({ daTao: true, name: 'Công ty TNHH VC Phồn Vinh', domain: 'vcprosperous.com' });
    const b = await khoiTaoCongTy(t.db.m, { ten: 'Tên khác', mien: 'vcprosperous.com' });
    expect(b).toMatchObject({ daTao: false, id: a.id, name: 'Công ty TNHH VC Phồn Vinh' });
    const all = await t.db.m.Company.find({}).lean<any[]>();
    expect(all).toHaveLength(1);
    expect(all[0].settings).toEqual({});
  });

  it('khoiTaoCongTy: chạy đồng thời vẫn chỉ một bản ghi', async () => {
    await t.db.m.Company.deleteMany({ domain: 'song-song.vn' });
    const kq = await Promise.allSettled(Array.from({ length: 5 }, () => khoiTaoCongTy(t.db.m, { ten: 'X', mien: 'song-song.vn' })));
    expect(kq.some((r) => r.status === 'fulfilled' && r.value.daTao)).toBe(true);
    expect(await t.db.m.Company.countDocuments({ domain: 'song-song.vn' })).toBe(1);
  });

  it('khoiTaoCongTy: thiếu tên hoặc tên miền sai → báo lỗi', async () => {
    await expect(khoiTaoCongTy(t.db.m, { ten: '  ', mien: 'vcprosperous.com' })).rejects.toThrow(/tên công ty/);
    await expect(khoiTaoCongTy(t.db.m, { ten: 'A', mien: 'khong co cham' })).rejects.toThrow(/Tên miền không hợp lệ/);
  });

  it('docThamSo: nhận --ten/--mien, dạng =, bỏ qua "--", báo tham số lạ', () => {
    expect(docThamSo(['--', '--ten', 'Công ty A', '--mien=a.vn'])).toEqual({ ten: 'Công ty A', mien: 'a.vn' });
    expect(docThamSo(['--ten', 'B'])).toEqual({ ten: 'B' });
    expect(() => docThamSo(['--ten'])).toThrow(/Thiếu giá trị/);
    expect(() => docThamSo(['--ten', '--mien', 'a.vn'])).toThrow(/Thiếu giá trị/);
    expect(() => docThamSo(['--xyz', '1'])).toThrow(/Tham số lạ/);
  });

  it('callback khi CSDL chưa có công ty → loi=setup (không phải domain), ghi log, không tạo phiên; khởi tạo xong thì đăng nhập được', async () => {
    await t.db.m.Company.deleteMany({});
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const cb = await callback(t, t.ids.emails.tgd);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toBe('http://localhost:3000/dang-nhap?loi=setup');
      expect(cb.headers['set-cookie']?.some((c: string) => c.startsWith('vcdocs_sid=') && !c.startsWith('vcdocs_sid=;'))).toBeFalsy();
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/chưa có công ty tên miền vcprosperous\.com.*khoi-tao/s));
    } finally {
      spy.mockRestore();
    }
    // Tài khoản ngoài tên miền vẫn là loi=domain dù chưa có công ty
    expect((await callback(t, 'nguoila@gmail.com')).headers.location).toBe('http://localhost:3000/dang-nhap?loi=domain');

    await khoiTaoCongTy(t.db.m, { ten: 'Công ty TNHH VC Phồn Vinh', mien: 'vcprosperous.com' });
    const ok = await callback(t, t.ids.emails.tgd);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('http://localhost:3000/');
  });

  it('lệnh khoi-tao: tạo công ty, chạy lại báo đã có; thiếu --mien lấy ALLOWED_DOMAIN', async () => {
    const uri = t.cfg.mongoUri.replace(/\/([^/?]+)(\?|$)/, `/${'cli' + Date.now()}$2`);
    // Chạy bất đồng bộ: spawnSync chặn tiến trình jest (giữ mongod trong bộ nhớ) → mongod treo khi đầy ống log
    const run = (...args: string[]) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          [require.resolve('tsx/cli'), path.join(__dirname, '../src/khoi-tao.ts'), ...args],
          { env: { ...process.env, MONGODB_URI: uri, ALLOWED_DOMAIN: 'vcprosperous.com', GOOGLE_MODE: 'real', NODE_ENV: 'test' }, encoding: 'utf8', timeout: 60_000 },
          (_err, stdout, stderr) => resolve({ status: child.exitCode, stdout, stderr }),
        );
      });
    const a = await run('--', '--ten', 'Công ty TNHH VC Phồn Vinh');
    expect(a.stderr).toBe('');
    expect(a.status).toBe(0);
    expect(a.stdout).toMatch(/Đã tạo công ty "Công ty TNHH VC Phồn Vinh" \(vcprosperous\.com\)/);
    const b = await run('--ten', 'Công ty TNHH VC Phồn Vinh', '--mien', 'vcprosperous.com');
    expect(b.stderr).toBe('');
    expect(b.status).toBe(0);
    expect(b.stdout).toMatch(/đã có .*không đổi gì/);
    const c = await run();
    expect(c.status).toBe(1);
    expect(c.stderr).toMatch(/Thiếu --ten/);
  }, 120_000);
});
