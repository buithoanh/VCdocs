/**
 * Cổng gọi Nextcloud của Flow (chat14). Chỉ gọi đúng origin cấu hình
 * FLOW_NEXTCLOUD_BASE_URL bằng app password của người chạy flow (runner);
 * không bao giờ dùng URL lấy từ payload webhook, không theo redirect, mọi id
 * ghép vào đường dẫn phải là số nguyên dương hoặc uid đã kiểm.
 * (Tải URL do người dùng đưa thì dùng common/safe-url.ts — Flow không có trường hợp đó.)
 */

/** Quyết định cuối không làm hiệu ứng (không thử lại): thiếu quyền, không thấy, lệch readback… */
export class FlowSkip extends Error {
  constructor(public readonly outcome: string, message: string) {
    super(message);
  }
}

/** Lỗi tạm thời (mạng, 5xx, 429, chưa thấy tag…) → worker thử lại có giãn cách */
export class FlowRetryable extends Error {
  constructor(public readonly outcome: string, message: string) {
    super(message);
  }
}

const NC_UID = /^[A-Za-z0-9._@-]{1,64}$/;

function id(n: unknown): string {
  if (!Number.isSafeInteger(n) || (n as number) <= 0) throw new FlowSkip('invalid_id', 'Id Nextcloud không hợp lệ');
  return String(n);
}

export interface FlowFolderFile {
  fileId: number;
  etag: string;
  /** getlastmodified (giây), null nếu Nextcloud không trả */
  modifiedAt: number | null;
}

export interface FlowHttpResult {
  status: number;
  text: string;
}

export class NextcloudFlowClient {
  private readonly base: URL;
  private readonly authorization: string;

