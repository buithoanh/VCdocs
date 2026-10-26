/**
 * Mã hoá bí mật lưu trong CSDL (app password Nextcloud theo người dùng) bằng AES-256-GCM.
 * Khoá chủ là keyring có phiên bản `kid:<base64 32 byte>,kid2:<...>`: khoá đầu dùng để mã hoá,
 * mọi khoá đều giải mã được (xoay khoá chủ: thêm khoá mới lên đầu, mã hoá lại, rồi gỡ khoá cũ).
 * AAD gắn bản mã với chủ sở hữu nên không chép được bản mã sang dòng khác.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface CredentialKey { kid: string; key: Buffer }
export interface SealedSecret { kid: string; iv: string; ciphertext: string; tag: string }

const KID = /^[a-z0-9-]{1,32}$/;

export function parseKeyring(raw: string | undefined, name = 'WORKSPACE_CREDENTIAL_KEYS'): CredentialKey[] {
  if (!raw || !raw.trim()) return [];
  const keys = raw.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const at = entry.indexOf(':');
    const kid = entry.slice(0, at);
    const key = Buffer.from(entry.slice(at + 1), 'base64');
    if (at < 1 || !KID.test(kid) || key.length !== 32) throw new Error(`${name} phải có dạng kid:<base64 32 byte>, phẩy ngăn cách`);
    return { kid, key };
  });
  if (new Set(keys.map((k) => k.kid)).size !== keys.length) throw new Error(`${name} có kid trùng`);
  return keys;
}

export function seal(keys: CredentialKey[], plaintext: string, aad: string): SealedSecret {
  const active = keys[0];
  if (!active) throw new Error('Chưa cấu hình khoá mã hoá credential');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', active.key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { kid: active.kid, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/** Sai khoá, sai AAD hoặc bản mã bị sửa đều ném lỗi chung, không nói lý do (tránh lộ thông tin). */
export function open(keys: CredentialKey[], sealed: SealedSecret, aad: string): string {
  const key = keys.find((k) => k.kid === sealed.kid);
  if (!key) throw new Error('CREDENTIAL_KEY_NOT_FOUND');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.key, Buffer.from(sealed.iv, 'base64'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('CREDENTIAL_DECRYPT_FAILED');
  }
}
