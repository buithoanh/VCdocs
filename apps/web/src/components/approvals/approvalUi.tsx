'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api, idem, unwrap } from '@/api/client';
import type { Approval } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { useJobs } from '@/components/jobs';
import { approvalObjectLabel } from '@/lib/labels';

/** Đường dẫn tới đối tượng được trình. */
export function approvalObjectHref(a: Pick<Approval, 'objectType' | 'objectId'>): string | undefined {
  switch (a.objectType) {
    case 'document':
    case 'document_withdrawal':
      return `/tai-lieu/${a.objectId}`;
    case 'record':
      return `/ho-so/${a.objectId}`;
    case 'retention':
      return `/danh-muc-ho-so/${a.objectId}`;
    case 'code':
      return '/bang-ma';
    case 'external_share':
      return '/chia-se';
    case 'delegation':
      return '/phe-duyet/uy-quyen';
    default:
      return undefined;
  }
}

export function approvalTitle(a: Approval) {
  return `${approvalObjectLabel[a.objectType]}: ${a.objectTitle ?? 'không có tên'}`;
}

export type DecideKind = 'approve' | 'changes_requested' | 'check';

/** Duyệt / yêu cầu sửa / xác nhận kiểm tra. Yêu cầu sửa bắt buộc ghi nội dung (US-05.2). */
export function DecideDialog({ approval, kind, onClose, onDone }: { approval: Approval; kind: DecideKind; onClose: () => void; onDone?: (a: Approval) => void }) {
  const qc = useQueryClient();
  const jobs = useJobs();
  const [invalidated, setInvalidated] = useState(false);
  const titles: Record<DecideKind, string> = { approve: 'Đồng ý', changes_requested: 'Yêu cầu sửa', check: 'Xác nhận đã kiểm tra' };
  return (
    <ActionDialog
      open
      title={titles[kind]}
      description={
        <>
          <p>{approvalTitle(approval)}</p>
          {invalidated && <p className="error-text">File đã bị sửa sau khi trình nên phiếu không còn hiệu lực. Người trình cần trình lại.</p>}
          <p className="small">Ý kiến, thời điểm và người duyệt được lưu làm bằng chứng phê duyệt, không sửa được.</p>
        </>
      }
      confirmLabel={titles[kind]}
      variant={kind === 'changes_requested' ? 'danger' : 'success'}
      textLabel={kind === 'changes_requested' ? 'Nội dung cần sửa' : 'Ý kiến'}
      textRequired={kind === 'changes_requested'}
      textHint={kind === 'changes_requested' ? 'Bắt buộc' : 'Không bắt buộc'}
      run={async (comment, key) => {
        try {
          if (kind === 'check') {
            return await unwrap(api.POST('/approvals/{id}/check', { params: { path: { id: approval.id } }, body: { comment: comment || undefined } }));
          }
          return await unwrap(
            api.POST('/approvals/{id}/decide', { params: { path: { id: approval.id } }, body: { result: kind, comment: comment || undefined }, ...idem(key) }),
          );
        } catch (e) {
          // BR-27: phiên bản file lệch bản chụp → 409, phiếu thành invalidated.
          if (e instanceof ApiError && e.status === 409) {
            setInvalidated(true);
            qc.invalidateQueries({ queryKey: ['approvals'] });
            qc.invalidateQueries({ queryKey: ['approval', approval.id] });
          }
          throw e;
        }
      }}
      invalidate={[['approvals'], ['approval', approval.id], ['document'], ['record']]}
      onDone={(a) => {
        // D15: quyết định có thể kéo theo việc nền (vd huỷ bỏ tài liệu: đổi tên, chuyển vào 99).
        if (a.jobId) {
          jobs.track({
            jobId: a.jobId,
            label: approval.objectType === 'document_withdrawal' ? 'Huỷ bỏ tài liệu' : 'Việc sau phê duyệt',
            invalidate: [['document'], ['documents'], ['approval', approval.id]],
          });
        }
        onDone?.(a);
      }}
      onClose={onClose}
    />
  );
}
