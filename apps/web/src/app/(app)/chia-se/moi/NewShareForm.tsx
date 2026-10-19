'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import type { ExternalShare, ShareRole } from '@/api/types';
import { Button, Card, ErrorBox, Field, Notice, PageHeader, TextField } from '@/components/ui';
import { parseDriveFileId } from '@/lib/drive';
import { addDaysISO, endOfDayVN, formatDateTime, todayISO } from '@/lib/format';
import { shareRoleLabel } from '@/lib/labels';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateShare(v: { file: string; email: string; reason: string; expires: string }, today = todayISO()) {
  const e: Record<string, string> = {};
  if (!parseDriveFileId(v.file)) e.file = 'Dán link file Google Drive (chỉ chia sẻ từng file).';
  if (!EMAIL.test(v.email.trim())) e.email = 'Email chưa đúng.';
  else if (/@vcprosperous\.com$/i.test(v.email.trim())) e.email = 'Người trong công ty không cần chia sẻ ngoài.';
  if (!v.reason.trim()) e.reason = 'Nhập lý do chia sẻ.';
  if (!v.expires) e.expires = 'Chọn ngày hết hạn.';
  else if (v.expires <= today) e.expires = 'Ngày hết hạn phải sau hôm nay.';
  return e;
}

export function NewShareForm() {
  const params = useSearchParams();
  const [file, setFile] = useState(params.get('fileId') ?? '');
  const fileName = params.get('ten');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('reader');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState(addDaysISO(14));
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<ExternalShare | null>(null);
  const errors = validateShare({ file, email, reason, expires });
  const save = useAction(
    (_: void, key: string) =>
      unwrap(
        api.POST('/external-shares', {
          body: { fileId: parseDriveFileId(file)!, email: email.trim().toLowerCase(), role, reason: reason.trim(), expiresAt: endOfDayVN(expires) },
          ...idem(key),
        }),
      ),
    { invalidate: [['external-shares']], onSuccess: setDone },
  );

  if (done) {
    return (
      <>
        <PageHeader title="Chia sẻ ra ngoài" back={{ href: '/chia-se', label: 'Sổ chia sẻ' }} />
        <Card>
          {done.status === 'pending_approval' ? (
            <Notice tone="warn">File thuộc drive Mật: đã gửi trưởng phòng duyệt. Đối tác nhận quyền sau khi được duyệt.</Notice>
          ) : (
            <Notice tone="success">
              Đã chia sẻ cho {done.email} ({shareRoleLabel[done.role]}) tới {formatDateTime(done.expiresAt)}. Đến hạn phần mềm tự gỡ; trước 3 ngày sẽ nhắc bạn.
            </Notice>
          )}
          <div className="form-actions">
            <Link className="btn btn-secondary" href="/chia-se">
              Xem sổ chia sẻ
            </Link>
            {done.approvalId && (
              <Link className="btn btn-secondary" href={`/phe-duyet/${done.approvalId}`}>
                Phiếu duyệt
              </Link>
            )}
          </div>
        </Card>
      </>
    );
  }

  const err = (k: string) => (touched ? errors[k] : undefined);
  return (
    <>
      <PageHeader title="Chia sẻ một file ra ngoài" back={{ href: '/chia-se', label: 'Sổ chia sẻ' }} subtitle="Chỉ chia sẻ từng file, tới đúng email, có thời hạn. Không có lựa chọn “Bất kỳ ai có liên kết”." />
      <Card>
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (Object.keys(errors).length === 0) save.mutate();
          }}
        >
          <TextField label="File" value={file} onChange={setFile} required error={err('file')} hint={fileName ? `File: ${fileName}` : 'Dán link file trên Google Drive'} />
          <TextField label="Email đối tác" type="email" value={email} onChange={setEmail} required error={err('email')} inputMode="email" />
          <Field label="Quyền">
            {(['reader', 'commenter'] as ShareRole[]).map((r) => (
              <label key={r} className="checkbox">
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
                {shareRoleLabel[r]}
              </label>
            ))}
          </Field>
          <TextField label="Lý do" value={reason} onChange={setReason} required error={err('reason')} multiline placeholder="Gửi báo giá cho đối tác…" />
          <TextField label="Hết hạn ngày" type="date" value={expires} onChange={setExpires} required error={err('expires')} min={addDaysISO(1)} hint="Có giới hạn số ngày tối đa; vượt thì máy chủ báo." />
          <ErrorBox error={save.error} />
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Chia sẻ
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
