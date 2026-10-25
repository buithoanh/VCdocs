import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Types } from 'mongoose';
import { APP_CONFIG, AppConfig, FlowRule } from '../../config/config';
import { Db } from '../../db/db.service';
import { AuditService, canonical } from '../../audit/audit.service';
import type { RequestCtx } from '../../common/context';
import { AppError, Errors } from '../../common/errors';
import { safeEqual, sha256 } from '../../common/util';
import { FlowRetryable, FlowSkip, NextcloudFlowClient } from './nextcloud-flow.client';

/**
 * Chat14 Flow: nhận event Nextcloud webhook_listeners → journal Mongo
 * (idempotent theo lớp event + tài nguyên + time) → worker nền xử lý theo
 * thứ tự từng tài nguyên, đọc lại qua API bằng quyền người chạy flow, rồi mới
 * tác động (Deck card, thông báo trong ứng dụng, kiểm tag file).
 */
export const FLOW_EVENTS = {
  formSubmitted: 'OCA\\Forms\\Events\\FormSubmittedEvent',
  rowAdded: 'OCA\\Tables\\Event\\RowAddedEvent',
  rowUpdated: 'OCA\\Tables\\Event\\RowUpdatedEvent',
  rowDeleted: 'OCA\\Tables\\Event\\RowDeletedEvent',
  nodeCreated: 'OCP\\Files\\Events\\Node\\NodeCreatedEvent',
  nodeWritten: 'OCP\\Files\\Events\\Node\\NodeWrittenEvent',
  nodeDeleted: 'OCP\\Files\\Events\\Node\\NodeDeletedEvent',
  nodeRenamed: 'OCP\\Files\\Events\\Node\\NodeRenamedEvent',
} as const;

/** Allowlist: chỉ các lớp event này được nhận; lớp khác → 422 FLOW-01 */
const ALLOWLIST: Record<string, 'forms' | 'tables' | 'files'> = {
  [FLOW_EVENTS.formSubmitted]: 'forms',
  [FLOW_EVENTS.rowAdded]: 'tables',
  [FLOW_EVENTS.rowUpdated]: 'tables',
  [FLOW_EVENTS.rowDeleted]: 'tables',
  [FLOW_EVENTS.nodeCreated]: 'files',
  [FLOW_EVENTS.nodeWritten]: 'files',
  [FLOW_EVENTS.nodeDeleted]: 'files',
  [FLOW_EVENTS.nodeRenamed]: 'files',
};

const NC_UID = /^[A-Za-z0-9._@-]{1,64}$/;
const FUTURE_SKEW_MS = 5 * 60_000;
const MARKER_PREFIX = 'vcw-flow:';
/** Kết quả là quyết định cuối của một rule (không chạy lại khi event được thử lại) */
const APPLIED = new Set(['card_created', 'card_recovered', 'already_done', 'notified', 'no_recipient', 'tag_verified']);

interface Parsed {
  eventClass: string;
  family: 'forms' | 'tables' | 'files';
  resource: Record<string, number>;
  resourceKey: string;
  orderingKey: string;
  time: number;
  actorUid?: string;
}

function posInt(v: unknown, field: string): number {
  if (!Number.isSafeInteger(v) || (v as number) <= 0) throw Errors.validation('Payload event thiếu id hợp lệ', [{ field, issue: 'positive_integer' }]);
  return v as number;
}

