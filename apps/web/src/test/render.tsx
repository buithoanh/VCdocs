import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { Me, SystemRole } from '@/api/types';
import { JobsProvider } from '@/components/jobs';
import { TestAuthProvider } from '@/components/providers/AuthProvider';
import { ToastProvider } from '@/components/providers/ToastProvider';
import { makeMe } from './fixtures';

export function renderApp(ui: ReactElement, { roles = ['R6'] as SystemRole[], me = {} as Partial<Me> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TestAuthProvider me={{ ...makeMe(roles), ...me }}>
          <JobsProvider>{ui}</JobsProvider>
        </TestAuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
