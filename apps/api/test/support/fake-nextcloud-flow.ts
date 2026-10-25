import { createServer, IncomingMessage, Server, ServerResponse } from 'http';

/**
 * Nextcloud giả cho test Flow (chat14): đủ các API mà receiver đọc lại/tác động
 * (Forms, Deck, Tables, WebDAV SEARCH + systemtags) với dạng phản hồi lấy từ
 * Nextcloud 33.0.10 thật (poc/flow/evidence). Quyền đơn giản theo uid.
 */
export interface FakeSubmission { id: number; formId: number; userId: string; timestamp: number; answers: { questionId: number; text: string }[] }
export interface FakeCard { id: number; title: string; description: string; stackId: number }

export class FakeNextcloudFlow {
  server!: Server;
  origin = '';
  passwords: Record<string, string> = {};
  requests: { method: string; path: string; user?: string }[] = [];
  /** Số lần tiếp theo trả 503 cho mọi request (giả Nextcloud quá tải) */
  fail503 = 0;
  forms = new Map<number, { ownerId: string; results: Set<string>; questions: { id: number; order: number; text: string }[]; submissions: Map<number, FakeSubmission> }>();
  boards = new Map<number, { editors: Set<string>; acl: any[]; stacks: Map<number, FakeCard[]> }>();
  tables = new Map<number, { title: string; ownership: string; shares: any[]; rows: Map<number, { id: number; tableId: number; createdAt: string; data: { columnId: number; value: string }[] }> }>();
  /** fileId → { đường dẫn theo từng uid thấy file, tag } */
  files = new Map<number, { paths: Record<string, string>; tags: string[] }>();
  private nextCard = 100;

