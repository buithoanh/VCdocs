import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { DriveRole, SystemRole } from './enums';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  departmentId?: string;
  systemRoles: SystemRole[];
}

/** Ngữ cảnh một yêu cầu: ai gọi, công ty nào, drive nào được xem. */
export interface RequestCtx {
  requestId: string;
  ip: string;
  device: string;
  companyId?: string;
  user?: SessionUser;
  sessionId?: string;
  csrfToken?: string;
  sessionExpiresAt?: Date;
  /** driveId → vai trò của người gọi trên drive */
  driveRoles: Map<string, DriveRole>;
  /** Danh sách driveId người gọi được xem nội dung */
  visibleDriveIds: string[];
  /** Tham số query đã kiểm tra theo hợp đồng (có giá trị mặc định) */
  query: Record<string, any>;
  /** Id các dòng audit_logs ghi trong yêu cầu này */
  auditIds: string[];
}

/** Ngữ cảnh đã đăng nhập (dùng trong dịch vụ). */
export interface Ctx extends RequestCtx {
  companyId: string;
  user: SessionUser;
}

export function getCtx(req: Request): RequestCtx {
  return (req as any).ctx;
}

export const CurrentCtx = createParamDecorator((_data: unknown, context: ExecutionContext): Ctx => {
  return getCtx(context.switchToHttp().getRequest()) as Ctx;
});

/** Query đã kiểm tra theo OpenAPI (ép kiểu, giá trị mặc định). */
export const VQuery = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return getCtx(context.switchToHttp().getRequest()).query;
});
