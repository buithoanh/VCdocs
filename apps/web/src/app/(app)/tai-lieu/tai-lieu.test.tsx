import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { doc, ids } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { chooseOption, findOption, selectedText } from '@/test/antd';
import { DocumentView } from './[id]/DocumentView';
import RegisterDocumentPage from './dang-ky/page';
import { validateDocumentRegistration } from './dang-ky/validate';
import { parseDriveFileId } from '@/lib/drive';

describe('đăng ký tài liệu', () => {
  const ok = { type: 'QT' as const, level: 'DEPT' as const, title: 'Quy trình SEO', departmentId: ids.dept, drafterId: ids.me, checkerId: '', dueDate: '' };

  it('đủ thông tin thì không lỗi', () => {
    expect(validateDocumentRegistration(ok)).toEqual({});
  });

  it('Quy định cấp phòng bị chặn (BR-02)', () => {
    expect(validateDocumentRegistration({ ...ok, type: 'QD', level: 'DEPT' }).level).toMatch(/VCPV/);
  });

  it('thiếu tên, người soạn thì báo', () => {
    const e = validateDocumentRegistration({ ...ok, title: ' ', drafterId: '' });
    expect(e.title).toBeTruthy();
    expect(e.drafterId).toBeTruthy();
  });

  it('chọn Quy định thì tự chuyển cấp công ty và khoá cấp phòng', async () => {
    renderApp(<RegisterDocumentPage />, { roles: ['R4'] });
    await chooseOption(screen.getByLabelText(/Loại tài liệu/), 'Quy định');
    const level = screen.getByLabelText(/^Cấp/);
    expect(selectedText(level)).toBe('Cấp công ty (VCPV)');
    expect(await findOption(level, 'Cấp phòng')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('chi tiết tài liệu', () => {
  it('chỉ hiện nút có trong allowedActions', async () => {
    renderApp(<DocumentView id={ids.doc} />, { roles: ['R4'] });
    expect(await screen.findByRole('button', { name: 'Trình duyệt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lấy góp ý' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ban hành' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cấp mã' })).toBeNull();
  });

  it('tài liệu đã duyệt có nút Ban hành', async () => {
    server.use(http.get(`${API}/documents/:id`, () => HttpResponse.json({ ...doc, status: 'approved', allowedActions: ['issue'] })));
    renderApp(<DocumentView id={ids.doc} />, { roles: ['R3'] });
    expect(await screen.findByRole('button', { name: 'Ban hành' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trình duyệt' })).toBeNull();
  });
});

describe('link Drive', () => {
  it('lấy được fileId từ link Google Docs', () => {
    expect(parseDriveFileId('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseDriveFileId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseDriveFileId('https://thuvienphapluat.vn/van-ban')).toBeUndefined();
  });
});
