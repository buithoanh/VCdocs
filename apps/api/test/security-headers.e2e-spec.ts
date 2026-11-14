import { createTestApp, TestApp } from './support/app';

// Review O14: header bảo mật trên mọi phản hồi API (JSON, lỗi, tệp tải về).
describe('Header bảo mật API', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });
  afterAll(async () => { await t.close(); });

  function expectHeaders(res: any) {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  }

  it('có trên phản hồi lỗi chưa đăng nhập, JSON và tệp tải về', async () => {
    const anonymous = await t.http().get('/api/v1/me');
    expect(anonymous.status).toBe(401);
    expectHeaders(anonymous);
    const manager = await t.login('tp.mkt');
    const me = await manager.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBeTruthy();
    expectHeaders(me);
    const space = (await manager.get('/spaces')).body.items.find((item: any) => item.kind === 'department');
    const file = await manager.upload('/drive/files', { spaceId: space.id }, { name: 'o14-header.txt', type: 'text/plain', content: Buffer.from('<script>alert(1)</script>') });
    const content = await manager.get(`/drive/files/${file.body.id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers['content-disposition']).toContain('attachment');
    expectHeaders(content);
  });
});
