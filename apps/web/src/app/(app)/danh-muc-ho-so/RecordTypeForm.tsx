'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/api/client';
import { useDepartments } from '@/api/queries';
import type { RecordKind, RecordType, SecurityLevel } from '@/api/types';
import { DeptSelect } from '@/components/pickers';
import { Button, ErrorBox, Notice, SelectField, TextField } from '@/components/ui';
import { parseDriveFileId } from '@/lib/drive';
import { recordKindLabel, securityLabel } from '@/lib/labels';

export type RecordTypeValues = {
  departmentId: string;
  name: string;
  kind: RecordKind | '';
  namingRule: string;
  example: string;
  folderId: string;
  keeperTitle: string;
  retentionYears: string;
  permanent: boolean;
  retentionBasis: string;
  disposalMethod: string;
  securityLevel: SecurityLevel | '';
  template: string;
  requiresApproval: boolean;
};

export function toValues(t?: Partial<RecordType>, departmentId = ''): RecordTypeValues {
  return {
    departmentId: t?.departmentId ?? departmentId,
    name: t?.name ?? '',
    kind: t?.kind ?? '',
    namingRule: t?.namingRule ?? '[Mã] [Loại] Nội dung – YYYY-MM-DD',
    example: t?.example ?? '',
    folderId: t?.folderId ?? '',
    keeperTitle: t?.keeperTitle ?? '',
    retentionYears: t?.retentionYears ? String(t.retentionYears) : '',
    permanent: t?.retentionYears === 0,
    retentionBasis: t?.retentionBasis ?? '',
    disposalMethod: t?.disposalMethod ?? '',
    securityLevel: t?.securityLevel ?? '',
    template: t?.templateId ?? '',
    requiresApproval: t?.requiresApproval ?? false,
  };
}

export function validateRecordType(v: RecordTypeValues) {
  const e: Partial<Record<keyof RecordTypeValues, string>> = {};
  if (!v.departmentId) e.departmentId = 'Chọn phòng.';
  if (!v.name.trim()) e.name = 'Nhập tên loại hồ sơ.';
  if (!v.kind) e.kind = 'Chọn loại.';
  if (!v.namingRule.trim()) e.namingRule = 'Nhập quy tắc đặt tên.';
  if (!v.folderId) e.folderId = 'Chọn thư mục lưu.';
  if (!v.keeperTitle.trim()) e.keeperTitle = 'Nhập chức danh người giữ.';
  if (!v.permanent) {
    const n = Number(v.retentionYears);
    if (!v.retentionYears || !Number.isInteger(n) || n < 1) e.retentionYears = 'Nhập số năm (số nguyên từ 1), hoặc chọn Vĩnh viễn.';
  }
  if (!v.retentionBasis.trim()) e.retentionBasis = 'Nhập căn cứ.';
  if (!v.disposalMethod.trim()) e.disposalMethod = 'Nhập cách huỷ.';
  if (!v.securityLevel) e.securityLevel = 'Chọn mức bảo mật.';
  if (v.template.trim() && !parseDriveFileId(v.template)) e.template = 'Không nhận ra link file Google.';
  return e;
}

export function toBody(v: RecordTypeValues) {
  return {
    departmentId: v.departmentId,
    name: v.name.trim(),
    kind: v.kind as RecordKind,
    namingRule: v.namingRule.trim(),
    example: v.example.trim() || undefined,
    folderId: v.folderId,
    keeperTitle: v.keeperTitle.trim(),
    retentionYears: v.permanent ? 0 : Number(v.retentionYears),
    retentionBasis: v.retentionBasis.trim(),
    disposalMethod: v.disposalMethod.trim(),
    securityLevel: v.securityLevel as SecurityLevel,
    templateId: v.template.trim() ? parseDriveFileId(v.template) : undefined,
    requiresApproval: v.requiresApproval,
  };
}

const KINDS = Object.keys(recordKindLabel) as RecordKind[];
const SECURITY = Object.keys(securityLabel) as SecurityLevel[];

