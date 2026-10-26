import * as zlib from 'zlib';

export interface ZipEntry {
  path: string;
  content: Buffer;
}

/** Giờ DOS của mục trong ZIP (giờ máy chủ, độ phân giải 2 giây) */
function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Ghi file ZIP (nén deflate, tên UTF-8) không cần thư viện ngoài – đủ cho gói
 * bằng chứng vài chục tệp (E17). Không hỗ trợ ZIP64 (mỗi gói < 4 GB).
 */
export function buildZip(entries: ZipEntry[], at = new Date()): Buffer {
  const { time, date } = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf8');
    const data = zlib.deflateRawSync(e.content);
    const crc = zlib.crc32(e.content);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // phiên bản cần để giải nén
    head.writeUInt16LE(0x0800, 6); // tên UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(e.content.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    locals.push(head, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(e.content.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += head.length + name.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/** Đọc lại ZIP do buildZip ghi (dùng trong test và kiểm gói) */
export function readZip(buf: Buffer): ZipEntry[] {
  const out: ZipEntry[] = [];
  let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extra;
    const data = buf.subarray(start, start + size);
    out.push({ path: name, content: method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data) });
    p = start + size;
  }
  return out;
}
