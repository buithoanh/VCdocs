import request from 'supertest';
import { createTestApp, expectContract, TestApp } from './support/app';
import { createApp } from '../src/bootstrap';
import { GOOGLE } from '../src/google/ports';
import { FakeGoogle } from '../src/google/fake/fake-google';
import { DemoSeedService } from '../src/seed/demo-seed.service';
import { dateVN } from '../src/common/util';

/**
 * Chạy local với Google giả: khởi động lại BE trên CSDL đã có dữ liệu mà mất
 * trạng thái Google giả thì vẫn đăng nhập được và thấy đủ drive, thư mục, file.
 */
describe('Khởi động lần 2 với Google giả', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('dựng lại danh bạ, nhóm, drive, thư mục, file từ CSDL; đăng nhập và lập hồ sơ được', async () => {
    // lần chạy 1: tạo một hồ sơ để có file trên Drive giả
    const nv1 = await t.login('nv.mkt');
    const r = await nv1.post('/records', { recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Trước khi khởi động lại', workMonth: dateVN().slice(0, 7) });
    await t.drain();
    const recId = (await nv1.get(`/jobs/${r.body.jobId}`)).body.result.objectId;
    const fileId = (await nv1.get(`/records/${recId}`)).body.fileId;

    // lần chạy 2: cùng CSDL, Google giả mới (không có file trạng thái)
    const app2 = await createApp({ ...t.cfg, google: { ...t.cfg.google, fakeStateFile: undefined } }, { logger: false });
    try {
      const fake2 = app2.get(GOOGLE) as FakeGoogle;
      expect(fake2.isEmpty()).toBe(true);
      await app2.get(DemoSeedService).seedIfEmpty();
      expect(fake2.world.users.map((u) => u.email)).toContain(t.ids.emails['nv.mkt']);
      expect(fake2.world.drives).toHaveLength(11);
      expect(fake2.fileState(fileId)).toBeTruthy();
      // CSDL không bị nạp mẫu lần hai
      expect(await t.db.m.Company.countDocuments({})).toBe(1);

      const agent = request.agent(app2.getHttpServer());
      const start = await agent.get('/api/v1/auth/google');
      const page = await agent.get(new URL(start.headers.location).pathname + new URL(start.headers.location).search);
      expect(page.text).toContain(t.ids.emails['nv.mkt']);
      const loc = new URL(start.headers.location);
      const cb = await agent.get(`/api/v1/auth/google/callback?state=${loc.searchParams.get('state')}&code=${encodeURIComponent(`fake|${t.ids.emails['nv.mkt']}|${loc.searchParams.get('nonce')}`)}`);
      expect(cb.headers.location).toBe('http://localhost:3000/');
      const me = await agent.get('/api/v1/me');
      expectContract('GET', '/api/v1/me', me);
      expect(me.body.systemRoles).toEqual(['R6']);
      expect(me.body.drives.find((d: any) => d.name === '11 MKT').role).toBe('writer');
      const csrf = me.body.csrfToken;
      const folders = await agent.get(`/api/v1/folders?driveId=${t.ids.depts.MKT.driveId}`);
      expect(folders.body.items.length).toBeGreaterThan(5);
      // thao tác ghi trên Drive giả sau khi dựng lại vẫn chạy
      const r2 = await agent
        .post('/api/v1/records')
        .set('X-CSRF-Token', csrf)
        .set('Idempotency-Key', 'restart-rec-0001')
        .send({ recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Sau khi khởi động lại', workMonth: dateVN().slice(0, 7) });
      expect(r2.status).toBe(202);
      await app2.get(require('../src/jobs/jobs.service').JobsService).drain();
      expect((await agent.get(`/api/v1/jobs/${r2.body.jobId}`)).body.status).toBe('done');
    } finally {
      await app2.close();
    }
  });
});
