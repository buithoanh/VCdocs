import type { Models } from '../db/models';
import type { FakeGoogle } from '../google/fake/fake-google';
import { FOLDER_MIME, GDOC_MIME } from '../google/ports';
import { addDemoDirectory, addDemoDrive, BM_KHUNG, DEMO_DOMAIN } from './demo-seed';

/**
 * Google giả chỉ giữ trong bộ nhớ (hoặc file trạng thái). Khởi động lại trên CSDL
 * đã có dữ liệu mà mất trạng thái giả thì dựng lại từ CSDL: danh bạ, nhóm, drive,
 * thư mục và file đã đăng ký (giữ đúng id cũ) để đăng nhập, xem cây được ngay.
 * Nội dung file không khôi phục được (chỉ còn bản trống, riêng BM khung có chỗ giữ).
 */
export async function rebuildFakeFromDb(m: Models, fake: FakeGoogle) {
  const companies = await m.Company.find({}).lean<any[]>();
  for (const c of companies) {
    const cid = c._id;
    if (c.domain === DEMO_DOMAIN) addDemoDirectory(fake);
    // Người dùng khác mẫu (vd đồng bộ thêm) kèm nhóm đã lưu
    const users = await m.User.find({ companyId: cid }).lean<any[]>();
    for (const u of users) {
      if (!fake.world.users.some((x) => x.email === u.email)) fake.addUser({ email: u.email, name: u.name, title: u.title, suspended: u.status === 'left' });
      for (const g of u.groupEmails ?? []) {
        if (!fake.world.groups.some((x) => x.email === g)) fake.addGroup(g, g.split('@')[0], []);
        fake.addGroupMember(g, u.email);
      }
    }
    for (const d of await m.Department.find({ companyId: cid }).lean<any[]>()) {
      if (!fake.world.drives.some((x) => x.driveId === d.driveId)) addDemoDrive(fake, d, d.driveId);
    }
    // Thư mục: cha trước con
    const folders = await m.Folder.find({ companyId: cid }).lean<any[]>();
    const byId = new Map(folders.map((f) => [String(f._id), f]));
    const depth = (f: any): number => (f.parentId && byId.get(String(f.parentId)) ? 1 + depth(byId.get(String(f.parentId))) : 0);
    for (const f of folders.sort((a, b) => depth(a) - depth(b))) {
      const parent = f.parentId ? byId.get(String(f.parentId)) : undefined;
      fake.restoreFile({ fileId: f.googleId, name: f.name, mimeType: FOLDER_MIME, parents: [parent?.googleId ?? f.driveId], driveId: f.driveId });
    }
    const folderGoogle = (id: any) => (id ? byId.get(String(id))?.googleId : undefined);
    for (const d of await m.Document.find({ companyId: cid }).lean<any[]>()) {
      const parent = folderGoogle(d.folderId) ?? d.driveId;
      const isFrame = /^BM-VCPV-0[2-4]$/.test(d.code ?? '');
      for (const [id, pdf] of [
        [d.fileId, false],
        [d.current?.fileId, false],
        [d.current?.pdfFileId, true],
      ] as [string | undefined, boolean][]) {
        if (id) fake.restoreFile({ fileId: id, name: `${d.code ?? ''} ${d.title}${pdf ? '.pdf' : ''}`.trim(), mimeType: pdf ? 'application/pdf' : GDOC_MIME, parents: [parent], driveId: d.driveId, text: isFrame ? BM_KHUNG : '', locked: d.lock?.isLocked || pdf });
      }
    }
    for (const r of await m.Record.find({ companyId: cid }).lean<any[]>()) {
      const parent = folderGoogle(r.folderId) ?? r.driveId;
      if (r.fileId) fake.restoreFile({ fileId: r.fileId, name: r.fileName ?? r.subject, mimeType: r.mimeType ?? GDOC_MIME, parents: [parent], driveId: r.driveId, locked: r.lock?.isLocked });
      if (r.finalized?.pdfFileId) fake.restoreFile({ fileId: r.finalized.pdfFileId, name: `${r.fileName}.pdf`, mimeType: 'application/pdf', parents: [parent], driveId: r.driveId, locked: true });
      if (r.scanFileId) fake.restoreFile({ fileId: r.scanFileId, name: `${r.fileName} – bản scan`, mimeType: 'application/pdf', parents: [parent], driveId: r.driveId });
    }
  }
}
