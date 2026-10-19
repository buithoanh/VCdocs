import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { ActionBar } from './pickers';
import { JobProgress, jobResultLink } from './jobs';
import { UserName, UserPicker } from './pickers';
import { makeJob, people } from '@/test/fixtures';
import { rememberPeople } from '@/api/client';
import { http, HttpResponse } from 'msw';
import { API, server } from '@/test/server';
import { DataTable } from './DataTable';

describe('ActionBar', () => {
  it('chỉ hiện nút có trong allowedActions', async () => {
    const onSubmit = vi.fn();
    renderApp(
      <ActionBar
        obj={{ allowedActions: ['submit'] as ('submit' | 'issue')[] }}
        actions={[
          { action: 'submit', label: 'Trình duyệt', onClick: onSubmit },
          { action: 'issue', label: 'Ban hành', onClick: vi.fn() },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ban hành' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Trình duyệt' }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('không có hành động nào thì không hiện nút', () => {
    renderApp(<ActionBar obj={{ allowedActions: [] as 'submit'[] }} actions={[{ action: 'submit', label: 'Trình duyệt', onClick: vi.fn() }]} emptyText="Không có việc." />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Không có việc.')).toBeInTheDocument();
  });
});

describe('JobProgress', () => {
  it('theo dõi GET /jobs/{id}, hiện các bước và link kết quả', async () => {
    const onFinished = vi.fn();
    renderApp(<JobProgress jobId="6712f0c2a1b2c3d4e5f60771" onFinished={onFinished} />);
    expect(await screen.findByText('Xong')).toBeInTheDocument();
    expect(screen.getByText('Tạo file từ biểu mẫu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở hồ sơ' })).toHaveAttribute('href', '/ho-so/6712f0c2a1b2c3d4e5f60751');
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
  });
});

describe('DataTable', () => {
  it('có dòng tiêu đề và nhãn cột cho điện thoại', () => {
    renderApp(<DataTable rows={[{ id: '1', name: 'A' }]} rowKey={(r) => r.id} columns={[{ key: 'name', header: 'Tên', render: (r) => r.name }]} />);
    expect(screen.getByRole('columnheader', { name: 'Tên' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'A' })).toHaveAttribute('data-label', 'Tên');
  });
});

describe('tên người từ people', () => {
  it('hiện tên khi phản hồi đã có people, không gọi /users/{id}', () => {
    rememberPeople(people);
    renderApp(<UserName id={Object.keys(people)[1]} />);
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument();
  });

  it('chưa có trong people thì hiện id rút gọn', () => {
    renderApp(<UserName id="6712f0c2a1b2c3d4e5f6ffff" />);
    expect(screen.getByText(/Nhân sự …f6ffff/)).toBeInTheDocument();
  });
});

describe('chọn người', () => {
  it('tra bằng /users/lookup (mọi vai trò)', async () => {
    let q: string | null = null;
    server.use(
      http.get(`${API}/users/lookup`, ({ request }) => {
        q = new URL(request.url).searchParams.get('q');
        return HttpResponse.json({ items: [{ id: '6712f0c2a1b2c3d4e5f60799', name: 'Lê Văn C', email: 'c@vcprosperous.com' }] });
      }),
    );
    const onChange = vi.fn();
    renderApp(<UserPicker label="Người soạn" value="" onChange={onChange} />, { roles: ['R6'] });
    await userEvent.type(screen.getByRole('searchbox'), 'Lê');
    const opt = await screen.findByRole('option', { name: /Lê Văn C/ });
    expect(q).toBe('Lê');
    await userEvent.selectOptions(screen.getByRole('combobox'), opt);
    expect(onChange).toHaveBeenCalledWith('6712f0c2a1b2c3d4e5f60799');
  });
});

describe('kết quả việc nền', () => {
  it('đối tượng VCdocs → trang trong giao diện; file → Drive', () => {
    expect(jobResultLink(makeJob('done', { result: { objectType: 'record_type', objectId: 'abc' } }))?.href).toBe('/danh-muc-ho-so/abc');
    expect(jobResultLink(makeJob('done', { result: { fileId: 'f1', url: 'https://docs.google.com/spreadsheets/d/f1' } }))).toMatchObject({ href: 'https://docs.google.com/spreadsheets/d/f1', external: true });
    expect(jobResultLink(makeJob('done', { result: { fileId: 'f1' } }))?.href).toBe('https://drive.google.com/open?id=f1');
  });
});
