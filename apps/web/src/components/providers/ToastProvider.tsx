'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string; href?: string; linkText?: string };
type ToastApi = {
  success: (text: string, link?: { href: string; text: string }) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => remove(id), t.kind === 'error' ? 10_000 : 6_000);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (text, link) => push({ kind: 'success', text, href: link?.href, linkText: link?.text }),
      error: (text) => push({ kind: 'error', text }),
      info: (text) => push({ kind: 'info', text }),
    }),
    [push],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.href && (
              <Link href={t.href} className="toast-link" onClick={() => remove(t.id)}>
                {t.linkText ?? 'Mở'}
              </Link>
            )}
            <button className="toast-close" aria-label="Đóng" onClick={() => remove(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast phải nằm trong ToastProvider');
  return v;
}