  constructor(baseUrl: string, private readonly timeoutMs: number, private readonly cred: { username: string; password: string }) {
    this.base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!NC_UID.test(cred.username)) throw new Error('Runner Flow cần uid Nextcloud hợp lệ');
    this.authorization = `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString('base64')}`;
  }

  get uid(): string {
    return this.cred.username;
  }

  private url(path: string): URL {
    const u = new URL(path.replace(/^\/+/, ''), this.base);
    if (u.origin !== this.base.origin || !u.pathname.startsWith(this.base.pathname)) throw new FlowSkip('invalid_path', 'Đường dẫn Nextcloud ra ngoài origin cấu hình');
    return u;
  }

  async call(method: string, path: string, opts: { json?: unknown; body?: string; headers?: Record<string, string> } = {}): Promise<FlowHttpResult> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: {
          Authorization: this.authorization,
          'OCS-APIRequest': 'true',
          Accept: 'application/json',
          ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e: any) {
      if (e instanceof FlowSkip) throw e;
      throw new FlowRetryable('upstream_unreachable', `Nextcloud không phản hồi (${e?.name ?? 'lỗi mạng'})`);
    }
    const text = await res.text();
    return { status: res.status, text };
  }

  /** Mã trạng thái → quyết định: 401/403 là runner mất quyền (không leo thang, không thử lại) */
  private check(label: string, r: FlowHttpResult): void {
    if (r.status >= 200 && r.status < 300) return;
    if (r.status === 207) return;
    if (r.status === 401) throw new FlowSkip('runner_unauthenticated', `${label}: app password của runner không còn hiệu lực`);
    if (r.status === 403) throw new FlowSkip('runner_forbidden', `${label}: runner không có quyền`);
    if (r.status === 404) throw new FlowSkip('not_found', `${label}: không thấy trên Nextcloud`);
    if (r.status === 429 || r.status >= 500) throw new FlowRetryable('upstream_error', `${label}: Nextcloud trả ${r.status}`);
    throw new FlowSkip('upstream_rejected', `${label}: Nextcloud trả ${r.status}`);
  }

  private async getJson(label: string, path: string): Promise<any> {
    const r = await this.call('GET', path);
    this.check(label, r);
    return this.parse(label, r.text);
  }

  private parse(label: string, text: string): any {
    try {
      const data = JSON.parse(text);
      return data?.ocs ? data.ocs.data : data;
    } catch {
      throw new FlowRetryable('upstream_bad_body', `${label}: Nextcloud trả thân không phải JSON`);
    }
  }

  // ── Forms (đọc câu trả lời qua API: payload webhook không chứa câu trả lời) ──
  getForm(formId: number) {
    return this.getJson('Đọc form', `/ocs/v2.php/apps/forms/api/v3/forms/${id(formId)}`);
  }
  getSubmission(formId: number, submissionId: number) {
    return this.getJson('Đọc phiếu', `/ocs/v2.php/apps/forms/api/v3/forms/${id(formId)}/submissions/${id(submissionId)}`);
  }
  async listSubmissions(formId: number): Promise<any[]> {
    const data = await this.getJson('Liệt kê phiếu', `/ocs/v2.php/apps/forms/api/v3/forms/${id(formId)}/submissions`);
    return Array.isArray(data?.submissions) ? data.submissions : [];
  }

  // ── Deck ──
  getBoard(boardId: number) {
    return this.getJson('Đọc board', `/index.php/apps/deck/api/v1.0/boards/${id(boardId)}`);
  }
  getStack(boardId: number, stackId: number) {
    return this.getJson('Đọc cột', `/index.php/apps/deck/api/v1.0/boards/${id(boardId)}/stacks/${id(stackId)}`);
  }
  getCard(boardId: number, stackId: number, cardId: number) {
    return this.getJson('Đọc thẻ', `/index.php/apps/deck/api/v1.0/boards/${id(boardId)}/stacks/${id(stackId)}/cards/${id(cardId)}`);
  }
  async createCard(boardId: number, stackId: number, card: { title: string; description: string }) {
    const r = await this.call('POST', `/index.php/apps/deck/api/v1.0/boards/${id(boardId)}/stacks/${id(stackId)}/cards`, {
      json: { title: card.title, type: 'plain', order: 999, description: card.description },
    });
    this.check('Tạo thẻ', r);
    return this.parse('Tạo thẻ', r.text);
  }

  // ── Tables ──
  getRow(rowId: number) {
    return this.getJson('Đọc dòng', `/index.php/apps/tables/api/1/rows/${id(rowId)}`);
  }
  getTable(tableId: number) {
    return this.getJson('Đọc bảng', `/index.php/apps/tables/api/1/tables/${id(tableId)}`);
  }
  async getTableShares(tableId: number): Promise<any[]> {
    const data = await this.getJson('Đọc chia sẻ bảng', `/index.php/apps/tables/api/1/tables/${id(tableId)}/shares`);
    return Array.isArray(data) ? data : [];
  }
  async listRows(tableId: number): Promise<any[]> {
    const data = await this.getJson('Liệt kê dòng', `/index.php/apps/tables/api/1/tables/${id(tableId)}/rows`);
    return Array.isArray(data) ? data : [];
  }

  // ── Files (WebDAV, theo fileid bất biến) ──
  /** Tìm đường dẫn của fileid trong cây của runner; null nếu runner không thấy file */
  async findFileHref(fileId: number): Promise<string | null> {
    const fid = id(fileId);
    const body = `<?xml version="1.0" encoding="UTF-8"?><d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:basicsearch><d:select><d:prop><oc:fileid/></d:prop></d:select><d:from><d:scope><d:href>/files/${encodeURIComponent(this.uid)}</d:href><d:depth>infinity</d:depth></d:scope></d:from><d:where><d:eq><d:prop><oc:fileid/></d:prop><d:literal>${fid}</d:literal></d:eq></d:where></d:basicsearch></d:searchrequest>`;
    const r = await this.call('SEARCH', '/remote.php/dav/', { body, headers: { 'Content-Type': 'text/xml' } });
    this.check('Tìm file', r);
    for (const m of r.text.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
      const href = /<d:href>([^<]+)<\/d:href>/.exec(m[1])?.[1];
      const found = /<oc:fileid>(\d+)<\/oc:fileid>/.exec(m[1])?.[1];
      if (href && found === fid) {
        try {
          return decodeURIComponent(href);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /** Đường dẫn WebDAV gốc của runner (đã giải mã), để so thư mục */
  filesRoot(): string {
    return `${this.base.pathname.replace(/\/$/, '')}/remote.php/dav/files/${this.uid}/`;
  }

  /**
   * Chat15 đối soát Files: liệt kê đệ quy (PROPFIND Depth 1 từng thư mục, như client sync)
   * thư mục folderPath trong cây của runner. Chỉ nhận mục nằm dưới đúng thư mục đó
   * (href khác bị bỏ qua, không đi theo), tối đa maxFiles file / maxDirs thư mục.
   */
  async listFolderFiles(folderPath: string, limits = { maxFiles: 5000, maxDirs: 500 }): Promise<{ files: FlowFolderFile[]; truncated: boolean }> {
    const rootPath = `${this.filesRoot()}${folderPath}/`;
    const files: FlowFolderFile[] = [];
    const queue: string[] = [rootPath];
    const visited = new Set<string>();
    let truncated = false;
    while (queue.length) {
      const dir = queue.shift()!;
      if (visited.has(dir)) continue;
      if (visited.size >= limits.maxDirs) {
        truncated = true;
        break;
      }
      visited.add(dir);
      const rel = dir.slice(this.base.pathname.replace(/\/$/, '').length);
      const r = await this.call('PROPFIND', rel.split('/').map((s) => encodeURIComponent(s)).join('/'), {
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/><d:getetag/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>',
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
      });
      this.check('Liệt kê thư mục', r);
      for (const m of r.text.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
        const rawHref = /<d:href>([^<]+)<\/d:href>/.exec(m[1])?.[1];
        let href: string;
        try {
          href = decodeURIComponent(rawHref ?? '');
        } catch {
          continue;
        }
        // Chỉ mục con trực tiếp hoặc chính thư mục, dưới đúng gốc của rule (không ../, không đường lạ)
        if (!href.startsWith(rootPath) || href.includes('/../') || href.includes('/./')) continue;
        const isDir = /<d:collection\s*\/>/.test(m[1]);
        if (isDir) {
          const normalized = href.endsWith('/') ? href : `${href}/`;
          if (normalized !== dir) queue.push(normalized);
          continue;
        }
        const fileId = Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(m[1])?.[1]);
        const etag = /<d:getetag>&quot;([^&<]*)&quot;<\/d:getetag>|<d:getetag>"?([^"<]*)"?<\/d:getetag>/.exec(m[1]);
        const modified = Date.parse(/<d:getlastmodified>([^<]+)<\/d:getlastmodified>/.exec(m[1])?.[1] ?? '');
        if (!Number.isSafeInteger(fileId) || fileId <= 0 || !etag) continue;
        if (files.length >= limits.maxFiles) {
          truncated = true;
          break;
        }
        files.push({ fileId, etag: etag[1] ?? etag[2], modifiedAt: Number.isFinite(modified) ? Math.floor(modified / 1000) : null });
      }
      if (truncated) break;
    }
    return { files, truncated };
  }

  async getFileTags(fileId: number): Promise<string[]> {
    const r = await this.call('PROPFIND', `/remote.php/dav/systemtags-relations/files/${id(fileId)}`, {
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:display-name/></d:prop></d:propfind>',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
    });
    this.check('Đọc tag', r);
    return [...r.text.matchAll(/<oc:display-name>([^<]*)<\/oc:display-name>/g)].map((m) =>
      m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'),
    );
  }
}
