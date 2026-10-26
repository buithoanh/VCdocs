'use client';

import { notification } from 'antd';
import Link from 'next/link';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

type ToastApi = {
  success: (text: string, link?: { href: string; text: string }) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

/** Thông báo nổi góc dưới phải (antd notification). Lỗi giữ lâu hơn để kịp đọc. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [api, holder] = notification.useNotification({ placement: 'bottomRight', maxCount: 4, showProgress: true, pauseOnHover: true });
  const value = useMemo<ToastApi>(
    () => ({
      success: (text, link) => {
        const key = `toast-${++seq}`;
        api.success({
          key,
          title: text,
          duration: 6,
          description: link ? (
            <Link href={link.href} onClick={() => api.destroy(key)}>
              {link.text}
            </Link>
          ) : undefined,
        });
      },
      error: (text) => api.error({ title: text, duration: 10 }),
      info: (text) => api.info({ title: text, duration: 6 }),
    }),
    [api],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      {holder}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast phải nằm trong ToastProvider');
  return v;
}
