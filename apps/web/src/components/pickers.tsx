'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { deptName, useDepartments, useUser, useUserSearch } from '@/api/queries';
import { hasAction } from '@/lib/permissions';
import { shortId } from '@/lib/format';
import { Button, Field } from './ui';

/** Hiện tên nhân sự từ id; không có quyền xem thì hiện id rút gọn. */
export function UserName({ id }: { id?: string }) {
  const q = useUser(id);
  if (!id) return <>—</>;
  if (q.data) return <span title={q.data.email}>{q.data.name}</span>;
  return <span className="muted" title={id}>{q.isLoading ? '…' : `Nhân sự ${shortId(id)}`}</span>;
}

export function DeptName({ id }: { id?: string }) {
  const q = useDepartments();
  return <>{deptName(q.data, id)}</>;
}

export function DeptSelect({ value, onChange, label = 'Phòng', required, allowAll, hint }: { value: string; onChange: (v: string) => void; label?: string; required?: boolean; allowAll?: boolean; hint?: ReactNode }) {
  const q = useDepartments();
  const id = useId();
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">{allowAll ? 'Tất cả phòng' : q.isLoading ? 'Đang tải…' : '— Chọn phòng —'}</option>
        {q.data?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.number} {d.code} – {d.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Chọn một nhân sự (tìm theo tên/email). */
export function UserPicker({ label, value, onChange, required, hint, excludeIds = [] }: { label: string; value: string; onChange: (id: string) => void; required?: boolean; hint?: ReactNode; excludeIds?: string[] }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const search = useUserSearch(debounced);
  const id = useId();
  const forbidden = search.error instanceof ApiError && search.error.status === 403;
  const options = (search.data ?? []).filter((u) => !excludeIds.includes(u.id));
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint}>
      <div className="picker">
        <input type="search" placeholder="Gõ tên hoặc email để tìm" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Tìm ${label.toLowerCase()}`} />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
          <option value="">{search.isLoading ? 'Đang tìm…' : `— Chọn (${options.length} người) —`}</option>
          {value && !options.some((u) => u.id === value) && <option value={value}>Đã chọn</option>}
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.email}
            </option>
          ))}
        </select>
      </div>
      {forbidden && <p className="field-error">Bạn chưa được xem danh sách nhân sự. Nhờ trưởng phòng thực hiện việc này.</p>}
    </Field>
  );
}

/** Chọn nhiều nhân sự. */
export function MultiUserPicker({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (ids: string[]) => void; hint?: ReactNode }) {
  const [pick, setPick] = useState('');
  return (
    <div>
      <UserPicker
        label={label}
        value={pick}
        hint={hint}
        excludeIds={value}
        onChange={(id) => {
          if (id && !value.includes(id)) onChange([...value, id]);
          setPick('');
        }}
      />
      {value.length > 0 && (
        <ul className="chips">
          {value.map((id) => (
            <li key={id} className="chip">
              <UserName id={id} />
              <button aria-label="Bỏ" onClick={() => onChange(value.filter((x) => x !== id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type ActionDef = {
  /** Tên hành động trong allowedActions. */
  action: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  onClick: () => void;
};

/** Chỉ hiện nút có trong allowedActions của đối tượng. */
export function ActionBar({ obj, actions, emptyText }: { obj: { allowedActions?: readonly string[] } | undefined; actions: ActionDef[]; emptyText?: string }) {
  const visible = actions.filter((a) => hasAction(obj, a.action));
  if (!visible.length) return emptyText ? <p className="muted small">{emptyText}</p> : null;
  return (
    <div className="actions">
      {visible.map((a) => (
        <Button key={a.action} variant={a.variant ?? 'secondary'} onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
    </div>
  );
}
