'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { JobsProvider } from '@/components/jobs';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { Button, Loading } from '@/components/ui';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider
      fallback={(state, retry, message) => (
        <div className="center-page">
          {state === 'loading' ? (
            <Loading text="Đang mở VCdocs…" />
          ) : (
            <div className="card">
              <p>{message || 'Không kết nối được máy chủ.'}</p>
              <Button variant="primary" onClick={retry}>
                Thử lại
              </Button>
            </div>
          )}
        </div>
      )}
    >
      <JobsProvider>
        <AppShell>{children}</AppShell>
      </JobsProvider>
    </AuthProvider>
  );
}