/** Chỉ lấy lớp event, id số nguyên, time và uid; không dùng URL hay nội dung nghiệp vụ trong payload */
export function parseEnvelope(body: any): Parsed {
  const event = body?.event;
  const eventClass = event?.class;
  if (typeof eventClass !== 'string') throw Errors.validation('Payload thiếu event.class', [{ field: 'event.class', issue: 'required' }]);
  const family = ALLOWLIST[eventClass];
  if (!family) throw Errors.rule('FLOW-01', 'Lớp event không nằm trong allowlist Flow', [{ field: 'event.class', issue: 'not_allowlisted' }]);
  const time = posInt(body.time, 'time');
  if (time * 1000 > Date.now() + FUTURE_SKEW_MS) throw Errors.validation('Thời điểm event ở tương lai', [{ field: 'time', issue: 'future' }]);
  const uid = body.user?.uid;
  if (uid !== undefined && uid !== null && (typeof uid !== 'string' || !NC_UID.test(uid))) throw Errors.validation('user.uid không hợp lệ', [{ field: 'user.uid', issue: 'format' }]);
  let resource: Record<string, number>;
  let resourceKey: string;
  let orderingKey: string;
  if (family === 'forms') {
    const formId = posInt(event.form?.id, 'event.form.id');
    const submissionId = posInt(event.submission?.id, 'event.submission.id');
    if (event.submission?.formId !== formId) throw Errors.validation('submission.formId lệch form.id', [{ field: 'event.submission.formId', issue: 'mismatch' }]);
    resource = { formId, submissionId };
    resourceKey = `forms:submission:${formId}:${submissionId}`;
    orderingKey = `forms:form:${formId}`;
  } else if (family === 'tables') {
    const tableId = posInt(event.tableId, 'event.tableId');
    const rowId = posInt(event.rowId, 'event.rowId');
    resource = { tableId, rowId };
    resourceKey = `tables:row:${tableId}:${rowId}`;
    orderingKey = resourceKey;
  } else {
    const node = eventClass === FLOW_EVENTS.nodeRenamed ? event.target : event.node;
    const fileId = posInt(node?.id, eventClass === FLOW_EVENTS.nodeRenamed ? 'event.target.id' : 'event.node.id');
    resource = { fileId };
    resourceKey = `files:node:${fileId}`;
    orderingKey = resourceKey;
  }
  return { eventClass, family, resource, resourceKey, orderingKey, time, actorUid: uid ?? undefined };
}

function matches(rule: FlowRule, p: { eventClass: string; resource: Record<string, number> }): boolean {
  if (rule.kind === 'forms.submission-to-deck') return p.eventClass === FLOW_EVENTS.formSubmitted && p.resource.formId === rule.formId;
  if (rule.kind === 'tables.row-notify') return p.eventClass === FLOW_EVENTS.rowAdded && p.resource.tableId === rule.tableId;
  if (rule.kind === 'files.verify-tag') return p.eventClass === FLOW_EVENTS.nodeCreated || p.eventClass === FLOW_EVENTS.nodeWritten;
  return false;
}

/** Bỏ ký tự điều khiển và mọi chuỗi trông như marker Flow (chặn giả marker để chặn tạo thẻ) */
function clean(text: unknown, max: number): string {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split(MARKER_PREFIX).join('vcw-flow')
    .slice(0, max);
}

