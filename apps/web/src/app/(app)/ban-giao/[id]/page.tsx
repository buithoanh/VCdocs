'use client';

import { useParams } from 'next/navigation';
import { HandoverView } from './HandoverView';

export default function HandoverPage() {
  const { id } = useParams<{ id: string }>();
  return <HandoverView id={id} />;
}
