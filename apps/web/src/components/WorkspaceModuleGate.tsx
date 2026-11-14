'use client';

import { Result } from 'antd';
import type { ReactNode } from 'react';
import { workspaceModuleEnabled, type WorkspaceModule } from '@/lib/workspace-modules';

const LABEL: Record<WorkspaceModule, string> = { drive: 'Bộ nhớ VCworkspace', mail: 'Email VCworkspace' };

/** Trang của phân hệ đang tắt: báo rõ thay vì để từng lời gọi API lỗi 503. */
export function WorkspaceModuleGate({ module, children }: { module: WorkspaceModule; children: ReactNode }) {
  if (workspaceModuleEnabled(module)) return <>{children}</>;
  return <Result status="info" title={`${LABEL[module]} chưa bật`} subTitle="Phân hệ này chưa được mở trên máy chủ hiện tại." />;
}
