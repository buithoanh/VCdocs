import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import ApprovalsPage from '@/app/(app)/phe-duyet/page';
import { DocumentView } from '@/app/(app)/tai-lieu/[id]/DocumentView';
import { DeptName, UserName } from '@/components/pickers';
import { JobProgress, jobResultLink } from '@/components/jobs';
import { approval, doc, ids, makeJob, people } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { API, server } from '@/test/server';
import { useDepartments } from '@/api/queries';
import { allowedFolderKinds } from './folders';
import { jobSummaryText, jobTypeText } from './labels';

describe('hợp đồng 1.2 (D15–D20)', () => {
  it('D15: đồng ý phiếu huỷ bỏ tài liệu thì theo dõi việc nền "Huỷ bỏ tài liệu"', async () => {
    const wd = { ...approval, objectType: 'document_withdrawal' as const, objectTitle: 'QT-MKT-01 Quy trình SEO' };
    server.use(
      http.get(`${API}/approvals`, () => HttpResponse.json({ page: 1, limit: 20, total: 1, items: [wd], people })),
      http.post(`${API}/approvals/:id/decide`, () => HttpResponse.json({ ...wd, status: 'approved', allowedActions: [], jobId: ids.job, people })),
      http.get(`${API}/jobs/:id`, () => HttpResponse.json(makeJob('running', { type: 'document.withdraw', result: undefined }))),
    );
    renderApp(<ApprovalsPage />, { roles: ['R4'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Đồng ý' }).at(-1)!);
    expect(await screen.findByLabelText('Việc đang chạy')).toHaveTextContent('Huỷ bỏ tài liệu');
    expect(jobTypeText('document.withdraw')).toBe('Huỷ bỏ tài liệu');
  });

  it('D16: summary thành câu ngắn; việc không có result thì không có nút Mở', async () => {
    expect(jobSummaryText({ created: 12, skipped: 1 })).toBe('Đã tạo 12 · bỏ qua 1.');
    expect(jobSummaryText({})).toBeUndefined();
    expect(jobResultLink(makeJob('done', { type: 'google.sync', result: undefined }))).toBeUndefined();
    server.use(http.get(`${API}/jobs/:id`, () => HttpResponse.json(makeJob('done', { type: 'google.sync', result: undefined, summary: { updated: 5 } }))));
    renderApp(<JobProgress jobId={ids.job} />);
    expect(await screen.findByText('Đã cập nhật 5.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('D17: tên người lấy từ people của chi tiết đối tượng', async () => {
    renderApp(
      <>
        <DocumentView id={ids.doc} />
        <UserName id={ids.boss} />
      </>,
      { roles: ['R4'] },
    );
    await screen.findByRole('button', { name: 'Trình duyệt' });
    expect(screen.getAllByText('Nguyễn Văn A').length).toBeGreaterThan(0);
  });

  it('D18: "Xem góp ý" theo hành động feedback, bấm mới tải số nhận xét', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/documents/:id`, () => HttpResponse.json({ ...doc, allowedActions: ['feedback'] })),
      http.get(`${API}/documents/:id/feedback`, () => ((calls += 1), HttpResponse.json({ openComments: 2 }))),
    );
    renderApp(<DocumentView id={ids.doc} />, { roles: ['R6'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Xem góp ý' }));
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('D18: không có hành động feedback thì không có nút, không gọi /feedback', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/documents/:id`, () => HttpResponse.json({ ...doc, status: 'feedback', allowedActions: [] })),
      http.get(`${API}/documents/:id/feedback`, () => ((calls += 1), HttpResponse.json({ openComments: 2 }))),
    );
    renderApp(<DocumentView id={ids.doc} />);
    await screen.findByText('Lịch sử phiên bản');
    expect(screen.queryByRole('button', { name: 'Xem góp ý' })).toBeNull();
    expect(calls).toBe(0);
  });

  it('D19: tên trưởng phòng lấy từ people của GET /departments', async () => {
    function Head() {
      const q = useDepartments();
      return q.data ? <UserName id={ids.boss} /> : <DeptName id={ids.dept} />;
    }
    server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: [], people: { [ids.boss]: { id: ids.boss, name: 'Trưởng phòng D19', email: 'tp@vcprosperous.com' } } })));
    renderApp(<Head />);
    await waitFor(() => expect(screen.getByText('Trưởng phòng D19')).toBeInTheDocument());
  });

  it('D20: gốc drive không có năm, tháng, đối tượng', () => {
    expect(allowedFolderKinds(true)).not.toContain('year');
    expect(allowedFolderKinds(true)).toEqual(expect.arrayContaining(['docs', 'plan_report', 'operations', 'area', 'project', 'closed', 'archive']));
    expect(allowedFolderKinds(false)).toEqual(expect.arrayContaining(['year', 'month', 'entity']));
  });
});

describe('ghép tên thư mục giống máy chủ', () => {
  it('mã đã chứa tên ngắn thì không lặp', async () => {
    const { previewFolderName } = await import('./folders');
    expect(previewFolderName('11', 'SAN-TTS', 'TTS', 'TikTok Shop')).toBe('11 SAN-TTS TikTok Shop');
    expect(previewFolderName('01', 'SEO', 'PTDA', 'phutungducanh.com')).toBe('01 SEO-PTDA phutungducanh.com');
    expect(previewFolderName('', '', '2026', '')).toBe('2026');
  });

  it('tóm tắt bỏ trường kỹ thuật', () => {
    expect(jobSummaryText({ googleId: 'x', name: '11 SAN' })).toBeUndefined();
    expect(jobSummaryText({ created: 1200 })).toBe('Đã tạo 1.200.');
  });
});
