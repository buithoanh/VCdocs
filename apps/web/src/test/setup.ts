import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setCsrfToken, setUnauthorizedHandler } from '@/api/client';
import { server } from './server';

// jsdom thiếu vài API antd cần (breakpoint, đo kích thước, cuộn).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
// jsdom không hỗ trợ getComputedStyle(el, pseudo); antd đo thanh cuộn bằng ::-webkit-scrollbar.
const computedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((el: Element) => computedStyle(el)) as typeof window.getComputedStyle;

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
