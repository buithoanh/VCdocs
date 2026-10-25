import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/config';
import { Db } from '../src/db/db.service';
import { FakeGoogle } from '../src/google/fake/fake-google';
import { GOOGLE } from '../src/google/ports';
import { FlowService } from '../src/modules/flow/flow.service';
import { NextcloudFlowClient } from '../src/modules/flow/nextcloud-flow.client';
import { anon, createTestApp, expectContract, TestApp } from './support/app';
import { FakeNextcloudFlow } from './support/fake-nextcloud-flow';

// Chat14 Flow: receiver webhook_listeners — xác thực header xoay vòng, allowlist,
// journal/idempotency, replay, readback bằng quyền runner, deny/không leo thang,
// thứ tự theo tài nguyên, restart giữa chừng, đối soát bù event bị lỡ.
const SECRET = 'flow14-current-secret-0123456789abcdef';
const OLD_SECRET = 'flow14-previous-secret-0123456789abcdef';
const URL_WEBHOOK = '/api/v1/flow/nextcloud/webhooks';
const OWNER = 'nc-owner';
const MEMBER = 'nc-member';
const LEFT = 'nc-left';
const OUTSIDER = 'nc-outsider';
const FORM = 5;
const BOARD = 8;
const STACK = 24;
const TABLE = 7;
const now = () => Math.floor(Date.now() / 1000);

function formEvent(submissionId: number, time = now(), extra: Record<string, unknown> = {}) {
  return {
    event: {
      class: 'OCA\\Forms\\Events\\FormSubmittedEvent',
      form: { id: FORM, title: 'Flow14 Yêu cầu', ownerId: OWNER },
      submission: { id: submissionId, formId: FORM, userId: MEMBER, timestamp: time },
      ...extra,
    },
    user: { uid: MEMBER, displayName: 'Member' },
    time,
    authentication: [{ token: 'ephemeral-should-never-be-stored' }],
  };
}
const rowEvent = (rowId: number, time = now(), cls = 'OCA\\Tables\\Event\\RowAddedEvent') => ({
  event: { class: cls, tableId: TABLE, rowId, values: [{ columnId: 1, value: 'payload value không được tin' }] },
  user: { uid: MEMBER },
  time,
});
const fileEvent = (fileId: number, time = now(), cls = 'OCP\\Files\\Events\\Node\\NodeCreatedEvent') => ({
  event: { class: cls, node: { id: fileId, path: `/${MEMBER}/files/Flow14-HoSo/x.txt` } },
  user: { uid: MEMBER },
  time,
});

describe('Cấu hình Flow dừng ngay khi sai', () => {
  const env = (extra: Record<string, string>) => ({ NODE_ENV: 'test', GOOGLE_MODE: 'fake', FLOW_ENABLED: 'true', FLOW_COMPANY_ID: 'a'.repeat(24), FLOW_WEBHOOK_SECRETS: SECRET, FLOW_NEXTCLOUD_BASE_URL: 'http://127.0.0.1:18130', ...extra }) as any;
  it('mặc định tắt; bí mật ngắn, URL lạ/có credential, rule thiếu runner hoặc id sai đều bị từ chối', () => {
    expect(loadConfig({ NODE_ENV: 'test', GOOGLE_MODE: 'fake' } as any).flow.enabled).toBe(false);
    expect(() => loadConfig(env({}))).not.toThrow();
    expect(() => loadConfig(env({ FLOW_WEBHOOK_SECRETS: 'ngan' }))).toThrow(/32/);
    expect(() => loadConfig(env({ FLOW_NEXTCLOUD_BASE_URL: 'http://nextcloud.example.com' }))).toThrow(/local/);
    expect(() => loadConfig(env({ FLOW_NEXTCLOUD_BASE_URL: 'http://u:p@127.0.0.1:1' }))).toThrow(/đăng nhập/);
    expect(() => loadConfig(env({ FLOW_COMPANY_ID: '' }))).toThrow(/FLOW_COMPANY_ID/);
    expect(() => loadConfig(env({ FLOW_RULES_JSON: JSON.stringify([{ id: 'r', kind: 'forms.submission-to-deck', runner: 'khong-co', formId: 1, boardId: 1, stackId: 1 }]) }))).toThrow(/runner/);
    expect(() => loadConfig(env({ FLOW_NEXTCLOUD_CREDENTIALS_JSON: JSON.stringify({ r: { username: 'u', password: 'p' } }), FLOW_RULES_JSON: JSON.stringify([{ id: 'r', kind: 'forms.submission-to-deck', runner: 'r', formId: '1; drop', boardId: 1, stackId: 1 }]) }))).toThrow(/số nguyên/);
    expect(() => loadConfig(env({ FLOW_NEXTCLOUD_CREDENTIALS_JSON: JSON.stringify({ r: { username: 'u', password: 'p' } }), FLOW_RULES_JSON: JSON.stringify([{ id: 'r', kind: 'shell.exec', runner: 'r' }]) }))).toThrow(/kind/);
  });
});

