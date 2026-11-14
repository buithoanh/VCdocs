'use client';

import { useParams } from 'next/navigation';
import { EvidencePackView } from './EvidencePackView';

export default function EvidencePackPage() {
  const { id } = useParams<{ id: string }>();
  return <EvidencePackView id={id} />;
}
