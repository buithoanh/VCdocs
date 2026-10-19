import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setCsrfToken, setUnauthorizedHandler } from '@/api/client';
import { server } from './server';

export const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: '/',
  search: new URLSearchParams(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace, back: navigation.back, prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.search,
  useParams: () => ({}),
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  navigation.search = new URLSearchParams();
  setCsrfToken(null);
  setUnauthorizedHandler(() => {});
});
afterAll(() => server.close());
