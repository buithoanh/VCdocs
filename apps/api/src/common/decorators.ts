import { SetMetadata } from '@nestjs/common';
import type { SystemRole } from './enums';

export const PUBLIC_KEY = 'vcdocs:public';
export const ROLES_KEY = 'vcdocs:roles';
export const SKIP_CSRF_KEY = 'vcdocs:skipCsrf';
export const RATE_BUCKET_KEY = 'vcdocs:rateBucket';

/** Không cần đăng nhập */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Cần ít nhất một trong các vai trò hệ thống (tầng 1). Kiểm phạm vi phòng/drive làm trong dịch vụ. */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
/** Nhóm giới hạn tần suất riêng (tìm kiếm 60/phút) */
export const RateBucket = (bucket: 'search') => SetMetadata(RATE_BUCKET_KEY, bucket);
