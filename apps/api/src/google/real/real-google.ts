import * as fs from 'fs';
import { Readable } from 'stream';
import { auth, drive as driveApi, drive_v3 } from '@googleapis/drive';
import { docs as docsApi } from '@googleapis/docs';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { admin as adminApi } from '@googleapis/admin';
import { gmail as gmailApi } from '@googleapis/gmail';
import { GoogleError } from '../../common/errors';
import type { AppConfig } from '../../config/config';
import {
  DriveFileMeta,
  DrivePermission,
  FOLDER_MIME,
  GDOC_MIME,
  GooglePorts,
  IdTokenClaims,
  ShareActivity,
} from '../ports';

/**
 * Bản thật gọi Google bằng googleapis. Chưa chạy với tài khoản thật (chưa có
 * tài khoản thử nghiệm) – xem README mục "Những gì còn dùng bản giả".
 * Hai tài khoản máy: ghi (thao tác) và đọc (quét); cả hai uỷ quyền toàn tên miền.
 */
const WRITE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
];
const ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
  'https://www.googleapis.com/auth/admin.reports.audit.readonly',
];
const FILE_FIELDS =
  'id,name,mimeType,driveId,parents,description,createdTime,modifiedTime,webViewLink,trashed,md5Checksum,size,contentRestrictions,downloadRestrictions,lastModifyingUser(emailAddress)';

function readKey(v?: string): { client_email: string; private_key: string } {
  if (!v) throw new Error('Thiếu khoá tài khoản máy Google (GOOGLE_SA_WRITE_KEY / GOOGLE_SA_READ_KEY)');
  let raw = v.trim();
  if (!raw.startsWith('{')) {
    raw = fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : Buffer.from(raw, 'base64').toString('utf8');
  }
  return JSON.parse(raw);
}

async function g<T>(op: string, fn: () => Promise<T>, retries = 3): Promise<T> {
  // Lỗi tạm thời (429, 5xx) tự thử lại có giãn cách (BA 9.3)
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.code ?? e?.response?.status;
      if (i < retries && (status === 429 || (status >= 500 && status < 600))) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
        continue;
      }
      throw new GoogleError(`${op}: ${e?.message ?? e}`, typeof status === 'number' ? status : undefined);
    }
  }
}

function toMeta(f: drive_v3.Schema$File): DriveFileMeta {
  const cr = f.contentRestrictions?.[0];
  return {
    fileId: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    driveId: f.driveId ?? undefined,
    parents: f.parents ?? [],
    description: f.description ?? undefined,
    createdTime: f.createdTime!,
    modifiedTime: f.modifiedTime ?? undefined,
    createdByEmail: f.lastModifyingUser?.emailAddress ?? undefined,
    webViewLink: f.webViewLink ?? undefined,
    trashed: f.trashed ?? false,
    md5Checksum: f.md5Checksum ?? undefined,
    size: f.size ? Number(f.size) : undefined,
    contentRestriction: cr ? { readOnly: !!cr.readOnly, reason: cr.reason ?? undefined, ownerRestricted: !!(cr as any).ownerRestricted } : undefined,
    downloadRestricted: !!(f as any).downloadRestrictions?.itemDownloadRestriction?.restrictedForReaders,
  };
}

