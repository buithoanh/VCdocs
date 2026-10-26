'use client';

import { Select, Space, Spin } from 'antd';
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getPeopleVersion, getPerson, rememberPeople, subscribePeople } from '@/api/client';
import { deptName, useDepartments, useUserLookup } from '@/api/queries';
import { shortId } from '@/lib/format';
import { hasAction } from '@/lib/permissions';
import { Button, Field } from './ui';

/*
 * Ô chọn phòng / nhân sự. Bản `…Input` chỉ là antd Select (value/onChange/id) để đặt trong
 * `Form.Item name=…` của antd Form; bản có nhãn (DeptSelect, UserPicker, MultiUserPicker) bọc thêm Field
 * cho trang còn giữ trạng thái bằng useState.
 */

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

type InputCommon = { id?: string; disabled?: boolean; status?: 'error' | 'warning'; placeholder?: string };

/** Ô chọn phòng, chỉ Select. `allowAll` thêm mục "Tất cả phòng" (giá trị ''). */
export function DeptSelectInput({
  value,
  onChange,
  allowAll,
  required,
  placeholder,
  ...rest
}: InputCommon & { value?: string; onChange?: (v: string | undefined) => void; allowAll?: boolean; required?: boolean }) {
  const q = useDepartments();
  const options = [
    ...(allowAll ? [{ value: '', label: 'Tất cả phòng' }] : []),
    ...(q.data ?? []).map((d) => ({ value: d.id, label: `${d.number} ${d.code} – ${d.name}` })),
  ];
  return (
    <Select
      value={allowAll ? (value ?? '') : value || undefined}
      onChange={(v) => onChange?.(v)}
      options={options}
      loading={q.isLoading}
      placeholder={placeholder ?? (q.isLoading ? 'Đang tải…' : '— Chọn phòng —')}
      allowClear={!required && !allowAll}
      showSearch
      optionFilterProp="label"
      style={{ width: '100%' }}
      {...rest}
    />
  );
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
  const id = useId();
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint}>
      <DeptSelectInput id={id} value={value} onChange={(v) => onChange(v ?? '')} allowAll={allowAll} required={required} />
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

function notFound(debounced: string, loading: boolean, failed: boolean) {
  if (failed) return SEARCH_ERROR;
  if (!debounced) return SEARCH_PLACEHOLDER;
  if (loading) return <Spin size="small" />;
  return 'Không thấy ai phù hợp';
}

/** Nhớ người vừa tìm được để nhãn còn hiện sau khi antd xoá chữ tìm (và UserName dùng chung). */
function useRememberLookup(items: { id: string; name: string; email: string }[] | undefined) {
  useEffect(() => {
    if (items?.length) rememberPeople(Object.fromEntries(items.map((u) => [u.id, u])));
  }, [items]);
}

function personLabel(id: string) {
  const p = getPerson(id);
  return p ? `${p.name} · ${p.email}` : `Nhân sự ${shortId(id)}`;
}

/** Chọn một nhân sự (tìm theo tên/email qua /users/lookup), chỉ Select. */
export function UserSelectInput({
  value,
  onChange,
  required,
  excludeIds = [],
  ...rest
}: InputCommon & { value?: string; onChange?: (id: string | undefined) => void; required?: boolean; excludeIds?: string[] }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const search = useUserLookup(debounced);
  useRememberLookup(search.data);
  useSyncExternalStore(subscribePeople, getPeopleVersion, getPeopleVersion);
  const options = (search.data ?? []).filter((u) => !excludeIds.includes(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }));
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: personLabel(value) });
  return (
    <Select
      showSearch
      value={value || undefined}
      onSearch={setQ}
      filterOption={false}
      onChange={(v) => {
        onChange?.(v);
        setQ('');
      }}
      options={options}
      allowClear={!required}
      placeholder={SEARCH_PLACEHOLDER}
      notFoundContent={notFound(debounced, search.isLoading, !!search.error)}
      loading={search.isLoading}
      status={search.error ? 'error' : undefined}
      style={{ width: '100%' }}
      {...rest}
    />
  );
}

export function UserPicker({
  label,
  value,
  onChange,
  required,
  hint,
  excludeIds,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  hint?: ReactNode;
  excludeIds?: string[];
}) {
  const id = useId();
  return (
    <Field label={label} required={required} htmlFor={id} hint={hint}>
      <UserSelectInput id={id} value={value} onChange={(v) => onChange(v ?? '')} required={required} excludeIds={excludeIds} />
    </Field>
  );
}

/** Chọn nhiều nhân sự, chỉ Select; người đã chọn hiện thành thẻ trong ô. */
export function MultiUserSelectInput({ value = [], onChange, ...rest }: InputCommon & { value?: string[]; onChange?: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const search = useUserLookup(debounced);
  useRememberLookup(search.data);
  useSyncExternalStore(subscribePeople, getPeopleVersion, getPeopleVersion);
  const chosen = value.map((uid) => ({ value: uid, label: personLabel(uid) }));
  const found = (search.data ?? []).filter((u) => !value.includes(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }));
  return (
    <Select
      mode="multiple"
      showSearch
      value={value}
      onSearch={setQ}
      filterOption={false}
      onChange={(ids) => {
        onChange?.(ids);
        setQ('');
      }}
      options={[...chosen, ...found]}
      placeholder={SEARCH_PLACEHOLDER}
      notFoundContent={notFound(debounced, search.isLoading, !!search.error)}
      loading={search.isLoading}
      status={search.error ? 'error' : undefined}
      style={{ width: '100%' }}
      {...rest}
    />
  );
}

export function MultiUserPicker({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (ids: string[]) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <MultiUserSelectInput id={id} value={value} onChange={onChange} />
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
