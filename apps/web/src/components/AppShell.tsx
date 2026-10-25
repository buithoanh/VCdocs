'use client';

import { BellOutlined, CheckSquareOutlined, LogoutOutlined, MenuOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Drawer, Grid, Input, Layout, Menu, type MenuProps } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, LOGIN_PATH, setCsrfToken, unwrap } from '@/api/client';
import { roleLabel } from '@/lib/labels';
import { NAV_GROUP_LABEL, navFor, type NavItem } from '@/lib/permissions';
import { useAuth } from './providers/AuthProvider';
import { useToast } from './providers/ToastProvider';

const { Header, Sider, Content } = Layout;
const GROUPS: NavItem['group'][] = ['chinh', 'danh-muc', 'quan-tri'];

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

/** Khung ứng dụng: thanh trên navy, menu trái (ngăn kéo trên điện thoại), nội dung. */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, roles } = useAuth();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const mobile = screens.lg === false;
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const pending = usePendingApprovals();
  const toast = useToast();
  useEffect(() => setOpen(false), [pathname]);

  const items = navFor(roles);
  const selectedKeys = items.filter((i) => isActive(pathname, i.href)).map((i) => i.href);
  const menuItems: NonNullable<MenuProps['items']> = [];
  for (const g of GROUPS) {
    const gi = items.filter((i) => i.group === g);
    if (gi.length) {
      menuItems.push({
        type: 'group',
        key: g,
        label: NAV_GROUP_LABEL[g],
        children: gi.map((i) => ({ key: i.href, label: <Link href={i.href}>{i.label}</Link> })),
      });
    }
  }
  menuItems.push(
    { type: 'divider' },
    { key: '/thong-bao', icon: <BellOutlined />, label: <Link href="/thong-bao">Thông báo</Link> },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true },
  );

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

  const nav = (
    <div className="sidenav-inner">
      <div className="me-box">
        <strong>{me.user.name}</strong>
        <span className="muted small">{me.user.email}</span>
        <span className="small">{roles.map((r) => roleLabel[r]).join(' · ') || 'Chưa có vai trò'}</span>
      </div>
      <Menu
        mode="inline"
        selectedKeys={selectedKeys}
        items={menuItems}
        onClick={(e) => {
          if (e.key === 'logout') void logout();
          else setOpen(false);
        }}
        style={{ borderInlineEnd: 0 }}
      />
    </div>
  );

  return (
    <Layout className="shell">
      <Header className="topbar">
        {mobile && <Button type="text" className="menu-btn" aria-label="Mở menu" aria-expanded={open} icon={<MenuOutlined />} onClick={() => setOpen((v) => !v)} />}
        <Link href="/" className="brand">
          VCworkspace
        </Link>
        <Input.Search
          className="topbar-search"
          placeholder="Tìm mã, tên, biển số, số PO…"
          aria-label="Tìm kiếm"
          allowClear
          onSearch={(v) => router.push(v.trim() ? `/tra-cuu?q=${encodeURIComponent(v.trim())}` : '/tra-cuu')}
        />
        <Link href="/phe-duyet" className="icon-link" aria-label={`Chờ tôi duyệt: ${pending.data ?? 0}`}>
          <Badge count={pending.data ?? 0} overflowCount={99} size="small">
            <CheckSquareOutlined />
          </Badge>
        </Link>
        <Link href="/thong-bao" className="icon-link" aria-label={`Thông báo chưa đọc: ${unread.data ?? 0}`}>
          <Badge count={unread.data ?? 0} overflowCount={99} size="small">
            <BellOutlined />
          </Badge>
        </Link>
      </Header>
      <Layout className="body">
        {mobile ? (
          <Drawer open={open} onClose={() => setOpen(false)} placement="left" size={280} closable={false} styles={{ body: { padding: 8 } }}>
            {nav}
          </Drawer>
        ) : (
          <Sider width={240} theme="light" className="sidenav">
            {nav}
          </Sider>
        )}
        <Content className="main" id="noi-dung">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
