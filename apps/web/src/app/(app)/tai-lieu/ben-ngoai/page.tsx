'use client';

import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import { JobProgress } from '@/components/jobs';
import { DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, Card, ErrorBox, PageHeader, TextField } from '@/components/ui';
import { parseDriveFileId } from '@/lib/drive';

export default function ExternalDocumentPage() {
  const { me } = useAuth();
  const [f, setF] = useState({ source: '', number: '', issuedAt: '', title: '', departmentId: me.departmentId ?? '', link: '' });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const [jobId, setJobId] = useState<string | null>(null);
  const fileId = parseDriveFileId(f.link);
  const isUrl = /^https?:\/\//.test(f.link.trim());
  const valid = f.source.trim() && f.number.trim() && f.issuedAt && f.title.trim() && f.departmentId && (fileId || isUrl);
  const save = useAction(
    (_: void, key: string) =>
      unwrap(
        api.POST('/external-documents', {
          body: {
            source: f.source.trim(),
            number: f.number.trim(),
            issuedAt: f.issuedAt,
            title: f.title.trim(),
            departmentId: f.departmentId,
            ...(fileId ? { fileId } : { url: f.link.trim() }),
          },
          ...idem(key),
        }),
      ),
    { onSuccess: (r) => setJobId(r.jobId) },
  );
  return (
    <>
      <PageHeader
        title="Nhập tài liệu bên ngoài"
        subtitle="Luật, nghị định, tài liệu hãng… Không cấp mã nội bộ; bản sao lưu vào 00 Tài liệu."
        back={{ href: '/tai-lieu', label: 'Tài liệu' }}
      />
      <Card>
        {jobId ? (
          <JobProgress jobId={jobId} />
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <TextField label="Cơ quan ban hành" value={f.source} onChange={set('source')} required placeholder="Quốc hội, Bộ Tài chính, Toyota…" />
            <div className="form-row">
              <TextField label="Số hiệu văn bản" value={f.number} onChange={set('number')} required placeholder="91/2025/QH15" />
              <TextField label="Ngày ban hành" type="date" value={f.issuedAt} onChange={set('issuedAt')} required />
            </div>
            <TextField label="Tên văn bản" value={f.title} onChange={set('title')} required />
            <DeptSelect label="Phòng áp dụng" value={f.departmentId} onChange={set('departmentId')} required />
            <TextField
              label="File trên Drive hoặc đường dẫn gốc"
              value={f.link}
              onChange={set('link')}
              required
              hint={fileId ? 'Đã nhận ra file trên Google Drive.' : 'Dán link file Google Drive, hoặc link trang web của văn bản.'}
            />
            <ErrorBox error={save.error} />
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={!valid} loading={save.isPending}>
                Nhập tài liệu
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
