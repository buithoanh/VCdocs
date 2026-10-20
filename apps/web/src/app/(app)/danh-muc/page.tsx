'use client';

import { useState } from 'react';
import { api, unwrap, idem } from '@/api/client';
import { blockName, useAction, useBlocks, useDepartments, useDivisions } from '@/api/queries';
import type { Block, Department, Division, SecurityLevel } from '@/api/types';
import { DataTable } from '@/components/DataTable';
import { UserName, UserPicker } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { Badge, Button, ErrorBox, Modal, PageHeader, QueryState, SelectField, Tabs, TextField } from '@/components/ui';
import { securityLabel } from '@/lib/labels';

type Tab = 'khoi' | 'phong' | 'division';

export default function MasterDataPage() {
  const [tab, setTab] = useState<Tab>('phong');
  return (
    <>
      <PageHeader title="Khối, phòng, division" subtitle="Danh mục nền theo QĐ-VCPV-02" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'phong', label: 'Phòng – drive' },
          { value: 'khoi', label: 'Khối' },
          { value: 'division', label: 'Division' },
        ]}
      />
      {tab === 'khoi' && <BlocksTab />}
      {tab === 'phong' && <DepartmentsTab />}
      {tab === 'division' && <DivisionsTab />}
    </>
  );
}

