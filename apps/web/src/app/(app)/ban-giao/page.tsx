import { Suspense } from 'react';
import { HandoverList } from './HandoverList';

export default function HandoversPage() {
  return (
    <Suspense>
      <HandoverList />
    </Suspense>
  );
}
