import { Suspense } from 'react';
import { NewRecordForm } from './NewRecordForm';

export default function NewRecordPage() {
  return (
    <Suspense>
      <NewRecordForm />
    </Suspense>
  );
}
