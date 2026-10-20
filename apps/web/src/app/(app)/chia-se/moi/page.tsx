import { Suspense } from 'react';
import { NewShareForm } from './NewShareForm';

export default function NewSharePage() {
  return (
    <Suspense>
      <NewShareForm />
    </Suspense>
  );
}
