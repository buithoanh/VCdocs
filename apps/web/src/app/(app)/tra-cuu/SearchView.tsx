'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/api/client';
import type { SearchHit } from '@/api/types';
import { Pagination } from '@/components/DataTable';
import { DeptName, DeptSelect } from '@/components/pickers';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge, Loading, PageHeader, QueryState, Tabs, TextField } from '@/components/ui';
import { formatMonth } from '@/lib/format';
import { docStatusLabel, recordStatusLabel } from '@/lib/labels';

type Scope = 'all' | 'documents' | 'records';
const LIMIT = 30;

/** Mã tài liệu dạng Loại-Mã phòng-Số, ví dụ QT-MKT-01. */
export function looksLikeDocumentCode(q: string) {
  return /^(QD|QT|HD|BM)-[A-Z0-9]+-\d+$/i.test(q.trim());
}

export function hitHref(h: SearchHit) {
  return h.objectType === 'document' ? `/tai-lieu/${h.id}` : `/ho-so/${h.id}`;
}

function statusText(h: SearchHit) {
  if (!h.status) return null;
  const label = h.objectType === 'document' ? docStatusLabel[h.status as keyof typeof docStatusLabel] : recordStatusLabel[h.status as keyof typeof recordStatusLabel];
  return <Badge status={h.status}>{label ?? h.status}</Badge>;
}

export function SearchView() {
  const { me } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const [input, setInput] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [scope, setScope] = useState<Scope>('all');
  const [departmentId, setDept] = useState('');
  const [workMonth, setMonth] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [showSuggest, setShowSuggest] = useState(false);

  // Ô tìm ở thanh trên đổi ?q= khi đang ở trang này.
  useEffect(() => {
    const fromUrl = params.get('q') ?? '';
    setInput(fromUrl);
    setQ(fromUrl);
    setPage(1);
  }, [params]);

  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 200);
    return () => clearTimeout(t);
  }, [input]);
  const suggest = useQuery({
    queryKey: ['search', 'suggest', debounced],
    enabled: showSuggest && debounced.length >= 2 && debounced !== q,
    queryFn: () => unwrap(api.GET('/search/suggest', { params: { query: { q: debounced } } })).then((r) => r.items),
    staleTime: 30_000,
  });

  const results = useQuery({
    queryKey: ['search', { q, scope, departmentId, workMonth, mine, page }],
    enabled: q.trim().length > 0,
    queryFn: () =>
      unwrap(
        api.GET('/search', {
          params: {
            query: { q: q.trim(), scope, departmentId: departmentId || undefined, workMonth: workMonth || undefined, createdBy: mine ? me.user.id : undefined, page, limit: LIMIT },
          },
        }),
      ),
    placeholderData: (prev) => prev,
  });

  function submit(value: string) {
    setShowSuggest(false);
    const v = value.trim();
    router.replace(v ? `/tra-cuu?q=${encodeURIComponent(v)}` : '/tra-cuu');
    setQ(v);
    setPage(1);
  }

  return (
    <>
      <PageHeader title="Tra cứu" subtitle="Tìm theo mã, từ trong tên, biển số, số PO, mã lớp… Chỉ hiện những gì bạn được xem." />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="card"
      >
        <div className="field" style={{ position: 'relative' }}>
          <label htmlFor="o-tim">Tìm</label>
          <input
            id="o-tim"
            type="search"
            autoFocus
            autoComplete="off"
            value={input}
            onChange={(e) => (setInput(e.target.value), setShowSuggest(true))}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            placeholder="QT-MKT-01, báo cáo tuần, 51G-123.45…"
          />
          {showSuggest && suggest.data && suggest.data.length > 0 && (
            <ul className="list" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', boxShadow: 'var(--shadow)' }}>
              {suggest.data.map((h) => (
                <li key={`${h.objectType}-${h.id}`} className="list-item">
                  <Link href={hitHref(h)}>
                    {h.code && <span className="mono">{h.code} </span>}
                    {h.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn btn-primary" type="submit">
          Tìm
        </button>
      </form>

      {looksLikeDocumentCode(q) && (
        <p>
          <Link className="btn btn-secondary" href={`/tai-lieu/ma/${encodeURIComponent(q.trim().toUpperCase())}`}>
            Mở bản đang hiệu lực của {q.trim().toUpperCase()}
          </Link>
        </p>
      )}

      <Tabs
        value={scope}
        onChange={(v) => (setScope(v), setPage(1))}
        tabs={[
          { value: 'all', label: 'Tất cả' },
          { value: 'documents', label: 'Tài liệu' },
          { value: 'records', label: 'Hồ sơ' },
        ]}
      />
      <div className="filters">
        <DeptSelect value={departmentId} onChange={(v) => (setDept(v), setPage(1))} allowAll />
        <TextField label="Tháng công việc" type="month" value={workMonth} onChange={(v) => (setMonth(v), setPage(1))} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={mine} onChange={(e) => (setMine(e.target.checked), setPage(1))} />
        Chỉ của tôi
      </label>

      {!q ? (
        <p className="empty">Nhập từ cần tìm.</p>
      ) : results.isLoading ? (
        <Loading text="Đang tìm…" />
      ) : (
        <QueryState q={results} empty={results.data?.items.length === 0}>
          <p className="muted small">{results.data?.total ?? 0} kết quả</p>
          <ul className="list">
            {results.data?.items.map((h) => (
              <li key={`${h.objectType}-${h.id}`} className="list-item">
                <div className="list-item-head">
                  <Link href={hitHref(h)}>
                    {h.code && <span className="mono">{h.code} </span>}
                    <strong>{h.title}</strong>
                  </Link>
                  {statusText(h)}
                </div>
                <div className="muted small">
                  {h.objectType === 'document' ? 'Tài liệu' : 'Hồ sơ'}
                  {h.departmentId && (
                    <>
                      {' · '}
                      <DeptName id={h.departmentId} />
                    </>
                  )}
                  {h.workMonth && <> · Tháng {formatMonth(h.workMonth)}</>}
                  {h.identifier && <> · {h.identifier}</>}
                </div>
              </li>
            ))}
          </ul>
          {results.data && <Pagination page={page} limit={LIMIT} total={results.data.total} onPage={setPage} />}
        </QueryState>
      )}
    </>
  );
}
