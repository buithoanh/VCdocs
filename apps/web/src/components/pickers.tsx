'use client';

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getPeopleVersion, getPerson, subscribePeople } from '@/api/client';
import { deptName, useDepartments, useUserLookup } from '@/api/queries';
import { hasAction } from '@/lib/permissions';
import { shortId } from '@/lib/format';
import { Button, Field } from './ui';

/** Tên nhân sự lấy từ `people` của các phản hồi (D10); không gọi /users/{id}. */
export function usePerson(id?: string) {
  useSyncExternalStore(subscribePeople, getPeopleVersion, getPeopleVersion);
  return getPerson(id);
}

export function UserName({ id }: { id?: string }) {
  const p = usePerson(id);
  if (!id) return <>—</>;
  if (p) return <span title={p.email}>{p.name}</span>;
  return (
    <span className="muted" title={id}>
      Nhân sự {shortId(id)}
    </span>
  );
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
  const search = useUserLookup(debounced);
  const id = useId();
  const selected = usePerson(value);
  const options = (search.data ?? []).filter((u) => !excludeIds.includes(u.id));
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint}>
      <div className="picker">
        <input type="search" placeholder="Gõ tên hoặc email để tìm" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Tìm ${label.toLowerCase()}`} />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
          <option value="">{!debounced ? '— Gõ tên để tìm —' : search.isLoading ? 'Đang tìm…' : `— Chọn (${options.length} người) —`}</option>
          {value && !options.some((u) => u.id === value) && <option value={value}>{selected ? `${selected.name} · ${selected.email}` : 'Đã chọn'}</option>}
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.email}
            </option>
          ))}
        </select>
      </div>
      {search.error && <p className="field-error">Không tìm được người, vui lòng thử lại.</p>}
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

export type ActionDef<A extends string = string> = {
  /** Tên hành động trong allowedActions (enum của đối tượng). */
  action: A;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  onClick: () => void;
};

/** Chỉ hiện nút có trong allowedActions của đối tượng. */
export function ActionBar<A extends string>({ obj, actions, emptyText }: { obj: { allowedActions?: readonly A[] } | undefined; actions: ActionDef<NoInfer<A>>[]; emptyText?: string }) {
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
