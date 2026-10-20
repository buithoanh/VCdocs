'use client';

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, unwrap } from '@/api/client';
import type { Job } from '@/api/types';
import { jobStatusLabel, jobSummaryText } from '@/lib/labels';
import { useToast } from './providers/ToastProvider';

/** Việc 202 trả jobId; theo dõi GET /jobs/{id} tới khi xong hoặc lỗi. */
export function useJob(jobId: string | null | undefined, intervalMs = 1500) {
  return useQuery({
    queryKey: ['job', jobId],
    enabled: !!jobId,
    queryFn: () => unwrap(api.GET('/jobs/{id}', { params: { path: { id: jobId! } } })),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'done' || s === 'failed' ? false : intervalMs;
    },
    retry: 2,
  });
}

export function isJobFinished(job?: Job) {
  return job?.status === 'done' || job?.status === 'failed';
}

export function jobErrorText(job?: Job): string {
  return job?.error?.error?.message || job?.steps?.find((s) => s.status === 'failed')?.error || 'Việc chạy nền bị lỗi.';
}

/** Đường dẫn tới kết quả của việc (D11): đối tượng VCdocs, hoặc file Google (fileId / url). */
export function jobResultLink(job?: Job): { href: string; text: string; external?: boolean } | undefined {
  const r = job?.result;
  if (!r) return undefined;
  if ('objectType' in r && r.objectId) {
    const map: Record<typeof r.objectType, [string, string]> = {
      record: ['/ho-so/', 'Mở hồ sơ'],
      document: ['/tai-lieu/', 'Mở tài liệu'],
      folder: ['/thu-muc?folder=', 'Mở thư mục'],
      approval: ['/phe-duyet/', 'Mở phiếu'],
      external_share: ['/chia-se?id=', 'Mở sổ chia sẻ'],
      code: ['/bang-ma?id=', 'Mở Bảng mã'],
      record_type: ['/danh-muc-ho-so/', 'Mở loại hồ sơ'],
    };
    const m = map[r.objectType];
    return m ? { href: `${m[0]}${r.objectId}`, text: m[1] } : undefined;
  }
  if ('fileId' in r && r.fileId) {
    const url = r.url && /^https:\/\//.test(r.url) ? r.url : `https://drive.google.com/open?id=${encodeURIComponent(r.fileId)}`;
    return { href: url, text: 'Mở file trên Drive', external: true };
  }
  return undefined;
}

/** Thanh tiến độ cho một việc, dùng ngay trong trang/hộp thoại. */
export function JobProgress({ jobId, onFinished }: { jobId: string; onFinished?: (job: Job) => void }) {
  const q = useJob(jobId);
  const job = q.data;
  const doneRef = useRef(false);
  useEffect(() => {
    if (job && isJobFinished(job) && !doneRef.current) {
      doneRef.current = true;
      onFinished?.(job);
    }
  }, [job, onFinished]);
  if (q.isError) return <p className="error-text">Không xem được tiến độ. Bạn có thể xem lại ở mục Việc đang chạy.</p>;
  if (!job) return <p className="muted">Đang gửi yêu cầu…</p>;
  const link = jobResultLink(job);
  return (
    <div className="job" aria-live="polite">
      <div className="job-head">
        <strong>{jobStatusLabel[job.status]}</strong>
        <span className="muted">{job.progress}%</span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
        <div className={`progress-bar ${job.status === 'failed' ? 'is-failed' : ''}`} style={{ width: `${job.progress}%` }} />
      </div>
      {job.steps?.length > 0 && (
        <ol className="job-steps">
          {job.steps.map((s, i) => (
            <li key={i} className={`job-step is-${s.status}`}>
              <span className="job-step-dot" aria-hidden />
              {s.name}
              {s.error && <span className="error-text"> – {s.error}</span>}
            </li>
          ))}
        </ol>
      )}
      {job.status === 'failed' && <p className="error-text">{jobErrorText(job)}</p>}
      {job.status === 'done' && jobSummaryText(job.summary) && <p>{jobSummaryText(job.summary)}</p>}
      {job.status === 'done' && link && (
        link.external ? (
          <a className="btn btn-secondary" href={link.href} target="_blank" rel="noreferrer">
            {link.text}
          </a>
        ) : (
          <Link className="btn btn-secondary" href={link.href}>
            {link.text}
          </Link>
        )
      )}
    </div>
  );
}

/* ── Theo dõi việc nền toàn cục: hiện góc màn hình, báo khi xong ── */

type Tracked = { jobId: string; label: string; invalidate?: QueryKey[]; onDone?: (job: Job) => void };
type JobsApi = { track: (t: Tracked) => void };
const JobsContext = createContext<JobsApi | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Tracked[]>([]);
  const track = useCallback((t: Tracked) => setItems((xs) => (xs.some((x) => x.jobId === t.jobId) ? xs : [...xs, t])), []);
  const remove = useCallback((id: string) => setItems((xs) => xs.filter((x) => x.jobId !== id)), []);
  return (
    <JobsContext.Provider value={{ track }}>
      {children}
      {items.length > 0 && (
        <div className="job-tray" aria-label="Việc đang chạy">
          {items.map((t) => (
            <TrayItem key={t.jobId} t={t} onClose={() => remove(t.jobId)} />
          ))}
        </div>
      )}
    </JobsContext.Provider>
  );
}

function TrayItem({ t, onClose }: { t: Tracked; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useJob(t.jobId);
  const job = q.data;
  const reported = useRef(false);
  useEffect(() => {
    if (!job || !isJobFinished(job) || reported.current) return;
    reported.current = true;
    for (const k of t.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    if (job.status === 'done') {
      const link = jobResultLink(job);
      toast.success(`${t.label}: xong.${jobSummaryText(job.summary) ? ` ${jobSummaryText(job.summary)}` : ''}`, link && !link.external ? link : undefined);
    } else {
      toast.error(`${t.label}: ${jobErrorText(job)}`);
    }
    t.onDone?.(job);
  }, [job, t, qc, toast]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const status = job?.status;
  useEffect(() => {
    if (status !== 'done' && status !== 'failed') return;
    const timer = setTimeout(() => closeRef.current(), status === 'done' ? 4000 : 15000);
    return () => clearTimeout(timer);
  }, [status]);
  const link = job?.status === 'done' ? jobResultLink(job) : undefined;
  return (
    <div className="job-tray-item">
      <div className="job-head">
        <strong>{t.label}</strong>
        <button className="toast-close" aria-label="Ẩn" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="progress">
        <div className={`progress-bar ${job?.status === 'failed' ? 'is-failed' : ''}`} style={{ width: `${job?.progress ?? 5}%` }} />
      </div>
      <div className="muted small">
        {job ? jobStatusLabel[job.status] : 'Đang gửi…'}
        {job?.status === 'failed' && ` – ${jobErrorText(job)}`}
        {link?.external && (
          <>
            {' · '}
            <a href={link.href} target="_blank" rel="noreferrer">
              {link.text}
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export function useJobs(): JobsApi {
  const v = useContext(JobsContext);
  if (!v) throw new Error('useJobs phải nằm trong JobsProvider');
  return v;
}
