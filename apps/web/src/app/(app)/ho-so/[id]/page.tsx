'use client';

import { useParams } from 'next/navigation';
import { RecordView } from './RecordView';

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  return <RecordView id={id} />;
}
