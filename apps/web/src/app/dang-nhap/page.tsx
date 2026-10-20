import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginBox } from './LoginBox';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function LoginPage() {
  return (
    <div className="login-page">
      <Suspense>
        <LoginBox />
      </Suspense>
    </div>
  );
}
