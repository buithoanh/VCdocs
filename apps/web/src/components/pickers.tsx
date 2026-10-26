'use client';

import { Select, Space, Spin } from 'antd';
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getPeopleVersion, getPerson, subscribePeople } from '@/api/client';
import { deptName, useDepartments, useUserLookup } from '@/api/queries';
import { shortId } from '@/lib/format';
import { hasAction } from '@/lib/permissions';
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

export function DeptSelect({
  value,
  onChange,
  label = 'Phòng',
  required,
  allowAll,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  required?: boolean;
  allowAll?: boolean;
  hint?: ReactNode;
}) {
  const q = useDepartments();
  const id = useId();
  const options = [
    ...(allowAll ? [{ value: '', label: 'Tất cả phòng' }] : []),
    ...(q.data ?? []).map((d) => ({ value: d.id, label: `${d.number} ${d.code} – ${d.name}` })),
  ];
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint}>
      <Select
        id={id}
        value={allowAll ? value : value || undefined}
        onChange={(v) => onChange(v ?? '')}
        options={options}
        loading={q.isLoading}
        placeholder={q.isLoading ? 'Đang tải…' : '— Chọn phòng —'}
        allowClear={!required && !allowAll}
        showSearch
        optionFilterProp="label"
        style={{ width: '100%' }}
      />
    </Field>
  );
}

function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const SEARCH_ERROR = 'Không tìm được người, vui lòng thử lại.';
const SEARCH_PLACEHOLDER = 'Gõ tên hoặc email để tìm';

function notFound(debounced: string, loading: boolean) {
  if (!debounced) return SEARCH_PLACEHOLDER;
  if (loading) return <Spin size="small" />;
  return 'Không thấy ai phù hợp';
}

/** Chọn một nhân sự (tìm theo tên/email qua /users/lookup). */
export function UserPicker({
  label,
  value,
  onChange,
  required,
  hint,
  excludeIds = [],
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  hint?: ReactNode;
  excludeIds?: string[];
}) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const search = useUserLookup(debounced);
  const id = useId();
  const selected = usePerson(value);
  const options = (search.data ?? []).filter((u) => !excludeIds.includes(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }));
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: selected ? `${selected.name} · ${selected.email}` : 'Đã chọn' });
  }
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint} error={search.error ? SEARCH_ERROR : undefined}>
      <Select
        id={id}
        showSearch
        value={value || undefined}
        onSearch={setQ}
        filterOption={false}
        onChange={(v) => {
          onChange(v ?? '');
          setQ('');
        }}
        options={options}
        allowClear={!required}
        placeholder={SEARCH_PLACEHOLDER}
        notFoundContent={notFound(debounced, search.isLoading)}
        loading={search.isLoading}
        style={{ width: '100%' }}
      />
    </Field>
  );
}

/** Chọn nhiều nhân sự; người đã chọn hiện thành thẻ trong ô. */
export function MultiUserPicker({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (ids: string[]) => void; hint?: ReactNode }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const search = useUserLookup(debounced);
  const id = useId();
  useSyncExternalStore(subscribePeople, getPeopleVersion, getPeopleVersion);
  const chosen = value.map((uid) => {
    const p = getPerson(uid);
    return { value: uid, label: p ? `${p.name} · ${p.email}` : `Nhân sự ${shortId(uid)}` };
  });
  const found = (search.data ?? []).filter((u) => !value.includes(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }));
  return (
    <Field label={label} htmlFor={id} hint={hint} error={search.error ? SEARCH_ERROR : undefined}>
      <Select
        id={id}
        mode="multiple"
        showSearch
        value={value}
        onSearch={setQ}
        filterOption={false}
        onChange={(ids) => {
          onChange(ids);
          setQ('');
        }}
        options={[...chosen, ...found]}
        placeholder={SEARCH_PLACEHOLDER}
        notFoundContent={notFound(debounced, search.isLoading)}
        loading={search.isLoading}
        style={{ width: '100%' }}
      />
    </Field>
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
    <Space wrap className="actions">
      {visible.map((a) => (
        <Button key={a.action} variant={a.variant ?? 'secondary'} onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
    </Space>
  );
}
