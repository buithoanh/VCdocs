'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Ẩn cột này trên điện thoại. */
  hideOnMobile?: boolean;
  className?: string;
};

/**
 * Bảng theo HD-VCPV-02: dòng tiêu đề nền #13233A chữ trắng, dòng xen kẽ #FFFFFF / #E8EDF3.
 * Trên điện thoại mỗi dòng thành một thẻ (nhãn cột hiện bên trái).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty = 'Chưa có dữ liệu.',
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string | undefined;
  empty?: ReactNode;
  caption?: string;
}) {
  const router = useRouter();
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="vc-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`${c.hideOnMobile ? 'hide-mobile' : ''} ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = rowHref?.(r);
            return (
              <tr
                key={rowKey(r)}
                className={href ? 'is-link' : undefined}
                onClick={
                  href
                    ? (e) => {
                        if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return;
                        router.push(href);
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} data-label={c.header} className={`${c.hideOnMobile ? 'hide-mobile' : ''} ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return total > 0 ? <p className="muted small">{formatNumber(total)} dòng</p> : null;
  return (
    <nav className="pagination" aria-label="Phân trang">
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Trước
      </button>
      <span>
        Trang {page}/{pages} · {formatNumber(total)} dòng
      </span>
      <button className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Sau →
      </button>
    </nav>
  );
}
