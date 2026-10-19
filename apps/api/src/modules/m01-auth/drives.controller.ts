import { Controller, Get, Inject, Param } from '@nestjs/common';
import { Ctx, CurrentCtx, VQuery } from '../../common/context';
import { Errors } from '../../common/errors';
import { AccessService } from '../../access/access.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { APP_CONFIG, AppConfig } from '../../config/config';

@Controller('drives')
export class DrivesController {
  constructor(
    private readonly access: AccessService,
    @Inject(GOOGLE) private readonly google: GooglePorts,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** 11 drive và vai trò của tôi trên từng drive */
  @Get()
  async list(@CurrentCtx() ctx: Ctx) {
    const depts = await this.access.departments(ctx.companyId);
    return {
      items: depts
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((d) => ({ driveId: d.driveId, departmentId: d.id, name: `${d.number} ${d.code}`, securityLevel: d.securityLevel, myRole: ctx.driveRoles.get(d.driveId) })),
    };
  }

  /** Thành viên drive; anomalies=true chỉ thành viên lẻ, ngoài tên miền (R3, R9; R4 drive mình) */
  @Get(':id/members')
  async members(@CurrentCtx() ctx: Ctx, @Param('id') driveId: string, @VQuery() q: any) {
    const dept = await this.access.deptByDrive(ctx.companyId, driveId);
    if (!dept) throw Errors.notFound('Không tìm thấy drive');
    const allowed = this.access.hasRole(ctx, 'R3', 'R9') || (await this.access.isHeadOf(ctx, dept.id));
    if (!allowed) throw Errors.forbidden('Chỉ R3, R9 hoặc trưởng phòng của drive này xem được thành viên');
    const perms = await this.google.drive.listDrivePermissions(driveId);
    const domain = `@${this.cfg.allowedDomain}`;
    const items: any[] = [];
    for (const p of perms) {
      if (p.role === 'owner') continue;
      const email = (p.emailAddress ?? p.domain ?? '').toLowerCase();
      if (p.type === 'group') {
        items.push({ permissionId: p.permissionId, email, name: p.displayName, type: 'group', role: p.role });
        for (const m of await this.google.directory.listGroupMembers(email)) {
          const me = m.toLowerCase();
          items.push({ email: me, type: 'user', role: p.role, viaGroup: email, ...(me.endsWith(domain) ? {} : { anomaly: 'foreign_member' }) });
        }
      } else {
        const foreign = p.type === 'anyone' || (p.type === 'user' && !email.endsWith(domain)) || (p.type === 'domain' && email !== this.cfg.allowedDomain);
        items.push({
          permissionId: p.permissionId,
          email: email || p.type,
          name: p.displayName,
          type: p.type,
          role: p.role,
          anomaly: foreign ? 'foreign_member' : p.type === 'user' ? 'direct_member' : undefined,
        });
      }
    }
    const out = items.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)));
    return { items: q.anomalies === true ? out.filter((x: any) => x.anomaly) : out };
  }
}
