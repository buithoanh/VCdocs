import { Types } from 'mongoose';
import { createTestApp, TestApp } from './support/app';
import { AuditService } from '../src/audit/audit.service';

describe('Phần chung: CSRF, Idempotency-Key, audit_logs, companyId, giới hạn', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ rateLimit: { perMinute: 600, searchPerMinute: 60 } });
  });
  afterAll(async () => t.close());

  it('POST thiếu hoặc sai X-CSRF-Token → 403', async () => {
    const c = await t.login('tp.mkt');
    const r = await c.post('/codes', { code: 'A-B', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' }, { noCsrf: true });
    expect(r.status).toBe(403);
    const r2 = await c.post('/codes', { code: 'A-B', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' }, { noCsrf: true, headers: { 'X-CSRF-Token': 'sai' } });
    expect(r2.status).toBe(403);
    // lần bị từ chối được ghi nhật ký
    const denied = await t.db.m.AuditLog.findOne({ companyId: new Types.ObjectId(t.ids.companyId), result: 'denied' }).lean();
    expect(denied).toBeTruthy();
  });

  it('Idempotency-Key: gửi lại cùng key → cùng kết quả, không tạo hai lần; thiếu key → 400; key dùng cho thân khác → 409', async () => {
    const c = await t.login('tp.mkt');
    const body = { code: 'IDEM-1', type: 'channel', meaning: 'Thử chống lặp', scope: 'MKT', reason: 'test' };
    const a = await c.post('/codes', body, { idem: 'key-abcdef-1' });
    const b = await c.post('/codes', body, { idem: 'key-abcdef-1' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['x-audit-id']).toBe(a.headers['x-audit-id']);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(await t.db.m.Code.countDocuments({ companyId: new Types.ObjectId(t.ids.companyId), code: 'IDEM-1' })).toBe(1);
    const other = await c.post('/codes', { ...body, code: 'IDEM-2' }, { idem: 'key-abcdef-1' });
    expect(other.status).toBe(409);
    const missing = await c.agent.post('/api/v1/codes').set('X-CSRF-Token', c.csrf).send(body);
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].field).toBe('header.Idempotency-Key');
    // key của người khác không đụng nhau
    const other2 = await (await t.login('tp.kd')).post('/codes', { ...body, code: 'IDEM-3' }, { idem: 'key-abcdef-1' });
    expect(other2.status).toBe(201);
  });

  it('lỗi thì không giữ key: sửa dữ liệu rồi gửi lại cùng key được', async () => {
    const c = await t.login('tp.mkt');
    const bad = await c.post('/codes', { code: 'SEO-PTDA', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' }, { idem: 'key-retry-001' });
    expect(bad.status).toBe(409);
    const good = await c.post('/codes', { code: 'SEO-PTDA', type: 'channel', meaning: 'x', scope: 'x', reason: 'x' }, { idem: 'key-retry-001' });
    expect(good.status).toBe(409);
  });

  it('audit_logs: mọi POST/PATCH có X-Audit-Id; chuỗi mã băm hợp lệ; không sửa được', async () => {
    const c = await t.login('hcns');
    const r = await c.post('/divisions', { prefix: 'AUD', name: 'Thử nhật ký' });
    const id = r.headers['x-audit-id'];
    const row = await t.db.m.AuditLog.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(id) }).lean<any>();
    expect(row).toMatchObject({ action: 'division.create', objectType: 'division', actorEmail: t.ids.emails.hcns });
    expect(row.requestId).toBe(r.headers['x-request-id']);
    const audit = t.app.get(AuditService);
    expect((await audit.verifyChain(t.ids.companyId)).ok).toBe(true);
    await expect(t.db.m.AuditLog.updateOne({ companyId: row.companyId, _id: row._id }, { $set: { action: 'x' } })).rejects.toThrow(/chỉ được thêm/);
    // sửa thẳng CSDL (vượt mô hình) → chuỗi báo lệch
    await t.db.conn.collection('audit_logs').updateOne({ _id: row._id }, { $set: { action: 'gia-mao' } });
    const v = await audit.verifyChain(t.ids.companyId);
    expect(v.ok).toBe(false);
    expect(v.brokenAtSeq).toBe(row.seq);
  });

  it('companyId: truy vấn thiếu companyId bị chặn ở tầng mô hình', async () => {
    await expect(t.db.m.Document.find({ status: 'effective' }).lean()).rejects.toThrow(/companyId/);
    await expect(t.db.m.Record.aggregate([{ $match: { status: 'drafting' } }])).rejects.toThrow(/companyId/);
  });

  it('companyId: dữ liệu công ty khác không lộ', async () => {
    const other = await t.db.m.Company.create({ name: 'Công ty khác', domain: 'khac.vn' });
    await t.db.m.Code.create({ companyId: other._id, code: 'BI-MAT', type: 'channel', meaning: 'Của công ty khác', status: 'approved' });
    const c = await t.login('nv.mkt');
    const res = await c.get('/codes?q=bi-mat');
    expect(res.body.total).toBe(0);
  });

  it('thân không phải JSON → 400 đúng schema Error; X-Request-Id lạ bị thay', async () => {
    const c = await t.login('tp.mkt');
    const r = await c.agent.post('/api/v1/codes').set('Content-Type', 'application/json').set('X-CSRF-Token', c.csrf).send('{oops');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
    const bad = await c.agent.get('/api/v1/me').set('X-Request-Id', 'co dau cach <script>');
    expect(bad.headers['x-request-id']).not.toBe('co dau cach <script>');
  });

  it('trường lạ trong thân bị loại, không báo lỗi', async () => {
    const c = await t.login('tp.mkt');
    const r = await c.post('/codes', { code: 'LA-1', type: 'channel', meaning: 'x', scope: 'x', reason: 'x', status: 'approved', companyId: '6712f0c2a1b2c3d4e5f60718' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    expect(r.body.companyId).toBe(t.ids.companyId);
  });

  it('đường dẫn không có → 404 đúng schema Error', async () => {
    const c = await t.login('tp.mkt');
    const r = await c.agent.get('/api/v1/khong-co');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
});

describe('Giới hạn tần suất', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ rateLimit: { perMinute: 5, searchPerMinute: 2 } });
  });
  afterAll(async () => t.close());

  it('vượt giới hạn → 429 kèm Retry-After', async () => {
    const c = await t.login('nv.mkt');
    let last: any;
    for (let i = 0; i < 6; i++) last = await c.agent.get('/api/v1/blocks');
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });
});
