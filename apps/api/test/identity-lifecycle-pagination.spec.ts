import { LocalIdentityLifecyclePort } from '../src/modules/m01-auth/identity-lifecycle.port';

describe('Authentik lifecycle pagination', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('tìm user/group và xóa session ở page 2, rồi readback không còn session trên mọi page', async () => {
    const deleted: string[] = [];
    let revokeReadback = false;
    const hundred = Array.from({ length: 100 }, (_, index) => ({ pk: `dummy-${index}`, user: index + 1000, uuid: `dummy-session-${index}` }));
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page') || 1);
      const path = url.pathname;
      if (init?.method === 'PATCH' && path === '/api/v3/core/users/7/') return new Response('{}', { status: 200 });
      if (init?.method === 'DELETE' && path.includes('/authenticated_sessions/page-two-session/')) { deleted.push(path); revokeReadback = true; return new Response(null, { status: 204 }); }
      if (path.endsWith('/core/users/')) return new Response(JSON.stringify(page === 1 ? { results: hundred.map((_, i) => ({ pk: i + 100, uid: `dummy-${i}` })), pagination: { next: 2 } } : { results: [{ pk: 7, uid: 'subject-page-two' }], pagination: { next: 0 } }), { status: 200 });
      if (path.endsWith('/core/groups/')) return new Response(JSON.stringify(page === 1 ? { results: hundred.map((_, i) => ({ pk: `g-${i}`, name: `dummy-g-${i}` })), pagination: { next: 2 } } : { results: [{ pk: 'team-pk', name: 'vcw-team-a' }], pagination: { next: 0 } }), { status: 200 });
      if (path.endsWith('/core/authenticated_sessions/')) {
        if (revokeReadback) return new Response(JSON.stringify({ results: [], pagination: { next: 0 } }), { status: 200 });
        return new Response(JSON.stringify(page === 1 ? { results: hundred, pagination: { next: 2 } } : { results: [{ user: 7, uuid: 'page-two-session' }], pagination: { next: 0 } }), { status: 200 });
      }
      throw new Error(`UNEXPECTED_FETCH:${init?.method || 'GET'}:${url}`);
    }) as any;
    const port = new LocalIdentityLifecyclePort({ mode: 'local', authentikBaseUrl: 'http://authentik.localtest.me:18121/api/v3', authentikToken: 'test', nextcloudBaseUrl: 'http://nextcloud.localtest.me:18120/ocs/v1.php/cloud', nextcloudAdminUser: 'admin', nextcloudAdminPassword: 'test', nextcloudControlUrl: 'http://127.0.0.1:18127', nextcloudControlToken: 'test', timeoutMs: 1_000 });
    await port.applyAuthentik({ subject: 'subject-page-two', email: 'member@example.test', groups: ['vcw-team-a'], active: true, globalRevoke: true });
    expect(deleted).toEqual(['/api/v3/core/authenticated_sessions/page-two-session/']);
  });
});
