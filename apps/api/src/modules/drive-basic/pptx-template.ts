// Mẫu PPTX OOXML xác định, ba slide, dùng font Liberation Sans có sẵn trong
// Document Server. ZIP store giúp fixture dễ giải và kiểm chứng độc lập.
function crc32(input: Buffer) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function u32(value: number) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
function zip(entries: Array<[string, string]>) {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [nameText, contentText] of entries) {
    const name = Buffer.from(nameText); const content = Buffer.from(contentText); const crc = crc32(content);
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), name]);
    local.push(header, content);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + content.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
}

const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const font = '<a:latin typeface="Liberation Sans"/><a:ea typeface="Liberation Sans"/><a:cs typeface="Liberation Sans"/>';
function esc(value: string) { return value.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!); }
function textShape(id: number, name: string, x: number, y: number, cx: number, cy: number, text: string, size: number, color = '13233A', bold = false) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="vi-VN" sz="${size}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${font}</a:rPr><a:t>${esc(text)}</a:t></a:r><a:endParaRPr lang="vi-VN" sz="${size}"/></a:p></p:txBody></p:sp>`;
}
function rectShape(id: number, name: string, x: number, y: number, cx: number, cy: number, fill: string, text: string) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="vi-VN" sz="2200" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>${font}</a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}
function slide(shapes: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:s ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:s>`;
}

export function createPresentationTemplate(title: string) {
  const safeTitle = title.trim() || 'Kế hoạch VCworkspace';
  const slide1 = slide(textShape(2, 'Tiêu đề', 850000, 1450000, 10400000, 1400000, safeTitle, 3600, '13233A', true)
    + textShape(3, 'Phụ đề', 850000, 3100000, 9000000, 800000, 'Mẫu trình chiếu tiếng Việt · VCworkspace', 2000, '3B82F6'));
  const slide2 = slide(textShape(2, 'Tiêu đề', 650000, 450000, 10800000, 800000, 'Ba trọng tâm triển khai', 3000, '13233A', true)
    + rectShape(3, 'Drive', 650000, 1800000, 3200000, 2200000, '2563EB', '01  Lưu trữ đúng quyền')
    + rectShape(4, 'Office', 4250000, 1800000, 3200000, 2200000, '0F766E', '02  Soạn thảo và phiên bản')
    + rectShape(5, 'Lien thong', 7850000, 1800000, 3200000, 2200000, 'C2410C', '03  Liên thông nghiệp vụ')
    + textShape(6, 'Ghi chú', 650000, 4550000, 10600000, 900000, 'Mỗi lần lưu tạo một phiên bản bất biến trong Drive.', 1900));
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Bảng tiến độ"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="800000" y="1700000"/><a:ext cx="10600000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5940675A-B579-460E-94D1-54222C63F5DA}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="3300000"/><a:gridCol w="3650000"/><a:gridCol w="3650000"/></a:tblGrid>${[['Hạng mục','Trạng thái','Bằng chứng'],['Mẫu 3 slide','Hoàn tất','PPTX + PDF'],['Lưu phiên bản','Đang kiểm','V1 → V2'],['Quyền người đọc','Bắt buộc','Chỉ xem']].map((row) => `<a:tr h="750000">${row.map((cell) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="vi-VN" sz="1800">${font}</a:rPr><a:t>${cell}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const slide3 = slide(textShape(2, 'Tiêu đề', 650000, 450000, 10800000, 800000, 'Bảng kiểm nghiệm thu', 3000, '13233A', true) + table);
  const slideRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'],
    ['ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/></Relationships>'],
    ['ppt/slides/slide1.xml', slide1], ['ppt/slides/slide2.xml', slide2], ['ppt/slides/slide3.xml', slide3],
    ['ppt/slides/_rels/slide1.xml.rels', slideRels], ['ppt/slides/_rels/slide2.xml.rels', slideRels], ['ppt/slides/_rels/slide3.xml.rels', slideRels],
    ['ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${ns} type="blank"><p:cSld name="Trống"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'],
    ['ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'],
    ['ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="VCworkspace"><a:themeElements><a:clrScheme name="VCworkspace"><a:dk1><a:srgbClr val="13233A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="334155"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>${['2563EB','0F766E','C2410C','7C3AED','0891B2','CA8A04'].map((c,i)=>`<a:accent${i+1}><a:srgbClr val="${c}"/></a:accent${i+1}>`).join('')}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="VCworkspace"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="VCworkspace"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`],
  ]);
}
