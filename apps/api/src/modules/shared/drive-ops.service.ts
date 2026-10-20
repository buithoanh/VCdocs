import { Inject, Injectable } from '@nestjs/common';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { dateVN, sha256 } from '../../common/util';

export interface Snapshot {
  revisionId: string;
  pdfFileId: string;
  pdfSha256: string;
  takenAt: Date;
  viewUrl?: string;
}

/** Thao tác Drive dùng chung: khoá, chụp phiên bản (BR-27), điền bảng nhận diện */
@Injectable()
export class DriveOpsService {
  constructor(@Inject(GOOGLE) private readonly google: GooglePorts) {}

  async lock(fileId: string, reason: string) {
    await this.google.drive.setLock(fileId, { locked: true, reason });
  }
  async unlock(fileId: string) {
    await this.google.drive.setLock(fileId, { locked: false });
  }

  /**
   * Chụp phiên bản lúc trình: revisionId mới nhất + PDF + SHA-256. PDF lưu cùng
   * thư mục, khoá lại để người duyệt xem đúng bản này.
   */
  async snapshot(fileId: string, parentGoogleId: string, baseName: string): Promise<Snapshot> {
    const rev = await this.google.drive.latestRevision(fileId);
    const pdf = await this.google.drive.exportPdf(fileId);
    const file = await this.google.drive.uploadFile({
      parentGoogleId,
      name: `${baseName} – bản trình ${dateVN()}.pdf`,
      mimeType: 'application/pdf',
      content: pdf,
      description: `Bản chụp lúc trình duyệt, revision ${rev.revisionId}`,
    });
    await this.google.drive.setLock(file.fileId, { locked: true, reason: 'Bản chụp trình duyệt – VCdocs' });
    return { revisionId: rev.revisionId, pdfFileId: file.fileId, pdfSha256: sha256(pdf), takenAt: new Date(), viewUrl: file.webViewLink };
  }

  /**
   * Cập nhật bảng nhận diện: giá trị cũ → mới; chưa có giá trị cũ thì thay chỗ
   * giữ {{KHOA}}. Giá trị mới rỗng thì giữ nguyên chỗ giữ.
   */
  async updateHeader(fileId: string, prev: Record<string, string> | undefined, next: Record<string, string>): Promise<Record<string, string>> {
    const pairs: [string, string][] = [];
    const out: Record<string, string> = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(next)) {
      if (!v) continue;
      const old = prev?.[k];
      if (old === v) continue;
      pairs.push([old ? old : `{{${k}}}`, v]);
      out[k] = v;
    }
    if (pairs.length) await this.google.docs.replaceText(fileId, pairs);
    return out;
  }
}
