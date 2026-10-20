'use client';

import { useParams } from 'next/navigation';
import { DocumentView } from './DocumentView';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentView id={id} />;
}
