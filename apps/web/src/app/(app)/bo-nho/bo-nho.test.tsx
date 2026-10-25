import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import WorkspaceDrivePage from './page';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SPACE = '6add32f4772313819e8ff3c4';
const FOLDER = '6add32f4772313819e8ff3d1';
const FILE = '6add32f4772313819e8ff3e1';

function space(role: 'manager' | 'reader') {
  return { id: SPACE, kind: 'department', name: 'Marketing', role, rootFolderId: SPACE,
    allowedActions: role === 'manager' ? ['list', 'create-folder', 'upload', 'download'] : ['list', 'download'] };
}
const rootItems = [
  { id: FILE, spaceId: SPACE, kind: 'file', name: 'Biên bản họp.docx', mimeType: DOCX, size: 1700, versionNumber: 2,
    currentVersionId: 'v2', contentSha256: 'a'.repeat(64), storageKey: 'k', createdAt: '2026-10-25T08:00:00Z', createdBy: 'u', allowedActions: [] },
  { id: FOLDER, spaceId: SPACE, kind: 'folder', name: 'Kế hoạch Q4', storageKey: 'f', createdAt: '2026-10-25T08:00:00Z', createdBy: 'u', allowedActions: [] },
];

function useDrive(role: 'manager' | 'reader', seen: string[] = []) {
  server.use(
    http.get(`${API}/spaces`, () => HttpResponse.json({ items: [space(role)] })),
    http.get(`${API}/drive/items`, ({ request }) => {
      const parentId = new URL(request.url).searchParams.get('parentId');
      seen.push(parentId ?? 'root');
      return HttpResponse.json({ items: parentId === FOLDER ? [] : rootItems });
    }),
  );
}

describe('Bộ nhớ VCworkspace', () => {
  it('liệt kê thư mục trước tệp, mở thư mục con theo parentId và quay lại bằng đường dẫn', async () => {
    const seen: string[] = [];
    useDrive('manager', seen);
    renderApp(<WorkspaceDrivePage />);
    const list = await screen.findByRole('list', { name: 'Danh sách mục' });
    const names = within(list).getAllByRole('button').map((row) => row.textContent);
    expect(names[0]).toContain('Kế hoạch Q4');
    expect(names[1]).toContain('Biên bản họp.docx');

    await userEvent.dblClick(within(list).getByRole('button', { name: /Kế hoạch Q4/ }));
    expect(await screen.findByText('Thư mục đang trống.')).toBeInTheDocument();
    expect(seen).toContain(FOLDER);
    const crumbs = screen.getByRole('navigation', { name: 'Đường dẫn thư mục' });
    expect(within(crumbs).getByRole('button', { name: 'Kế hoạch Q4' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(within(crumbs).getByRole('button', { name: 'Marketing' }));
    expect(await screen.findByRole('button', { name: /Biên bản họp.docx/ })).toBeInTheDocument();
  });

  it('tạo văn bản trong thư mục đang mở và báo lỗi rõ khi API từ chối', async () => {
    useDrive('manager');
    let created: any = null;
    server.use(http.post(`${API}/drive/documents`, async ({ request }) => {
      created = await request.json();
      return HttpResponse.json({ ...rootItems[0], id: '6add32f4772313819e8ff3f9', name: `${created.name}.docx`, parentId: FOLDER }, { status: 201 });
    }), http.post(`${API}/drive/folders`, () => HttpResponse.json({ error: { code: 'VALIDATION', message: 'Tên thư mục không hợp lệ', requestId: 'x' } }, { status: 400 })));
    renderApp(<WorkspaceDrivePage />);
    await userEvent.dblClick(await screen.findByRole('button', { name: /Kế hoạch Q4/ }));
    await screen.findByText('Thư mục đang trống.');

    await userEvent.click(screen.getByRole('button', { name: 'Mới' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Văn bản' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Tên mục mới' }), 'Kế hoạch nội dung');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    expect(await screen.findByText('Đã tạo văn bản Kế hoạch nội dung.')).toBeInTheDocument();
    expect(created).toMatchObject({ spaceId: SPACE, name: 'Kế hoạch nội dung', parentId: FOLDER });

    await userEvent.click(screen.getByRole('button', { name: 'Mới' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Tên mục mới' }), 'Q4/Tháng 12');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    expect(await screen.findByText(/Tên không được chứa dấu \//)).toBeInTheDocument();
  });

  it('chọn tệp hiện thao tác Office; người chỉ đọc không thấy đổi tên, tải bản mới hay thùng rác', async () => {
    useDrive('reader');
    renderApp(<WorkspaceDrivePage />);
    await userEvent.click(await screen.findByRole('button', { name: /Biên bản họp.docx/ }));
    const detail = screen.getByRole('complementary', { name: 'Chi tiết' });
    expect(within(detail).getByRole('link', { name: 'Mở soạn thảo' })).toHaveAttribute('href', `/bo-nho/soan-thao/${FILE}`);
    expect(within(detail).getByRole('link', { name: 'Xuất PDF' })).toHaveAttribute('href', expect.stringContaining(`/drive/files/${FILE}/export?format=pdf`));
    expect(within(detail).queryByRole('button', { name: 'Đổi tên/di chuyển' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Bỏ vào thùng rác' })).not.toBeInTheDocument();
    expect(within(detail).queryByText('Tải bản mới')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mới' })).not.toBeInTheDocument();
  });

  it('người quản lý bỏ tệp vào thùng rác; lỗi máy chủ hiện thành thông báo thay vì im lặng', async () => {
    useDrive('manager');
    let trashed = false;
    server.use(http.post(`${API}/drive/items/:id/trash`, () => { trashed = true; return HttpResponse.json({ error: { code: 'INTERNAL', message: 'x', requestId: 'x' } }, { status: 500 }); }));
    renderApp(<WorkspaceDrivePage />);
    await userEvent.click(await screen.findByRole('button', { name: /Biên bản họp.docx/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ vào thùng rác' }));
    expect(trashed).toBe(true);
    expect(await screen.findByText('Thao tác Drive không thành công.')).toHaveClass('is-error');
  });
});
