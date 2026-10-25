import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditService } from '../../audit/audit.service';
import { Ctx } from '../../common/context';
import { Errors } from '../../common/errors';
import { randomToken, sha256 } from '../../common/util';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Db } from '../../db/db.service';
import { OidcService } from './oidc.service';
import { MailBasicService } from '../mail-basic/mail-basic.service';
import { IDENTITY_LIFECYCLE_PORT, IdentityLifecyclePort, IdentityProjection } from './identity-lifecycle.port';

const STEP_NAMES = ['app-deny', 'authentik', 'nextcloud', 'app-commit'] as const;

@Injectable()
export class IdentityLifecycleService {
  constructor(private readonly db: Db, private readonly oidc: OidcService, private readonly audit: AuditService, @Inject(IDENTITY_LIFECYCLE_PORT) private readonly port: IdentityLifecyclePort, private readonly mail: MailBasicService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** Không có cổng thật thì từ chối trước khi app-deny khoá user, thay vì báo done chỉ ở app (audit 8/12). */
  private assertEnabled() {
    if (this.cfg.identityLifecycle.mode === 'disabled') throw Errors.storageUnavailable('Identity lifecycle chưa cấu hình cổng Authentik/Nextcloud; thao tác tại IdP rồi người dùng đăng nhập lại');
  }

  private api(row: any) {
    return { id: String(row._id), subject: row.subject, subjectRevision: row.subjectRevision, desired: row.desired, status: row.status, steps: row.steps, version: row.version, ...(row.lastError ? { lastError: row.lastError } : {}), ...(row.completedAt ? { completedAt: row.completedAt } : {}), createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async create(ctx: Ctx, input: any, idempotencyKey?: string) {
    this.assertEnabled();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) throw Errors.validation('Idempotency-Key không hợp lệ');
    const subject = String(input?.subject || '').trim();
    const email = String(input?.email || '').trim().toLowerCase();
    const rawGroups: unknown[] = Array.isArray(input?.groups) ? input.groups : [];
    const groups: string[] = [...new Set(rawGroups.map((value) => String(value)))].sort();
    if (!subject || !/^\S+@\S+\.\S+$/.test(email) || typeof input?.active !== 'boolean' || groups.some((group) => !group || group.length > 200)) throw Errors.validation('Projection identity không hợp lệ');
    const desired: IdentityProjection = { subject, email, groups, active: input.active, globalRevoke: Boolean(input.globalRevoke) };
    const fingerprint = sha256(JSON.stringify(desired));
    let row = await this.db.m.IdentityLifecycleOperation.findOne({ companyId: new Types.ObjectId(ctx.companyId), idempotencyKey }).lean<any>();
    if (row) {
      if (row.fingerprint !== fingerprint) throw Errors.state('Idempotency-Key đã bind với projection khác');
      row = await this.allocateSubjectRevision(ctx, row);
      if (row.status !== 'done') row = await this.run(ctx, String(row._id));
      return this.api(row);
    }
    const cid = new Types.ObjectId(ctx.companyId);
    const binding = await this.db.m.OidcIdentity.findOne({ companyId: cid, subject }).lean<any>();
    if (!binding) throw Errors.notFound('Không tìm thấy OIDC binding');
    try {
      row = (await this.db.m.IdentityLifecycleOperation.create({ companyId: cid, idempotencyKey, fingerprint, subject, subjectRevision: 0, desired, status: 'pending', steps: STEP_NAMES.map((name) => ({ name, status: 'pending', attempts: 0 })), createdBy: new Types.ObjectId(ctx.user.id), updatedBy: new Types.ObjectId(ctx.user.id) })).toObject();
    } catch (error: any) {
      if (error?.code === 11000) return this.create(ctx, input, idempotencyKey);
      throw error;
    }
    row = await this.allocateSubjectRevision(ctx, row);
    row = await this.run(ctx, String(row._id));
    await this.audit.record(ctx, { action: 'identity.lifecycle.reconcile', objectType: 'identity_lifecycle_operation', objectId: String(row._id), after: { subject, status: row.status, globalRevoke: desired.globalRevoke } });
    return this.api(row);
  }

  private async allocateSubjectRevision(ctx: Ctx, row: any) {
    if (row.subjectRevision > 0) {
      await this.db.m.IdentityLifecycleSubject.updateOne({ companyId: row.companyId, subject: row.subject, reservedOperationId: row._id }, { $unset: { reservedOperationId: 1, reservedRevision: 1 } });
      return row;
    }
    const cid = new Types.ObjectId(ctx.companyId), uid = new Types.ObjectId(ctx.user.id);
    let state = await this.db.m.IdentityLifecycleSubject.findOne({ companyId: cid, subject: row.subject }).lean<any>();
    if (!state) {
      try {
        state = (await this.db.m.IdentityLifecycleSubject.create({ companyId: cid, subject: row.subject, revision: 0, appliedRevision: 0, status: 'pending', reservedOperationId: row._id, createdBy: uid, updatedBy: uid })).toObject();
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        state = await this.db.m.IdentityLifecycleSubject.findOne({ companyId: cid, subject: row.subject }).lean<any>();
      }
    }
    if (state.reservedOperationId && String(state.reservedOperationId) !== String(row._id)) throw Errors.state('Identity subject đang cấp revision cho operation khác');
    if (!state.reservedOperationId) {
      state = await this.db.m.IdentityLifecycleSubject.findOneAndUpdate(
        { _id: state._id, companyId: cid, revision: state.revision, reservedOperationId: { $exists: false } },
        { $set: { reservedOperationId: row._id, status: 'pending', updatedBy: uid } }, { new: true },
      ).lean<any>();
      if (!state) throw Errors.state('Identity subject đang cấp revision cho operation khác');
    }
    if (!state.reservedRevision) {
      state = await this.db.m.IdentityLifecycleSubject.findOneAndUpdate(
        { _id: state._id, companyId: cid, revision: state.revision, reservedOperationId: row._id, reservedRevision: { $exists: false } },
        [{ $set: { revision: { $add: ['$revision', 1] }, reservedRevision: { $add: ['$revision', 1] }, desiredFingerprint: row.fingerprint, status: 'pending', updatedBy: uid } }],
        { new: true },
      ).lean<any>();
      if (!state) state = await this.db.m.IdentityLifecycleSubject.findOne({ companyId: cid, subject: row.subject, reservedOperationId: row._id }).lean<any>();
    }
    if (!state?.reservedRevision) throw Errors.state('Không cấp được subject revision');
    const assigned = await this.db.m.IdentityLifecycleOperation.findOneAndUpdate(
      { _id: row._id, companyId: cid, subjectRevision: 0 }, { $set: { subjectRevision: state.reservedRevision } }, { new: true },
    ).lean<any>();
    row = assigned || await this.db.m.IdentityLifecycleOperation.findOne({ _id: row._id, companyId: cid }).lean<any>();
    await this.db.m.IdentityLifecycleSubject.updateOne({ _id: state._id, companyId: cid, reservedOperationId: row._id, reservedRevision: row.subjectRevision }, { $unset: { reservedOperationId: 1, reservedRevision: 1 } });
    return row;
  }

  async get(ctx: Ctx, id: string) {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound();
    const row = await this.db.m.IdentityLifecycleOperation.findOne({ _id: new Types.ObjectId(id), companyId: new Types.ObjectId(ctx.companyId) }).lean<any>();
    if (!row) throw Errors.notFound();
    return this.api(row);
  }

  async reconcile(ctx: Ctx, id: string) {
    this.assertEnabled();
    const row = await this.run(ctx, id);
    await this.audit.record(ctx, { action: 'identity.lifecycle.retry', objectType: 'identity_lifecycle_operation', objectId: id, after: { status: row.status } });
    return this.api(row);
  }

  private same(actual: any, desired: IdentityProjection) {
    return actual.subject === desired.subject && actual.email === desired.email && actual.active === desired.active && JSON.stringify([...actual.groups].sort()) === JSON.stringify([...desired.groups].sort());
  }

  private async run(ctx: Ctx, id: string) {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound();
    const cid = new Types.ObjectId(ctx.companyId), oid = new Types.ObjectId(id), leaseToken = randomToken(16), now = new Date();
    let row = await this.db.m.IdentityLifecycleOperation.findOne({ _id: oid, companyId: cid }).lean<any>();
    if (!row) throw Errors.notFound();
    if (row.status === 'done' || row.status === 'superseded') return row;
    const subjectLease = await this.db.m.IdentityLifecycleSubject.findOneAndUpdate(
      { companyId: cid, subject: row.subject, revision: row.subjectRevision, $or: [{ leaseUntil: { $lt: now } }, { leaseUntil: { $exists: false } }] },
      { $set: { status: 'running', leaseToken, leaseUntil: new Date(Date.now() + 30_000) } }, { new: true },
    ).lean<any>();
    if (!subjectLease) {
      const state = await this.db.m.IdentityLifecycleSubject.findOne({ companyId: cid, subject: row.subject }).lean<any>();
      if (state && state.revision > row.subjectRevision) {
        await this.db.m.IdentityLifecycleOperation.updateOne({ _id: oid, companyId: cid }, { $set: { status: 'superseded', lastError: 'SUPERSEDED_BY_NEWER_SUBJECT_REVISION' } });
        return this.db.m.IdentityLifecycleOperation.findOne({ _id: oid, companyId: cid }).lean<any>();
      }
      throw Errors.state('Identity subject đang được operation khác reconcile');
    }
    row = await this.db.m.IdentityLifecycleOperation.findOneAndUpdate(
      { _id: oid, companyId: cid, status: { $nin: ['done', 'superseded'] }, $or: [{ leaseUntil: { $lt: now } }, { leaseUntil: { $exists: false } }] },
      { $set: { status: 'running', leaseToken, leaseUntil: new Date(Date.now() + 30_000), updatedBy: new Types.ObjectId(ctx.user.id) }, $inc: { version: 1 } }, { new: true },
    ).lean<any>();
    if (!row) {
      await this.releaseSubject(cid, subjectLease.subject, leaseToken, 'partial');
      throw Errors.state('Lifecycle operation đang được process khác reconcile');
    }
    const desired = row.desired as IdentityProjection;
    try {
      for (const name of STEP_NAMES) {
        await this.assertFence(cid, row.subject, row.subjectRevision, leaseToken);
        const started = await this.db.m.IdentityLifecycleOperation.updateOne({ _id: oid, companyId: cid, leaseToken }, { $set: { 'steps.$[step].status': 'running' }, $inc: { 'steps.$[step].attempts': 1 } }, { arrayFilters: [{ 'step.name': name }] });
        if (started.matchedCount !== 1) throw new Error('LIFECYCLE_LEASE_LOST');
        if (name === 'app-deny') await this.denyApp(cid, desired, row.subjectRevision);
        if (name === 'authentik') { await this.port.applyAuthentik(desired); if (!this.same(await this.port.readAuthentik(desired.subject), desired)) throw new Error('AUTHENTIK_READBACK_MISMATCH'); }
        if (name === 'nextcloud') { await this.port.applyNextcloud(desired); if (!this.same(await this.port.readNextcloud(desired.subject), desired)) throw new Error('NEXTCLOUD_READBACK_MISMATCH'); }
        await this.assertFence(cid, row.subject, row.subjectRevision, leaseToken);
        if (name === 'app-commit') await this.commitApp(cid, desired, row.subjectRevision, leaseToken);
        await this.db.m.IdentityLifecycleOperation.updateOne({ _id: oid, companyId: cid, leaseToken }, { $set: { 'steps.$[step].status': 'done', 'steps.$[step].completedAt': new Date() }, $unset: { 'steps.$[step].lastError': 1 } }, { arrayFilters: [{ 'step.name': name }] });
        row = await this.db.m.IdentityLifecycleOperation.findOne({ _id: oid, companyId: cid }).lean<any>();
      }
      await this.db.m.IdentityLifecycleOperation.updateOne({ _id: oid, companyId: cid, leaseToken }, { $set: { status: 'done', completedAt: new Date() }, $unset: { leaseToken: 1, leaseUntil: 1, lastError: 1 } });
      await this.db.m.IdentityLifecycleSubject.updateOne({ companyId: cid, subject: row.subject, revision: row.subjectRevision, leaseToken }, { $set: { status: 'done', appliedRevision: row.subjectRevision }, $unset: { leaseToken: 1, leaseUntil: 1 } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'IDENTITY_LIFECYCLE_FAILED';
      if (message === 'LIFECYCLE_SUPERSEDED') {
        await this.db.m.IdentityLifecycleOperation.updateOne({ _id: oid, companyId: cid, leaseToken }, { $set: { status: 'superseded', lastError: message }, $unset: { leaseToken: 1, leaseUntil: 1 } });
        await this.releaseSubject(cid, row.subject, leaseToken, 'pending');
        const current = await this.db.m.IdentityLifecycleSubject.findOne({ companyId: cid, subject: row.subject }).lean<any>();
        if (current && current.revision > row.subjectRevision) {
          const latest = await this.db.m.IdentityLifecycleOperation.findOne({ companyId: cid, subject: row.subject, subjectRevision: current.revision }).lean<any>();
          if (latest) {
            await this.denyApp(cid, latest.desired as IdentityProjection, latest.subjectRevision);
            await this.db.m.IdentityLifecycleOperation.updateOne({ _id: latest._id, companyId: cid }, { $set: { status: 'partial', lastError: 'RECONCILE_REQUIRED_AFTER_SUPERSEDED_UPSTREAM' }, $unset: { completedAt: 1 } });
            await this.db.m.IdentityLifecycleSubject.updateOne({ companyId: cid, subject: row.subject, revision: current.revision }, { $set: { status: 'partial' } });
          }
        }
        return this.db.m.IdentityLifecycleOperation.findOne({ _id: oid, companyId: cid }).lean<any>();
      }
      await this.db.m.IdentityLifecycleOperation.updateOne({ _id: oid, companyId: cid, leaseToken }, { $set: { status: 'partial', lastError: message, 'steps.$[step].status': 'failed', 'steps.$[step].lastError': message }, $unset: { leaseToken: 1, leaseUntil: 1 } }, { arrayFilters: [{ 'step.status': 'running' }] });
      await this.releaseSubject(cid, row.subject, leaseToken, 'partial');
      throw Errors.storageUnavailable('Lifecycle mới áp dụng một phần; cần retry/reconcile cùng operation');
    }
    return this.db.m.IdentityLifecycleOperation.findOne({ _id: oid, companyId: cid }).lean<any>();
  }

  private async assertFence(cid: Types.ObjectId, subject: string, revision: number, leaseToken: string) {
    const state = await this.db.m.IdentityLifecycleSubject.exists({ companyId: cid, subject, revision, leaseToken, leaseUntil: { $gt: new Date() } });
    if (!state) throw new Error('LIFECYCLE_SUPERSEDED');
  }

  private async releaseSubject(cid: Types.ObjectId, subject: string, leaseToken: string, status: 'pending' | 'partial') {
    await this.db.m.IdentityLifecycleSubject.updateOne({ companyId: cid, subject, leaseToken }, { $set: { status }, $unset: { leaseToken: 1, leaseUntil: 1 } });
  }

  private async denyApp(cid: Types.ObjectId, desired: IdentityProjection, revision: number) {
    const binding = await this.db.m.OidcIdentity.findOne({ companyId: cid, subject: desired.subject }).lean<any>();
    if (!binding) throw new Error('APP_BINDING_NOT_FOUND');
    await this.db.m.OidcIdentity.updateOne({ _id: binding._id, companyId: cid }, { $set: { active: false, projectionPendingRevision: revision } });
    await this.db.m.User.updateOne({ _id: binding.userId, companyId: cid }, { $set: { isSuspended: true } });
    await this.db.m.Session.deleteMany({ companyId: cid, userId: binding.userId });
  }

  private async commitApp(cid: Types.ObjectId, desired: IdentityProjection, revision: number, leaseToken: string) {
    await this.assertFence(cid, desired.subject, revision, leaseToken);
    const binding = await this.db.m.OidcIdentity.findOne({ companyId: cid, subject: desired.subject, projectionPendingRevision: revision }).lean<any>();
    if (!binding) throw new Error('APP_BINDING_PENDING_REVISION_MISMATCH');
    const duplicate = await this.db.m.User.exists({ companyId: cid, email: desired.email, _id: { $ne: binding.userId } });
    if (duplicate) throw new Error('APP_EMAIL_CONFLICT');
    const roles = this.oidc.roles(desired.groups);
    const before = await this.db.m.User.findOne({ _id: binding.userId, companyId: cid }, { email: 1 }).lean<any>();
    await this.db.m.User.updateOne({ _id: binding.userId, companyId: cid }, { $set: { email: desired.email, systemRoles: roles, isSuspended: !desired.active } });
    if (before?.email !== desired.email) await this.mail.releaseAddressFor({ companyId: String(cid), userId: String(binding.userId) }, desired.email);
    await this.assertFence(cid, desired.subject, revision, leaseToken);
    const committed = await this.db.m.OidcIdentity.updateOne({ _id: binding._id, companyId: cid, projectionPendingRevision: revision }, { $set: { email: desired.email, groups: desired.groups, active: desired.active, lastSeenAt: new Date(), projectionRevision: revision }, $unset: { projectionPendingRevision: 1 } });
    if (committed.matchedCount !== 1) throw new Error('APP_BINDING_PENDING_REVISION_MISMATCH');
  }
}
