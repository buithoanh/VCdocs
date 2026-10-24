export type OfficeKind = 'document' | 'spreadsheet' | 'presentation';

export function officeKind(mimeType: string, name: string): OfficeKind | undefined {
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && /\.docx$/i.test(name)) return 'document';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && /\.xlsx$/i.test(name)) return 'spreadsheet';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' && /\.pptx$/i.test(name)) return 'presentation';
  return undefined;
}

// Kiểm cấu trúc tối thiểu của gói OOXML, không chỉ kiểm magic PK. ZIP tạo bởi
// Office/ONLYOFFICE luôn chứa tên entry trong central directory.
export function validOfficePackage(bytes: Buffer, kind: OfficeKind) {
  if (bytes.length < 100 || bytes.subarray(0, 2).toString() !== 'PK') return false;
  const binary = bytes.toString('latin1');
  const required = kind === 'document'
    ? ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
    : kind === 'spreadsheet'
      ? ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/', 'spreadsheetml.sheet.main+xml']
      : ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'presentationml.presentation.main+xml'];
  return required.every((value) => binary.includes(value));
}
