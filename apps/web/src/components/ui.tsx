'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { errorText } from '@/api/client';
import { toneOf } from '@/lib/labels';

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

export function Button({
  variant = 'secondary',
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={`btn btn-${variant} ${className}`}
    >
      {loading ? 'Đang xử lý…' : children}
    </button>
  );
}

export function LinkButton({ href, variant = 'secondary', children }: { href: string; variant?: BtnVariant; children: ReactNode }) {
  return (
    <Link href={href} className={`btn btn-${variant}`}>
      {children}
    </Link>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="page-header">
      {back && (
        <Link className="back-link" href={back.href}>
          ← {back.label}
        </Link>
      )}
      <div className="page-header-row">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ status, children }: { status?: string; children: ReactNode }) {
  return <span className={`badge badge-${toneOf(status)}`}>{children}</span>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{errorText(error)}</span>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'success'; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function Loading({ text = 'Đang tải…' }: { text?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden /> {text}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Hiện trạng thái tải / lỗi / rỗng cho một truy vấn. */
export function QueryState({ q, empty, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; empty?: boolean; children: ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (empty) return <Empty>Chưa có dữ liệu.</Empty>;
  return <>{children}</>;
}

export function Field({ label, hint, error, required, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** Ô nhập có nhãn. id tự sinh để nhãn gắn với ô. */
export function TextField({
  label,
  value,
  onChange,
  required,
  hint,
  error,
  type = 'text',
  multiline,
  ...rest
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  type?: string;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
  autoFocus?: boolean;
  inputMode?: 'text' | 'numeric' | 'email';
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={id}>
      {multiline ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} rows={3} {...rest} />
      ) : (
        <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} {...rest} />
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  required,
  hint,
  error,
  placeholder = '— Chọn —',
  disabled,
}: {
  label: ReactNode;
  value: T | '';
  onChange: (v: T | '') => void;
  options: { value: T; label: string; disabled?: boolean }[];
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T | '')} required={required} disabled={disabled}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Modal({ title, open, onClose, children, footer }: { title: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Chỉ đặt con trỏ khi vừa mở; không chạy lại mỗi lần vẽ (sẽ cướp con trỏ khi đang gõ).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const body = ref.current?.querySelector('.modal-body');
    (body?.querySelector<HTMLElement>('input, textarea, select') ?? ref.current?.querySelector<HTMLElement>('.modal-foot button:last-child'))?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="toast-close" aria-label="Đóng" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} className={`tab ${t.value === value ? 'is-active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function DefList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="deflist">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DriveLink({ fileId, children = 'Mở trên Drive' }: { fileId?: string; children?: ReactNode }) {
  if (!fileId) return null;
  return (
    <a className="btn btn-secondary" href={`https://drive.google.com/open?id=${encodeURIComponent(fileId)}`} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