export function createRealGoogle(cfg: AppConfig): GooglePorts {
  const writeKey = readKey(cfg.google.saWriteKey);
  const readKeyJson = cfg.google.saReadKey ? readKey(cfg.google.saReadKey) : writeKey;
  const writeAuth = new auth.JWT({ email: writeKey.client_email, key: writeKey.private_key, scopes: WRITE_SCOPES });
  const mailAuth = new auth.JWT({ email: writeKey.client_email, key: writeKey.private_key, scopes: WRITE_SCOPES, subject: cfg.google.mailFrom });
  const adminAuth = new auth.JWT({ email: readKeyJson.client_email, key: readKeyJson.private_key, scopes: ADMIN_SCOPES, subject: cfg.google.adminSubject });
  const oauth = new auth.OAuth2(cfg.google.clientId, cfg.google.clientSecret);
  const d = driveApi({ version: 'v3', auth: writeAuth as any });
  const dc = docsApi({ version: 'v1', auth: writeAuth as any });
  const sh = sheetsApi({ version: 'v4', auth: writeAuth as any });
  const dir = adminApi({ version: 'directory_v1', auth: adminAuth as any });
  const rep = adminApi({ version: 'reports_v1', auth: adminAuth as any });
  const gm = gmailApi({ version: 'v1', auth: mailAuth as any });
  const all = { supportsAllDrives: true };

  async function paged<T>(fetch: (pageToken?: string) => Promise<{ items: T[]; next?: string | null }>): Promise<T[]> {
    const out: T[] = [];
    let token: string | undefined;
    do {
      const r = await fetch(token);
      out.push(...r.items);
      token = r.next ?? undefined;
    } while (token);
    return out;
  }

  return {
    mode: 'real',
    auth: {
      buildAuthUrl: (p) =>
        oauth.generateAuthUrl({
          scope: ['openid', 'email', 'profile'],
          redirect_uri: p.redirectUri,
          state: p.state,
          nonce: p.nonce,
          hd: p.hd,
          prompt: 'select_account',
          access_type: 'online',
        } as any),
      exchangeCode: async (p) => {
        const { tokens } = await g('oauth.getToken', () => oauth.getToken({ code: p.code, redirect_uri: p.redirectUri }));
        if (!tokens.id_token) throw new GoogleError('Google không trả id_token');
        const ticket = await g('oauth.verifyIdToken', () => oauth.verifyIdToken({ idToken: tokens.id_token!, audience: cfg.google.clientId }));
        const c = ticket.getPayload()!;
        return { sub: c.sub, email: c.email!, email_verified: c.email_verified, hd: c.hd, name: c.name, nonce: (c as any).nonce } as IdTokenClaims;
      },
    },
    directory: {
      listUsers: (domain) =>
        g('directory.users.list', () =>
          paged(async (pageToken) => {
            const r = await dir.users.list({ domain, maxResults: 500, pageToken });
            return {
              items: (r.data.users ?? []).map((u) => ({
                email: u.primaryEmail!,
                name: u.name?.fullName ?? u.primaryEmail!,
                title: (u.organizations as any)?.[0]?.title,
                suspended: !!u.suspended,
              })),
              next: r.data.nextPageToken,
            };
          }),
        ),
      getUser: async (email) => {
        try {
          const r = await dir.users.get({ userKey: email });
          return { email: r.data.primaryEmail!, name: r.data.name?.fullName ?? email, suspended: !!r.data.suspended };
        } catch (e: any) {
          if ((e?.code ?? e?.response?.status) === 404) return undefined;
          throw new GoogleError(`directory.users.get: ${e?.message}`);
        }
      },
      listGroups: (domain) =>
        g('directory.groups.list', () =>
          paged(async (pageToken) => {
            const r = await dir.groups.list({ domain, maxResults: 200, pageToken });
            return { items: (r.data.groups ?? []).map((x) => ({ email: x.email!, name: x.name ?? x.email! })), next: r.data.nextPageToken };
          }),
        ),
      listGroupMembers: (groupEmail) =>
        g('directory.members.list', () =>
          paged(async (pageToken) => {
            const r = await dir.members.list({ groupKey: groupEmail, maxResults: 200, pageToken });
            return { items: (r.data.members ?? []).map((m) => m.email!).filter(Boolean), next: r.data.nextPageToken };
          }),
        ),
      listUserGroups: (email) =>
        g('directory.groups.list(userKey)', () =>
          paged(async (pageToken) => {
            const r = await dir.groups.list({ userKey: email, maxResults: 200, pageToken });
            return { items: (r.data.groups ?? []).map((x) => x.email!), next: r.data.nextPageToken };
          }),
        ),
    },
    drive: {
      listDrives: () =>
        g('drives.list', () =>
          paged(async (pageToken) => {
            const r = await d.drives.list({ pageSize: 100, pageToken });
            return { items: (r.data.drives ?? []).map((x) => ({ driveId: x.id!, name: x.name! })), next: r.data.nextPageToken };
          }),
        ),
      listDrivePermissions: (driveId) =>
        g('permissions.list(drive)', () =>
          paged(async (pageToken) => {
            const r = await d.permissions.list({ fileId: driveId, ...all, useDomainAdminAccess: false, pageToken, fields: 'nextPageToken,permissions(id,type,emailAddress,domain,displayName,role,expirationTime)' });
            return {
              items: (r.data.permissions ?? []).map(
                (p) => ({ permissionId: p.id!, type: p.type as any, emailAddress: p.emailAddress ?? undefined, domain: p.domain ?? undefined, displayName: p.displayName ?? undefined, role: p.role as any, expirationTime: p.expirationTime ?? undefined }) as DrivePermission,
              ),
              next: r.data.nextPageToken,
            };
          }),
        ),
      getFile: async (fileId) => {
        try {
          const r = await d.files.get({ fileId, ...all, fields: FILE_FIELDS });
          return toMeta(r.data);
        } catch (e: any) {
          if ((e?.code ?? e?.response?.status) === 404) return undefined;
          throw new GoogleError(`files.get: ${e?.message}`);
        }
      },
      listFiles: (driveId, opts) =>
        g('files.list', () =>
          paged(async (pageToken) => {
            const q = `trashed = false and mimeType ${opts?.foldersOnly ? '=' : '!='} '${FOLDER_MIME}'`;
            const r = await d.files.list({ corpora: 'drive', driveId, includeItemsFromAllDrives: true, ...all, q, pageSize: 1000, pageToken, fields: `nextPageToken,files(${FILE_FIELDS})` });
            return { items: (r.data.files ?? []).map(toMeta), next: r.data.nextPageToken };
          }),
        ),
      createFolder: (p) =>
        g('files.create(folder)', async () => toMeta((await d.files.create({ ...all, fields: FILE_FIELDS, requestBody: { name: p.name, mimeType: FOLDER_MIME, parents: [p.parentGoogleId ?? p.driveId] } })).data)),
      createEmptyDoc: (p) =>
        g('files.create(doc)', async () => toMeta((await d.files.create({ ...all, fields: FILE_FIELDS, requestBody: { name: p.name, mimeType: p.mimeType ?? GDOC_MIME, parents: [p.parentGoogleId] } })).data)),
      copyFile: (p) =>
        g('files.copy', async () => toMeta((await d.files.copy({ fileId: p.fileId, ...all, fields: FILE_FIELDS, requestBody: { name: p.name, parents: [p.parentGoogleId] } })).data)),
      uploadFile: (p) =>
        g('files.create(upload)', async () =>
          toMeta(
            (
              await d.files.create({
                ...all,
                fields: FILE_FIELDS,
                requestBody: { name: p.name, parents: [p.parentGoogleId], mimeType: p.convertTo ?? p.mimeType, description: p.description },
                media: { mimeType: p.mimeType, body: Readable.from(p.content) },
              })
            ).data,
          ),
        ),
      updateFile: (fileId, p) =>
        g('files.update', async () =>
          toMeta(
            (
              await d.files.update({
                fileId,
                ...all,
                fields: FILE_FIELDS,
                addParents: p.addParents?.join(','),
                removeParents: p.removeParents?.join(','),
                requestBody: { name: p.name, description: p.description },
              })
            ).data,
          ),
        ),
      setLock: (fileId, p) =>
        g('files.update(contentRestrictions)', async () => {
          await d.files.update({
            fileId,
            ...all,
            requestBody: { contentRestrictions: [p.locked ? { readOnly: true, reason: p.reason, ownerRestricted: true } as any : { readOnly: false }] },
          });
        }),
      setDownloadRestriction: (fileId, restricted) =>
        g('files.update(downloadRestrictions)', async () => {
          await d.files.update({
            fileId,
            ...all,
            requestBody: { downloadRestrictions: { itemDownloadRestriction: { restrictedForReaders: restricted, restrictedForWriters: restricted } } } as any,
          });
        }),
      latestRevision: (fileId) =>
        g('revisions.list', async () => {
          const revs = await paged(async (pageToken) => {
            const r = await d.revisions.list({ fileId, pageSize: 1000, pageToken, fields: 'nextPageToken,revisions(id,modifiedTime)' });
            return { items: r.data.revisions ?? [], next: r.data.nextPageToken };
          });
          const last = revs[revs.length - 1];
          if (!last) throw new GoogleError('File không có phiên bản');
          return { revisionId: last.id!, modifiedTime: last.modifiedTime! };
        }),
      exportPdf: (fileId) =>
        g('files.export', async () => {
          const meta = await d.files.get({ fileId, ...all, fields: 'mimeType' });
          if (meta.data.mimeType === 'application/pdf') {
            const r = await d.files.get({ fileId, ...all, alt: 'media' }, { responseType: 'arraybuffer' });
            return Buffer.from(r.data as any);
          }
          const r = await d.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
          return Buffer.from(r.data as any);
        }),
      countOpenComments: (fileId) =>
        g('comments.list', async () => {
          const items = await paged(async (pageToken) => {
            const r = await d.comments.list({ fileId, pageSize: 100, pageToken, fields: 'nextPageToken,comments(id,resolved,deleted)' });
            return { items: r.data.comments ?? [], next: r.data.nextPageToken };
          });
          return items.filter((c) => !c.resolved && !c.deleted).length;
        }),
      createPermission: (fileId, p) =>
        g('permissions.create', async () => {
          try {
            const r = await d.permissions.create({ fileId, ...all, sendNotificationEmail: p.sendNotification ?? true, requestBody: { type: 'user', role: p.role, emailAddress: p.email, expirationTime: p.expirationTime } });
            return { permissionId: r.data.id!, expirationApplied: !!p.expirationTime };
          } catch (e: any) {
            // Một số loại file không nhận hạn → tạo không hạn, VCdocs tự gỡ khi đến hạn
            if (p.expirationTime && /expiration/i.test(e?.message ?? '')) {
              const r = await d.permissions.create({ fileId, ...all, sendNotificationEmail: p.sendNotification ?? true, requestBody: { type: 'user', role: p.role, emailAddress: p.email } });
              return { permissionId: r.data.id!, expirationApplied: false };
            }
            throw e;
          }
        }),
      updatePermissionExpiry: (fileId, permissionId, expirationTime) =>
        g('permissions.update', async () => {
          try {
            await d.permissions.update({ fileId, permissionId, ...all, requestBody: { expirationTime } });
            return true;
          } catch (e: any) {
            if (/expiration/i.test(e?.message ?? '')) return false;
            throw e;
          }
        }),
      deletePermission: (fileId, permissionId) =>
        g('permissions.delete', async () => {
          await d.permissions.delete({ fileId, permissionId, ...all });
        }),
      listFilePermissions: (fileId) =>
        g('permissions.list', async () => {
          const r = await d.permissions.list({ fileId, ...all, fields: 'permissions(id,type,emailAddress,domain,role,expirationTime)' });
          return (r.data.permissions ?? []).map((p) => ({ permissionId: p.id!, type: p.type as any, emailAddress: p.emailAddress ?? undefined, domain: p.domain ?? undefined, role: p.role as any, expirationTime: p.expirationTime ?? undefined }));
        }),
    },
    docs: {
      replacePlaceholders: (fileId, values) =>
        g('docs.batchUpdate(replaceAllText)', async () => {
          const meta = await d.files.get({ fileId, ...all, fields: 'mimeType' });
          if (meta.data.mimeType === GDOC_MIME) {
            await dc.documents.batchUpdate({
              documentId: fileId,
              requestBody: { requests: Object.entries(values).map(([k, v]) => ({ replaceAllText: { containsText: { text: `{{${k}}}`, matchCase: true }, replaceText: v } })) },
            });
          } else if (meta.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
            await sh.spreadsheets.batchUpdate({
              spreadsheetId: fileId,
              requestBody: { requests: Object.entries(values).map(([k, v]) => ({ findReplace: { find: `{{${k}}}`, replacement: v, allSheets: true } })) },
            });
          }
        }),
      replaceText: (fileId, pairs) =>
        g('docs.batchUpdate(replaceAllText)', async () => {
          const reqs = pairs.filter(([a]) => a).map(([a, b]) => ({ a, b }));
          if (!reqs.length) return;
          const meta = await d.files.get({ fileId, ...all, fields: 'mimeType' });
          if (meta.data.mimeType === GDOC_MIME) {
            await dc.documents.batchUpdate({ documentId: fileId, requestBody: { requests: reqs.map((x) => ({ replaceAllText: { containsText: { text: x.a, matchCase: true }, replaceText: x.b } })) } });
          } else if (meta.data.mimeType === 'application/vnd.google-apps.spreadsheet') {
            await sh.spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests: reqs.map((x) => ({ findReplace: { find: x.a, replacement: x.b, allSheets: true, matchCase: true } })) } });
          }
        }),
      appendVersionRow: (fileId, cells) =>
        g('docs.batchUpdate(insertTableRow)', async () => {
          const doc = await dc.documents.get({ documentId: fileId });
          const content = doc.data.body?.content ?? [];
          const tables = content.filter((c) => c.table);
          const last = tables[tables.length - 1];
          if (!last?.table || last.startIndex == null) return; // không có bảng Lịch sử phiên bản → bỏ qua
          const rows = last.table.tableRows ?? [];
          await dc.documents.batchUpdate({
            documentId: fileId,
            requestBody: { requests: [{ insertTableRow: { tableCellLocation: { tableStartLocation: { index: last.startIndex }, rowIndex: rows.length - 1, columnIndex: 0 }, insertBelow: true } }] },
          });
          const fresh = await dc.documents.get({ documentId: fileId });
          const t = (fresh.data.body?.content ?? []).filter((c) => c.table).pop()!;
          const newRow = t.table!.tableRows![t.table!.tableRows!.length - 1];
          const reqs = (newRow.tableCells ?? [])
            .map((cell, i) => ({ cell, text: cells[i] ?? '' }))
            .filter((x) => x.text)
            .reverse()
            .map((x) => ({ insertText: { location: { index: x.cell.content![0].startIndex! }, text: x.text } }));
          if (reqs.length) await dc.documents.batchUpdate({ documentId: fileId, requestBody: { requests: reqs } });
        }),
    },
    sheets: {
      createSheet: (p) =>
        g('sheets.create', async () => {
          const created = await d.files.create({ ...all, fields: 'id', requestBody: { name: p.title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: p.parentGoogleId ? [p.parentGoogleId] : undefined } });
          const id = created.data.id!;
          await sh.spreadsheets.values.update({ spreadsheetId: id, range: 'A1', valueInputOption: 'RAW', requestBody: { values: [p.header, ...p.rows] } });
          // Quy cách HD-VCPV-02: Times New Roman, tiêu đề nền #13233A chữ trắng, cố định dòng 1
          await sh.spreadsheets.batchUpdate({
            spreadsheetId: id,
            requestBody: {
              requests: [
                { updateSpreadsheetProperties: { properties: { locale: 'vi_VN', defaultFormat: { textFormat: { fontFamily: 'Times New Roman', fontSize: 11 } } }, fields: 'locale,defaultFormat.textFormat' } },
                { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
                { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0x13 / 255, green: 0x23 / 255, blue: 0x3a / 255 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontFamily: 'Times New Roman' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
                { addBanding: { bandedRange: { range: { sheetId: 0, startRowIndex: 1 }, rowProperties: { firstBandColor: { red: 1, green: 1, blue: 1 }, secondBandColor: { red: 0xe8 / 255, green: 0xed / 255, blue: 0xf3 / 255 } } } } },
              ],
            },
          });
          return id;
        }),
    },
    gmail: {
      send: (p) =>
        g('gmail.send', async () => {
          const subject = `=?UTF-8?B?${Buffer.from(p.subject).toString('base64')}?=`;
          const raw = [`From: ${cfg.google.mailFrom}`, `To: ${p.to.join(', ')}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', p.html].join('\r\n');
          await gm.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(raw).toString('base64url') } });
        }),
    },
    urls: {
      fetch: async (url) => {
        const u = new URL(url);
        if (u.protocol !== 'https:') throw new GoogleError('Chỉ nhận đường dẫn https');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30_000);
        try {
          const r = await fetch(u, { signal: ctrl.signal, redirect: 'follow' });
          if (!r.ok) throw new GoogleError(`Tải ${u.hostname} lỗi ${r.status}`);
          const len = Number(r.headers.get('content-length') || 0);
          if (len > 100 * 1024 * 1024) throw new GoogleError('File quá 100 MB');
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 100 * 1024 * 1024) throw new GoogleError('File quá 100 MB');
          return { content: buf, mimeType: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0], fileName: decodeURIComponent(u.pathname.split('/').pop() || 'tai-lieu') };
        } finally {
          clearTimeout(timer);
        }
      },
    },
    reports: {
      listExternalShares: (since) =>
        g('reports.activities.list', async () => {
          const items = await paged(async (pageToken) => {
            const r = await rep.activities.list({ userKey: 'all', applicationName: 'drive', eventName: 'change_user_access', startTime: since.toISOString(), maxResults: 1000, pageToken });
            return { items: r.data.items ?? [], next: r.data.nextPageToken };
          });
          const out: ShareActivity[] = [];
          for (const it of items) {
            for (const ev of it.events ?? []) {
              const params = Object.fromEntries((ev.parameters ?? []).map((p) => [p.name, p.value ?? p.multiValue]));
              const target = String(params.target_user ?? '');
              if (!target || target.endsWith(`@${cfg.allowedDomain}`)) continue;
              const role = String(params.new_value ?? '');
              if (!['reader', 'commenter', 'writer', 'can_view', 'can_comment', 'can_edit'].some((x) => role.includes(x))) continue;
              out.push({
                fileId: String(params.doc_id ?? ''),
                fileName: params.doc_title ? String(params.doc_title) : undefined,
                email: target,
                role: role.includes('edit') || role.includes('writer') ? 'writer' : role.includes('comment') ? 'commenter' : 'reader',
                actorEmail: it.actor?.email ?? undefined,
                at: it.id?.time ?? new Date().toISOString(),
              });
            }
          }
          return out;
        }),
    },
  };
}
