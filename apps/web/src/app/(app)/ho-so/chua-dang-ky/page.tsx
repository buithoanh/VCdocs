'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useApprovedCodes, useDrives, useRecordTypes } from '@/api/queries';
import type { DriveFile } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { DataTable } from '@/components/DataTable';
import { useJobs } from '@/components/jobs';
import { Button, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
import { currentMonth, formatDateTime } from '@/lib/format';
import { canUseRecordType } from '@/lib/records';

/** File tạo thẳng trên Drive chưa có trong sổ: đăng ký ngược để có số, tên đúng, chỗ đúng. */
export default function UnregisteredPage() {
  const drives = useDrives();
  const [driveId, setDrive] = useState('');
  const [claiming, setClaiming] = useState<DriveFile | null>(null);
  const q = useQuery({
    queryKey: ['records', 'unregistered', driveId],
    queryFn: () => unwrap(api.GET('/records/unregistered', { params: { query: { driveId: driveId || undefined } } })).then((r) => r.items),
  });
  return (
    <>
      <PageHeader title="File chưa đăng ký" subtitle="File tạo thẳng trên Drive, chưa có trong sổ VCdocs. Đăng ký để có số hồ sơ; tên sai thì phần mềm đổi cho đúng." back={{ href: '/ho-so', label: 'Hồ sơ' }} />
      <div className="filters">
        <SelectField label="Drive" value={driveId} onChange={setDrive} placeholder="Tất cả drive" options={(drives.data ?? []).map((d) => ({ value: d.driveId, label: d.name }))} />
      </div>
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(f) => f.fileId}
          empty="Không có file nào chưa đăng ký."
          columns={[
            { key: 'name', header: 'Tên file', render: (f) => (f.webViewLink ? <a href={f.webViewLink} target="_blank" rel="noreferrer">{f.name}</a> : f.name) },
            { key: 'owner', header: 'Người tạo', render: (f) => f.ownerEmail ?? '—', hideOnMobile: true },
            { key: 'time', header: 'Tạo lúc', render: (f) => formatDateTime(f.createdTime), hideOnMobile: true },
            { key: 'act', header: '', render: (f) => <Button variant="primary" onClick={() => setClaiming(f)}>Đăng ký</Button> },
          ]}
        />
      </QueryState>
      {claiming && <ClaimDialog file={claiming} onClose={() => setClaiming(null)} />}
    </>
  );
}

function ClaimDialog({ file, onClose }: { file: DriveFile; onClose: () => void }) {
  const jobs = useJobs();
  const types = useRecordTypes();
  const [recordTypeId, setType] = useState('');
  const type = types.data?.find((t) => t.id === recordTypeId);
  const codes = useApprovedCodes(type?.departmentId);
  const [functionCode, setCode] = useState('');
  const [subject, setSubject] = useState(file.name.replace(/\.[a-z0-9]+$/i, ''));
  const [identifier, setIdentifier] = useState('');
  const [workMonth, setMonth] = useState(file.createdTime?.slice(0, 7) ?? currentMonth());
  const valid = !!type && canUseRecordType(type) && !!functionCode && !!subject.trim() && /^\d{4}-\d{2}$/.test(workMonth) && (type.kind !== 'OPS' || !!identifier.trim());
  return (
    <ActionDialog
      open
      title="Đăng ký file vào sổ hồ sơ"
      description={<p className="mono small">{file.name}</p>}
      confirmLabel="Đăng ký"
      canConfirm={valid}
      run={(_, key) =>
        unwrap(
          api.POST('/records/claim', {
            body: { fileId: file.fileId, recordTypeId, kind: type!.kind, functionCode, subject: subject.trim(), identifier: identifier.trim() || undefined, workMonth },
            ...idem(key),
          }),
        )
      }
      onDone={(r) => jobs.track({ jobId: r.jobId, label: 'Đăng ký file có sẵn', invalidate: [['records']] })}
      onClose={onClose}
    >
      <SelectField
        label="Loại hồ sơ"
        value={recordTypeId}
        onChange={(v) => (setType(v), setCode(''))}
        required
        options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name + (canUseRecordType(t) ? '' : ' – chưa duyệt thời hạn'), disabled: !canUseRecordType(t) }))}
      />
      <SelectField label="Mã chức năng" value={functionCode} onChange={setCode} required disabled={!type} options={(codes.data ?? []).map((c) => ({ value: c.code, label: `${c.code} – ${c.meaning}` }))} />
      <TextField label="Nội dung ngắn" value={subject} onChange={setSubject} required />
      {type?.kind === 'OPS' && <TextField label="Số định danh" value={identifier} onChange={setIdentifier} required />}
      <TextField label="Tháng công việc" type="month" value={workMonth} onChange={setMonth} required />
    </ActionDialog>
  );
}
