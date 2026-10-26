'use client';

import { Pagination as AntPagination, Table, type TableColumnsType } from 'antd';
import { useRouter } from 'next/navigation';
import type { ReactNode, TdHTMLAttributes } from 'react';
import { formatNumber } from '@/lib/format';
import { Empty } from './ui';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Ẩn cột này trên điện thoại. */
  hideOnMobile?: boolean;
  className?: string;
};

/** Bấm vào phần tử tương tác trong dòng thì không mở dòng. */
const INTERACTIVE = 'a,button,input,select,textarea,label,[role="combobox"]';

/**
 * Bảng theo HD-VCPV-02 trên antd Table: dòng tiêu đề nền #13233A chữ trắng, dòng xen kẽ #FFFFFF / #E8EDF3.
 * Trên điện thoại mỗi dòng thành một thẻ (nhãn cột hiện bên trái, lấy từ data-label).
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
  if (!rows.length) return <Empty>{empty}</Empty>;
  const cols: TableColumnsType<T> = columns.map((c) => ({
    key: c.key,
    title: c.header,
    className: [c.hideOnMobile ? 'hide-mobile' : '', c.className ?? ''].filter(Boolean).join(' ') || undefined,
    render: (_: unknown, row: T) => c.render(row),
    onCell: () => ({ 'data-label': c.header }) as TdHTMLAttributes<HTMLTableCellElement>,
  }));
  return (
    <Table<T>
      className="vc-table"
      size="small"
      columns={cols}
      dataSource={rows}
      rowKey={rowKey}
      pagination={false}
      caption={caption ? <span className="sr-only">{caption}</span> : undefined}
      rowClassName={(_, i) => (i % 2 ? 'vc-row-even' : 'vc-row-odd')}
      onRow={(row) => {
        const href = rowHref?.(row);
        if (!href) return {};
        return {
          className: 'is-link',
          onClick: (e) => {
            if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
            router.push(href);
          },
        };
      }}
    />
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  if (total <= limit) return total > 0 ? <p className="muted small">{formatNumber(total)} dòng</p> : null;
  return (
    <AntPagination
      className="pagination"
      current={page}
      pageSize={limit}
      total={total}
      onChange={onPage}
      showSizeChanger={false}
      showTotal={(t) => `${formatNumber(t)} dòng`}
    />
  );
}