describe('Flow receiver webhook Nextcloud (chat14)', () => {
  let t: TestApp;
  let nc: FakeNextcloudFlow;
  let flow: FlowService;
  let nextSubmission = 10;
  let restarted: INestApplication | undefined;

  const post = async (body: any, token: string | null = SECRET, raw = false) => {
    let r = t.http().post(URL_WEBHOOK);
    if (token !== null) r = r.set('X-VCW-Flow-Token', token);
    // Nextcloud gửi JSON không kèm Content-Type
    const res = await (raw ? r.unset('Content-Type').send(Buffer.from(JSON.stringify(body))) : r.send(body));
    if (process.env.FLOW_DEBUG) console.log(res.status, JSON.stringify(res.body));
    expectContract("POST", URL_WEBHOOK, res);
    return res;
  };
  const submission = (text = 'Laptop hỏng', timestamp = now()) => {
    const id = nextSubmission++;
    nc.forms.get(FORM)!.submissions.set(id, { id, formId: FORM, userId: MEMBER, timestamp, answers: [{ questionId: 9, text }, { questionId: 10, text: `Mô tả ${id}` }] });
    return id;
  };
  const events = (filter: any = {}) => t.db.m.FlowEvent.find({ companyId: new Types.ObjectId(t.ids.companyId), ...filter }).sort({ _id: 1 }).lean<any[]>();
  const cardsOf = (submissionId: number) => nc.cards(BOARD, STACK).filter((c) => c.description.split('\n').includes(`vcw-flow:form-deck:${FORM}:${submissionId}`));

  beforeAll(async () => {
    nc = new FakeNextcloudFlow();
    await nc.start();
    nc.passwords = { [OWNER]: 'owner-app-password', [MEMBER]: 'member-app-password' };
    nc.forms.set(FORM, { ownerId: OWNER, results: new Set([OWNER]), questions: [{ id: 10, order: 2, text: 'Mô tả' }, { id: 9, order: 1, text: 'Tiêu đề' }], submissions: new Map() });
    nc.forms.set(6, { ownerId: 'nc-other', results: new Set(['nc-other']), questions: [], submissions: new Map([[99, { id: 99, formId: 6, userId: 'x', timestamp: now(), answers: [] }]]) });
    nc.boards.set(BOARD, { editors: new Set([OWNER]), acl: [], stacks: new Map([[STACK, []]]) });
    nc.tables.set(TABLE, { title: 'Flow14 Sự cố', ownership: OWNER, shares: [{ receiverType: 'user', receiver: MEMBER, permissionRead: true }, { receiverType: 'user', receiver: LEFT, permissionRead: true }, { receiverType: 'group', receiver: 'grp', permissionRead: true }], rows: new Map() });
    t = await createTestApp({
      flow: {
        enabled: true,
        companyId: '000000000000000000000000',
        webhookSecrets: [SECRET, OLD_SECRET],
        nextcloud: {
          baseUrl: nc.origin,
          timeoutMs: 2000,
          credentials: { owner: { username: OWNER, password: 'owner-app-password' } },
          userBindings: { [OWNER]: 'tp.mkt@vcprosperous.com', [MEMBER]: 'nv.mkt@vcprosperous.com', [LEFT]: 'nv.kd@vcprosperous.com', [OUTSIDER]: 'tp.kd@vcprosperous.com' },
        },
        rules: [
          { id: 'form-deck', kind: 'forms.submission-to-deck', runner: 'owner', formId: FORM, boardId: BOARD, stackId: STACK },
          { id: 'table-notify', kind: 'tables.row-notify', runner: 'owner', tableId: TABLE, recipients: [OWNER, MEMBER, LEFT, OUTSIDER] },
          { id: 'files-tag', kind: 'files.verify-tag', runner: 'owner', folderPath: 'Flow14-HoSo', tagName: 'flow14-hoso' },
        ],
        workerPollMs: 0,
        leaseMs: 60_000,
        maxAttempts: 3,
        retryBaseMs: 0,
        reconcileMs: 0,
      },
    });
    t.cfg.flow.companyId = t.ids.companyId;
    flow = t.app.get(FlowService);
    await t.db.m.User.updateOne({ companyId: new Types.ObjectId(t.ids.companyId), email: 'nv.kd@vcprosperous.com' }, { $set: { status: 'left' } });
  });
  afterAll(async () => {
    if (restarted) {
      await t.db.conn.db?.dropDatabase().catch(() => undefined);
      await restarted.close();
    } else await t?.close();
    await nc?.stop();
  });

  it('xác thực header bí mật: thiếu/sai → 401, bí mật cũ còn nhận khi xoay vòng, gỡ bí mật cũ thì 401; không ghi journal', async () => {
    const id = submission();
    expect((await post(formEvent(id), null)).status).toBe(401);
    expect((await post(formEvent(id), 'x'.repeat(40))).status).toBe(401);
    expect((await post(formEvent(id), SECRET.slice(0, -1))).status).toBe(401);
    expect(await events()).toHaveLength(0);
    const old = await post(formEvent(id), OLD_SECRET);
    expect(old.status).toBe(202);
    t.cfg.flow.webhookSecrets = [SECRET];
    try {
      expect((await post(formEvent(id, now() + 1), OLD_SECRET)).status).toBe(401);
    } finally {
      t.cfg.flow.webhookSecrets = [SECRET, OLD_SECRET];
    }
    expect(await events()).toHaveLength(1);
    t.cfg.flow.enabled = false;
    try {
      const off = await post(formEvent(id), SECRET);
      expect(off.status).toBe(503);
      expect(off.body.error.code).toBe('MAINTENANCE');
    } finally {
      t.cfg.flow.enabled = true;
    }
    await flow.drain();
  });

  it('allowlist lớp event và kiểm id: Deck/lớp lạ → 422 FLOW-01, payload sai → 400', async () => {
    const deck = await post({ event: { class: 'OCA\\Deck\\Event\\CardCreatedEvent', card: { id: 1 } }, user: { uid: MEMBER }, time: now() });
    expect(deck.status).toBe(422);
    expect(deck.body.error.rule).toBe('FLOW-01');
    expect((await post({ event: { class: 'OCA\\WorkflowEngine\\Something' }, time: now() })).status).toBe(422);
    expect((await post({ event: {}, time: now() })).status).toBe(400);
    expect((await post({ ...formEvent(1), time: now() + 3600 })).status).toBe(400);
    expect((await post({ event: { class: 'OCA\\Tables\\Event\\RowAddedEvent', tableId: TABLE, rowId: '1; drop' }, time: now() })).status).toBe(400);
    const mismatch = formEvent(1);
    mismatch.event.submission.formId = 6;
    expect((await post(mismatch)).status).toBe(400);
    expect((await post({ ...formEvent(1), user: { uid: '../../etc' } })).status).toBe(400);
    expect(await events({ eventClass: { $ne: 'OCA\\Forms\\Events\\FormSubmittedEvent' } })).toHaveLength(0);
  });

  it('Form → thẻ Deck: đọc câu trả lời qua API bằng quyền runner, không tin payload, không tải URL trong payload; audit cùng correlationId', async () => {
    const id = submission('Máy in kẹt giấy');
    const fetchSpy = jest.spyOn(global, 'fetch');
    const res = await post(formEvent(id, now(), { answers: [{ text: 'GIẢ MẠO từ payload' }], url: 'http://169.254.169.254/latest/meta-data' }), SECRET, true);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ duplicate: false, status: 'queued' });
    expect(res.headers['x-audit-id']).toBeDefined();
    await flow.drain();
    const fetched = fetchSpy.mock.calls.map((c) => String(c[0]));
    fetchSpy.mockRestore();
    expect(fetched.every((u) => u.startsWith(nc.origin))).toBe(true);
    const cards = cardsOf(id);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Máy in kẹt giấy');
    expect(cards[0].description).toContain(`Mô tả ${id}`);
    expect(cards[0].description).not.toContain('GIẢ MẠO');
    expect(nc.requests.filter((r) => r.path.includes('/deck/')).every((r) => r.user === OWNER)).toBe(true);
    const [ev] = await events({ resourceKey: `forms:submission:${FORM}:${id}` });
    expect(ev.status).toBe('done');
    expect(ev.results[0]).toMatchObject({ ruleId: 'form-deck', outcome: 'card_created', cardId: cards[0].id });
    expect(JSON.stringify(ev)).not.toContain('ephemeral-should-never-be-stored');
    const audits = await t.db.m.AuditLog.find({ companyId: new Types.ObjectId(t.ids.companyId), requestId: ev.correlationId }).sort({ seq: 1 }).lean<any[]>();
    expect(audits.map((a) => a.action)).toEqual(['flow.event.received', 'flow.deck.card_created', 'flow.event.done']);
    expect(audits[0]._id.toHexString()).toBe(res.headers['x-audit-id']);
  });

  it('replay cùng payload không nhân đôi; cùng phiếu với time khác chỉ là already_done', async () => {
    const id = submission('Màn hình nhấp nháy');
    const body = formEvent(id);
    const first = await post(body);
    await flow.drain();
    const again = await post(body);
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ journalId: first.body.journalId, duplicate: true, status: 'done' });
    const tampered = await post({ ...body, event: { ...body.event, form: { ...body.event.form, title: 'đổi' } } });
    expect(tampered.body.duplicate).toBe(true);
    await flow.drain();
    expect(cardsOf(id)).toHaveLength(1);
    const [ev] = await events({ resourceKey: `forms:submission:${FORM}:${id}` });
    expect(ev.replayCount).toBe(2);
    const dup = await t.db.m.AuditLog.find({ companyId: new Types.ObjectId(t.ids.companyId), requestId: ev.correlationId, action: 'flow.event.duplicate' }).lean<any[]>();
    expect(dup.map((a) => a.after.payloadMismatch)).toEqual([false, true]);
    // Nextcloud phát lại cùng phiếu (time khác) → journal mới nhưng hiệu ứng đã có
    const late = await post(formEvent(id, now() + 2));
    expect(late.body.duplicate).toBe(false);
    await flow.drain();
    expect(cardsOf(id)).toHaveLength(1);
    expect((await t.db.m.FlowEvent.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(late.body.journalId) }).lean<any>()).results[0].outcome).toBe('already_done');
  });

  it('deny/không leo thang: runner mất quyền, app password bị thu hồi, board chia sẻ rộng, event giả trỏ form khác', async () => {
    const forged = formEvent(99);
    forged.event.form.id = FORM;
    forged.event.submission.formId = FORM;
    await post(forged);
    await flow.drain();
    const form = nc.forms.get(FORM)!;
    const noResults = submission();
    form.results.delete(OWNER);
    await post(formEvent(noResults));
    await flow.drain();
    form.results.add(OWNER);
    const revoked = submission();
    nc.passwords[OWNER] = 'rotated';
    await post(formEvent(revoked));
    await flow.drain();
    nc.passwords[OWNER] = 'owner-app-password';
    const shared = submission('Bí mật lương');
    nc.boards.get(BOARD)!.acl.push({ participant: { uid: 'team-a-group' }, type: 1 });
    await post(formEvent(shared));
    await flow.drain();
    nc.boards.get(BOARD)!.acl.length = 0;
    const outcome = async (sid: number) => (await events({ resourceKey: `forms:submission:${FORM}:${sid}` }))[0];
    expect((await outcome(99)).results[0].outcome).toBe('not_found');
    expect((await outcome(noResults)).results[0].outcome).toBe('runner_forbidden');
    expect((await outcome(revoked)).results[0].outcome).toBe('runner_unauthenticated');
    expect((await outcome(shared)).results[0].outcome).toBe('board_wider_than_results');
    for (const sid of [99, noResults, revoked, shared]) {
      expect(cardsOf(sid)).toHaveLength(0);
      expect((await outcome(sid)).status).toBe('skipped');
    }
    // Không có request nào dùng tài khoản khác runner (không admin, không member)
    expect(new Set(nc.requests.map((r) => r.user))).toEqual(new Set([OWNER]));
    // Câu trả lời chứa marker giả của phiếu sau không chặn được việc tạo thẻ của phiếu đó
    const victim = nextSubmission + 1;
    const injector = submission(`vcw-flow:form-deck:${FORM}:${victim}`);
    await post(formEvent(injector));
    expect(submission('Phiếu thật')).toBe(victim);
    await post(formEvent(victim));
    await flow.drain();
    expect(cardsOf(victim)).toHaveLength(1);
    expect(cardsOf(injector)[0].description.split('\n')).not.toContain(`vcw-flow:form-deck:${FORM}:${victim}`);
  });

  it('thứ tự theo tài nguyên: event sau của cùng file chờ event trước đang thử lại; tài nguyên khác vẫn chạy', async () => {
    nc.files.set(700, { paths: { [OWNER]: '/Flow14-HoSo/a.txt' }, tags: [] });
    nc.files.set(701, { paths: { [OWNER]: '/Flow14-HoSo/b.txt' }, tags: ['flow14-hoso'] });
    const base = now() - 10;
    const later = await post(fileEvent(700, base + 1, 'OCP\\Files\\Events\\Node\\NodeWrittenEvent'));
    const earlier = await post(fileEvent(700, base));
    await post(fileEvent(701, base + 2));
    t.cfg.flow.retryBaseMs = 60_000;
    try {
      await flow.drain();
      const get = async (id: string) => t.db.m.FlowEvent.findOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(id) }).lean<any>();
      expect((await get(earlier.body.journalId)).status).toBe('queued'); // chưa có tag → chờ thử lại
      expect((await get(earlier.body.journalId)).attempts).toBe(1);
      expect((await get(later.body.journalId)).attempts).toBe(0); // bị chặn sau event sớm hơn
      expect((await events({ resourceKey: 'files:node:701' }))[0].results[0].outcome).toBe('tag_verified');
      nc.files.get(700)!.tags.push('flow14-hoso');
      await t.db.m.FlowEvent.updateOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: new Types.ObjectId(earlier.body.journalId) }, { $set: { nextAttemptAt: new Date() } });
      await flow.drain();
      const e1 = await get(earlier.body.journalId);
      const e2 = await get(later.body.journalId);
      expect([e1.status, e2.status]).toEqual(['done', 'done']);
      expect(new Date(e1.finishedAt).getTime()).toBeLessThanOrEqual(new Date(e2.startedAt).getTime());
    } finally {
      t.cfg.flow.retryBaseMs = 0;
    }
  });

  it('file ngoài thư mục, runner không thấy, tag không bao giờ có → skipped/failed sau số lần thử tối đa', async () => {
    nc.files.set(710, { paths: { [OWNER]: '/Khac/c.txt' }, tags: ['flow14-hoso'] });
    nc.files.set(711, { paths: { [MEMBER]: '/Flow14-HoSo/rieng.txt' }, tags: ['flow14-hoso'] });
    nc.files.set(712, { paths: { [OWNER]: '/Flow14-HoSo/d.txt' }, tags: [] });
    await post(fileEvent(710));
    await post(fileEvent(711));
    await post(fileEvent(712));
    for (let i = 0; i < 4; i++) await flow.drain();
    const one = async (id: number) => (await events({ resourceKey: `files:node:${id}` }))[0];
    expect((await one(710)).results[0].outcome).toBe('outside_folder');
    expect((await one(711)).results[0].outcome).toBe('not_visible_to_runner');
    const failed = await one(712);
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(3);
    expect(failed.lastError).toContain('flow14-hoso');
  });

  it('Nextcloud 503 → thử lại rồi xong, không mất event', async () => {
    const id = submission('Wifi chập chờn');
    await post(formEvent(id));
    nc.fail503 = 1;
    await flow.drain();
    const [mid] = await events({ resourceKey: `forms:submission:${FORM}:${id}` });
    expect(mid.status).toBe('done');
    expect(mid.attempts).toBe(2);
    expect(cardsOf(id)).toHaveLength(1);
  });

  it('Tables → thông báo trong ứng dụng: quyền quyết định ở điểm cuối, người ngoài/đã nghỉ không nhận, không gửi email', async () => {
    const outbox = (t.app.get(GOOGLE) as FakeGoogle).world.outbox.length;
    nc.tables.get(TABLE)!.rows.set(41, { id: 41, tableId: TABLE, createdAt: '2026-10-25 08:00:00', data: [{ columnId: 1, value: 'Máy lạnh phòng họp hỏng' }] });
    const body = rowEvent(41);
    expect((await post(body)).status).toBe(202);
    await post(body);
    await flow.drain();
    const [ev] = await events({ resourceKey: `tables:row:${TABLE}:41` });
    expect(ev.status).toBe('done');
    expect(ev.results[0].outcome).toBe('notified');
    expect(ev.results[0].delivered).toBe(2);
    expect(ev.results[0].denied).toEqual([{ uid: LEFT, reason: 'inactive' }, { uid: OUTSIDER, reason: 'no_table_read' }]);
    const member = await t.login('nv.mkt');
    const list = await member.get('/notifications');
    const mine = list.body.items.filter((n: any) => n.type === 'flow.tables.row_added');
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toBe('Máy lạnh phòng họp hỏng');
    const outsider = await t.login('tp.kd');
    expect((await outsider.get('/notifications')).body.items.filter((n: any) => n.type === 'flow.tables.row_added')).toHaveLength(0);
    expect((t.app.get(GOOGLE) as FakeGoogle).world.outbox.length).toBe(outbox);
    // Row giả (id thuộc bảng khác) → không thông báo
    nc.tables.set(8, { title: 'Bảng khác', ownership: OWNER, shares: [], rows: new Map([[42, { id: 42, tableId: 8, createdAt: '2026-10-25 08:00:00', data: [] }]]) });
    await post(rowEvent(42));
    await flow.drain();
    expect((await events({ resourceKey: `tables:row:${TABLE}:42` }))[0].results[0].outcome).toBe('readback_mismatch');
  });

  it('đối soát bù event bị lỡ (Nextcloud không gửi lại): tạo thẻ một lần, webhook đến muộn chỉ already_done', async () => {
    await flow.reconcile(); // nạp mốc kích hoạt rule
    const id = submission('Gửi lúc receiver đang tắt', now() + 1);
    nc.tables.get(TABLE)!.rows.set(50, { id: 50, tableId: TABLE, createdAt: new Date(Date.now() + 1000).toISOString().slice(0, 19).replace('T', ' '), data: [{ columnId: 1, value: 'Dòng lỡ webhook' }] });
    expect(await flow.reconcile()).toBe(2);
    expect(await flow.reconcile()).toBe(0);
    await flow.drain();
    expect(cardsOf(id)).toHaveLength(1);
    const [rec] = await events({ resourceKey: `forms:submission:${FORM}:${id}` });
    expect(rec.source).toBe('reconcile');
    await post(formEvent(id));
    await flow.drain();
    expect(cardsOf(id)).toHaveLength(1);
    expect((await events({ resourceKey: `tables:row:${TABLE}:50` }))[0].results[0].outcome).toBe('notified');
  });

  it('R9 đọc journal; người khác 403, chưa đăng nhập 401', async () => {
    const it9 = await t.login('it');
    const page = await it9.get('/flow/events?status=done&limit=5');
    expect(page.status).toBe(200);
    expect(page.body.items.length).toBeGreaterThan(0);
    expect(page.body.items.every((e: any) => e.status === 'done')).toBe(true);
    const one = await it9.get(`/flow/events/${page.body.items[0].id}`);
    expect(one.status).toBe(200);
    expect(one.body.correlationId).toMatch(/^flow-[a-f0-9]{24}$/);
    expect((await it9.get(`/flow/events/${new Types.ObjectId().toHexString()}`)).status).toBe(404);
    expect((await it9.get('/flow/events?ruleId=form-deck')).body.items.every((e: any) => e.ruleIds.includes('form-deck'))).toBe(true);
    const member = await t.login('nv.mkt');
    expect((await member.get('/flow/events')).status).toBe(403);
    expect((await member.get(`/flow/events/${page.body.items[0].id}`)).status).toBe(403);
    expect((await anon(t, 'get', '/flow/events')).status).toBe(401);
    expect((await anon(t, 'get', `/flow/events/${page.body.items[0].id}`)).status).toBe(401);
    // Không rò ra ngoài: request không xác thực không đọc được gì
    expect((await request(t.app.getHttpServer()).post(URL_WEBHOOK).send({})).status).toBe(401);
  });
  it('restart giữa chừng: thẻ đã tạo nhưng chưa ghi effect, app mới trên cùng CSDL lấy lại lease và không tạo thẻ thứ hai', async () => {
    const id = submission('Mất mạng tầng 3');
    await post(formEvent(id));
    const original = NextcloudFlowClient.prototype.createCard;
    const spy = jest.spyOn(NextcloudFlowClient.prototype, 'createCard').mockImplementationOnce(async function (this: NextcloudFlowClient, ...args: Parameters<NextcloudFlowClient['createCard']>) {
      await original.apply(this, args);
      throw new Error('SIMULATED_CRASH sau khi Deck đã tạo thẻ');
    });
    await flow.drain(1);
    spy.mockRestore();
    expect(cardsOf(id)).toHaveLength(1);
    const [mid] = await events({ resourceKey: `forms:submission:${FORM}:${id}` });
    expect(mid.status).toBe('queued');
    // Giả tiến trình chết khi đang chạy lần 2: status running, lease đã hết hạn
    await t.db.m.FlowEvent.updateOne({ companyId: new Types.ObjectId(t.ids.companyId), _id: mid._id }, { $set: { status: 'running', lockedUntil: new Date(Date.now() - 1000) }, $inc: { attempts: 1 } });
    await t.app.close();
    restarted = await createApp({ ...t.cfg }, { logger: false });
    t.db = restarted.get(Db);
    flow = restarted.get(FlowService);
    expect(await flow.drain()).toBeGreaterThanOrEqual(1);
    const [after] = await events({ resourceKey: `forms:submission:${FORM}:${id}` });
    expect(after.status).toBe('done');
    expect(after.attempts).toBe(3);
    expect(after.results[0].outcome).toBe('card_recovered');
    expect(cardsOf(id)).toHaveLength(1);
    const res = await request(restarted.getHttpServer()).post(URL_WEBHOOK).set('X-VCW-Flow-Token', SECRET).send(formEvent(id, mid.eventTime.getTime() / 1000));
    expect(res.body).toMatchObject({ duplicate: true, status: 'done' });
  });
});