/* ── Khối ── */
function BlocksTab() {
  const { can } = useAuth();
  const q = useBlocks();
  const [edit, setEdit] = useState<Partial<Block> | null>(null);
  return (
    <>
      {can('editMasterData') && (
        <div className="actions" style={{ marginBottom: '1rem' }}>
          <Button variant="primary" onClick={() => setEdit({})}>
            Thêm khối
          </Button>
        </div>
      )}
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(b) => b.id}
          columns={[
            { key: 'code', header: 'Mã', render: (b) => <strong>{b.code}</strong> },
            { key: 'name', header: 'Tên khối', render: (b) => b.name },
            { key: 'dir', header: 'Giám đốc khối', render: (b) => <UserName id={b.directorId} /> },
            { key: 'edit', header: '', render: (b) => can('editMasterData') && <Button variant="ghost" onClick={() => setEdit(b)}>Sửa</Button> },
          ]}
        />
      </QueryState>
      {edit && <BlockForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function BlockForm({ initial, onClose }: { initial: Partial<Block>; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(initial.code ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [directorId, setDirector] = useState(initial.directorId ?? '');
  const save = useAction(
    (_: void, key: string) => {
      const body = { code: code.trim(), name: name.trim(), directorId: directorId || undefined };
      return initial.id
        ? unwrap(api.PATCH('/blocks/{id}', { params: { path: { id: initial.id } }, body }))
        : unwrap(api.POST('/blocks', { body, ...idem(key) }));
    },
    { invalidate: [['blocks']], onSuccess: () => (toast.success('Đã lưu khối.'), onClose()) },
  );
  return (
    <Modal
      open
      title={initial.id ? 'Sửa khối' : 'Thêm khối'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!code.trim() || !name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <TextField label="Mã khối" value={code} onChange={setCode} required placeholder="KD" />
      <TextField label="Tên khối" value={name} onChange={setName} required placeholder="Khối Kinh doanh" />
      <UserPicker label="Giám đốc khối" value={directorId} onChange={setDirector} />
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/* ── Phòng ── */
function DepartmentsTab() {
  const { can } = useAuth();
  const q = useDepartments();
  const blocks = useBlocks();
  const [edit, setEdit] = useState<Partial<Department> | null>(null);
  return (
    <>
      {can('editMasterData') && (
        <div className="actions" style={{ marginBottom: '1rem' }}>
          <Button variant="primary" onClick={() => setEdit({})}>
            Thêm phòng
          </Button>
        </div>
      )}
      <QueryState q={q}>
        <DataTable
          rows={[...(q.data ?? [])].sort((a, b) => a.number.localeCompare(b.number))}
          rowKey={(d) => d.id}
          columns={[
            { key: 'num', header: 'Số', render: (d) => d.number },
            { key: 'code', header: 'Mã', render: (d) => <strong>{d.code}</strong> },
            { key: 'name', header: 'Tên phòng', render: (d) => d.name },
            { key: 'block', header: 'Khối', render: (d) => blockName(blocks.data, d.blockId), hideOnMobile: true },
            { key: 'sec', header: 'Mức bảo mật', render: (d) => <Badge status={d.securityLevel === 'confidential' ? 'failed' : 'active'}>{securityLabel[d.securityLevel]}</Badge> },
            { key: 'head', header: 'Trưởng phòng', render: (d) => <UserName id={d.headId} />, hideOnMobile: true },
            { key: 'edit', header: '', render: (d) => can('editMasterData') && <Button variant="ghost" onClick={() => setEdit(d)}>Sửa</Button> },
          ]}
        />
      </QueryState>
      {edit && <DepartmentForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const SECURITY: SecurityLevel[] = ['internal', 'department', 'confidential'];

function DepartmentForm({ initial, onClose }: { initial: Partial<Department>; onClose: () => void }) {
  const toast = useToast();
  const blocks = useBlocks();
  const [f, setF] = useState({
    code: initial.code ?? '',
    number: initial.number ?? '',
    name: initial.name ?? '',
    blockId: initial.blockId ?? '',
    driveId: initial.driveId ?? '',
    securityLevel: (initial.securityLevel ?? '') as SecurityLevel | '',
    headId: initial.headId ?? '',
    groupEmails: (initial.groupEmails ?? []).join(', '),
  });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const valid = f.code.trim() && /^\d{2}$/.test(f.number.trim()) && f.name.trim() && f.driveId.trim() && f.securityLevel;
  const save = useAction(
    (_: void, key: string) => {
      const body = {
        code: f.code.trim(),
        number: f.number.trim(),
        name: f.name.trim(),
        blockId: f.blockId || undefined,
        driveId: f.driveId.trim(),
        securityLevel: f.securityLevel as SecurityLevel,
        headId: f.headId || undefined,
        groupEmails: f.groupEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
      };
      return initial.id
        ? unwrap(api.PATCH('/departments/{id}', { params: { path: { id: initial.id } }, body }))
        : unwrap(api.POST('/departments', { body, ...idem(key) }));
    },
    { invalidate: [['departments']], onSuccess: () => (toast.success('Đã lưu phòng.'), onClose()) },
  );
  return (
    <Modal
      open
      title={initial.id ? 'Sửa phòng' : 'Thêm phòng'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="form-row">
        <TextField label="Số" value={f.number} onChange={set('number')} required placeholder="11" hint="2 chữ số, 00–22" inputMode="numeric" maxLength={2} />
        <TextField label="Mã phòng" value={f.code} onChange={set('code')} required placeholder="MKT" />
      </div>
      <TextField label="Tên phòng" value={f.name} onChange={set('name')} required placeholder="Marketing" />
      <SelectField label="Khối" value={f.blockId} onChange={set('blockId')} options={(blocks.data ?? []).map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))} />
      <TextField label="Mã Bộ nhớ dùng chung (drive)" value={f.driveId} onChange={set('driveId')} required hint="Lấy từ đường dẫn drive trên Google Drive" />
      <SelectField label="Mức bảo mật" value={f.securityLevel} onChange={set('securityLevel')} required options={SECURITY.map((s) => ({ value: s, label: securityLabel[s] }))} />
      <UserPicker label="Trưởng phòng" value={f.headId} onChange={set('headId')} />
      <TextField label="Nhóm Google gắn với drive" value={f.groupEmails} onChange={set('groupEmails')} hint="Các email nhóm, cách nhau bằng dấu phẩy" />
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/* ── Division ── */
function DivisionsTab() {
  const { can } = useAuth();
  const q = useDivisions();
  const [edit, setEdit] = useState<Partial<Division> | null>(null);
  return (
    <>
      {can('editMasterData') && (
        <div className="actions" style={{ marginBottom: '1rem' }}>
          <Button variant="primary" onClick={() => setEdit({})}>
            Thêm division
          </Button>
        </div>
      )}
      <QueryState q={q}>
        <DataTable
          rows={q.data ?? []}
          rowKey={(d) => d.id}
          columns={[
            { key: 'prefix', header: 'Tiền tố mã', render: (d) => <strong>{d.prefix}</strong> },
            { key: 'name', header: 'Tên', render: (d) => d.name },
            { key: 'edit', header: '', render: (d) => can('editMasterData') && <Button variant="ghost" onClick={() => setEdit(d)}>Sửa</Button> },
          ]}
        />
      </QueryState>
      {edit && <DivisionForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function DivisionForm({ initial, onClose }: { initial: Partial<Division>; onClose: () => void }) {
  const toast = useToast();
  const [prefix, setPrefix] = useState(initial.prefix ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const save = useAction(
    (_: void, key: string) => {
      const body = { prefix: prefix.trim(), name: name.trim() };
      return initial.id
        ? unwrap(api.PATCH('/divisions/{id}', { params: { path: { id: initial.id } }, body }))
        : unwrap(api.POST('/divisions', { body, ...idem(key) }));
    },
    { invalidate: [['divisions']], onSuccess: () => (toast.success('Đã lưu division.'), onClose()) },
  );
  return (
    <Modal
      open
      title={initial.id ? 'Sửa division' : 'Thêm division'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!prefix.trim() || !name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <TextField label="Tiền tố mã" value={prefix} onChange={setPrefix} required placeholder="VCS" />
      <TextField label="Tên" value={name} onChange={setName} required />
      <ErrorBox error={save.error} />
    </Modal>
  );
}
