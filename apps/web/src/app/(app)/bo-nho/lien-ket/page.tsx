'use client';

import { useEffect, useState } from 'react';
import { API_BASE, DRIVE_LINK_TOKEN_STORAGE } from '@/api/client';

export default function AuthenticatedDriveLinkPage() {
  const [token, setToken] = useState('');
  useEffect(() => {
    const fromFragment=window.location.hash.slice(1),stored=window.sessionStorage.getItem(DRIVE_LINK_TOKEN_STORAGE) || '';
    const next=fromFragment || stored;
    if (!next) return;
    if (fromFragment) window.sessionStorage.setItem(DRIVE_LINK_TOKEN_STORAGE,fromFragment);
    if (next) window.sessionStorage.removeItem(DRIVE_LINK_TOKEN_STORAGE);
    if (window.location.hash) window.history.replaceState(null,'',window.location.pathname+window.location.search);
    setToken(next);
  }, []);
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  return <main className="card">
    <h1>Tệp Drive được chia sẻ</h1>
    <p>Liên kết chỉ tải được khi tài khoản đăng nhập là đúng người nhận và vẫn còn quyền Drive.</p>
    {valid
      ? <a className="btn btn-primary" href={`${API_BASE}/drive/shared-links/${encodeURIComponent(token)}`}>Tải snapshot đã chia sẻ</a>
      : <p role="alert">Liên kết thiếu hoặc không hợp lệ.</p>}
  </main>;
}
