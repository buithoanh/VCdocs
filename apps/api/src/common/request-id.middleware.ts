import type { NextFunction, Request, Response } from 'express';
import { randomToken } from './util';
import type { RequestCtx } from './context';

/** Gắn X-Request-Id (FE sinh, BE trả lại; thiếu thì BE sinh) và tạo ngữ cảnh yêu cầu. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomToken(12);
  res.setHeader('X-Request-Id', requestId);
  const ctx: RequestCtx = {
    requestId,
    ip: req.ip || req.socket.remoteAddress || '',
    device: (req.header('user-agent') || '').slice(0, 300),
    driveRoles: new Map(),
    visibleDriveIds: [],
    query: {},
    auditIds: [],
  };
  (req as any).ctx = ctx;
  next();
}
