'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newId, unwrap } from './client';
import type { Block, Department, Division, Drive, RecordType, User } from './types';

/* Danh mục ít đổi: giữ 5 phút để trang mở nhanh. */
const STATIC = { staleTime: 5 * 60_000 };

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => unwrap(api.GET('/departments')).then((r) => r.items),
    ...STATIC,
  });
}

export function useBlocks() {
  return useQuery({ queryKey: ['blocks'], queryFn: () => unwrap(api.GET('/blocks')).then((r) => r.items), ...STATIC });
}

export function useDivisions() {
  return useQuery({ queryKey: ['divisions'], queryFn: () => unwrap(api.GET('/divisions')).then((r) => r.items), ...STATIC });
}

export function useDrives() {
  return useQuery({ queryKey: ['drives'], queryFn: () => unwrap(api.GET('/drives')).then((r) => r.items), ...STATIC });
}

export function useRecordTypes(departmentId?: string) {
  return useQuery({
    queryKey: ['record-types', departmentId ?? null],
    queryFn: () =>
      unwrap(api.GET('/record-types', { params: { query: departmentId ? { departmentId } : {} } })).then((r) => r.items),
    ...STATIC,
  });
}

/** Tên một nhân sự từ id. Không có quyền xem danh sách nhân sự thì trả undefined. */
export function useUser(id?: string) {
  return useQuery({
    queryKey: ['user', id],
    enabled: !!id,
    queryFn: () => unwrap(api.GET('/users/{id}', { params: { path: { id: id! } } })),
    retry: false,
    ...STATIC,
  });
}

export function useUserSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: ['users', 'search', q],
    enabled,
    queryFn: () =>
      unwrap(api.GET('/users', { params: { query: { q: q || undefined, limit: 20, status: 'active' } } })).then((r) => r.items),
    retry: false,
    staleTime: 60_000,
  });
}

export function byId<T extends { id: string }>(list?: T[]): Map<string, T> {
  return new Map((list ?? []).map((x) => [x.id, x]));
}

export function deptName(list: Department[] | undefined, id?: string) {
  if (!id) return '—';
  const d = list?.find((x) => x.id === id);
  return d ? `${d.number} ${d.code}` : '—';
}

export function blockName(list: Block[] | undefined, id?: string) {
  if (!id) return '—';
  return list?.find((x) => x.id === id)?.name ?? '—';
}

export function recordTypeName(list: RecordType[] | undefined, id?: string) {
  if (!id) return '—';
  return list?.find((x) => x.id === id)?.name ?? '—';
}

export function driveName(list: Drive[] | undefined, driveId?: string) {
  if (!driveId) return '—';
  return list?.find((x) => x.driveId === driveId)?.name ?? driveId;
}

export type { Block, Department, Division, Drive, RecordType, User };

/**
 * Gọi một hành động có chống lặp: giữ cùng Idempotency-Key cho tới khi thành công,
 * nên bấm lại sau lỗi mạng không làm hai lần.
 */
export function useAction<TVars, TResult>(
  fn: (vars: TVars, idempotencyKey: string) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; onSuccess?: (r: TResult, vars: TVars) => void } = {},
) {
  const qc = useQueryClient();
  const keyRef = useRef<string>(newId());
  const m = useMutation({
    mutationFn: (vars: TVars) => fn(vars, keyRef.current),
    onSuccess: (r, vars) => {
      keyRef.current = newId();
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r, vars);
    },
    onError: (err) => {
      // Máy chủ đã từ chối (4xx) thì việc chưa làm: lần sau dùng key mới vì dữ liệu có thể đã sửa.
      // Lỗi mạng / 5xx: giữ key để bấm lại không làm hai lần.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) keyRef.current = newId();
    },
  });
  const resetKey = useCallback(() => {
    keyRef.current = newId();
  }, []);
  return Object.assign(m, { resetKey });
}

/** Kiểm tra mã trùng khi gõ: tìm mã cùng tên trong Bảng mã. */
export function useCodeExists(code: string) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(code.trim().toUpperCase()), 300);
    return () => clearTimeout(t);
  }, [code]);
  return useQuery({
    queryKey: ['codes', 'exists', debounced],
    enabled: debounced.length >= 2,
    queryFn: () =>
      unwrap(api.GET('/codes', { params: { query: { q: debounced, limit: 20 } } })).then((r) => r.items.find((c) => c.code.toUpperCase() === debounced)),
    staleTime: 30_000,
  });
}

/** Mã đã duyệt (dùng được để đặt tên). */
export function useApprovedCodes(departmentId?: string) {
  return useQuery({
    queryKey: ['codes', 'approved', departmentId ?? null],
    queryFn: () =>
      unwrap(api.GET('/codes', { params: { query: { status: 'approved', departmentId: departmentId || undefined, limit: 200, sort: 'code' } } })).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}
