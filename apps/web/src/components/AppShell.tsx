'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, LOGIN_PATH, setCsrfToken, unwrap } from '@/api/client';
import { roleLabel } from '@/lib/labels';
import { NAV_GROUP_LABEL, navFor, type NavItem } from '@/lib/permissions';
import { useAuth } from './providers/AuthProvider';
import { useToast } from './providers/ToastProvider';

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => unwrap(api.GET('/notifications', { params: { query: { unread: true, limit: 1 } } })).then((r) => r.unreadCount),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ['approvals', 'inbox-count'],
    queryFn: () => unwrap(api.GET('/approvals', { params: { query: { box: 'inbox', status: 'pending', limit: 1 } } })).then((r) => r.total),
    refetchInterval: 120_000,
    staleTime: 30_000,
  });
}

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/phe-duyet') return pathname === '/phe-duyet' || /^\/phe-duyet\/(?!uy-quyen)/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, roles } = useAuth();
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const pending = usePendingApprovals();
  const toast = useToast();
  useEffect(() => setOpen(false), [pathname]);

  const items = navFor(roles);
  const groups = (['chinh', 'danh-muc', 'quan-tri'] as NavItem['group'][]).map((g) => ({ g, items: items.filter((i) => i.group === g) }));

  async function logout() {
    try {
      await unwrap(api.POST('/auth/logout'));
    } catch {
      // Phiên có thể đã hết; vẫn đưa về trang đăng nhập.
    }
    setCsrfToken(null);
    toast.info('Đã đăng xuất.');
    window.location.assign(LOGIN_PATH);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="menu-btn" aria-label="Mở menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          ☰
        </button>
        <Link href="/" className="brand">
          VCdocs
        </Link>
        <form className="topbar-search" action="/tra-cuu" role="search">
          <input name="q" type="search" placeholder="Tìm mã, tên, biển số, số PO…" aria-label="Tìm kiếm" />
        </form>
        <Link href="/phe-duyet" className="icon-link" aria-label={`Chờ tôi duyệt: ${pending.data ?? 0}`}>
          <span aria-hidden>✓</span>
          {!!pending.data && <span className="dot">{pending.data > 99 ? '99+' : pending.data}</span>}
        </Link>
        <Link href="/thong-bao" className="icon-link" aria-label={`Thông báo chưa đọc: ${unread.data ?? 0}`}>
          <span aria-hidden>🔔</span>
          {!!unread.data && <span className="dot">{unread.data > 99 ? '99+' : unread.data}</span>}
        </Link>
      </header>
      <div className="body">
        <nav className={`sidenav ${open ? 'is-open' : ''}`} aria-label="Điều hướng chính">
          <div className="me-box">
            <strong>{me.user.name}</strong>
            <span className="muted small">{me.user.email}</span>
            <span className="small">{roles.map((r) => roleLabel[r]).join(' · ') || 'Chưa có vai trò'}</span>
          </div>
          {groups.map(
            ({ g, items: gi }) =>
              gi.length > 0 && (
                <div key={g} className="nav-group">
                  <p className="nav-group-label">{NAV_GROUP_LABEL[g]}</p>
                  {gi.map((i) => (
                    <Link key={i.href} href={i.href} className={`nav-link ${isActive(pathname, i.href) ? 'is-active' : ''}`} aria-current={isActive(pathname, i.href) ? 'page' : undefined}>
                      {i.label}
                    </Link>
                  ))}
                </div>
              ),
          )}
          <div className="nav-group">
            <Link href="/thong-bao" className="nav-link">
              Thông báo
            </Link>
            <button className="nav-link nav-logout" onClick={logout}>
              Đăng xuất
            </button>
          </div>
        </nav>
        {open && <div className="nav-backdrop" onClick={() => setOpen(false)} />}
        <main className="main" id="noi-dung">
          {children}
        </main>
      </div>
    </div>
  );
}
