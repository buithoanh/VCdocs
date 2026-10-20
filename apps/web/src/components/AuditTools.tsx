'use client';

import { useState } from 'react';
import { api, getLimits, idem, unwrap } from '@/api/client';
import { ActionDialog } from './ActionDialog';
import { useJobs } from './jobs';
import { useAuth } from './providers/AuthProvider';
import { Button, LinkButton } from './ui';

type Target = { documentId: string; recordId?: never } | { recordId: string; documentId?: never };

/** Kiểm toán viên có quyền xem tạm cho phòng này không (E16). */
export function useAuditorScope(departmentId?: string) {
  const { me } = useAuth();
  const a = me.auditorAccess;
  return !!a && !!departmentId && a.departmentIds.includes(departmentId) && new Date(a.expiresAt).getTime() > Date.now();
}

/**
 * Nút M15 trên trang tài liệu / hồ sơ: xem nhật ký của đối tượng, lập gói bằng chứng (E17).
 * Hiện theo vai trò hoặc quyền xem tạm của kiểm toán viên; máy chủ vẫn kiểm lại.
 */
export function AuditTools({ target, departmentId }: { target: Target; departmentId?: string }) {
  const { can } = useAuth();
  const jobs = useJobs();
  const auditor = useAuditorScope(departmentId);
  const [open, setOpen] = useState(false);
  const objectType = target.documentId ? 'document' : 'record';
  const objectId = (target.documentId ?? target.recordId)!;
  const canLogs = can('viewAuditLogs') || auditor;
  const canPack = can('buildEvidencePack') || auditor;
  if (!canLogs && !canPack) return null;
  const days = getLimits().evidencePackDays ?? 7;
  return (
    <>
      {canLogs && <LinkButton href={`/nhat-ky?objectType=${objectType}&objectId=${encodeURIComponent(objectId)}`}>Xem nhật ký</LinkButton>}
      {canPack && <Button onClick={() => setOpen(true)}>Lập gói bằng chứng</Button>}
      {open && (
        <ActionDialog
          open
          title="Lập gói bằng chứng"
          description={`Gói ZIP gồm bản PDF, phiếu duyệt, nhật ký thao tác và mã băm neo của ${objectType === 'document' ? 'tài liệu' : 'hồ sơ'} này. Gói giữ ${days} ngày trên máy chủ rồi tự xoá.`}
          confirmLabel="Lập gói"
          variant="primary"
          run={(_, key) => unwrap(api.POST('/evidence-pack', { body: target.documentId ? { documentId: target.documentId } : { recordId: target.recordId }, ...idem(key) }))}
          onDone={(r) => jobs.track({ jobId: r.jobId, label: 'Lập gói bằng chứng' })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
