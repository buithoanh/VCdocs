import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Roles } from '../../common/decorators';
import { Errors } from '../../common/errors';
import { driveRoleAtLeast, FolderKind } from '../../common/enums';
import { AccessService } from '../../access/access.service';
import { AuditService } from '../../audit/audit.service';
import { JobsService } from '../../jobs/jobs.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { folderName, FoldersService, UNNUMBERED } from './folders.service';

/** M03 Cây thư mục: đọc từ sổ VCdocs theo quyền drive; tạo, đổi tên đúng khung 00–99 */
@Controller('folders')
export class FoldersController {
  constructor(
    private readonly db: Db,
    private readonly folders: FoldersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
  ) {
    jobs.register('folder.create', {
      title: 'Tạo thư mục trên Drive',
      steps: ['Cấp số thư mục', 'Tạo thư mục trên Drive'],
      handler: async (job) => {
        const p = job.payload;
        const number = await job.step('Cấp số thư mục', async () => {
          const n = await this.folders.nextNumber(job.companyId, p.driveId, p.parentId, p.kind);
          await this.folders.reserveNumber(job.companyId, p.driveId, p.parentId, n);
          return n;
        });
        const f = await job.step('Tạo thư mục trên Drive', () => this.folders.createFolder(job.companyId, job.userId, { ...p, number }));
        return { objectType: 'folder', objectId: String(f._id), googleId: f.googleId, name: f.name };
      },
    });
    jobs.register('folder.close_project', {
      title: 'Kết thúc dự án',
      steps: ['Tìm thư mục 98 Đã kết thúc', 'Chuyển thư mục trên Drive', 'Cập nhật sổ VCdocs'],
      handler: async (job) => {
        const f = await this.folders.get(job.companyId, job.payload.folderId);
        if (!f) throw Errors.notFound('Không tìm thấy thư mục');
        const parent = f.parentId ? await this.folders.get(job.companyId, f.parentId) : undefined;
        const closed = await job.step('Tìm thư mục 98 Đã kết thúc', async () => {
          const c = await this.folders.rootOfKind(job.companyId, f.driveId, 'closed');
          if (c) return c;
          await this.folders.reserveNumber(job.companyId, f.driveId, undefined, '98').catch(() => undefined);
          return this.folders.createFolder(job.companyId, job.userId, { driveId: f.driveId, kind: 'closed', number: '98', shortName: 'Đã kết thúc', hasPeriods: false });
        });
        await job.step('Chuyển thư mục trên Drive', () =>
          this.google.drive.updateFile(f.googleId, { addParents: [closed.googleId], removeParents: [parent?.googleId ?? f.driveId] }),
        );
        return job.step('Cập nhật sổ VCdocs', async () => {
          // Giữ nguyên tên, số, ID; số không cấp lại vì vẫn giữ trong folder_numbers của cha cũ
          const path = `${closed.path} / ${f.name}`;
          await this.db.m.Folder.updateOne(
            { _id: f._id, companyId: f.companyId },
            { $set: { parentId: closed._id, status: 'closed', path, originalParentKey: this.folders.parentKey(f.driveId, f.parentId), updatedBy: new Types.ObjectId(job.userId) } },
          );
          await this.folders.repath(job.companyId, { ...f, path });
          return { objectType: 'folder', objectId: String(f._id) };
        });
      },
    });
    jobs.register('folder.ensure_periods', {
      title: 'Tạo thư mục năm, tháng',
      steps: ['Tìm thư mục chia năm / tháng', 'Tạo thư mục còn thiếu'],
      handler: async (job) => {
        const cid = new Types.ObjectId(job.companyId);
        const targets = await job.step('Tìm thư mục chia năm / tháng', async () => {
          const rt = await this.db.m.RecordType.distinct('folderId', { companyId: cid });
          const filter: any = { companyId: cid, status: 'active', $or: [{ hasPeriods: true }, { _id: { $in: rt } }] };
          if (job.payload.driveId) filter.driveId = job.payload.driveId;
          return this.db.m.Folder.find(filter, { _id: 1 }).lean<any[]>();
        });
        let created = 0;
        await job.step('Tạo thư mục còn thiếu', async () => {
          for (const f of targets) created += (await this.folders.ensurePeriod(job.companyId, f._id, job.payload.month, job.userId)).created;
        });
        return { month: job.payload.month, folders: targets.length, created };
      },
    });
  }

