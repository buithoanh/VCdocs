import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { ActionBar } from './pickers';
import { JobProgress } from './jobs';
import { DataTable } from './DataTable';

describe('ActionBar', () => {
  it('chỉ hiện nút có trong allowedActions', async () => {
    const onSubmit = vi.fn();
    renderApp(
      <ActionBar
        obj={{ allowedActions: ['submit'] }}
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
    renderApp(<ActionBar obj={{ allowedActions: [] }} actions={[{ action: 'submit', label: 'Trình duyệt', onClick: vi.fn() }]} emptyText="Không có việc." />);
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
