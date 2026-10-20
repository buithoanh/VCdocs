'use client';

import { useState } from 'react';
import { api, idem, unwrap } from '@/api/client';
import { ActionDialog } from '@/components/ActionDialog';
import { useJobs } from '@/components/jobs';
import { UserPicker } from '@/components/pickers';
import { TextField } from '@/components/ui';
import { todayVN } from '@/lib/format';

/**
 * Lập biên bản bằng tay (R3, E4): ghi ngày làm việc cuối, người đó chuyển sang “Sắp nghỉ”;
 * việc nền handover.list tự liệt kê. Người nhận bỏ trống = trưởng phòng (người nghỉ là trưởng phòng → GĐ khối, E3).
 */
export function NewHandoverDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (handoverId: string) => void }) {
  const jobs = useJobs();
  const [userId, setUserId] = useState('');
  const [day, setDay] = useState('');
  const [receiverId, setReceiverId] = useState('');
  return (
    <ActionDialog
      open
      title="Lập biên bản bàn giao"
      description="Người nghỉ chuyển sang “Sắp nghỉ”. Hệ thống tự liệt kê tài liệu, hồ sơ, phiếu chờ, chia sẻ ngoài, uỷ quyền, file Drive của tôi và nhóm Google của người đó."
      confirmLabel="Lập biên bản"
      textLabel="Ghi chú"
      canConfirm={!!userId && !!day && receiverId !== userId}
      run={(note, key) =>
        unwrap(
          api.POST('/handovers', {
            body: { userId, lastWorkingDay: day, receiverId: receiverId || undefined, note: note || undefined },
            ...idem(key),
          }),
        )
      }
      invalidate={[['handovers']]}
      onDone={(r) => {
        jobs.track({ jobId: r.jobId, label: 'Liệt kê bàn giao', invalidate: [['handovers'], ['handover', r.handoverId]] });
        onCreated(r.handoverId);
      }}
      onClose={onClose}
    >
      <UserPicker label="Người nghỉ việc" value={userId} onChange={setUserId} required />
      <TextField label="Ngày làm việc cuối" type="date" value={day} onChange={setDay} required hint={day && day < todayVN() ? 'Ngày đã qua: HCNS phải ghi lý do khi kiểm tra (BR-25).' : undefined} />
      <UserPicker
        label="Người nhận bàn giao"
        value={receiverId}
        onChange={setReceiverId}
        excludeIds={userId ? [userId] : []}
        hint="Bỏ trống = trưởng phòng của người nghỉ; người nghỉ là trưởng phòng thì giám đốc khối."
      />
    </ActionDialog>
  );
}