  @Get()
  async list(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const cid = new Types.ObjectId(ctx.companyId);
    const visible = q.driveId ? ctx.visibleDriveIds.filter((d) => d === q.driveId) : ctx.visibleDriveIds;
    if (q.parentId) {
      const parent = await this.folders.get(ctx.companyId, q.parentId);
      if (!parent || !visible.includes(parent.driveId)) return { items: [] };
    }
    const depth: number = q.depth ?? 1;
    let level = await this.db.m.Folder.find({
      companyId: cid,
      driveId: { $in: visible },
      parentId: q.parentId ? new Types.ObjectId(q.parentId) : { $exists: false },
    })
      .sort({ driveId: 1, number: 1, name: 1 })
      .lean<any[]>();
    const all = [...level];
    for (let d = 2; d <= depth && level.length; d++) {
      level = await this.db.m.Folder.find({ companyId: cid, driveId: { $in: visible }, parentId: { $in: level.map((x) => x._id) } })
        .sort({ number: 1, name: 1 })
        .lean<any[]>();
      all.push(...level);
    }
    const rows = q.kind ? all.filter((f) => f.kind === q.kind) : all;
    return { items: await this.folders.withChildrenFlag(ctx.companyId, rows) };
  }

  /** Trưởng phòng của drive; leader (R5) chỉ trong mảng/dự án mình (có vai trò Quản lý nội dung) */
  private async assertCanManage(ctx: Ctx, driveId: string, parent: any | undefined, allowLeader: boolean) {
    const dept = await this.access.deptByDrive(ctx.companyId, driveId);
    if (!dept) throw Errors.validation('Drive không thuộc VCdocs', [{ field: 'driveId', issue: 'not_found' }]);
    await this.access.assertVisible(ctx, driveId);
    const role = this.access.driveRole(ctx, driveId);
    if ((await this.access.isHeadOf(ctx, dept.id)) && driveRoleAtLeast(role, 'fileOrganizer')) return dept;
    if (allowLeader && this.access.hasRole(ctx, 'R5') && driveRoleAtLeast(role, 'fileOrganizer') && parent && ['area', 'project'].includes(parent.kind)) return dept;
    throw Errors.forbidden('Chỉ trưởng phòng (R4) quản lý drive, hoặc leader (R5) trong mảng của mình, được làm');
  }

  @Post()
  @Roles('R4', 'R5')
  @HttpCode(202)
  async create(@CurrentCtx() ctx: Ctx, @Body() body: any) {
    const kind = body.kind as FolderKind;
    // parentId bắt buộc theo hợp đồng nhưng thư mục gốc drive (mảng 10–49, dự án 50–89) không có cha → nhận thiếu (xem DE_NGHI_SUA_HOP_DONG.md)
    const parent = body.parentId ? await this.folders.get(ctx.companyId, body.parentId) : undefined;
    if (body.parentId && (!parent || parent.driveId !== body.driveId)) throw Errors.validation('Thư mục cha không thuộc drive này', [{ field: 'parentId', issue: 'not_found' }]);
    await this.assertCanManage(ctx, body.driveId, parent, true);
    if (kind === 'year' || kind === 'month') throw Errors.rule('BR-11', 'Thư mục năm, tháng do VCdocs tự tạo (POST /folders/ensure-periods)');
    if (!String(body.shortName ?? '').trim()) throw Errors.validation('Thiếu tên ngắn', [{ field: 'shortName', issue: 'required' }]);
    if (['area', 'project'].includes(kind) && !body.code) throw Errors.rule('BR-12', 'Mảng, dự án phải chọn mã từ Bảng mã', [{ field: 'code', issue: 'required' }]);
    if (body.code) {
      const code = await this.db.m.Code.findOne({ companyId: new Types.ObjectId(ctx.companyId), code: body.code, status: 'approved' }).lean();
      if (!code) throw Errors.rule('BR-12', `Mã ${body.code} chưa được duyệt trong Bảng mã`, [{ field: 'code', issue: 'not_approved' }]);
    }
    // Kiểm còn số trống ngay để báo sớm
    await this.folders.nextNumber(ctx.companyId, body.driveId, body.parentId, kind);
    const payload = { driveId: body.driveId, parentId: body.parentId, kind, code: body.code, shortName: body.shortName.trim(), fullName: body.fullName?.trim() };
    const jobId = await this.jobs.enqueue(ctx, 'folder.create', payload);
    await this.audit.record(ctx, { action: 'folder.create', objectType: 'folder', after: { ...payload, jobId } });
    return { jobId };
  }

  @Get('next-number')
  @Roles('R4', 'R5')
  async nextNumber(@CurrentCtx() ctx: Ctx, @VQuery() q: any) {
    const parent = await this.folders.getVisible(ctx, q.parentId);
    return { number: await this.folders.nextNumber(ctx.companyId, parent.driveId, String(parent._id), q.kind) };
  }

  @Post('ensure-periods')
  @Roles('R3')
  @HttpCode(202)
  async ensurePeriods(@CurrentCtx() ctx: Ctx, @Body() body: { driveId?: string; month: string }) {
    if (body.driveId && !(await this.access.deptByDrive(ctx.companyId, body.driveId))) throw Errors.validation('Drive không thuộc VCdocs', [{ field: 'driveId', issue: 'not_found' }]);
    const jobId = await this.jobs.enqueue(ctx, 'folder.ensure_periods', body);
    await this.audit.record(ctx, { action: 'folder.ensure_periods', objectType: 'folder', after: { ...body, jobId } });
    return { jobId };
  }

