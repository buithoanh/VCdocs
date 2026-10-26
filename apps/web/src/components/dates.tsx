'use client';

import { DatePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useId, type ReactNode } from 'react';
import { Field } from './ui';

/*
 * Chọn ngày / tháng bằng antd DatePicker nhưng giá trị trao đổi với trang là chuỗi ISO
 * (YYYY-MM-DD, YYYY-MM) đúng như hợp đồng API, nên lib/records và các truy vấn không đổi.
 */

export function toDayjs(iso?: string | null): Dayjs | null {
  return iso ? dayjs(iso) : null;
}

export function toISODate(d?: Dayjs | null): string {
  return d ? d.format('YYYY-MM-DD') : '';
}

export function toISOMonth(d?: Dayjs | null): string {
  return d ? d.format('YYYY-MM') : '';
}

type PickerProps = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  status?: 'error' | 'warning';
  /** Không cho chọn sau hôm nay / tháng này. */
  disabledFuture?: boolean;
};

/** Chọn tháng, giá trị YYYY-MM. */
export function MonthPicker({ value, onChange, disabledFuture, ...rest }: PickerProps) {
  return (
    <DatePicker
      picker="month"
      format="MM/YYYY"
      value={toDayjs(value)}
      onChange={(d) => onChange(toISOMonth(d))}
      disabledDate={disabledFuture ? (d) => d.isAfter(dayjs(), 'month') : undefined}
      style={{ width: '100%' }}
      {...rest}
    />
  );
}

/** Chọn ngày, giá trị YYYY-MM-DD. */
export function DayPicker({ value, onChange, disabledFuture, ...rest }: PickerProps) {
  return (
    <DatePicker
      format="DD/MM/YYYY"
      value={toDayjs(value)}
      onChange={(d) => onChange(toISODate(d))}
      disabledDate={disabledFuture ? (d) => d.isAfter(dayjs(), 'day') : undefined}
      style={{ width: '100%' }}
      {...rest}
    />
  );
}

type FieldProps = {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  allowClear?: boolean;
  disabled?: boolean;
  disabledFuture?: boolean;
  placeholder?: string;
};

export function MonthField({ label, required, hint, error, ...rest }: FieldProps) {
  const id = useId();
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={id}>
      <MonthPicker id={id} status={error ? 'error' : undefined} allowClear={!required} {...rest} />
    </Field>
  );
}

export function DateField({ label, required, hint, error, ...rest }: FieldProps) {
  const id = useId();
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={id}>
      <DayPicker id={id} status={error ? 'error' : undefined} allowClear={!required} {...rest} />
    </Field>
  );
}
