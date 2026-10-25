import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedDocumentServer, documentServerOrigins, isObjectId } from './document-server';

afterEach(() => vi.unstubAllEnvs());

describe('danh sách Document Server cho phép', () => {
  it('production không khai báo thì không cho origin nào', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS', undefined as unknown as string);
    expect(documentServerOrigins()).toEqual([]);
    expect(allowedDocumentServer('http://127.0.0.1:18082')).toBeNull();
  });

  it('chỉ nhận đúng origin khai báo, giữ path tiền tố', () => {
    vi.stubEnv('NEXT_PUBLIC_DOCUMENT_SERVER_ORIGINS', 'https://office.example.vn, https://ds2.example.vn');
    expect(allowedDocumentServer('https://office.example.vn/')).toBe('https://office.example.vn');
    expect(allowedDocumentServer('https://ds2.example.vn/onlyoffice/')).toBe('https://ds2.example.vn/onlyoffice');
    for (const bad of ['https://office.example.vn.attacker.example', 'https://office.example.vn@attacker.example', 'http://office.example.vn',
      'https://office.example.vn:8443', '//attacker.example', 'javascript:alert(1)', 'https://office.example.vn/?x=1', 42, null])
      expect(allowedDocumentServer(bad)).toBeNull();
  });

  it('fileId phải là ObjectId 24 hex', () => {
    expect(isObjectId('6712f0c2a1b2c3d4e5f60901')).toBe(true);
    for (const bad of ['6712f0c2a1b2c3d4e5f60901/content#', '6712f0c2a1b2c3d4e5f6090', '..', '6712f0c2a1b2c3d4e5f6090g']) expect(isObjectId(bad)).toBe(false);
  });
});