  @Get(':id')
  async get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const f = await this.folders.getVisible(ctx, id);
    return (await this.folders.withChildrenFlag(ctx.companyId, [f]))[0];
  }

  @Get(':id/children')
  async children(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const f = await this.folders.getVisible(ctx, id);
    const rows = await this.db.m.Folder.find({ companyId: f.companyId, parentId: f._id }).sort({ number: 1, name: 1 }).lean<any[]>();
    return { items: await this.folders.withChildrenFlag(ctx.companyId, rows) };
  }

  @Post(':id/rename')
  @Roles('R4')
  @HttpCode(200)
  async rename(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() body: { shortName: string; fullName?: string }) {
    const f = await this.folders.getVisible(ctx, id);
    const parent = f.parentId ? await this.folders.get(ctx.companyId, f.parentId) : undefined;
    await this.assertCanManage(ctx, f.driveId, parent, false);
    if (UNNUMBERED.includes(f.kind) && f.kind !== 'entity') throw Errors.rule('BR-11', 'Thư mục năm, tháng không đổi tên');
    const shortName = body.shortName.trim();
    if (!shortName) throw Errors.validation('Thiếu tên ngắn', [{ field: 'shortName', issue: 'required' }]);
    const fullName = body.fullName !== undefined ? body.fullName.trim() : f.fullName;
    // Giữ số và mã, chỉ đổi phần tên
    const name = folderName({ number: f.number, code: f.code, shortName, fullName });
    await this.google.drive.updateFile(f.googleId, { name });
    const path = f.path.endsWith(f.name) ? f.path.slice(0, f.path.length - f.name.length) + name : f.path;
    await this.db.m.Folder.updateOne({ _id: f._id, companyId: f.companyId }, { $set: { shortName, fullName, name, path, updatedBy: new Types.ObjectId(ctx.user.id) } });
    const after = await this.folders.get(ctx.companyId, f._id);
    await this.folders.repath(ctx.companyId, after);
    await this.audit.record(ctx, { action: 'folder.rename', objectType: 'folder', objectId: id, before: { name: f.name }, after: { name } });
    return (await this.folders.withChildrenFlag(ctx.companyId, [after]))[0];
  }

  @Post(':id/close-project')
  @Roles('R4')
  @HttpCode(202)
  async closeProject(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const f = await this.folders.getVisible(ctx, id);
    await this.assertCanManage(ctx, f.driveId, undefined, false);
    if (f.kind !== 'project') throw Errors.state('Chỉ kết thúc được thư mục dự án');
    if (f.status !== 'active') throw Errors.state('Dự án đã kết thúc');
    const pending = await this.db.m.Job.findOne({ companyId: f.companyId, type: 'folder.close_project', status: { $in: ['queued', 'running'] }, 'payload.folderId': id }).lean();
    if (pending) throw Errors.state('Đang kết thúc dự án này');
    const jobId = await this.jobs.enqueue(ctx, 'folder.close_project', { folderId: id });
    await this.audit.record(ctx, { action: 'folder.close_project', objectType: 'folder', objectId: id, after: { jobId } });
    return { jobId };
  }

  @Post(':id/resync')
  @Roles('R3', 'R4')
  @HttpCode(200)
  async resync(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    const f = await this.folders.getVisible(ctx, id);
    if (!this.access.hasRole(ctx, 'R3')) await this.assertCanManage(ctx, f.driveId, undefined, false);
    const g = await this.google.drive.getFile(f.googleId);
    const set: any = { updatedBy: new Types.ObjectId(ctx.user.id) };
    if (!g || g.trashed) {
      set.status = 'archived';
    } else {
      // Drive là nơi thật: lấy lại tên, cha đang nằm
      set.name = g.name;
      const parentGoogle = g.parents[0];
      const parent = parentGoogle && parentGoogle !== f.driveId ? await this.db.m.Folder.findOne({ companyId: f.companyId, googleId: parentGoogle }).lean<any>() : undefined;
      set.path = await this.folders.pathOf(ctx.companyId, f.driveId, parent, g.name);
      if (parent && String(parent._id) !== String(f.parentId)) set.parentId = parent._id;
    }
    await this.db.m.Folder.updateOne({ _id: f._id, companyId: f.companyId }, { $set: set });
    const after = await this.folders.get(ctx.companyId, f._id);
    await this.folders.repath(ctx.companyId, after);
    await this.audit.record(ctx, { action: 'folder.resync', objectType: 'folder', objectId: id, before: { name: f.name, path: f.path, status: f.status }, after: { name: after.name, path: after.path, status: after.status } });
    return (await this.folders.withChildrenFlag(ctx.companyId, [after]))[0];
  }
}
