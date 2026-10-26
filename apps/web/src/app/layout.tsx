import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers/Providers';
import './globals.css';

// Font có đủ dấu tiếng Việt; Next tải về lúc build và tự phục vụ, không gọi Google khi chạy.
const font = Be_Vietnam_Pro({ subsets: ['vietnamese', 'latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'VCworkspace', template: '%s · VCworkspace' },
  description: 'Quản lý tài liệu – hồ sơ VC Phồn Vinh',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#13233A',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={font.variable}>
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