  async start() {
    this.server = createServer((req, res) => this.handle(req, res).catch((e) => this.send(res, 500, { error: String(e) })));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as any).port}`;
  }
  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  cards(boardId: number, stackId: number): FakeCard[] {
    return this.boards.get(boardId)?.stacks.get(stackId) ?? [];
  }

  private send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
  private ocs(res: ServerResponse, status: number, data: unknown) {
    this.send(res, status, { ocs: { meta: { status: status < 300 ? 'ok' : 'failure', statuscode: status, message: '' }, data } });
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', this.origin);
    const path = url.pathname;
    const auth = String(req.headers.authorization ?? '');
    const [user, pass] = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString().split(':') : [];
    this.requests.push({ method: req.method ?? '', path, user });
    if (this.fail503 > 0) {
      this.fail503--;
      return this.send(res, 503, { message: 'maintenance' });
    }
    if (!user || this.passwords[user] !== pass) return this.send(res, 401, { message: 'unauthenticated' });
    let m: RegExpMatchArray | null;

    if ((m = path.match(/^\/ocs\/v2\.php\/apps\/forms\/api\/v3\/forms\/(\d+)(?:\/submissions(?:\/(\d+))?)?$/)) && req.method === 'GET') {
      const form = this.forms.get(Number(m[1]));
      if (!form) return this.ocs(res, 404, null);
      const isSubs = path.includes('/submissions');
      if (!isSubs) {
        const permissions = form.results.has(user) ? ['edit', 'results', 'submit'] : ['submit'];
        if (!form.results.has(user)) return this.ocs(res, 403, null);
        return this.ocs(res, 200, { id: Number(m[1]), ownerId: form.ownerId, permissions, questions: form.questions });
      }
      if (!form.results.has(user)) return this.ocs(res, 403, null);
      if (m[2]) {
        const s = form.submissions.get(Number(m[2]));
        return s ? this.ocs(res, 200, s) : this.ocs(res, 404, null);
      }
      return this.ocs(res, 200, { submissions: [...form.submissions.values()], questions: form.questions });
    }

    if ((m = path.match(/^\/index\.php\/apps\/deck\/api\/v1\.0\/boards\/(\d+)(?:\/stacks\/(\d+)(?:\/cards(?:\/(\d+))?)?)?$/))) {
      const board = this.boards.get(Number(m[1]));
      if (!board) return this.send(res, 404, { message: 'not found' });
      const canEdit = board.editors.has(user);
      if (!canEdit && !board.acl.some((a) => a.participant?.uid === user)) return this.send(res, 403, { message: 'forbidden' });
      if (!m[2] && req.method === 'GET') {
        return this.send(res, 200, { id: Number(m[1]), acl: board.acl, permissions: { PERMISSION_READ: true, PERMISSION_EDIT: canEdit, PERMISSION_MANAGE: canEdit, PERMISSION_SHARE: canEdit }, stacks: [...board.stacks.keys()].map((id) => ({ id })) });
      }
      const stack = board.stacks.get(Number(m[2]));
      if (!stack) return this.send(res, 404, { message: 'not found' });
      if (!path.includes('/cards') && req.method === 'GET') return this.send(res, 200, { id: Number(m[2]), cards: stack });
      if (path.endsWith('/cards') && req.method === 'POST') {
        if (!canEdit) return this.send(res, 403, { message: 'forbidden' });
        const input = JSON.parse(body);
        const card = { id: this.nextCard++, title: input.title, description: input.description, stackId: Number(m[2]) };
        stack.push(card);
        return this.send(res, 200, card);
      }
      if (m[3] && req.method === 'GET') {
        const cardId = Number(m[3]);
        const card = stack.find((c) => c.id === cardId);
        return card ? this.send(res, 200, card) : this.send(res, 404, { message: 'not found' });
      }
    }

    if ((m = path.match(/^\/index\.php\/apps\/tables\/api\/1\/(rows|tables)\/(\d+)(\/shares|\/rows)?$/)) && req.method === 'GET') {
      const id = Number(m[2]);
      if (m[1] === 'rows') {
        for (const t of this.tables.values()) {
          const row = t.rows.get(id);
          if (row) return t.ownership === user || t.shares.some((s) => s.receiver === user) ? this.send(res, 200, row) : this.send(res, 403, { message: 'forbidden' });
        }
        return this.send(res, 404, { message: 'not found' });
      }
      const table = this.tables.get(id);
      if (!table) return this.send(res, 404, { message: 'not found' });
      const reader = table.ownership === user || table.shares.some((s) => s.receiver === user);
      if (!reader) return this.send(res, 403, { message: 'forbidden' });
      if (m[3] === '/shares') return table.ownership === user ? this.send(res, 200, table.shares) : this.send(res, 403, { message: 'forbidden' });
      if (m[3] === '/rows') return this.send(res, 200, [...table.rows.values()]);
      return this.send(res, 200, { id, title: table.title, ownership: table.ownership });
    }

    if (path === '/remote.php/dav/' && req.method === 'SEARCH') {
      const fid = Number(/<d:literal>(\d+)<\/d:literal>/.exec(body)?.[1]);
      const scope = /<d:href>\/files\/([^<]+)<\/d:href>/.exec(body)?.[1];
      const file = this.files.get(fid);
      const visible = file && scope === user ? file.paths[user] : undefined;
      const inner = visible ? `<d:response><d:href>/remote.php/dav/files/${user}${encodeURI(visible)}</d:href><d:propstat><d:prop><oc:fileid>${fid}</oc:fileid></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` : '';
      return this.send(res, 207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${inner}</d:multistatus>`, 'application/xml');
    }
    if ((m = path.match(/^\/remote\.php\/dav\/systemtags-relations\/files\/(\d+)$/)) && req.method === 'PROPFIND') {
      const file = this.files.get(Number(m[1]));
      if (!file || !file.paths[user]) return this.send(res, 404, '<?xml version="1.0"?><d:error xmlns:d="DAV:"/>', 'application/xml');
      const tags = file.tags.map((t, i) => `<d:response><d:href>/remote.php/dav/systemtags-relations/files/${m![1]}/${i + 1}</d:href><d:propstat><d:prop><oc:display-name>${t}</oc:display-name></d:prop></d:propstat></d:response>`).join('');
      return this.send(res, 207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${tags}</d:multistatus>`, 'application/xml');
    }
    return this.send(res, 404, { message: `no fake route ${req.method} ${path}` });
  }
}
