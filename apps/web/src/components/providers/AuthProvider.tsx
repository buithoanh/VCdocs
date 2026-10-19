'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, rememberPeople, setCsrfToken, setLimits, unwrap } from '@/api/client';
import type { Me, SystemRole } from '@/api/types';
import { canRole, type RoleRule } from '@/lib/permissions';

type AuthValue = {
  me: Me;
  roles: SystemRole[];
  can: (rule: RoleRule) => boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useMeQuery() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await unwrap(api.GET('/me'));
      setCsrfToken(me.csrfToken);
      setLimits(me.limits);
      rememberPeople({ [me.user.id]: { id: me.user.id, name: me.user.name, email: me.user.email } });
      return me;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Chỉ hiện nội dung khi đã có /me (đã đăng nhập, có csrfToken). 401 tự chuyển về đăng nhập. */
export function AuthProvider({ children, fallback }: { children: ReactNode; fallback: (state: 'loading' | 'error', retry: () => void, message?: string) => ReactNode }) {
  const q = useMeQuery();
  useEffect(() => {
    if (q.data) setCsrfToken(q.data.csrfToken);
  }, [q.data]);
  const value = useMemo<AuthValue | null>(() => {
    if (!q.data) return null;
    const roles = q.data.systemRoles ?? [];
    return { me: q.data, roles, can: (rule) => canRole(roles, rule) };
  }, [q.data]);
  if (!value) {
    if (q.isError) return <>{fallback('error', () => q.refetch(), (q.error as Error)?.message)}</>;
    return <>{fallback('loading', () => q.refetch())}</>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth phải nằm trong AuthProvider');
  return v;
}

/** Cho test: dựng sẵn ngữ cảnh đăng nhập. */
export function TestAuthProvider({ me, children }: { me: Me; children: ReactNode }) {
  setCsrfToken(me.csrfToken);
  setLimits(me.limits);
  const roles = me.systemRoles ?? [];
  return <AuthContext.Provider value={{ me, roles, can: (rule) => canRole(roles, rule) }}>{children}</AuthContext.Provider>;
}
