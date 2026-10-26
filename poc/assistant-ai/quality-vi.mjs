// Chat19: fixed Vietnamese prompts through the real Assistant task types (as
// member-a, CPU alias) to judge language quality by hand. Records output and
// latency in evidence/quality-vi.json; the handoff carries the notes.
import { client, runTask, writeEvidence } from './lib.mjs';

const c = await client('member-a');
const prompts = [
  { id: 'summary', type: 'core:text2text:summary', input: { input: 'Từ ngày 01/01/2027, công ty áp dụng chính sách làm việc linh hoạt: nhân viên được làm việc từ xa tối đa hai ngày mỗi tuần, nhưng phải có mặt tại văn phòng vào thứ Hai để họp giao ban. Trưởng phòng chịu trách nhiệm duyệt lịch làm việc từ xa trước thứ Sáu tuần trước. Nhân viên mới trong ba tháng thử việc chưa áp dụng chính sách này. Mọi trao đổi công việc phải qua kênh chat nội bộ, không dùng ứng dụng cá nhân. Phòng Nhân sự sẽ đánh giá lại chính sách sau sáu tháng.' } },
  { id: 'draft-notice', type: 'core:text2text', input: { input: 'Soạn nháp một thông báo ngắn (dưới 120 chữ) gửi toàn phòng về việc kiểm kê kho vào sáng thứ Bảy 14/11/2026, yêu cầu mọi người có mặt lúc 7h30 và mang theo phiếu nhập xuất tháng 10. Giọng văn lịch sự, rõ ràng. Chỉ soạn nháp, không gửi.' } },
  { id: 'proofread-no-diacritics', type: 'core:text2text:proofread', input: { input: 'Kinh gui anh chi, chung toi xin thong bao lich hop giao ban se doi sang chieu thu nam luc 2 gio. Mong moi nguoi sap xep tham du day du.' } },
  { id: 'reformulate-formal', type: 'core:text2text:reformulation', input: { input: 'mai họp nhé mọi người, ai không đến được thì báo sớm giùm, đừng để sát giờ mới nói.' } },
  { id: 'headline', type: 'core:text2text:headline', input: { input: 'Phòng Kinh doanh miền Trung vượt chỉ tiêu quý 3 nhờ mở thêm hai đại lý tại Huế và Quảng Ngãi, doanh thu tăng 18% so với cùng kỳ.' } },
  { id: 'qa-general', type: 'core:text2text', input: { input: 'Giải thích ngắn gọn (3–4 câu) sự khác nhau giữa "hoá đơn đỏ" và "phiếu thu" trong doanh nghiệp Việt Nam.' } },
  { id: 'topics', type: 'core:text2text:topics', input: { input: 'Cuộc họp bàn về ngân sách marketing quý 1, tuyển thêm hai nhân viên kho, và thay nhà cung cấp bao bì do giao hàng trễ.' } },
];
const results = [];
for (const p of prompts) {
  const r = await runTask(c, p.type, p.input);
  results.push({ id: p.id, type: p.type, input: p.input.input, ms: r.ms, status: r.status, output: r.output?.output });
  console.log(`--- ${p.id} (${p.type}) ${r.ms} ms\n${r.output?.output}`);
}
await writeEvidence('quality-vi.json', { model: 'vcws-qwen3-4b-cpu (qwen3:4b-instruct-2507-q4_K_M, num_gpu 0, temperature 0.2)', results });
