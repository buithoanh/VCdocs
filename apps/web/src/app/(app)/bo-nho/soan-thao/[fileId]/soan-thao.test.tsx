import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API, server } from '@/test/server';
import DocumentEditorPage from './page';

const FILE_ID = '6712f0c2a1b2c3d4e5f60901';
const ATTACKER = 'https://attacker.example';

/* Tệp do kẻ tấn công tải lên: byte là JSON giả cấu hình editor. */
const planted = { documentServerUrl: ATTACKER, mode: 'view', config: {} };

let requested: string[] = [];

function editorScripts() {
  return Array.from(document.head.querySelectorAll('script')).map((s) => s.getAttribute('src') ?? '');
}

/* Trang đã chạy xong effect: hoặc đã chèn script, hoặc đã báo lỗi. */
async function settled() {
  await waitFor(() => expect(editorScripts().length > 0 || !screen.getByRole('status').textContent?.includes('Đang chuẩn bị')).toBe(true));
}

function renderEditor(fileId: string) {
  return render(<DocumentEditorPage params={Promise.resolve({ fileId })} />);
}

beforeEach(() => {
  requested = [];
  server.events.on('request:start', ({ request }) => { requested.push(new URL(request.url).pathname); });
  server.use(
    http.get(`${API}/drive/files/:id/content`, () => HttpResponse.text(JSON.stringify(planted), { headers: { 'Content-Type': 'text/plain' } })),
    http.get(`${API}/drive/files/:id`, () => HttpResponse.json(planted)),
  );
});

afterEach(() => {
  server.events.removeAllListeners();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

describe('trang soạn thảo /bo-nho/soan-thao/[fileId]', () => {
  it.each([
    ['dấu # cắt phần editor-config', `${FILE_ID}/content#`],
    ['dấu ? biến phần sau thành query', `${FILE_ID}?x=`],
    ['dấu / trỏ sang route khác', `${FILE_ID}/content`],
  ])('fileId có %s thì không gọi API nào khác editor-config và không nạp script lạ', async (_, fileId) => {
    renderEditor(fileId);
    await settled();
    expect({
      requests: requested.filter((p) => p.startsWith('/api/v1/drive/files/') && p !== `/api/v1/drive/files/${FILE_ID}/editor-config`),
      attackerScript: editorScripts().some((src) => src.startsWith(ATTACKER)),
    }).toEqual({ requests: [], attackerScript: false });
  });

  it('documentServerUrl ngoài danh sách cho phép thì không chèn thẻ script', async () => {
    server.use(http.get(`${API}/drive/files/:id/editor-config`, () => HttpResponse.json(planted)));
    renderEditor(FILE_ID);
    await settled();
    expect(requested).toContain(`/api/v1/drive/files/${FILE_ID}/editor-config`);
    expect(editorScripts().some((src) => src.startsWith(ATTACKER))).toBe(false);
  });

  it('origin Document Server được phép thì nạp api.js như cũ', async () => {
    server.use(http.get(`${API}/drive/files/:id/editor-config`, () => HttpResponse.json({ documentServerUrl: 'http://127.0.0.1:18082', mode: 'edit', config: {} })));
    renderEditor(FILE_ID);
    await waitFor(() => expect(editorScripts()).toContain('http://127.0.0.1:18082/web-apps/apps/api/documents/api.js'));
  });
});
