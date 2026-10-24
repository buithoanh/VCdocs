import { createHash } from 'node:crypto';
import { AppConfig } from '../../config/config';

export type IdentityProjection = { subject: string; email: string; groups: string[]; active: boolean; globalRevoke: boolean };
export const IDENTITY_LIFECYCLE_PORT = Symbol('IDENTITY_LIFECYCLE_PORT');

export interface IdentityLifecyclePort {
  applyAuthentik(desired: IdentityProjection): Promise<void>;
  readAuthentik(subject: string): Promise<Omit<IdentityProjection, 'globalRevoke'>>;
  applyNextcloud(desired: IdentityProjection): Promise<void>;
  readNextcloud(subject: string): Promise<Omit<IdentityProjection, 'globalRevoke'>>;
}

export class FakeIdentityLifecyclePort implements IdentityLifecyclePort {
  authentik = new Map<string, any>();
  nextcloud = new Map<string, any>();
  failNext?: 'authentik' | 'nextcloud';
  holdNextMs?: number;
  private apply(target: 'authentik' | 'nextcloud', desired: IdentityProjection) {
    if (this.failNext === target) { this.failNext = undefined; throw new Error(`${target.toUpperCase()}_UNAVAILABLE`); }
    this[target].set(desired.subject, { subject: desired.subject, email: desired.email, groups: [...desired.groups].sort(), active: desired.active });
  }
  async applyAuthentik(desired: IdentityProjection) { if (this.holdNextMs) { const ms = this.holdNextMs; this.holdNextMs = undefined; await new Promise((resolve) => setTimeout(resolve, ms)); } this.apply('authentik', desired); }
  async readAuthentik(subject: string) { const row = this.authentik.get(subject); if (!row) throw new Error('AUTHENTIK_READBACK_MISSING'); return row; }
  async applyNextcloud(desired: IdentityProjection) { this.apply('nextcloud', desired); }
  async readNextcloud(subject: string) { const row = this.nextcloud.get(subject); if (!row) throw new Error('NEXTCLOUD_READBACK_MISSING'); return row; }
}

export class LocalIdentityLifecyclePort implements IdentityLifecyclePort {
  constructor(private readonly cfg: AppConfig['identityLifecycle']) {}

