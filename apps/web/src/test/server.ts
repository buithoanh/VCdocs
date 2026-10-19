import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { approval, departments, doc, makeJob, makeMe, notifications, recordTypes } from './fixtures';

export const API = `${window.location.origin}/api/v1`;

/** Máy chủ giả cho test, dữ liệu cố định. Test riêng ghi đè bằng server.use(...). */
export const handlers = [
  http.get(`${API}/me`, () => HttpResponse.json(makeMe())),
  http.get(`${API}/departments`, () => HttpResponse.json({ items: departments })),
  http.get(`${API}/record-types`, () => HttpResponse.json({ items: recordTypes })),
  http.get(`${API}/notifications`, () => HttpResponse.json(notifications)),
  http.get(`${API}/approvals`, () => HttpResponse.json({ page: 1, limit: 50, total: 1, items: [approval] })),
  http.get(`${API}/approvals/:id`, () => HttpResponse.json(approval)),
  http.get(`${API}/documents/:id`, () => HttpResponse.json(doc)),
  http.get(`${API}/jobs/:id`, () => HttpResponse.json(makeJob('done', { result: { objectType: 'record', objectId: '6712f0c2a1b2c3d4e5f60751' } }))),
  http.get(`${API}/users/:id`, () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Không có quyền', requestId: 'x' } }, { status: 403 })),
  http.get(`${API}/users`, () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Không có quyền', requestId: 'x' } }, { status: 403 })),
];

export const server = setupServer(...handlers);
