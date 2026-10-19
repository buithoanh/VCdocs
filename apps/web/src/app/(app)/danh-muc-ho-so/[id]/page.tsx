'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { useAction } from '@/api/queries';
import { ActionDialog } from '@/components/ActionDialog';
import { ActionBar, DeptName } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Card, DefList, DriveLink, Notice, PageHeader, QueryState } from '@/components/ui';
import { parseDriveFileId } from '@/lib/drive';
import { recordKindLabel, retentionStatusLabel, retentionText, securityLabel } from '@/lib/labels';
import { RecordTypeForm, toValues, type RecordTypeValues } from '../RecordTypeForm';

export default function RecordTypePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const q = useQuery({ queryKey: ['record-type', id], queryFn: () => unwrap(api.GET('/record-types/{id}', { params: { path: { id } } })) });
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const save = useAction(
    (v: RecordTypeValues) => {
      const t = q.data!;
      const body = {
        name: v.name.trim(),
        namingRule: v.namingRule.trim(),
        example: v.example.trim() || undefined,
        folderId: v.folderId,
        keeperTitle: v.keeperTitle.trim(),
        retentionYears: v.permanent ? 0 : Number(v.retentionYears),
        retentionBasis: v.retentionBasis.trim(),
        disposalMethod: v.disposalMethod.trim(),
        securityLevel: v.securityLevel || t.securityLevel,
        requiresApproval: v.requiresApproval,
        templateId: v.template.trim() ? parseDriveFileId(v.template) : undefined,
      };
      return unwrap(api.PATCH('/record-types/{id}', { params: { path: { id } }, body }));
    },
    {
      invalidate: [['record-type', id], ['record-types']],
      onSuccess: () => {
        toast.success('Đã lưu loại hồ sơ.');
        setEditing(false);
      },
    },
  );
  const t = q.data;
  return (
    <QueryState q={q}>
      {t && (
        <>
          <PageHeader
            back={{ href: '/danh-muc-ho-so', label: 'Danh mục hồ sơ' }}
            title={t.name}
            subtitle={<Badge status={t.retentionStatus === 'approved' ? 'approved' : t.retentionStatus === 'submitted' ? 'pending' : 'expired'}>{retentionStatusLabel[t.retentionStatus]}</Badge>}
            actions={
              <ActionBar
                obj={t}
                actions={[
                  { action: 'update', label: 'Sửa', onClick: () => setEditing(true) },
                  { action: 'submit-retention', label: 'Trình thời hạn lưu', variant: 'primary', onClick: () => setSubmitting(true) },
                ]}
              />
            }
          />
          {t.retentionStatus === 'draft' && <Notice tone="warn">Thời hạn lưu chưa được duyệt: chưa lập được hồ sơ loại này.</Notice>}
          {t.retentionApprovalId && (
            <p>
              <Link href={`/phe-duyet/${t.retentionApprovalId}`}>Xem phiếu duyệt thời hạn lưu</Link>
            </p>
          )}
          {editing ? (
            <Card title="Sửa loại hồ sơ">
              <RecordTypeForm initial={toValues(t)} editing submitLabel="Lưu" pending={save.isPending} error={save.error} onSubmit={(v) => save.mutate(v)} />
            </Card>
          ) : (
            <Card>
              <DefList
                items={[
                  ['Phòng', <DeptName key="d" id={t.departmentId} />],
                  ['Loại', recordKindLabel[t.kind]],
                  ['Quy tắc đặt tên', t.namingRule],
                  ['Ví dụ', t.example ?? '—'],
                  ['Người giữ', t.keeperTitle],
                  ['Thời hạn lưu', retentionText(t.retentionYears)],
                  ['Căn cứ', t.retentionBasis],
                  ['Cách huỷ', t.disposalMethod],
                  ['Mức bảo mật', securityLabel[t.securityLevel]],
                  ['Cần trình duyệt trước khi chốt', t.requiresApproval ? 'Có' : 'Không'],
                ]}
              />
              <div className="actions" style={{ marginTop: '1rem' }}>
                <DriveLink fileId={t.templateId}>Mở biểu mẫu</DriveLink>
              </div>
            </Card>
          )}
          <ActionDialog
            open={submitting}
            title="Trình thời hạn lưu"
            description="Phiếu gửi Ban Điều hành duyệt. Chứng từ kế toán cần thêm kế toán trưởng xác nhận; hồ sơ nhân sự cần thêm HCNS xác nhận."
            confirmLabel="Trình"
            run={(_, key) => unwrap(api.POST('/record-types/{id}/submit-retention', { params: { path: { id } }, ...idem(key) }))}
            invalidate={[['record-type', id], ['record-types'], ['approvals']]}
            onDone={(a) => router.push(`/phe-duyet/${a.id}`)}
            onClose={() => setSubmitting(false)}
          />
        </>
      )}
    </QueryState>
  );
}
