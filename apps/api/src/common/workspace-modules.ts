import { applyDecorators, CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Errors } from './errors';

/** Phân hệ VCworkspace có thể tắt theo môi trường (production chưa có Nextcloud/Stalwart thật). */
export type WorkspaceModule = 'drive' | 'mail';
const WORKSPACE_MODULES_KEY = 'vcdocs:workspaceModules';
const LABEL: Record<WorkspaceModule, string> = { drive: 'Bộ nhớ VCworkspace', mail: 'Email VCworkspace' };

export function workspaceModuleEnabled(cfg: AppConfig, module: WorkspaceModule): boolean {
  return module === 'drive' ? cfg.workspaceStorage.mode !== 'disabled' : cfg.mailEngine.mode !== 'disabled';
}

/** Chặn route bằng 503 trước khi chạm service khi phân hệ đang tắt. */
@Injectable()
export class WorkspaceModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}
  canActivate(context: ExecutionContext): boolean {
    const modules = this.reflector.getAllAndOverride<WorkspaceModule[]>(WORKSPACE_MODULES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const off = modules.find((m) => !workspaceModuleEnabled(this.cfg, m));
    if (off) throw Errors.storageUnavailable(`${LABEL[off]} chưa bật trên máy chủ này`);
    return true;
  }
}

export const RequiresWorkspace = (...modules: WorkspaceModule[]) =>
  applyDecorators(SetMetadata(WORKSPACE_MODULES_KEY, modules), UseGuards(WorkspaceModuleGuard));

/** Thuộc tính Nest/Promise dò trên provider; không được coi là phương thức của cổng. */
const NOT_PORT_METHODS = new Set(['then', 'onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown']);

/** Cổng thay adapter khi phân hệ tắt: mọi lời gọi đều báo 503, không rơi về bản giả trong bộ nhớ. */
export function disabledPort<T extends object>(module: WorkspaceModule): T {
  return new Proxy({} as T, {
    get: (_target, prop) => (typeof prop === 'symbol' || NOT_PORT_METHODS.has(prop)
      ? undefined
      : async () => { throw Errors.storageUnavailable(`${LABEL[module]} chưa bật trên máy chủ này`); }),
  });
}