  private async json(url: string, init: RequestInit, expected: number[]) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
    const text = await response.text();
    let payload: any; try { payload = text ? JSON.parse(text) : undefined; } catch { payload = text; }
    if (!expected.includes(response.status)) throw new Error(`IDENTITY_UPSTREAM_${response.status}`);
    return payload;
  }
  private async ak(path: string, init: RequestInit = {}, expected = [200, 201, 204]) {
    return this.json(`${this.cfg.authentikBaseUrl!.replace(/\/$/, '')}${path}`, { ...init, headers: { Authorization: `Bearer ${this.cfg.authentikToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } }, expected);
  }
  private async akAll(path: string) {
    const out: any[] = [];
    for (let page = 1; page <= 1_000; page += 1) {
      const join = path.includes('?') ? '&' : '?';
      const payload = await this.ak(`${path}${join}page_size=100&page=${page}`);
      const rows = Array.isArray(payload) ? payload : payload?.results || [];
      out.push(...rows);
      const next = payload?.pagination?.next;
      if (Array.isArray(payload) || (!next && rows.length < 100)) return out;
      if (!next && rows.length === 0) return out;
    }
    throw new Error('AUTHENTIK_PAGINATION_LIMIT');
  }
  private async akUser(subject: string) {
    const users = await this.akAll('/core/users/');
    const user = users.find((item: any) => item.uid === subject || item.attributes?.uid === subject);
    if (!user) throw new Error('AUTHENTIK_SUBJECT_NOT_FOUND');
    return user;
  }
  private async groupsByName(names: string[]) {
    const groups = await this.akAll('/core/groups/');
    return names.map((name) => groups.find((item: any) => item.name === name)?.pk).filter(Boolean);
  }
  async applyAuthentik(desired: IdentityProjection) {
    const user = await this.akUser(desired.subject);
    const groups = await this.groupsByName(desired.groups);
    if (groups.length !== desired.groups.length) throw new Error('AUTHENTIK_GROUP_NOT_FOUND');
    await this.ak(`/core/users/${user.pk}/`, { method: 'PATCH', body: JSON.stringify({ email: desired.email, is_active: desired.active, groups }) });
    if (desired.globalRevoke || !desired.active) {
      const sessions = (await this.akAll('/core/authenticated_sessions/')).filter((item: any) => item.user === user.pk);
      for (const session of sessions) await this.ak(`/core/authenticated_sessions/${session.uuid}/`, { method: 'DELETE' });
      const remaining = (await this.akAll('/core/authenticated_sessions/')).filter((item: any) => item.user === user.pk);
      if (remaining.length) throw new Error('AUTHENTIK_SESSION_REVOKE_INCOMPLETE');
    }
  }
  async readAuthentik(subject: string) {
    const found = await this.akUser(subject);
    const user = await this.ak(`/core/users/${found.pk}/`);
    const groups = (user.groups_obj || []).map((item: any) => String(item.name));
    return { subject, email: String(user.email).toLowerCase(), groups: groups.sort(), active: Boolean(user.is_active) };
  }
  private async nc(path: string, init: RequestInit = {}) {
    const auth = Buffer.from(`${this.cfg.nextcloudAdminUser}:${this.cfg.nextcloudAdminPassword}`).toString('base64');
    const join = path.includes('?') ? '&' : '?';
    const payload = await this.json(`${this.cfg.nextcloudBaseUrl!.replace(/\/$/, '')}${path}${join}format=json`, { ...init, headers: { Authorization: `Basic ${auth}`, 'OCS-APIRequest': 'true', ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(init.headers || {}) } }, [200]);
    if (![100, 102, 200].includes(payload?.ocs?.meta?.statuscode)) throw new Error(`NEXTCLOUD_OCS_${payload?.ocs?.meta?.statuscode}`);
    return payload.ocs.data;
  }
  private oidcGroup(group: string) { return createHash('sha256').update(`1_0_${group}`).digest('hex'); }
  async applyNextcloud(desired: IdentityProjection) {
    const user = encodeURIComponent(desired.subject);
    await this.nc(`/users/${user}`, { method: 'PUT', body: new URLSearchParams({ key: 'email', value: desired.email }) });
    const current = await this.nc(`/users/${user}/groups`);
    const wanted = new Set(desired.groups.flatMap((group) => [group, this.oidcGroup(group)]));
    for (const group of (current.groups || []).filter((name: string) => (name.startsWith('vcw-') || /^[0-9a-f]{64}$/.test(name)) && !wanted.has(name))) {
      await this.nc(`/users/${user}/groups`, { method: 'DELETE', body: new URLSearchParams({ groupid: group }) });
    }
    for (const group of wanted) await this.nc(`/users/${user}/groups`, { method: 'POST', body: new URLSearchParams({ groupid: group }) });
    if (desired.globalRevoke) {
      const response = await this.json(`${this.cfg.nextcloudControlUrl!.replace(/\/$/, '')}/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.nextcloudControlToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: desired.subject }) }, [200]);
      if (response?.userId !== desired.subject || response?.remainingTokens !== 0 || response?.cacheSettled !== true) throw new Error('NEXTCLOUD_TOKEN_REVOKE_INCOMPLETE');
    }
    await this.nc(`/users/${user}/${desired.active ? 'enable' : 'disable'}`, { method: 'PUT' });
  }
  async readNextcloud(subject: string) {
    const user = encodeURIComponent(subject), row = await this.nc(`/users/${user}`), groupData = await this.nc(`/users/${user}/groups`);
    const groups = (groupData.groups || []).filter((name: string) => name.startsWith('vcw-')).sort();
    return { subject, email: String(row.email).toLowerCase(), groups, active: Boolean(row.enabled) };
  }
}
