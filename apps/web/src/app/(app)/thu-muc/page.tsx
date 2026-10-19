import { Suspense } from 'react';
import { FolderBrowser } from './FolderBrowser';

export default function FoldersPage() {
  return (
    <Suspense>
      <FolderBrowser />
    </Suspense>
  );
}
