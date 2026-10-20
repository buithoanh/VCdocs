'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { deptName, useAction, useApprovedCodes, useDepartments, useRecordTypes } from '@/api/queries';
import type { Job } from '@/api/types';
import { JobProgress } from '@/components/jobs';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button, Card, ErrorBox, Field, Notice, PageHeader, SelectField, TextField } from '@/components/ui';
import { currentMonth } from '@/lib/format';
import { recordKindLabel } from '@/lib/labels';
import { canUseRecordType, emptyRecordForm, isBackdated, previewRecordName, toFormData, toRecordInput, validateRecordForm, type RecordFormValues } from '@/lib/records';

const EXCLUDED_CODE_TYPES = new Set(['department', 'division']);

/** Lập hồ sơ: 1 màn hình, 3 phần, 1 nút (BA 9.3: tối đa 3 bước). */
export function NewRecordForm() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const types = useRecordTypes();
  const depts = useDepartments();
  const [v, setV] = useState<RecordFormValues>(() => ({ ...emptyRecordForm(currentMonth()), recordTypeId: params.get('loai') ?? '' }));
  const [touched, setTouched] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const set = <K extends keyof RecordFormValues>(k: K) => (x: RecordFormValues[K]) => setV((p) => ({ ...p, [k]: x }));

  const sortedTypes = useMemo(
    () => [...(types.data ?? [])].sort((a, b) => Number(b.departmentId === me.departmentId) - Number(a.departmentId === me.departmentId) || a.name.localeCompare(b.name, 'vi')),
    [types.data, me.departmentId],
  );
  const type = types.data?.find((t) => t.id === v.recordTypeId);
  const codes = useApprovedCodes(type?.departmentId);
  const codeOptions = (codes.data ?? []).filter((c) => !EXCLUDED_CODE_TYPES.has(c.type));
  const errors = validateRecordForm(v, type);
  const err = (k: keyof RecordFormValues) => (touched ? errors[k] : undefined);
  const step = !type || !v.functionCode ? 1 : !v.subject.trim() ? 2 : 3;

  const create = useAction(
    (_: void, key: string) => {
      const input = toRecordInput(v, type!.kind);
      if (v.source === 'upload' && v.file) {
        const fd = toFormData(input, v.file);
        return unwrap(api.POST('/records/upload', { body: fd as never, bodySerializer: (b: unknown) => b as FormData, ...idem(key) }));
      }
      return unwrap(api.POST('/records', { body: input, ...idem(key) }));
    },
    { onSuccess: (r) => setJobId(r.jobId) },
  );

  function onFinished(job: Job) {
    const r = (job.result ?? {}) as { objectType?: string; objectId?: string };
    if (job.status === 'done' && r.objectType === 'record' && r.objectId) router.push(`/ho-so/${r.objectId}`);
  }

  if (jobId) {
    return (
      <>
        <PageHeader title="Đang lập hồ sơ" back={{ href: '/ho-so', label: 'Hồ sơ' }} />
        <Card>
          <p>
            Tên dự kiến: <strong>{previewRecordName(v.functionCode, type?.kind, v.subject, v.identifier, v.createdDate)}</strong>
          </p>
          <JobProgress jobId={jobId} onFinished={onFinished} />
          <div className="form-actions">
            <Button
              onClick={() => {
                setJobId(null);
                setV({ ...emptyRecordForm(v.workMonth), recordTypeId: v.recordTypeId, functionCode: v.functionCode });
                setTouched(false);
              }}
            >
              Lập hồ sơ khác
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Lập hồ sơ" back={{ href: '/ho-so', label: 'Hồ sơ' }} subtitle="Phần mềm tự đặt tên và đặt đúng thư mục năm / tháng." />
      <ol className="steps" aria-label="Các bước">
        <li className={step === 1 ? 'is-current' : 'is-done'}>1. Loại và tháng</li>
        <li className={step === 2 ? 'is-current' : step > 2 ? 'is-done' : ''}>2. Nội dung</li>
        <li className={step === 3 ? 'is-current' : ''}>3. Lập</li>
      </ol>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (Object.keys(errors).length === 0) create.mutate();
        }}
      >
        <Card title="1. Loại hồ sơ và tháng công việc">
          <SelectField
            label="Loại hồ sơ"
            value={v.recordTypeId}
            onChange={(x) => setV((p) => ({ ...p, recordTypeId: x, functionCode: '' }))}
            required
            error={err('recordTypeId')}
            placeholder={types.isLoading ? 'Đang tải…' : '— Chọn loại hồ sơ —'}
            options={sortedTypes.map((t) => ({
              value: t.id,
              label: `${t.name} (${recordKindLabel[t.kind]} · ${deptName(depts.data, t.departmentId)})${canUseRecordType(t) ? '' : ' – chưa duyệt thời hạn'}`,
              disabled: !canUseRecordType(t),
            }))}
          />
          {types.error && <ErrorBox error={types.error} />}
          <SelectField
            label="Mã chức năng"
            value={v.functionCode}
            onChange={set('functionCode')}
            required
            error={err('functionCode')}
            disabled={!type}
            placeholder={!type ? 'Chọn loại hồ sơ trước' : codes.isLoading ? 'Đang tải…' : '— Chọn mã —'}
            options={codeOptions.map((c) => ({ value: c.code, label: `${c.code} – ${c.meaning}` }))}
          />
          <TextField label="Tháng công việc" type="month" value={v.workMonth} onChange={set('workMonth')} required error={err('workMonth')} />
        </Card>

        <Card title="2. Nội dung">
          <TextField label="Nội dung ngắn" value={v.subject} onChange={set('subject')} required error={err('subject')} placeholder="Báo cáo tuần 42" maxLength={120} />
          {type?.kind === 'OPS' && (
            <TextField label="Số định danh" value={v.identifier} onChange={set('identifier')} required error={err('identifier')} placeholder="Biển số, số PO, mã lớp…" />
          )}
          <TextField label="Ngày lập" type="date" value={v.createdDate} onChange={set('createdDate')} required error={err('createdDate')} />
          {isBackdated(v.createdDate) && <TextField label="Lý do lập lùi ngày" value={v.backdateReason} onChange={set('backdateReason')} required error={err('backdateReason')} multiline />}
          <Field label="File hồ sơ">
            <label className="checkbox">
              <input type="radio" name="source" checked={v.source === 'template'} onChange={() => set('source')('template')} />
              {type?.templateId ? 'Tạo file Google từ biểu mẫu' : 'Tạo file Google trống'}
            </label>
            <label className="checkbox">
              <input type="radio" name="source" checked={v.source === 'upload'} onChange={() => set('source')('upload')} />
              Tải file lên (ảnh, PDF, XML hoá đơn, Word, Excel…)
            </label>
          </Field>
          {v.source === 'upload' && (
            <Field label="Chọn file" required error={err('file')} htmlFor="file-ho-so" hint="File Word, Excel, PowerPoint được đổi sang định dạng Google; hoá đơn, giấy tờ ký, scan giữ nguyên.">
              <input id="file-ho-so" type="file" onChange={(e) => set('file')(e.target.files?.[0] ?? null)} />
            </Field>
          )}
        </Card>

        <Card title="3. Lập hồ sơ">
          <p>
            Tên dự kiến: <strong className="mono">{previewRecordName(v.functionCode, type?.kind, v.subject, v.identifier, v.createdDate)}</strong>
          </p>
          {type?.requiresApproval && <Notice>Loại hồ sơ này cần trình duyệt trước khi chốt.</Notice>}
          <ErrorBox error={create.error} />
          <div className="form-actions">
            <Button type="submit" variant="primary" className="btn-lg" loading={create.isPending}>
              Lập hồ sơ
            </Button>
          </div>
        </Card>
      </form>
    </>
  );
}
