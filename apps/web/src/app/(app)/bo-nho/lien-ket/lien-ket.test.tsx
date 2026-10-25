import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthenticatedDriveLinkPage from './page';

describe('link Drive có xác thực', () => {
  it('đọc token từ fragment và chỉ đưa token vào API khi người dùng bấm tải', async () => {
    window.location.hash = '#abcdefghijklmnopqrstuvwx';
    render(<AuthenticatedDriveLinkPage />);
    const link = await screen.findByRole('link', { name:'Tải snapshot đã chia sẻ' });
    expect(link).toHaveAttribute('href', '/api/v1/drive/shared-links/abcdefghijklmnopqrstuvwx');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem('vcworkspace.drive-link-token')).toBeNull();
  });
});
