import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { AccessService, DeptInfo } from '../../access/access.service';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DriveRole, SystemRole, maxDriveRole, SYSTEM_ROLES } from '../../common/enums';
import { MailBasicService } from '../mail-basic/mail-basic.service';

/**
 * Nhóm Google ↔ vai trò (US-01.2). Quy ước tên nhóm (giả định, chờ chủ dự án
 * chốt tên nhóm): <số drive>-<mã phòng>-<vai trò>@tên miền, ví dụ
 * 11-mkt-dong-gop@ → R6 của 11 MKT; nhóm hệ thống vcdocs-r1@ … vcdocs-r9@.
 */
const DEPT_GROUP = /^(\d{2}b?)-([a-z0-9]+)-(quan-ly-noi-dung|quan-ly|dong-gop|nhan-xet|xem)@/;
const SYS_GROUP = /^vcdocs-(r[1-9])@/;
const GROUP_ROLE: Record<string, SystemRole> = {
  'quan-ly': 'R4',
  'quan-ly-noi-dung': 'R5',
  'dong-gop': 'R6',
  'nhan-xet': 'R7',
  xem: 'R7',
};
const GROUP_RANK: Record<string, number> = { 'quan-ly': 5, 'quan-ly-noi-dung': 4, 'dong-gop': 3, 'nhan-xet': 2, xem: 1 };

export interface UserAccess {
  groupEmails: string[];
  groupRoles: SystemRole[];
  departmentId?: string;
  driveRoles: { driveId: string; role: DriveRole }[];
}

@Injectable()
export class GoogleSyncService {
  private permCache = new Map<string, { at: number; perms: Map<string, { email: string; type: string; role: DriveRole }[]> }>();

  constructor(
    private readonly db: Db,
    private readonly access: AccessService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mail: MailBasicService,
  ) {}

  rolesFromGroups(groupEmails: string[], depts: DeptInfo[]): { roles: SystemRole[]; departmentId?: string } {
    const roles = new Set<SystemRole>();
    let best: { rank: number; deptId: string } | undefined;
    for (const g of groupEmails.map((x) => x.toLowerCase())) {
      const s = SYS_GROUP.exec(g);
      if (s) {
        const r = s[1].toUpperCase() as SystemRole;
        if (SYSTEM_ROLES.includes(r)) roles.add(r);
        continue;
      }
      const m = DEPT_GROUP.exec(g);
      if (!m) continue;
      const dept = depts.find((d) => d.number.toLowerCase() === m[1]);
      if (!dept) continue;
      // Nhóm "xem" của drive Nội bộ là cả công ty: không tính vai trò, không tính phòng
      if (dept.securityLevel === 'internal' && m[3] === 'xem') continue;
      roles.add(GROUP_ROLE[m[3]]);
      // Phòng của người dùng = phòng có vai trò cao nhất
      const rank = GROUP_RANK[m[3]];
      if (!best || rank > best.rank) best = { rank, deptId: dept.id };
    }
    return { roles: [...roles].sort(), departmentId: best?.deptId };
  }

  private async drivePerms(companyId: string, depts: DeptInfo[], fresh = false) {
    const c = this.permCache.get(companyId);
    if (!fresh && c && Date.now() - c.at < 5 * 60_000) return c.perms;
    const perms = new Map<string, { email: string; type: string; role: DriveRole }[]>();
    for (const d of depts) {
      const list = await this.google.drive.listDrivePermissions(d.driveId);
      perms.set(
        d.driveId,
        list.filter((p) => p.emailAddress && p.role !== 'owner').map((p) => ({ email: p.emailAddress!.toLowerCase(), type: p.type, role: p.role as DriveRole })),
      );
    }
    this.permCache.set(companyId, { at: Date.now(), perms });
    return perms;
  }

  /** Vai trò trên từng drive = vai trò cao nhất qua quyền trực tiếp hoặc qua nhóm */
  async computeAccess(companyId: string, email: string, opts: { fresh?: boolean; userGroups?: string[] } = {}): Promise<UserAccess> {
    const depts = await this.access.departments(companyId);
    const groups = (opts.userGroups ?? (await this.google.directory.listUserGroups(email))).map((g) => g.toLowerCase());
    const perms = await this.drivePerms(companyId, depts, opts.fresh);
    const me = email.toLowerCase();
    const driveRoles: { driveId: string; role: DriveRole }[] = [];
    for (const d of depts) {
      let role: DriveRole | undefined;
      for (const p of perms.get(d.driveId) ?? []) {
        if ((p.type === 'user' && p.email === me) || (p.type === 'group' && groups.includes(p.email))) role = maxDriveRole(role, p.role);
      }
      if (role) driveRoles.push({ driveId: d.driveId, role });
    }
    const { roles, departmentId } = this.rolesFromGroups(groups, depts);
    return { groupEmails: groups, groupRoles: roles, departmentId, driveRoles };
  }

  /** Ghi quyền vào user; systemRoles = vai trò từ nhóm ∪ vai trò R9 gán tay */
  async applyAccess(companyId: string, userId: string, acc: UserAccess) {
    const filter = { _id: new Types.ObjectId(userId), companyId: new Types.ObjectId(companyId) };
    const u = await this.db.m.User.findOne(filter).lean<any>();
    if (!u) return;
    const manual: string[] = u.manualRoles ?? [];
    const systemRoles = [...new Set([...acc.groupRoles, ...manual])].sort();
    await this.db.m.User.updateOne(filter, {
      $set: {
        groupEmails: acc.groupEmails,
        groupRoles: acc.groupRoles,
        systemRoles,
        driveRoles: acc.driveRoles,
        ...(acc.departmentId ? { departmentId: new Types.ObjectId(acc.departmentId) } : {}),
      },
    });
  }

  /** Đồng bộ toàn bộ nhân sự, nhóm, thành viên drive (POST /sync/google, việc nền hằng đêm) */
  async syncAll(companyId: string, step: <T>(name: string, fn: () => Promise<T>) => Promise<T>) {
    const cid = new Types.ObjectId(companyId);
    const dirUsers = await step('Đọc nhân sự từ Google', () => this.google.directory.listUsers(this.cfg.allowedDomain));
    const groupMembers = await step('Đọc nhóm Google', async () => {
      const groups = await this.google.directory.listGroups(this.cfg.allowedDomain);
      const map = new Map<string, string[]>();
      for (const g of groups) {
        for (const m of await this.google.directory.listGroupMembers(g.email)) {
          const k = m.toLowerCase();
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push(g.email.toLowerCase());
        }
      }
      return map;
    });
    let created = 0;
    let updated = 0;
    await step('Cập nhật vai trò và thành viên drive', async () => {
      await this.drivePerms(companyId, await this.access.departments(companyId), true);
      for (const du of dirUsers) {
        const email = du.email.toLowerCase();
        const existing = await this.db.m.User.findOne({ companyId: cid, email }).lean<any>();
        let userId: string;
        if (!existing) {
          const u = await this.db.m.User.create({ companyId: cid, email, name: du.name, title: du.title, isSuspended: du.suspended });
          userId = String(u._id);
          await this.mail.releaseAddressFor({ companyId, userId }, email);
          created++;
        } else {
          userId = String(existing._id);
          await this.db.m.User.updateOne({ _id: existing._id, companyId: cid }, { $set: { name: du.name, title: du.title ?? existing.title, isSuspended: du.suspended } });
          updated++;
        }
        const acc = await this.computeAccess(companyId, email, { userGroups: groupMembers.get(email) ?? [] });
        await this.applyAccess(companyId, userId, acc);
      }
    });
    return { created, updated, total: dirUsers.length };
  }
}