export function RecordTypeForm({
  initial,
  editing,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  initial: RecordTypeValues;
  editing?: boolean;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (v: RecordTypeValues) => void;
}) {
  const [v, setV] = useState(initial);
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof RecordTypeValues>(k: K) => (x: RecordTypeValues[K]) => setV((p) => ({ ...p, [k]: x }));
  const depts = useDepartments();
  const dept = depts.data?.find((d) => d.id === v.departmentId);
  const folders = useQuery({
    queryKey: ['folders', 'for-record-type', dept?.driveId],
    enabled: !!dept?.driveId,
    queryFn: () => unwrap(api.GET('/folders', { params: { query: { driveId: dept!.driveId, depth: 3 } } })).then((r) => r.items.filter((f) => f.status === 'active')),
  });
  const errors = validateRecordType(v);
  const err = (k: keyof RecordTypeValues) => (touched ? errors[k] : undefined);
  const retentionChanged = editing && (v.retentionYears !== initial.retentionYears || v.permanent !== initial.permanent || v.retentionBasis !== initial.retentionBasis);

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (Object.keys(errors).length === 0) onSubmit(v);
      }}
    >
      {!editing && <DeptSelect value={v.departmentId} onChange={set('departmentId')} required />}
      {touched && errors.departmentId && <p className="field-error">{errors.departmentId}</p>}
      <TextField label="Tên loại hồ sơ" value={v.name} onChange={set('name')} required error={err('name')} placeholder="Báo cáo tuần SEO" />
      {!editing && (
        <SelectField label="Loại" value={v.kind} onChange={set('kind')} required error={err('kind')} options={KINDS.map((k) => ({ value: k, label: recordKindLabel[k] }))} />
      )}
      <TextField label="Quy tắc đặt tên" value={v.namingRule} onChange={set('namingRule')} required error={err('namingRule')} />
      <TextField label="Ví dụ tên" value={v.example} onChange={set('example')} placeholder="SEO-PTDA BC Báo cáo tuần 42 – 2026-10-19" />
      <SelectField
        label="Thư mục lưu"
        value={v.folderId}
        onChange={set('folderId')}
        required
        error={err('folderId')}
        placeholder={!dept ? 'Chọn phòng trước' : folders.isLoading ? 'Đang tải…' : '— Chọn thư mục —'}
        options={(folders.data ?? []).map((f) => ({ value: f.id, label: f.path }))}
      />
      <TextField label="Người giữ (chức danh)" value={v.keeperTitle} onChange={set('keeperTitle')} required error={err('keeperTitle')} placeholder="Leader SEO" />
      <div className="form-row">
        <TextField
          label="Thời hạn lưu (năm)"
          type="number"
          min={1}
          value={v.permanent ? '' : v.retentionYears}
          onChange={set('retentionYears')}
          required={!v.permanent}
          error={err('retentionYears')}
          inputMode="numeric"
        />
        <label className="checkbox" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={v.permanent} onChange={(e) => set('permanent')(e.target.checked)} />
          Lưu vĩnh viễn
        </label>
      </div>
      <TextField label="Căn cứ thời hạn" value={v.retentionBasis} onChange={set('retentionBasis')} required error={err('retentionBasis')} placeholder="Luật Kế toán 2015, Điều 41" />
      <TextField label="Cách huỷ" value={v.disposalMethod} onChange={set('disposalMethod')} required error={err('disposalMethod')} placeholder="Xoá file trên Drive, lập biên bản BM-VCPV-06" />
      <SelectField label="Mức bảo mật" value={v.securityLevel} onChange={set('securityLevel')} required error={err('securityLevel')} options={SECURITY.map((s) => ({ value: s, label: securityLabel[s] }))} />
      <TextField label="Biểu mẫu (link file Google)" value={v.template} onChange={set('template')} error={err('template')} hint="Không bắt buộc. Có biểu mẫu thì lập hồ sơ sẽ tạo file từ biểu mẫu." />
      <label className="checkbox">
        <input type="checkbox" checked={v.requiresApproval} onChange={(e) => set('requiresApproval')(e.target.checked)} />
        Hồ sơ loại này cần trình duyệt trước khi chốt
      </label>
      {retentionChanged && <Notice tone="warn">Đổi thời hạn lưu thì loại hồ sơ quay về Nháp và phải trình Ban Điều hành duyệt lại.</Notice>}
      <ErrorBox error={error} />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
