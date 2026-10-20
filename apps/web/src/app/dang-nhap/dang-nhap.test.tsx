import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navigation } from '@/test/setup';
import { LoginBox } from './LoginBox';

describe('Trang đăng nhập', () => {
  it('loi=setup (D22): báo hệ thống chưa khởi tạo, không báo sai tên miền', () => {
    navigation.search = new URLSearchParams('loi=setup');
    render(<LoginBox />);
    expect(screen.getByRole('alert')).toHaveTextContent('Hệ thống chưa được khởi tạo. Vui lòng liên hệ Quản trị hệ thống.');
    expect(screen.queryByText(/chỉ tài khoản @vcprosperous.com/)).toBeNull();
  });

  it('loi=domain vẫn báo sai tên miền', () => {
    navigation.search = new URLSearchParams('loi=domain');
    render(<LoginBox />);
    expect(screen.getByRole('alert')).toHaveTextContent('chỉ tài khoản @vcprosperous.com được đăng nhập');
  });

  it('không có loi thì không hiện thông báo', () => {
    render(<LoginBox />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
