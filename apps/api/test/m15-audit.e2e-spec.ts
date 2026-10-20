import { Types } from 'mongoose';
import { createTestApp, TestApp, Client } from './support/app';
import { AuditChainService } from '../src/modules/m15-audit/audit-chain.service';
import { readZip } from '../src/modules/m15-audit/zip';
import { auditHash } from '../src/audit/audit.service';
import { dateVN, sha256 } from '../src/common/util';

describe('M15 Nhật ký (giai đoạn 2, E13–E17)', () => {
  let t: TestApp;
  let tgd: Client, r3: Client, it9: Client, tp: Client, gdkKd: Client, nv: Client, nvKd: Client, ktt: Client;
  let chain: AuditChainService;
  const month = dateVN().slice(0, 7);
  const cid = () => new Types.ObjectId(t.ids.companyId);
  const u = (k: string) => t.ids.users[k];
  const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
  let recId: string, secretRecId: string, kdRecId: string;

  const jobOf = async (c: Client, jobId: string) => {
    await t.drain();
    return (await c.get(`/jobs/${jobId}`)).body;
  };

  beforeAll(async () => {
    t = await createTestApp();
    chain = t.app.get(AuditChainService);
    tgd = await t.login('tgd');
    r3 = await t.login('hcns');
    it9 = await t.login('it');
    tp = await t.login('tp.mkt');
    gdkKd = await t.login('gdk.kd');
    nv = await t.login('nv.mkt');
    nvKd = await t.login('nv.kd');
    ktt = await t.login('ktt');
    const r = await nv.post('/records', { recordTypeId: t.ids.recordTypes.seoPlan, kind: 'KH', functionCode: 'SEO-PTDA', subject: 'Kế hoạch nhật ký', workMonth: month });
    recId = (await jobOf(nv, r.body.jobId)).result.objectId;
    const f = await t.db.m.Folder.findOne({ companyId: cid(), _id: new Types.ObjectId(t.ids.folders['TCKT:01']) }).lean<any>();
    const rt = await t.db.m.RecordType.create({ companyId: cid(), departmentId: new Types.ObjectId(t.ids.depts.TCKT.id), name: 'Chứng từ chi', kind: 'DX', folderId: f._id, retentionYears: 10, retentionStatus: 'approved', securityLevel: 'confidential' });
    const s = await ktt.post('/records', { recordTypeId: String(rt._id), kind: 'DX', functionCode: 'KD', subject: 'Chi bí mật', workMonth: month });
    secretRecId = (await jobOf(ktt, s.body.jobId)).result.objectId;
    // hồ sơ của phòng KD (để kiểm phạm vi kiểm toán viên)
    const kf = await t.db.m.Folder.findOne({ companyId: cid(), _id: new Types.ObjectId(t.ids.folders['KD:01']) }).lean<any>();
    const krt = await t.db.m.RecordType.create({ companyId: cid(), departmentId: new Types.ObjectId(t.ids.depts.KD.id), name: 'Báo giá khách', kind: 'DX', folderId: kf._id, retentionYears: 5, retentionStatus: 'approved', securityLevel: 'department' });
    const k = await nvKd.post('/records', { recordTypeId: String(krt._id), kind: 'DX', functionCode: 'KD', subject: 'Báo giá phụ tùng', workMonth: month });
    kdRecId = (await jobOf(nvKd, k.body.jobId)).result.objectId;
  });
  afterAll(async () => t.close());

  describe('GET /audit-logs (E13, E14)', () => {
    it('chỉ đọc theo vai trò: nhân viên → 403; R1 xem tất cả, mới nhất trước, kèm people', async () => {
      expect((await nv.get('/audit-logs')).status).toBe(403);
      const r = await tgd.get('/audit-logs?limit=20');
      expect(r.status).toBe(200);
      const seqs = r.body.items.map((x: any) => x.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
      expect(r.body.items[0]).toMatchObject({ prevHash: expect.stringMatching(/^[a-f0-9]{64}$/), hash: expect.stringMatching(/^[a-f0-9]{64}$/), isRedacted: false });
      expect(r.body.people).toBeDefined();
      const asc = await tgd.get('/audit-logs?sort=seq&limit=1');
      expect(asc.body.items[0].seq).toBe(1);
      expect((await tgd.get('/audit-logs?sort=at')).status).toBe(400);
    });

    it('lọc theo đối tượng, người làm, hành động (so đúng chữ), phòng, thời gian; dòng mới có departmentId', async () => {
      const r = await r3.get(`/audit-logs?objectType=record&objectId=${recId}`);
      expect(r.body.total).toBeGreaterThan(0);
      expect(r.body.items.every((x: any) => x.objectId === recId && x.departmentId === t.ids.depts.MKT.id)).toBe(true);
      const byActor = await r3.get(`/audit-logs?actorId=${u('nv.mkt')}&action=record.create`);
      expect(byActor.body.items.length).toBeGreaterThan(0);
      expect(byActor.body.items.every((x: any) => x.action === 'record.create' && x.actorId === u('nv.mkt'))).toBe(true);
      expect(byActor.body.people[u('nv.mkt')].email).toBe(t.ids.emails['nv.mkt']);
      expect((await r3.get('/audit-logs?action=record')).body.total).toBe(0);
      const from = new Date(Date.now() + 3600_000).toISOString();
      expect((await r3.get(`/audit-logs?from=${encodeURIComponent(from)}`)).body.total).toBe(0);
      expect((await r3.get(`/audit-logs?to=${encodeURIComponent(new Date().toISOString())}&departmentId=${t.ids.depts.MKT.id}`)).body.total).toBeGreaterThan(0);
    });

    it('R4 chỉ phòng mình, R2 các phòng trong khối; phòng ngoài phạm vi → 403', async () => {
      const mine = await tp.get('/audit-logs?limit=200');
      expect(mine.body.total).toBeGreaterThan(0);
      expect(mine.body.items.every((x: any) => x.departmentId === t.ids.depts.MKT.id)).toBe(true);
      expect((await tp.get(`/audit-logs?departmentId=${t.ids.depts.KD.id}`)).status).toBe(403);
      const block = await gdkKd.get('/audit-logs?limit=200');
      expect(new Set(block.body.items.map((x: any) => x.departmentId))).toEqual(new Set([t.ids.depts.MKT.id, t.ids.depts.KD.id]));
    });

    it('dòng về drive Mật người gọi không xem được → isRedacted, bỏ before/after (R9 cũng vậy)', async () => {
      const r9 = await it9.get(`/audit-logs?objectType=record&objectId=${secretRecId}`);
      expect(r9.body.total).toBeGreaterThan(0);
      for (const x of r9.body.items) {
        expect(x.isRedacted).toBe(true);
        expect(x.before).toBeUndefined();
        expect(x.after).toBeUndefined();
      }
      const own = await ktt.get(`/audit-logs?objectType=record&objectId=${secretRecId}`);
      expect(own.body.items.some((x: any) => x.isRedacted === false && x.after)).toBe(true);
    });
  });

  describe('kiểm chuỗi, mỏ neo (E15)', () => {
    it('GET /audit-logs/anchor (R1, R3): đầu chuỗi, chưa kiểm lần nào = never', async () => {
      expect((await nv.get('/audit-logs/anchor')).status).toBe(403);
      expect((await it9.get('/audit-logs/anchor')).status).toBe(403);
      const a = await r3.get('/audit-logs/anchor');
      expect(a.status).toBe(200);
      expect(a.body.lastSeq).toBeGreaterThan(0);
      expect(a.body.verification).toEqual({ status: 'never' });
      expect(a.body.latestAnchor).toBeUndefined();
    });

    it('POST /audit-logs/verify → 202 audit.verify; summary đếm dòng, không result', async () => {
      expect((await nv.post('/audit-logs/verify')).status).toBe(403);
      const r = await tgd.post('/audit-logs/verify');
      expect(r.status).toBe(202);
      const job = await jobOf(tgd, r.body.jobId);
      expect(job).toMatchObject({ type: 'audit.verify', status: 'done', summary: { status: 'ok' } });
      expect(job.result).toBeUndefined();
      const a = (await tgd.get('/audit-logs/anchor')).body;
      expect(a.verification).toMatchObject({ status: 'ok', count: job.summary.count, jobId: r.body.jobId });
    });

    it('audit.anchor (07:00 thứ Hai): email cho R1, dòng mới trong file Sheets khoá ở drive 01 BĐH; một việc mỗi ngày', async () => {
      await chain.enqueueScheduled('audit.anchor');
      await chain.enqueueScheduled('audit.anchor');
      expect(await t.db.m.Job.countDocuments({ companyId: cid(), type: 'audit.anchor' })).toBe(1);
      await t.drain();
      const a = (await r3.get('/audit-logs/anchor')).body;
      expect(a.latestAnchor).toMatchObject({ seq: expect.any(Number), hash: expect.stringMatching(/^[a-f0-9]{64}$/), sentTo: [t.ids.emails.tgd] });
      const file = t.fake.fileState(a.latestAnchor.fileId);
      expect(file.name).toBe('Mỏ neo nhật ký VCdocs');
      expect(file.driveId).toBe(t.ids.depts.BDH.driveId);
      expect(file.contentRestriction?.readOnly).toBe(true);
      expect(file.rows!.at(-1)).toEqual(expect.arrayContaining([a.latestAnchor.seq, a.latestAnchor.hash]));
      expect(t.fake.world.outbox.some((m) => m.to.includes(t.ids.emails.tgd) && m.subject.includes('Mỏ neo nhật ký'))).toBe(true);
      await chain.enqueueScheduled('audit.verify');
      await t.drain();
      expect((await r3.get('/audit-logs/anchor')).body.verification.status).toBe('ok');
    });
  });

  describe('kiểm toán viên (E16)', () => {
    let accessId: string;

    it('POST /auditor-access (R1): hạn ≤ 30 ngày (400), chỉ tài khoản tên miền đang làm (422 BR-15)', async () => {
      const body = { email: t.ids.emails['nv.kd'], departmentIds: [t.ids.depts.MKT.id], expiresAt: inDays(10), reason: 'Kiểm toán nội bộ quý 4' };
      expect((await r3.post('/auditor-access', body)).status).toBe(403);
      expect((await tgd.post('/auditor-access', { ...body, expiresAt: inDays(40) })).status).toBe(400);
      expect((await tgd.post('/auditor-access', { ...body, expiresAt: inDays(-1) })).status).toBe(400);
      expect((await tgd.post('/auditor-access', { ...body, departmentIds: [new Types.ObjectId().toHexString()] })).status).toBe(400);
      expect((await tgd.post('/auditor-access', { ...body, departmentIds: [] })).status).toBe(400);
      const ext = await tgd.post('/auditor-access', { ...body, email: 'kiemtoan@gmail.com' });
      expect(ext.status).toBe(422);
      expect(ext.body.error.rule).toBe('BR-15');
      expect((await tgd.post('/auditor-access', { ...body, email: 'chua-co@vcprosperous.com' })).body.error.rule).toBe('BR-15');
      const r = await tgd.post('/auditor-access', body);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ email: t.ids.emails['nv.kd'], userId: u('nv.kd'), status: 'active', grantedBy: u('tgd'), allowedActions: ['revoke'] });
      expect(r.body.people[u('tgd')]).toBeDefined();
      accessId = r.body.id;
      const n = await t.db.m.Notification.findOne({ companyId: cid(), userId: new Types.ObjectId(u('nv.kd')), type: 'auditor_access_granted' }).lean<any>();
      expect(n).toBeTruthy();
    });

    it('GET /auditor-access (R1, R3), lọc trạng thái; /me có auditorAccess', async () => {
      expect((await nv.get('/auditor-access')).status).toBe(403);
      const l = await r3.get('/auditor-access?status=active');
      expect(l.body.total).toBe(1);
      expect(l.body.items[0].allowedActions).toEqual([]);
      expect((await tgd.get('/auditor-access')).body.items[0].allowedActions).toEqual(['revoke']);
      const me = (await nvKd.get('/me')).body;
      expect(me.auditorAccess).toMatchObject({ id: accessId, departmentIds: [t.ids.depts.MKT.id] });
      expect((await nv.get('/me')).body.auditorAccess).toBeUndefined();
    });

    it('trong phòng được cấp: đọc hồ sơ, phiếu, nhật ký không cần là thành viên drive; mọi lượt ghi auditor.view', async () => {
      const list = await nvKd.get('/records?limit=200');
      expect(list.body.items.map((x: any) => x.id)).toEqual(expect.arrayContaining([recId, kdRecId]));
      expect((await nvKd.get(`/records/${recId}`)).status).toBe(200);
      expect((await nvKd.get(`/records/${secretRecId}`)).status).toBe(404);
      const logs = await nvKd.get('/audit-logs?limit=200');
      expect(logs.status).toBe(200);
      expect(logs.body.items.every((x: any) => x.departmentId === t.ids.depts.MKT.id)).toBe(true);
      expect((await nvKd.get(`/audit-logs?departmentId=${t.ids.depts.TCKT.id}`)).status).toBe(403);
      // phiếu của phòng MKT (nhân viên MKT trình trưởng phòng)
      const seoRep = await nv.post('/records', { recordTypeId: t.ids.recordTypes.seoReport, kind: 'BC', functionCode: 'SEO-PTDA', subject: 'Báo cáo tháng', workMonth: month });
      const repId = (await jobOf(nv, seoRep.body.jobId)).result.objectId;
      await nv.post(`/records/${repId}/submit`);
      const apps = await nvKd.get('/approvals?box=all');
      const a = apps.body.items.find((x: any) => x.objectId === repId);
      expect(a).toBeTruthy();
      expect((await nvKd.get(`/approvals/${a.id}`)).status).toBe(200);
      expect((await nvKd.post(`/approvals/${a.id}/decide`, { result: 'approve' })).status).toBe(403);
      const views = await t.db.m.AuditLog.find({ companyId: cid(), action: 'auditor.view', actorId: new Types.ObjectId(u('nv.kd')) }).lean<any[]>();
      expect(views.length).toBeGreaterThanOrEqual(6);
      expect(views.some((v) => v.objectType === 'record' && v.objectId === recId && String(v.departmentId) === t.ids.depts.MKT.id)).toBe(true);
      expect((await t.db.m.AuditorAccess.findOne({ companyId: cid(), _id: new Types.ObjectId(accessId) }).lean<any>()).lastUsedAt).toBeTruthy();
    });

    it('DELETE (R1) → 204 revoked; lần nữa → 409; hết quyền xem', async () => {
      expect((await r3.del(`/auditor-access/${accessId}`)).status).toBe(403);
      expect((await tgd.del(`/auditor-access/${new Types.ObjectId().toHexString()}`)).status).toBe(404);
      const r = await tgd.del(`/auditor-access/${accessId}`);
      expect(r.status).toBe(204);
      expect((await tgd.del(`/auditor-access/${accessId}`)).status).toBe(409);
      expect((await r3.get('/auditor-access?status=revoked')).body.items[0]).toMatchObject({ id: accessId, revokedBy: u('tgd'), allowedActions: [] });
      expect((await nvKd.get(`/records/${recId}`)).status).toBe(403);
      expect((await nvKd.get('/audit-logs')).status).toBe(403);
    });

    it('quá hạn → expired (việc nền); thu hồi quyền đã hết hạn → 409', async () => {
      const r = await tgd.post('/auditor-access', { email: t.ids.emails['nv.kd'], departmentIds: [t.ids.depts.MKT.id], expiresAt: inDays(1) });
      await t.db.m.AuditorAccess.updateOne({ companyId: cid(), _id: new Types.ObjectId(r.body.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await chain.expireAuditorAccess();
      expect((await r3.get('/auditor-access?status=expired')).body.items.map((x: any) => x.id)).toEqual([r.body.id]);
      expect((await tgd.del(`/auditor-access/${r.body.id}`)).status).toBe(409);
    });
  });

  describe('gói bằng chứng (E17)', () => {
    let packId: string;

    it('đúng một trong documentId, recordId (400); không có → 404; nhân viên → 403', async () => {
      expect((await r3.post('/evidence-pack', {})).status).toBe(400);
      expect((await r3.post('/evidence-pack', { documentId: t.ids.templates['BM-VCPV-02'], recordId: recId })).status).toBe(400);
      expect((await r3.post('/evidence-pack', { recordId: new Types.ObjectId().toHexString() })).status).toBe(404);
      expect((await nv.post('/evidence-pack', { recordId: recId })).status).toBe(403);
    });

    it('hồ sơ đã chốt → ZIP: manifest (SHA-256 từng tệp), PDF bản chốt, approvals.json, audit-logs.csv, anchor.json', async () => {
      const fin = await nv.post(`/records/${recId}/finalize`);
      expect((await jobOf(nv, fin.body.jobId)).status).toBe('done');
      const r = await r3.post('/evidence-pack', { recordId: recId });
      expect(r.status).toBe(202);
      const job = await jobOf(r3, r.body.jobId);
      expect(job).toMatchObject({ type: 'evidence_pack.build', status: 'done', result: { objectType: 'evidence_pack' } });
      packId = job.result.objectId;
      const p = await r3.get(`/evidence-pack/${packId}`);
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ targetType: 'record', targetId: recId, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), createdBy: u('hcns') });
      expect(p.body.people[u('hcns')]).toBeDefined();
      expect(new Date(p.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
      const paths = p.body.files.map((f: any) => f.path);
      expect(paths).toEqual(expect.arrayContaining(['approvals.json', 'audit-logs.csv', 'anchor.json']));
      expect(paths.some((x: string) => x.startsWith('pdf/') && x.includes('bản chốt'))).toBe(true);

      const d = await r3.download(`/evidence-pack/${packId}/download`);
      expect(d.status).toBe(200);
      expect(d.headers['content-type']).toBe('application/zip');
      expect(d.headers['content-disposition']).toMatch(/^attachment; filename="Goi bang chung HS-/);
      expect(sha256(d.body)).toBe(p.body.sha256);
      expect(d.body.length).toBe(p.body.sizeBytes);
      const entries = readZip(d.body);
      const manifest = JSON.parse(entries.find((e) => e.path === 'manifest.json')!.content.toString());
      expect(manifest.target).toMatchObject({ type: 'record', id: recId });
      for (const f of manifest.files) {
        const e = entries.find((x) => x.path === f.path)!;
        expect(sha256(e.content)).toBe(f.sha256);
      }
      const pdf = entries.find((e) => e.path.includes('bản chốt'))!;
      const rec = (await nv.get(`/records/${recId}`)).body;
      expect(sha256(pdf.content)).toBe(rec.finalized.pdfSha256);
      const csv = entries.find((e) => e.path === 'audit-logs.csv')!.content.toString();
      expect(csv).toContain('record.finalized');
      expect(JSON.parse(entries.find((e) => e.path === 'anchor.json')!.content.toString()).verification.status).toBe('ok');
      const dl = await t.db.m.AuditLog.findOne({ companyId: cid(), action: 'evidence_pack.download' }).lean<any>();
      expect(dl.objectId).toBe(recId);
    });

    it('tài liệu: PDF mọi phiên bản đã ban hành trong kho riêng; xem gói: người tạo, R1, R3', async () => {
      const r = await tgd.post('/evidence-pack', { documentId: t.ids.templates['BM-VCPV-02'] });
      const job = await jobOf(tgd, r.body.jobId);
      expect(job.status).toBe('done');
      const id = job.result.objectId;
      expect((await nv.get(`/evidence-pack/${id}`)).status).toBe(403);
      expect((await nv.download(`/evidence-pack/${id}/download`)).status).toBe(403);
      expect((await r3.get(`/evidence-pack/${id}`)).body.targetType).toBe('document');
    });

    it('kiểm toán viên lập gói trong phạm vi; ngoài phạm vi → 403', async () => {
      const g = await tgd.post('/auditor-access', { email: t.ids.emails['nv.kd'], departmentIds: [t.ids.depts.MKT.id], expiresAt: inDays(5) });
      expect(g.status).toBe(201);
      const r = await nvKd.post('/evidence-pack', { recordId: recId });
      expect(r.status).toBe(202);
      const id = (await jobOf(nvKd, r.body.jobId)).result.objectId;
      expect((await nvKd.get(`/evidence-pack/${id}`)).status).toBe(200);
      expect((await nvKd.download(`/evidence-pack/${id}/download`)).status).toBe(200);
      expect((await nvKd.post('/evidence-pack', { recordId: secretRecId })).status).toBe(403);
    });

    it('quá 7 ngày → 404 và bị xoá khỏi máy chủ', async () => {
      await t.db.m.EvidencePack.updateOne({ companyId: cid(), _id: new Types.ObjectId(packId) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await r3.get(`/evidence-pack/${packId}`)).status).toBe(404);
      expect((await r3.download(`/evidence-pack/${packId}/download`)).status).toBe(404);
      await t.app.get(require('../src/modules/m15-audit/evidence.service').EvidenceService).purgeExpired();
      expect((await t.db.m.EvidencePack.findOne({ companyId: cid(), _id: new Types.ObjectId(packId) }).lean<any>()).purgedAt).toBeTruthy();
    });
  });

  describe('chuỗi gãy', () => {
    it('dòng bị sửa ngoài VCdocs → audit.verify báo broken, brokenAtSeq; thông báo audit_chain_broken cho R1, R3, R9', async () => {
      const row = await t.db.m.AuditLog.findOne({ companyId: cid(), seq: 3 }).lean<any>();
      // sửa thẳng trong CSDL (mô hình chặn sửa, đi đường collection)
      await t.db.m.AuditLog.collection.updateOne({ _id: row._id }, { $set: { action: 'gia.mao' } });
      expect(auditHash(row.prevHash, { ...row, action: 'gia.mao' })).not.toBe(row.hash);
      const r = await r3.post('/audit-logs/verify');
      const job = await jobOf(r3, r.body.jobId);
      expect(job.summary).toMatchObject({ status: 'broken', brokenAtSeq: 3 });
      expect((await tgd.get('/audit-logs/anchor')).body.verification).toMatchObject({ status: 'broken', brokenAtSeq: 3 });
      for (const k of ['tgd', 'hcns', 'it']) {
        expect(await t.db.m.Notification.countDocuments({ companyId: cid(), userId: new Types.ObjectId(u(k)), type: 'audit_chain_broken' })).toBe(1);
      }
    });
  });
});
