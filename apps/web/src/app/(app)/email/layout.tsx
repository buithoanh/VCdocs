import type { ReactNode } from 'react';
import { WorkspaceModuleGate } from '@/components/WorkspaceModuleGate';

export default function Layout({ children }: { children: ReactNode }) {
  return <WorkspaceModuleGate module="mail">{children}</WorkspaceModuleGate>;
}
