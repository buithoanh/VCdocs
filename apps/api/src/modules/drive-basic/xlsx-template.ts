// Mẫu XLSX OOXML nhỏ, xác định và không phụ thuộc dịch vụ ngoài. Công thức có
// cached value để trình đọc/kiểm chứng vẫn thấy kết quả trước lần tính lại đầu tiên.
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

export function createSpreadsheetTemplate(firstQuantity = 2) {
  const firstAmount = firstQuantity * 1_500_000;
  const total = firstAmount + 2_400_000 + 2_000_000;
  const partsTotal = firstAmount + 2_000_000;
  const evaluation = total > 7_000_000 ? 'Vượt ngưỡng' : 'Trong ngưỡng';
  const strings = ['Mã', 'Nhóm', 'Ngày', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Chỉ số', 'PT-01', 'Phụ tùng',
    'DV-01', 'Dịch vụ', 'PT-02', 'TỔNG', 'Đánh giá', 'SUMIF Phụ tùng', 'Lookup DV-01'];
  const shared = strings.map((value) => `<si><t>${value}</t></si>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="16" customWidth="1"/><col min="3" max="3" width="13" customWidth="1"/><col min="4" max="7" width="18" customWidth="1"/></cols><sheetData>
<row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="s" s="1"><v>1</v></c><c r="C1" t="s" s="1"><v>2</v></c><c r="D1" t="s" s="1"><v>3</v></c><c r="E1" t="s" s="1"><v>4</v></c><c r="F1" t="s" s="1"><v>5</v></c><c r="G1" t="s" s="1"><v>6</v></c></row>
<row r="2"><c r="A2" t="s"><v>7</v></c><c r="B2" t="s"><v>8</v></c><c r="C2" s="2"><v>46315</v></c><c r="D2"><v>${firstQuantity}</v></c><c r="E2" s="3"><v>1500000</v></c><c r="F2" s="3"><f>D2*E2</f><v>${firstAmount}</v></c><c r="G2" t="str"><f>IF(F5&gt;7000000,&quot;Vượt ngưỡng&quot;,&quot;Trong ngưỡng&quot;)</f><v>${evaluation}</v></c></row>
<row r="3"><c r="A3" t="s"><v>9</v></c><c r="B3" t="s"><v>10</v></c><c r="C3" s="2"><v>46316</v></c><c r="D3"><v>3</v></c><c r="E3" s="3"><v>800000</v></c><c r="F3" s="3"><f>D3*E3</f><v>2400000</v></c><c r="G3" s="3"><f>SUMIF(B2:B4,&quot;Phụ tùng&quot;,F2:F4)</f><v>${partsTotal}</v></c></row>
<row r="4"><c r="A4" t="s"><v>11</v></c><c r="B4" t="s"><v>8</v></c><c r="C4" s="2"><v>46317</v></c><c r="D4"><v>1</v></c><c r="E4" s="3"><v>2000000</v></c><c r="F4" s="3"><f>D4*E4</f><v>2000000</v></c><c r="G4" s="3"><f>VLOOKUP(&quot;DV-01&quot;,A2:F4,6,FALSE)</f><v>2400000</v></c></row>
<row r="5"><c r="A5" t="s" s="1"><v>12</v></c><c r="F5" s="3"><f>SUM(F2:F4)</f><v>${total}</v></c></row>
</sheetData><autoFilter ref="A1:G4"><filterColumn colId="1"><filters><filter val="Phụ tùng"/><filter val="Dịch vụ"/></filters></filterColumn><sortState ref="A2:G4"><sortCondition ref="F2:F4" descending="1"/></sortState></autoFilter><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Báo cáo" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${shared}</sst>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#.##0 [$₫-vi-VN]"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13233A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'],
  ]);
}