@Injectable()
export class FlowService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Flow');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private lastReconcile = 0;
  private cursorsFor?: string;
  private readonly clients = new Map<string, NextcloudFlowClient>();

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onApplicationBootstrap() {
    const f = this.cfg.flow;
    if (f.enabled && f.workerPollMs > 0 && !this.timer) {
      this.timer = setInterval(() => this.kick(), f.workerPollMs);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private get companyId() {
    return new Types.ObjectId(this.cfg.flow.companyId);
  }

  /** Header bí mật: so thời gian hằng với từng bí mật còn hiệu lực (bản hiện hành + bản cũ khi xoay vòng) */
  authenticate(token: string | undefined): boolean {
    if (!this.cfg.flow.enabled) throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'MAINTENANCE', 'Flow chưa bật trên máy chủ này');
    if (!token) return false;
    let ok = false;
    for (const s of this.cfg.flow.webhookSecrets) ok = safeEqual(token, s) || ok;
    return ok;
  }

  private client(runner: string): NextcloudFlowClient {
    let c = this.clients.get(runner);
    if (!c) {
      const cred = this.cfg.flow.nextcloud.credentials[runner];
      if (!cred) throw new FlowSkip('runner_missing', 'Runner chưa cấu hình');
      c = new NextcloudFlowClient(this.cfg.flow.nextcloud.baseUrl!, this.cfg.flow.nextcloud.timeoutMs, cred);
      this.clients.set(runner, c);
    }
    return c;
  }

  // ───────────────────────── Nhận event ─────────────────────────

  async ingest(ctx: RequestCtx, body: any): Promise<{ journalId: string; duplicate: boolean; status: string }> {
    const f = this.cfg.flow;
    ctx.companyId = f.companyId;
    const parsed = parseEnvelope(body);
    const companyId = this.companyId;
    // Token tạm (authentication) của webhook_listeners không bao giờ được lưu hay băm vào journal
    const { authentication: _ignored, ...rest } = body ?? {};
    const payloadSha256 = sha256(canonical(rest));
    const dedupeKey = sha256(`${parsed.eventClass}|${parsed.resourceKey}|${parsed.time}`);
    const ruleIds = f.rules.filter((r) => matches(r, parsed)).map((r) => r.id);
    const now = new Date();
    const journalId = new Types.ObjectId();
    const correlationId = `flow-${journalId.toHexString()}`;
    const actor = { companyId: f.companyId!, requestId: correlationId, ip: ctx.ip, device: ctx.device };
    try {
      await this.db.m.FlowEvent.create({
        _id: journalId,
        companyId,
        dedupeKey,
        source: 'webhook',
        eventClass: parsed.eventClass,
        resource: parsed.resource,
        resourceKey: parsed.resourceKey,
        orderingKey: parsed.orderingKey,
        eventTime: new Date(parsed.time * 1000),
        claimedActorUid: parsed.actorUid,
        payloadSha256,
        ruleIds,
        status: ruleIds.length ? 'queued' : 'skipped',
        nextAttemptAt: now,
        receivedAt: now,
        correlationId,
        results: ruleIds.length ? [] : [{ ruleId: null, outcome: 'no_rule' }],
        ...(ruleIds.length ? {} : { finishedAt: now }),
      });
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
      const old = await this.db.m.FlowEvent.findOneAndUpdate({ companyId, dedupeKey }, { $inc: { replayCount: 1 } }, { new: true }).lean<any>();
      const auditId = await this.audit.write({ ...actor, requestId: old.correlationId }, {
        action: 'flow.event.duplicate',
        objectType: 'flow_event',
        objectId: String(old._id),
        after: { eventClass: parsed.eventClass, resourceKey: parsed.resourceKey, replayCount: old.replayCount, payloadMismatch: old.payloadSha256 !== payloadSha256 },
        result: 'denied',
      });
      ctx.auditIds.push(auditId);
      return { journalId: String(old._id), duplicate: true, status: old.status };
    }
    const auditId = await this.audit.write(actor, {
      action: 'flow.event.received',
      objectType: 'flow_event',
      objectId: journalId.toHexString(),
      after: { eventClass: parsed.eventClass, resourceKey: parsed.resourceKey, ruleIds, claimedActorUid: parsed.actorUid },
    });
    ctx.auditIds.push(auditId);
    this.kick();
    return { journalId: journalId.toHexString(), duplicate: false, status: ruleIds.length ? 'queued' : 'skipped' };
  }

  // ───────────────────────── Worker nền ─────────────────────────

  kick() {
    if (this.cfg.flow.workerPollMs <= 0 || this.running || this.stopped || !this.cfg.flow.enabled) return;
    this.running = true;
    (async () => {
      const f = this.cfg.flow;
      if (this.cursorsFor !== f.companyId) {
        await this.ensureCursors();
        this.cursorsFor = f.companyId;
      }
      if (f.reconcileMs > 0 && Date.now() - this.lastReconcile >= f.reconcileMs) {
        this.lastReconcile = Date.now();
        await this.reconcile().catch((e) => this.log.warn(`Đối soát Flow lỗi: ${e?.message ?? e}`));
      }
      await this.drain();
    })()
      .catch((e) => this.log.error(e?.stack ?? e))
      .finally(() => (this.running = false));
  }

  /** Xử lý hết event đến hạn (test gọi trực tiếp) */
  async drain(max = 100): Promise<number> {
    let n = 0;
    while (n < max && !this.stopped) {
      if (!(await this.runOne())) break;
      n++;
    }
    return n;
  }

  /** Lấy event đến hạn, đúng thứ tự: không lấy nếu còn event sớm hơn cùng tài nguyên chưa xong */
  private async claim(): Promise<any | null> {
    const now = new Date();
    const companyId = this.companyId;
    const M = this.db.m.FlowEvent;
    const candidates = await M.find({
      companyId,
      $or: [
        { status: 'queued', nextAttemptAt: { $lte: now } },
        { status: 'running', lockedUntil: { $lt: now } },
      ],
    })
      .sort({ eventTime: 1, _id: 1 })
      .limit(50)
      .lean<any[]>();
    for (const c of candidates) {
      const blocker = await M.exists({
        companyId,
        orderingKey: c.orderingKey,
        _id: { $ne: c._id },
        status: { $in: ['queued', 'running'] },
        $or: [{ eventTime: { $lt: c.eventTime } }, { eventTime: c.eventTime, _id: { $lt: c._id } }],
      });
      if (blocker) continue;
      const claimed = await M.findOneAndUpdate(
        { companyId, _id: c._id, status: c.status, attempts: c.attempts },
        { $set: { status: 'running', lockedUntil: new Date(now.getTime() + this.cfg.flow.leaseMs), startedAt: c.startedAt ?? now }, $inc: { attempts: 1 } },
        { new: true },
      ).lean<any>();
      if (claimed) return claimed;
    }
    return null;
  }

  private async runOne(): Promise<boolean> {
    const ev = await this.claim();
    if (!ev) return false;
    const f = this.cfg.flow;
    const actor = { companyId: f.companyId!, requestId: ev.correlationId };
    const kept = (ev.results ?? []).filter((r: any) => r.ruleId && r.final);
    const results: any[] = [...kept];
    let retry: FlowRetryable | Error | undefined;
    for (const ruleId of ev.ruleIds as string[]) {
      if (kept.some((r: any) => r.ruleId === ruleId)) continue;
      const rule = f.rules.find((r) => r.id === ruleId);
      if (!rule) {
        results.push({ ruleId, outcome: 'rule_removed', final: true });
        continue;
      }
      try {
        const out = await this.apply(rule, ev);
        results.push({ ruleId, final: true, ...out });
      } catch (e: any) {
        if (e instanceof FlowSkip) {
          results.push({ ruleId, outcome: e.outcome, message: e.message, final: true });
          await this.audit.write(actor, { action: 'flow.rule.skipped', objectType: 'flow_event', objectId: String(ev._id), after: { ruleId, outcome: e.outcome }, result: 'denied' });
        } else {
          retry = e;
          results.push({ ruleId, outcome: e instanceof FlowRetryable ? e.outcome : 'error', message: e?.message ?? String(e), final: false });
          if (!(e instanceof FlowRetryable)) this.log.warn(`Flow ${ev._id} rule ${ruleId} lỗi: ${e?.stack ?? e}`);
        }
      }
    }
    const now = new Date();
    const own = { companyId: this.companyId, _id: ev._id, status: 'running', attempts: ev.attempts };
    if (retry && ev.attempts < f.maxAttempts) {
      const nextAttemptAt = new Date(now.getTime() + f.retryBaseMs * 2 ** (ev.attempts - 1));
      await this.db.m.FlowEvent.updateOne(own, { $set: { status: 'queued', results, nextAttemptAt, lockedUntil: null, lastError: retry.message } });
      await this.audit.write(actor, { action: 'flow.event.retry', objectType: 'flow_event', objectId: String(ev._id), after: { attempt: ev.attempts, nextAttemptAt, reason: retry.message } });
      return true;
    }
    const status = retry ? 'failed' : results.some((r) => APPLIED.has(r.outcome)) ? 'done' : 'skipped';
    await this.db.m.FlowEvent.updateOne(own, { $set: { status, results, finishedAt: now, lockedUntil: null, ...(retry ? { lastError: retry.message } : {}) } });
    await this.audit.write(actor, {
      action: `flow.event.${status}`,
      objectType: 'flow_event',
      objectId: String(ev._id),
      after: { attempts: ev.attempts, outcomes: results.map((r) => `${r.ruleId}:${r.outcome}`) },
      result: status === 'done' ? 'ok' : 'denied',
    });
    return true;
  }

  private apply(rule: FlowRule, ev: any): Promise<Record<string, any>> {
    if (rule.kind === 'forms.submission-to-deck') return this.formsToDeck(rule, ev);
    if (rule.kind === 'tables.row-notify') return this.tablesNotify(rule, ev);
    return this.filesVerifyTag(rule, ev);
  }

  /** Một hiệu ứng cho một (rule, khoá nghiệp vụ) dù event đến mấy lần (replay, đối soát) */
  private async effect(ruleId: string, effectKey: string, eventId: Types.ObjectId) {
    return this.db.m.FlowEffect.findOneAndUpdate(
      { companyId: this.companyId, ruleId, effectKey },
      { $setOnInsert: { state: 'pending' }, $addToSet: { eventIds: eventId } },
      { upsert: true, new: true },
    ).lean<any>();
  }

  private async effectDone(ruleId: string, effectKey: string, output: any) {
    await this.db.m.FlowEffect.updateOne({ companyId: this.companyId, ruleId, effectKey }, { $set: { state: 'done', output } });
  }

  // ── (a) Forms → Deck ──
  private async formsToDeck(rule: Extract<FlowRule, { kind: 'forms.submission-to-deck' }>, ev: any) {
    const nc = this.client(rule.runner);
    const { formId, submissionId } = ev.resource;
    const effectKey = `submission:${formId}:${submissionId}`;
    const effect = await this.effect(rule.id, effectKey, ev._id);
    if (effect.state === 'done') return { outcome: 'already_done', cardId: effect.output?.cardId };
    // Đọc lại bằng quyền runner: runner phải còn quyền xem kết quả form và sửa board đích
    const sub = await nc.getSubmission(formId, submissionId);
    if (sub?.id !== submissionId || sub?.formId !== formId) throw new FlowSkip('readback_mismatch', 'Phiếu đọc lại không khớp event');
    const form = await nc.getForm(formId);
    if (!Array.isArray(form?.permissions) || !form.permissions.includes('results')) throw new FlowSkip('runner_no_results', 'Runner không còn quyền xem kết quả form');
    const board = await nc.getBoard(rule.boardId);
    if (!board?.permissions?.PERMISSION_EDIT) throw new FlowSkip('runner_no_board_edit', 'Runner không còn quyền sửa board đích');
    if (!(board.stacks ?? []).some((s: any) => s.id === rule.stackId)) throw new FlowSkip('stack_not_on_board', 'Cột đích không thuộc board');
    // Thẻ chứa câu trả lời: ai xem được board thì đọc được câu trả lời → board phải hẹp như quyền xem kết quả
    const acl = Array.isArray(board.acl) ? board.acl : [];
    if (acl.length && !rule.allowSharedBoard) throw new FlowSkip('board_wider_than_results', 'Board đích đang chia sẻ cho người khác; không chép câu trả lời');

    const questions: any[] = [...(form.questions ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const answers = new Map<number, string[]>();
    for (const a of sub.answers ?? []) {
      if (!answers.has(a.questionId)) answers.set(a.questionId, []);
      answers.get(a.questionId)!.push(clean(a.text, 2000));
    }
    const marker = `${MARKER_PREFIX}${rule.id}:${formId}:${submissionId}`;
    const firstAnswer = questions.map((q) => (answers.get(q.id) ?? []).join(', ').trim()).find(Boolean);
    const title = clean(firstAnswer || `Phiếu #${submissionId}`, 255).replace(/\s+/g, ' ').trim() || `Phiếu #${submissionId}`;
    const lines = questions.map((q) => `**${clean(q.text, 300)}**\n${(answers.get(q.id) ?? []).join(', ') || '—'}`);
    const description = `${lines.join('\n\n')}\n\n---\nNguồn: Forms #${formId}, phiếu #${submissionId}\n${marker}`.slice(0, 10_000);

    // Readback trước khi tạo: lần trước có thể đã tạo thẻ rồi chết trước khi ghi effect
    const hasMarker = (c: any) => String(c?.description ?? '').split('\n').includes(marker);
    const stack = await nc.getStack(rule.boardId, rule.stackId);
    let card = (stack?.cards ?? []).find(hasMarker);
    const created = !card;
    if (!card) card = await nc.createCard(rule.boardId, rule.stackId, { title, description });
    if (!Number.isSafeInteger(card?.id)) throw new FlowRetryable('upstream_bad_body', 'Deck không trả id thẻ');
    const check = await nc.getCard(rule.boardId, rule.stackId, card.id);
    if (!hasMarker(check)) throw new FlowRetryable('readback_pending', 'Đọc lại thẻ chưa thấy marker');
    await this.effectDone(rule.id, effectKey, { cardId: card.id, boardId: rule.boardId, stackId: rule.stackId });
    await this.audit.write({ companyId: this.cfg.flow.companyId!, requestId: ev.correlationId }, {
      action: created ? 'flow.deck.card_created' : 'flow.deck.card_recovered',
      objectType: 'flow_event',
      objectId: String(ev._id),
      after: { ruleId: rule.id, formId, submissionId, cardId: card.id, boardId: rule.boardId, runner: nc.uid, submitterUid: sub.userId },
    });
    return { outcome: created ? 'card_created' : 'card_recovered', cardId: card.id, boardAcl: acl.length };
  }

  // ── (b) Tables → thông báo trong ứng dụng (không gửi email) ──
  private async tablesNotify(rule: Extract<FlowRule, { kind: 'tables.row-notify' }>, ev: any) {
    const nc = this.client(rule.runner);
    const { tableId, rowId } = ev.resource;
    const effectKey = `row:${tableId}:${rowId}`;
    const effect = await this.effect(rule.id, effectKey, ev._id);
    if (effect.state === 'done') return { outcome: 'already_done', delivered: effect.output?.delivered?.length ?? 0 };
    const row = await nc.getRow(rowId);
    if (row?.id !== rowId || row?.tableId !== tableId) throw new FlowSkip('readback_mismatch', 'Dòng đọc lại không thuộc bảng của rule');
    const table = await nc.getTable(tableId);
    const shares = await nc.getTableShares(tableId);
    // Quyết định quyền ở điểm cuối: chỉ chủ bảng và người được share trực tiếp có quyền đọc.
    // Share theo nhóm không tự giải được thành viên bằng quyền runner → không gửi (đóng an toàn).
    const readers = new Set<string>([table?.ownership, ...shares.filter((s) => s.receiverType === 'user' && s.permissionRead === true).map((s) => s.receiver)].filter(Boolean));
    const companyId = this.companyId;
    const actor = { companyId: this.cfg.flow.companyId!, requestId: ev.correlationId };
    const firstValue = clean((row.data ?? [])[0]?.value, 200);
    const link = `/flow/nextcloud/tables/${tableId}/rows/${rowId}`;
    const delivered: string[] = [];
    const denied: { uid: string; reason: string }[] = [];
    for (const uid of rule.recipients) {
      let reason: string | undefined;
      let user: any;
      if (!readers.has(uid)) reason = 'no_table_read';
      else {
        const email = this.cfg.flow.nextcloud.userBindings[uid];
        user = email ? await this.db.m.User.findOne({ companyId, email: email.toLowerCase() }).lean<any>() : undefined;
        if (!email) reason = 'no_binding';
        else if (!user || user.status === 'left' || user.isSuspended) reason = 'inactive';
      }
      if (reason) {
        denied.push({ uid, reason });
        await this.audit.write(actor, { action: 'flow.notify.denied', objectType: 'flow_event', objectId: String(ev._id), after: { ruleId: rule.id, recipientUid: uid, reason }, result: 'denied' });
        continue;
      }
      const exists = await this.db.m.Notification.exists({ companyId, userId: user._id, type: 'flow.tables.row_added', link });
      if (!exists) {
        await this.db.m.Notification.create({
          companyId,
          userId: user._id,
          type: 'flow.tables.row_added',
          title: clean(`Dòng mới trong bảng "${table?.title ?? tableId}"`, 200),
          body: firstValue || undefined,
          link,
          isRead: false,
          emailState: 'none',
        });
      }
      delivered.push(String(user._id));
    }
    await this.effectDone(rule.id, effectKey, { delivered, denied });
    await this.audit.write(actor, {
      action: 'flow.notify.inapp',
      objectType: 'flow_event',
      objectId: String(ev._id),
      after: { ruleId: rule.id, tableId, rowId, delivered: delivered.length, denied: denied.length, runner: nc.uid },
    });
    return { outcome: delivered.length ? 'notified' : 'no_recipient', delivered: delivered.length, denied };
  }

  // ── (c) File vào thư mục chia sẻ → kiểm tag do Flow core gắn ──
  private async filesVerifyTag(rule: Extract<FlowRule, { kind: 'files.verify-tag' }>, ev: any) {
    const nc = this.client(rule.runner);
    const { fileId } = ev.resource;
    const href = await nc.findFileHref(fileId);
    if (!href) throw new FlowSkip('not_visible_to_runner', 'Runner không thấy file');
    if (!href.startsWith(`${nc.filesRoot()}${rule.folderPath}/`)) throw new FlowSkip('outside_folder', 'File không nằm trong thư mục của rule');
    const tags = await nc.getFileTags(fileId);
    if (!tags.includes(rule.tagName)) throw new FlowRetryable('tag_pending', `Chưa thấy tag ${rule.tagName}`);
    await this.audit.write({ companyId: this.cfg.flow.companyId!, requestId: ev.correlationId }, {
      action: 'flow.files.tag_verified',
      objectType: 'flow_event',
      objectId: String(ev._id),
      after: { ruleId: rule.id, fileId, tags, runner: nc.uid },
    });
    return { outcome: 'tag_verified', tags };
  }

  // ───────────────────────── Đối soát bù event bị lỡ ─────────────────────────

  /**
   * webhook_listeners không gửi lại khi receiver lỗi/tắt (job bắt exception rồi bỏ).
   * Đối soát đọc danh sách phiếu/dòng bằng quyền runner, chỉ từ mốc rule được nạp,
   * và đưa phần chưa có journal vào hàng đợi (source = reconcile).
   */
  /** Mốc kích hoạt rule = lần đầu worker chạy với rule đó; đối soát không bù dữ liệu trước mốc */
  async ensureCursors(): Promise<void> {
    for (const rule of this.cfg.flow.rules) {
      if (rule.kind !== 'forms.submission-to-deck' && rule.kind !== 'tables.row-notify') continue;
      await this.cursor(rule.id);
    }
  }

  private cursor(ruleId: string) {
    return this.db.m.FlowCursor.findOneAndUpdate(
      { companyId: this.companyId, ruleId },
      { $setOnInsert: { activatedAt: new Date() } },
      { upsert: true, new: true },
    ).lean<any>();
  }

  async reconcile(): Promise<number> {
    const f = this.cfg.flow;
    if (!f.enabled) return 0;
    const companyId = this.companyId;
    let added = 0;
    for (const rule of f.rules) {
      if (rule.kind !== 'forms.submission-to-deck' && rule.kind !== 'tables.row-notify') continue;
      const cursor = await this.cursor(rule.id);
      const since = new Date(cursor.activatedAt).getTime();
      const nc = this.client(rule.runner);
      const items: { eventClass: string; resource: Record<string, number>; resourceKey: string; orderingKey: string; time: number }[] = [];
      if (rule.kind === 'forms.submission-to-deck') {
        for (const s of await nc.listSubmissions(rule.formId)) {
          if (!Number.isSafeInteger(s?.id) || !Number.isSafeInteger(s?.timestamp) || s.timestamp * 1000 < since) continue;
          items.push({ eventClass: FLOW_EVENTS.formSubmitted, resource: { formId: rule.formId, submissionId: s.id }, resourceKey: `forms:submission:${rule.formId}:${s.id}`, orderingKey: `forms:form:${rule.formId}`, time: s.timestamp });
        }
      } else {
        for (const r of await nc.listRows(rule.tableId)) {
          const created = Date.parse(`${String(r?.createdAt ?? '').replace(' ', 'T')}Z`);
          if (!Number.isSafeInteger(r?.id) || !Number.isFinite(created) || created < since) continue;
          const key = `tables:row:${rule.tableId}:${r.id}`;
          items.push({ eventClass: FLOW_EVENTS.rowAdded, resource: { tableId: rule.tableId, rowId: r.id }, resourceKey: key, orderingKey: key, time: Math.floor(created / 1000) });
        }
      }
      for (const it of items) {
        if (await this.db.m.FlowEvent.exists({ companyId, eventClass: it.eventClass, resourceKey: it.resourceKey })) continue;
        const done = await this.db.m.FlowEffect.exists({ companyId, ruleId: rule.id, state: 'done', effectKey: rule.kind === 'forms.submission-to-deck' ? `submission:${it.resource.formId}:${it.resource.submissionId}` : `row:${it.resource.tableId}:${it.resource.rowId}` });
        if (done) continue;
        const journalId = new Types.ObjectId();
        const now = new Date();
        try {
          await this.db.m.FlowEvent.create({
            _id: journalId,
            companyId,
            dedupeKey: sha256(`reconcile|${it.eventClass}|${it.resourceKey}`),
            source: 'reconcile',
            eventClass: it.eventClass,
            resource: it.resource,
            resourceKey: it.resourceKey,
            orderingKey: it.orderingKey,
            eventTime: new Date(it.time * 1000),
            payloadSha256: sha256(canonical(it)),
            ruleIds: f.rules.filter((r) => matches(r, it)).map((r) => r.id),
            status: 'queued',
            nextAttemptAt: now,
            receivedAt: now,
            correlationId: `flow-${journalId.toHexString()}`,
          });
        } catch (e: any) {
          if (e?.code === 11000) continue;
          throw e;
        }
        added++;
        await this.audit.write({ companyId: f.companyId!, requestId: `flow-${journalId.toHexString()}` }, {
          action: 'flow.event.reconciled',
          objectType: 'flow_event',
          objectId: journalId.toHexString(),
          after: { ruleId: rule.id, resourceKey: it.resourceKey },
        });
      }
      await this.db.m.FlowCursor.updateOne({ companyId, ruleId: rule.id }, { $set: { lastReconcileAt: new Date() } });
    }
    return added;
  }

  // ───────────────────────── Đọc journal (R9) ─────────────────────────

  toApi(ev: any) {
    const receivedAt = new Date(ev.receivedAt);
    const eventTime = new Date(ev.eventTime);
    return {
      id: String(ev._id),
      source: ev.source,
      eventClass: ev.eventClass,
      resourceKey: ev.resourceKey,
      ruleIds: ev.ruleIds ?? [],
      status: ev.status,
      attempts: ev.attempts ?? 0,
      replayCount: ev.replayCount ?? 0,
      claimedActorUid: ev.claimedActorUid ?? null,
      correlationId: ev.correlationId,
      eventTime: eventTime.toISOString(),
      receivedAt: receivedAt.toISOString(),
      finishedAt: ev.finishedAt ? new Date(ev.finishedAt).toISOString() : null,
      deliveryLagMs: Math.max(0, receivedAt.getTime() - eventTime.getTime()),
      processingMs: ev.finishedAt ? Math.max(0, new Date(ev.finishedAt).getTime() - receivedAt.getTime()) : null,
      results: (ev.results ?? []).map(({ final: _f, ...r }: any) => r),
      lastError: ev.lastError ?? null,
    };
  }
}
