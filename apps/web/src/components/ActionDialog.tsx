'use client';

import type { QueryKey } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useAction } from '@/api/queries';
import { Button, ErrorBox, Modal, TextField } from './ui';

/**
 * Hộp thoại xác nhận một hành động, có thể kèm ô ghi lý do/ý kiến.
 * Giữ Idempotency-Key cho tới khi thành công (bấm lại sau lỗi mạng không làm hai lần).
 */
export function ActionDialog<R>({
  open,
  title,
  description,
  confirmLabel,
  variant = 'primary',
  textLabel,
  textRequired,
  textHint,
  children,
  canConfirm = true,
  run,
  invalidate,
  onDone,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  variant?: 'primary' | 'danger' | 'success';
  /** Có nhãn thì hiện ô nhập chữ. */
  textLabel?: string;
  textRequired?: boolean;
  textHint?: ReactNode;
  /** Ô nhập thêm (ngày, lựa chọn…) do nơi gọi tự giữ trạng thái. */
  children?: ReactNode;
  canConfirm?: boolean;
  run: (text: string, idempotencyKey: string) => Promise<R>;
  invalidate?: QueryKey[];
  onDone?: (r: R) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const m = useAction((t: string, key: string) => run(t, key), {
    invalidate,
    onSuccess: (r) => {
      setText('');
      onDone?.(r);
      onClose();
    },
  });
  const missing = !!textLabel && !!textRequired && !text.trim();
  return (
    <Modal
      open={open}
      title={title}
      onClose={() => {
        m.reset();
        onClose();
      }}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant={variant} disabled={missing || !canConfirm} loading={m.isPending} onClick={() => m.mutate(text.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="muted">{description}</div>}
      {children}
      {textLabel && <TextField label={textLabel} value={text} onChange={setText} required={textRequired} multiline hint={textHint} />}
      <ErrorBox error={m.error} />
    </Modal>
  );
}
