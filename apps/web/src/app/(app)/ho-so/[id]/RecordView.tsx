'use client';

import { UploadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { DatePicker, Form, Input, Space, Upload } from 'antd';
import type { Dayjs } from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, getLimits, idem, unwrap } from '@/api/client';
import { isTooLarge } from '@/lib/records';
import { recordTypeName, useAction, useRecordTypes } from '@/api/queries';
import type { VcRecord } from '@/api/types';
import { ActionDialog } from '@/components/ActionDialog';
import { ApproverPreview } from '@/components/ApproverPreview';
import { toDayjs, toISOMonth } from '@/components/dates';
import { useJobs } from '@/components/jobs';
import { ActionBar, DeptName, UserName } from '@/components/pickers';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, Card, DefList, DriveLink, ErrorBox, Field, LinkButton, Modal, Notice, PageHeader, QueryState, SelectField, TextField } from '@/components/ui';
import { formatDate, formatDateTime, formatMonth } from '@/lib/format';
import { holdReasonLabel, recordKindLabel, recordStatusLabel, type HoldReasonType } from '@/lib/labels';
import { hasAction } from '@/lib/permissions';

type Dialog = 'edit' | 'submit' | 'finalize' | 'adjust' | 'scan' | 'hold' | 'release' | null;

export function RecordView({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['record', id], queryFn: () => unwrap(api.GET('/records/{id}', { params: { path: { id } } })) });
  const types = useRecordTypes();
  const router = useRouter();
  const jobs = useJobs();
  const [dialog, setDialog] = useState<Dialog>(null);
  const invalidate = [['record', id], ['records']];
  const r = q.data;
  const close = () => setDialog(null);

  return (
    <QueryState q={q}>
      {r && (
        <>
          <PageHeader
            back={{ href: '/ho-so', label: 'Hồ sơ' }}
            title={r.fileName ?? r.subject}
            subtitle={
              <>
                <span className="mono">{r.number}</span> · <Badge status={r.status}>{recordStatusLabel[r.status]}</Badge>
                {r.status === 'drafting' && r.isApproved && <> <Badge status="approved">Đã duyệt, chờ chốt</Badge></>}
              </>
            }
            actions={
              <ActionBar
                obj={r}
                actions={[
                  { action: 'update', label: 'Sửa', onClick: () => setDialog('edit') },
                  { action: 'submit', label: 'Trình duyệt', variant: 'primary', onClick: () => setDialog('submit') },
                  { action: 'finalize', label: 'Chốt hồ sơ', variant: 'success', onClick: () => setDialog('finalize') },
                  { action: 'adjust', label: 'Lập hồ sơ điều chỉnh', onClick: () => setDialog('adjust') },
                  { action: 'scan', label: 'Gắn bản scan', onClick: () => setDialog('scan') },
                  { action: 'hold', label: 'Giữ lại', onClick: () => setDialog('hold') },
                  { action: 'release-hold', label: 'Bỏ giữ lại', onClick: () => setDialog('release') },
                ]}
              />
            }
          />
          {r.status === 'finalized' && <Notice tone="success">Hồ sơ đã chốt: file đã khoá, không sửa được. Muốn sửa thì lập hồ sơ điều chỉnh.</Notice>}
          {r.adjustsId && (
            <Notice>
              Đây là hồ sơ điều chỉnh cho <Link href={`/ho-so/${r.adjustsId}`}>hồ sơ gốc</Link>.
            </Notice>
          )}
          <Card title="Thông tin">
            <DefList
              items={[
                ['Loại hồ sơ', recordTypeName(types.data, r.recordTypeId)],
                ['Loại', recordKindLabel[r.kind]],
                ['Mã chức năng', <span key="f" className="mono">{r.functionCode}</span>],
                ['Nội dung', r.subject],
                ['Số định danh', r.identifier ?? '—'],
                ['Phòng', <DeptName key="d" id={r.departmentId} />],
                ['Tháng công việc', formatMonth(r.workMonth)],
                ['Ngày lập', formatDate(r.createdDate)],
                ['Người lập', <UserName key="c" id={r.createdBy} />],
                ['Lý do lập lùi ngày', r.backdateReason ?? '—'],
                ['Vị trí bản giấy', r.paperLocation ?? '—'],
                ['Lưu đến', r.retention?.until ? formatDate(r.retention.until) : r.retention?.years === 0 ? 'Vĩnh viễn' : '—'],
              ]}
            />
            <Space wrap style={{ marginTop: 16 }}>
              <DriveLink fileId={r.fileId}>Mở file</DriveLink>
              <DriveLink fileId={r.finalized?.pdfFileId}>Mở bản PDF đã chốt</DriveLink>
              {r.approvalId && <LinkButton href={`/phe-duyet/${r.approvalId}`}>Phiếu duyệt</LinkButton>}
              {r.fileId && hasAction(r, 'share') && <LinkButton href={`/chia-se/moi?fileId=${encodeURIComponent(r.fileId)}&ten=${encodeURIComponent(r.fileName ?? r.subject)}`}>Chia sẻ ra ngoài</LinkButton>}
            </Space>
          </Card>
          {r.finalized && <FinalizedCard r={r} />}
          {r.hold?.isActive && (
            <Card title="Đang giữ lại">
              <p>
                {r.hold.reasonType && <strong>{holdReasonLabel[r.hold.reasonType]}: </strong>}
                {r.hold.reason}
              </p>
              <p className="muted small">
                <UserName id={r.hold.by} /> · {formatDateTime(r.hold.at)}
              </p>
            </Card>
          )}
          {!!r.adjustedByIds?.length && (
            <Card title="Hồ sơ điều chỉnh">
              <ul>
                {r.adjustedByIds.map((aid) => (
                  <li key={aid}>
                    <Link href={`/ho-so/${aid}`}>Mở hồ sơ điều chỉnh</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dialog === 'edit' && <EditDialog r={r} onClose={close} />}
          {dialog === 'submit' && (
            <ActionDialog
              open
              title="Trình duyệt hồ sơ"
              description="File được khoá tạm và chụp lại phiên bản để người duyệt xem đúng bản đã trình."
              confirmLabel="Trình duyệt"
              run={(_, key) => unwrap(api.POST('/records/{id}/submit', { params: { path: { id } }, ...idem(key) }))}
              invalidate={[...invalidate, ['approvals']]}
              onClose={close}
            >
              <ApproverPreview objectType="record" objectId={id} />
            </ActionDialog>
          )}
          {dialog === 'finalize' && (
            <ActionDialog
              open
              title="Chốt hồ sơ"
              description="Xuất PDF cùng thư mục, đóng dấu chốt có mã tra cứu, khoá cả file gốc và PDF, lưu dấu vân tay số. Sau khi chốt không sửa được."
              confirmLabel="Chốt"
              variant="success"
              run={(_, key) => unwrap(api.POST('/records/{id}/finalize', { params: { path: { id } }, ...idem(key) }))}
              onDone={(res) => jobs.track({ jobId: res.jobId, label: `Chốt hồ sơ ${r.number}`, invalidate })}
              onClose={close}
            />
          )}
          {dialog === 'adjust' && (
            <ActionDialog
              open
              title="Lập hồ sơ điều chỉnh"
              description="Hồ sơ gốc giữ nguyên; hồ sơ mới có liên kết tới hồ sơ gốc."
              confirmLabel="Lập hồ sơ điều chỉnh"
              textLabel="Lý do điều chỉnh"
              textRequired
              run={(reason, key) => unwrap(api.POST('/records/{id}/adjust', { params: { path: { id } }, body: { reason }, ...idem(key) }))}
              invalidate={invalidate}
              onDone={(nr) => router.push(`/ho-so/${nr.id}`)}
              onClose={close}
            />
          )}
          {dialog === 'scan' && <ScanDialog r={r} onClose={close} />}
          {dialog === 'hold' && <HoldDialog id={id} onClose={close} />}
          {dialog === 'release' && (
            <ActionDialog
              open
              title="Bỏ giữ lại"
              confirmLabel="Bỏ giữ lại"
              run={() => unwrap(api.POST('/records/{id}/release-hold', { params: { path: { id } } }))}
              invalidate={invalidate}
              onClose={close}
            />
          )}
        </>
      )}
    </QueryState>
  );
}

function FinalizedCard({ r }: { r: VcRecord }) {
  const [check, setCheck] = useState(false);
  const integrity = useQuery({
    queryKey: ['record-integrity', r.id],
    enabled: check,
    queryFn: () => unwrap(api.GET('/records/{id}/integrity', { params: { path: { id: r.id } } })),
    retry: false,
  });
  const f = r.finalized!;
  const i = integrity.data;
  return (
    <Card
      title="Đã chốt"
      actions={
        hasAction(r, 'integrity') && (
          <Button onClick={() => (check ? integrity.refetch() : setCheck(true))} loading={integrity.isFetching}>
            Kiểm tra toàn vẹn
          </Button>
        )
      }
    >
      <DefList
        items={[
          ['Chốt lúc', formatDateTime(f.at)],
          ['Người chốt', <UserName key="b" id={f.by} />],
          ['Mã tra cứu', f.verifyCode ? <Link key="v" href={`/kiem-tra/${encodeURIComponent(f.verifyCode)}`}>{f.verifyCode}</Link> : '—'],
          ['Dấu vân tay số (SHA-256)', <span key="h" className="mono small" style={{ wordBreak: 'break-all' }}>{f.pdfSha256 ?? '—'}</span>],
        ]}
      />
      {integrity.error && <ErrorBox error={integrity.error} />}
      {i &&
        (i.isLocked && i.isRevisionMatching && i.isHashMatching !== false ? (
          <Notice tone="success">Toàn vẹn: file đang khoá, nội dung khớp bản đã chốt.</Notice>
        ) : (
          <Notice tone="warn">
            Cảnh báo: {!i.isLocked && 'file đang không khoá. '}
            {!i.isRevisionMatching && 'nội dung file khác bản đã chốt. '}
            {i.isHashMatching === false && 'mã băm PDF không khớp. '}
            Phần mềm sẽ khoá lại; báo Kiểm soát tài liệu nếu cần.
          </Notice>
        ))}
    </Card>
  );
}

type EditValues = { subject: string; identifier: string; workMonth: Dayjs | null; paperLocation: string };

function EditDialog({ r, onClose }: { r: VcRecord; onClose: () => void }) {
  const toast = useToast();
  const [form] = Form.useForm<EditValues>();
  const save = useAction(
    (v: EditValues) =>
      unwrap(
        api.PATCH('/records/{id}', {
          params: { path: { id: r.id } },
          body: { subject: v.subject.trim(), identifier: v.identifier?.trim() || undefined, workMonth: toISOMonth(v.workMonth), paperLocation: v.paperLocation?.trim() || undefined },
        }),
      ),
    {
      invalidate: [['record', r.id], ['records']],
      onSuccess: () => {
        toast.success('Đã lưu hồ sơ.');
        onClose();
      },
    },
  );
  return (
    <Modal
      open
      title="Sửa hồ sơ"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => form.submit()}>
            Lưu
          </Button>
        </>
      }
    >
      <Form<EditValues>
        form={form}
        layout="vertical"
        initialValues={{ subject: r.subject, identifier: r.identifier ?? '', workMonth: toDayjs(r.workMonth), paperLocation: r.paperLocation ?? '' }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="subject" label="Nội dung ngắn" rules={[{ required: true, whitespace: true, message: 'Nhập nội dung ngắn.' }]}>
          <Input maxLength={120} />
        </Form.Item>
        {r.kind === 'OPS' && (
          <Form.Item name="identifier" label="Số định danh" rules={[{ required: true, whitespace: true, message: 'Hồ sơ vận hành phải có số định danh.' }]}>
            <Input />
          </Form.Item>
        )}
        <Form.Item name="workMonth" label="Tháng công việc" rules={[{ required: true, message: 'Chọn tháng công việc.' }]}>
          <DatePicker picker="month" format="MM/YYYY" allowClear={false} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="paperLocation" label="Vị trí bản giấy">
          <Input placeholder="Tủ 2, ngăn 3" />
        </Form.Item>
      </Form>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function ScanDialog({ r, onClose }: { r: VcRecord; onClose: () => void }) {
  const jobs = useJobs();
  const [file, setFile] = useState<File | null>(null);
  const [paperLocation, setPaper] = useState(r.paperLocation ?? '');
  const tooLarge = isTooLarge(file);
  return (
    <ActionDialog
      open
      title="Gắn bản scan"
      description="Vị trí bản giấy được ghi cả vào phần Mô tả của file trên Drive."
      confirmLabel="Tải lên"
      canConfirm={!!file && !tooLarge && !!paperLocation.trim()}
      run={() => {
        const fd = new FormData();
        fd.append('file', file!);
        fd.append('paperLocation', paperLocation.trim());
        return unwrap(api.POST('/records/{id}/scan', { params: { path: { id: r.id } }, body: fd as never, bodySerializer: (b: unknown) => b as FormData }));
      }}
      onDone={(res) => jobs.track({ jobId: res.jobId, label: 'Gắn bản scan', invalidate: [['record', r.id]] })}
      onClose={onClose}
    >
      <Field label="File scan" required error={tooLarge ? `File quá lớn (tối đa ${getLimits().uploadMaxMb} MB).` : undefined}>
        <Upload
          maxCount={1}
          accept="application/pdf,image/*"
          beforeUpload={(f) => {
            setFile(f);
            return false;
          }}
          onRemove={() => setFile(null)}
        >
          <Button icon={<UploadOutlined />}>Chọn file scan</Button>
        </Upload>
      </Field>
      <TextField label="Vị trí bản giấy" value={paperLocation} onChange={setPaper} required placeholder="Tủ 2, ngăn 3, kệ B" />
    </ActionDialog>
  );
}

function HoldDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reasonType, setType] = useState<HoldReasonType | ''>('');
  return (
    <ActionDialog
      open
      title="Giữ lại hồ sơ"
      description="Hồ sơ giữ lại không được huỷ khi hết hạn (BR-22)."
      confirmLabel="Giữ lại"
      textLabel="Diễn giải"
      textRequired
      canConfirm={!!reasonType}
      run={(reason) => unwrap(api.POST('/records/{id}/hold', { params: { path: { id } }, body: { reasonType: reasonType as HoldReasonType, reason } }))}
      invalidate={[['record', id], ['records']]}
      onClose={onClose}
    >
      <SelectField
        label="Lý do"
        value={reasonType}
        onChange={setType}
        required
        options={(Object.keys(holdReasonLabel) as HoldReasonType[]).map((k) => ({ value: k, label: holdReasonLabel[k] }))}
      />
    </ActionDialog>
  );
}
