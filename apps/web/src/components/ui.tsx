'use client';

import { ExportOutlined } from '@ant-design/icons';
import {
  Alert,
  Button as AntButton,
  Card as AntCard,
  Descriptions,
  Empty as AntEmpty,
  Form,
  Input,
  Modal as AntModal,
  Select,
  Spin,
  Tabs as AntTabs,
  Tag,
  Typography,
  type ButtonProps as AntButtonProps,
} from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, type MouseEvent, type MouseEventHandler, type ReactNode } from 'react';
import { errorText } from '@/api/client';
import { toneOf, type Tone } from '@/lib/labels';

/*
 * Lớp component nền của VCworkspace, dựng trên Ant Design 6.
 * Giữ tên export và props cũ để các trang không phải đổi cùng lúc;
 * khi viết lại từng module thì dùng thẳng antd (Form, Table…) ở đó.
 */

/* ── Nút ── */

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type BtnSize = 'small' | 'middle' | 'large';

const VARIANT: Record<BtnVariant, Pick<AntButtonProps, 'type' | 'danger' | 'color' | 'variant'>> = {
  primary: { type: 'primary' },
  secondary: { type: 'default' },
  danger: { type: 'primary', danger: true },
  ghost: { type: 'link' },
  success: { color: 'green', variant: 'solid' },
};

export type ButtonProps = {
  variant?: BtnVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Mặc định `button` để không vô tình submit form. */
  type?: 'button' | 'submit' | 'reset';
  size?: BtnSize;
  block?: boolean;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
  title?: string;
  id?: string;
  form?: string;
  autoFocus?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-pressed'?: boolean;
  'aria-controls'?: string;
};

export function Button({ variant = 'secondary', loading, className = '', type = 'button', size, block, ...rest }: ButtonProps) {
  // Lớp cũ `btn-lg`, `btn-block` còn ở vài trang; đổi sang prop antd cho tới khi các trang được viết lại.
  const classes = className.split(/\s+/).filter(Boolean);
  const large = classes.includes('btn-lg');
  const isBlock = block || classes.includes('btn-block');
  const rest_cls = classes.filter((c) => c !== 'btn-lg' && c !== 'btn-block').join(' ');
  return (
    <AntButton
      {...VARIANT[variant]}
      htmlType={type}
      loading={loading}
      aria-busy={loading || undefined}
      size={large ? 'large' : size}
      block={isBlock}
      className={rest_cls || undefined}
      {...rest}
    />
  );
}

/** Nút dẫn tới trang khác; đường dẫn trong app điều hướng phía client, link ngoài mở tab mới. */
export function LinkButton({
  href,
  variant = 'secondary',
  children,
  size,
  className,
  icon,
}: {
  href: string;
  variant?: BtnVariant;
  children: ReactNode;
  size?: BtnSize;
  className?: string;
  icon?: ReactNode;
}) {
  const router = useRouter();
  const external = /^https?:\/\//i.test(href);
  function onClick(e: MouseEvent<HTMLElement>) {
    if (external || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(href);
  }
  return (
    <AntButton
      {...VARIANT[variant]}
      href={href}
      size={size}
      icon={icon}
      className={className}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      onClick={onClick}
    >
      {children}
    </AntButton>
  );
}

/* ── Trang ── */

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
    <AntCard
      className={`vc-card ${className}`.trim()}
      title={title ? <h2 className="vc-card-title">{title}</h2> : undefined}
      extra={actions ? <div className="actions">{actions}</div> : undefined}
    >
      {children}
    </AntCard>
  );
}

/* ── Trạng thái, thông báo ── */

const TONE_COLOR: Record<Tone, string> = { green: 'success', amber: 'warning', red: 'error', blue: 'processing', grey: 'default' };

export function Badge({ status, children }: { status?: string; children: ReactNode }) {
  return (
    <Tag variant="filled" color={TONE_COLOR[toneOf(status)]} className="vc-badge">
      {children}
    </Tag>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert
      type="error"
      showIcon
      className="vc-notice"
      title={errorText(error)}
      action={
        onRetry && (
          <AntButton size="small" onClick={onRetry}>
            Thử lại
          </AntButton>
        )
      }
    />
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'success'; children: ReactNode }) {
  return <Alert type={tone === 'warn' ? 'warning' : tone} showIcon className="vc-notice" title={children} />;
}

export function Loading({ text = 'Đang tải…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <Spin size="small" /> <span>{text}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <AntEmpty className="vc-empty" image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description={children} />;
}

/** Hiện trạng thái tải / lỗi / rỗng cho một truy vấn. */
export function QueryState({ q, empty, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; empty?: boolean; children: ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (empty) return <Empty>Chưa có dữ liệu.</Empty>;
  return <>{children}</>;
}

/* ── Form ── */

/** Ô nhập có nhãn, gợi ý và lỗi; dùng được với ô nhập thường (file, radio) hoặc antd. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <Form.Item
      className={`vc-field ${className}`.trim()}
      label={label}
      htmlFor={htmlFor}
      required={required}
      layout="vertical"
      validateStatus={error ? 'error' : undefined}
      help={error}
      extra={error ? undefined : hint}
    >
      {children}
    </Form.Item>
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
  min,
  max,
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
  const status = error ? 'error' : undefined;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={id}>
      {multiline ? (
        <Input.TextArea id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} rows={3} status={status} {...rest} />
      ) : (
        <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} status={status} min={min} max={max} {...rest} />
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
      <Select<T | ''>
        id={id}
        value={value || undefined}
        onChange={(v) => onChange((v ?? '') as T | '')}
        options={options}
        placeholder={placeholder}
        allowClear={!required}
        disabled={disabled}
        showSearch={options.length > 8}
        optionFilterProp="label"
        status={error ? 'error' : undefined}
        style={{ width: '100%' }}
      />
    </Field>
  );
}

/* ── Hộp thoại ── */

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  width = 560,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <AntModal
      title={title}
      open={open}
      onCancel={onClose}
      footer={footer ?? null}
      width={width}
      destroyOnHidden
      afterOpenChange={(opened) => {
        // Đặt con trỏ vào ô nhập đầu tiên khi vừa mở; không chạy lại mỗi lần vẽ.
        if (opened) bodyRef.current?.querySelector<HTMLElement>('input, textarea, select, [role="combobox"]')?.focus();
      }}
    >
      <div ref={bodyRef} className="vc-modal-body">
        {children}
      </div>
    </AntModal>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return <AntTabs className="vc-tabs" activeKey={value} onChange={(k) => onChange(k as T)} items={tabs.map((t) => ({ key: t.value, label: t.label }))} />;
}

export function DefList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <Descriptions
      className="vc-deflist"
      size="small"
      layout="vertical"
      column={{ xs: 1, sm: 2, lg: 3 }}
      items={items.map(([k, v], i) => ({ key: i, label: k, children: v ?? '—' }))}
    />
  );
}

export function DriveLink({ fileId, children = 'Mở trên Drive' }: { fileId?: string; children?: ReactNode }) {
  if (!fileId) return null;
  return (
    <AntButton href={`https://drive.google.com/open?id=${encodeURIComponent(fileId)}`} target="_blank" rel="noreferrer" icon={<ExportOutlined />}>
      {children}
    </AntButton>
  );
}

export const Text = Typography.Text;
