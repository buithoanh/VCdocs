import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { Db } from '../../db/db.service';
import { GOOGLE, GooglePorts } from '../../google/ports';
import { dateVN } from '../../common/util';

/** Xuất danh mục ra Google Sheets đúng quy cách HD-VCPV-02, để ở 00 VCPV Chung / 01 Danh mục tài liệu – hồ sơ */
@Injectable()
export class ExportService {
  constructor(private readonly db: Db, @Inject(GOOGLE) private readonly google: GooglePorts) {}

  async catalogFolderGoogleId(companyId: string): Promise<string | undefined> {
    const cid = new Types.ObjectId(companyId);
    const chung = await this.db.m.Department.findOne({ companyId: cid, securityLevel: 'internal' }).sort({ number: 1 }).lean<any>();
    if (!chung) return undefined;
    const f = await this.db.m.Folder.findOne({ companyId: cid, driveId: chung.driveId, parentId: { $exists: false }, kind: 'plan_report' }).lean<any>();
    return f?.googleId ?? chung.driveId;
  }

  async toSheet(companyId: string, title: string, header: string[], rows: (string | number)[][]) {
    const parent = await this.catalogFolderGoogleId(companyId);
    const fileId = await this.google.sheets.createSheet({ parentGoogleId: parent, title: `${title} – ${dateVN()}`, header, rows });
    return { fileId, rowCount: rows.length };
  }
}
