import { Suspense } from 'react';
import { AuditLogView } from './AuditLogView';

export default function AuditLogPage() {
  return (
    <Suspense>
      <AuditLogView />
    </Suspense>
  );
}
