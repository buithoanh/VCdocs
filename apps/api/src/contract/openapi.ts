import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import Ajv2020, { ValidateFunction, ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/**
 * Đọc contract/openapi.yaml (gốc chung FE/BE) và dựng bộ kiểm tra theo từng
 * điểm cuối. BE kiểm tra dữ liệu vào bằng chính schema của hợp đồng nên không
 * thể lệch khỏi hợp đồng; test dùng cùng file để kiểm phản hồi.
 */
export interface OperationInfo {
  method: string;
  path: string;
  op: any;
  parameters: any[];
  hasIdempotency: boolean;
  hasCsrf: boolean;
}

let cached: OpenApiContract | undefined;

/** Mã lỗi chung (hợp đồng mục 1) – điểm cuối nào cũng có thể trả, thân là Error */
export const GLOBAL_ERROR_STATUSES = [400, 401, 403, 404, 409, 422, 423, 429, 502, 503];

export function findContractFile(): string {
  if (process.env.OPENAPI_PATH) return path.resolve(process.env.OPENAPI_PATH);
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const f = path.join(dir, 'contract', 'openapi.yaml');
    if (fs.existsSync(f)) return f;
    dir = path.dirname(dir);
  }
  throw new Error('Không tìm thấy contract/openapi.yaml (đặt OPENAPI_PATH)');
}

export function getContract(): OpenApiContract {
  if (!cached) cached = new OpenApiContract(findContractFile());
  return cached;
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined, prefix: string): { field: string; issue: string }[] {
  return (errors || []).slice(0, 20).map((e) => {
    let field = e.instancePath.replace(/^\//, '').replace(/\//g, '.');
    if (e.keyword === 'required') field = [field, (e.params as any).missingProperty].filter(Boolean).join('.');
    if (e.keyword === 'additionalProperties') field = [field, (e.params as any).additionalProperty].filter(Boolean).join('.');
    return { field: [prefix, field].filter(Boolean).join('.') || prefix, issue: e.keyword + (e.message ? `: ${e.message}` : '') };
  });
}

export class OpenApiContract {
  readonly doc: any;
  private readonly ops = new Map<string, OperationInfo>();
  private readonly bodyAjv: Ajv2020;
  private readonly queryAjv: Ajv2020;
  private readonly responseAjv: Ajv2020;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor(file: string) {
    this.doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    const mk = (opts: any) => {
      const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true, ...opts });
      addFormats(ajv);
      ajv.addFormat('binary', true);
      ajv.addSchema({ $id: 'oas', components: this.doc.components });
      return ajv;
    };
    // Trường lạ trong thân bị loại, không báo lỗi (hợp đồng mục 7)
    this.bodyAjv = mk({ removeAdditional: 'failing', coerceTypes: false });
    this.queryAjv = mk({ coerceTypes: 'array', useDefaults: true, removeAdditional: false });
    this.responseAjv = mk({});
    for (const [p, item] of Object.entries<any>(this.doc.paths)) {
      const common = item.parameters || [];
      for (const m of ['get', 'post', 'patch', 'put', 'delete']) {
        if (!item[m]) continue;
        const parameters = [...common, ...(item[m].parameters || [])].map((x) => this.deref(x));
        this.ops.set(`${m.toUpperCase()} ${p}`, {
          method: m.toUpperCase(),
          path: p,
          op: item[m],
          parameters,
          hasIdempotency: parameters.some((x) => x.name === 'Idempotency-Key' && x.in === 'header'),
          hasCsrf: parameters.some((x) => x.name === 'X-CSRF-Token' && x.in === 'header'),
        });
      }
    }
  }

  /** Mọi điểm cuối "METHOD /path" trong hợp đồng */
  operations(): OperationInfo[] {
    return [...this.ops.values()];
  }

  find(method: string, oasPath: string): OperationInfo | undefined {
    return this.ops.get(`${method.toUpperCase()} ${oasPath}`);
  }

  deref(x: any): any {
    let cur = x;
    let guard = 0;
    while (cur && cur.$ref && guard++ < 10) {
      const parts = String(cur.$ref).replace(/^#\//, '').split('/');
      cur = parts.reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), this.doc);
    }
    return cur;
  }

  /** Đổi $ref nội bộ (#/components/...) sang id schema đã nạp vào ajv */
  private rebase(schema: any): any {
    return JSON.parse(JSON.stringify(schema).replace(/"#\/components\//g, '"oas#/components/'));
  }

  private compile(ajv: Ajv2020, key: string, schema: any): ValidateFunction {
    let v = this.cache.get(key);
    if (!v) {
      v = ajv.compile(this.rebase(schema));
      this.cache.set(key, v);
    }
    return v;
  }

  bodySchema(info: OperationInfo, contentType = 'application/json'): any | undefined {
    const rb = this.deref(info.op.requestBody);
    return rb?.content?.[contentType]?.schema;
  }

  bodyRequired(info: OperationInfo): boolean {
    return !!this.deref(info.op.requestBody)?.required;
  }

  /** Kiểm thân JSON; trả lỗi (nếu có) và đã loại trường lạ ngay trên object */
  validateBody(info: OperationInfo, body: any, contentType = 'application/json') {
    const schema = this.bodySchema(info, contentType);
    if (!schema) return { ok: true, errors: [] as any[] };
    const v = this.compile(this.bodyAjv, `body:${contentType}:${info.method} ${info.path}`, schema);
    const ok = v(body) as boolean;
    return { ok, errors: formatAjvErrors(v.errors, 'body') };
  }

  /** Kiểm và ép kiểu tham số query/path; trả object đã có giá trị mặc định */
  validateParams(info: OperationInfo, where: 'query' | 'path', input: Record<string, any>) {
    const params = info.parameters.filter((p) => p.in === where);
    const schema = {
      type: 'object',
      properties: Object.fromEntries(params.map((p) => [p.name, p.schema || {}])),
      required: params.filter((p) => p.required).map((p) => p.name),
    };
    const v = this.compile(this.queryAjv, `${where}:${info.method} ${info.path}`, schema);
    const data: Record<string, any> = {};
    for (const p of params) if (input[p.name] !== undefined) data[p.name] = input[p.name];
    const ok = v(data) as boolean;
    return { ok, data, errors: formatAjvErrors(v.errors, where) };
  }

  headerParam(info: OperationInfo, name: string): any | undefined {
    return info.parameters.find((p) => p.in === 'header' && p.name === name);
  }

  /** Dùng trong test: kiểm phản hồi theo schema của mã trạng thái tương ứng */
  validateResponse(method: string, oasPath: string, status: number, body: any) {
    const info = this.find(method, oasPath);
    if (!info) return { ok: false, errors: [`Không có ${method} ${oasPath} trong hợp đồng`] };
    let resp = this.deref(info.op.responses?.[String(status)]);
    let undeclared = false;
    if (!resp && GLOBAL_ERROR_STATUSES.includes(status)) {
      // Mã lỗi chung ở hợp đồng mục 1 dùng cho mọi điểm cuối, thân là Error
      resp = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
      undeclared = true;
    }
    if (!resp) return { ok: false, undeclared, errors: [`Hợp đồng không khai báo mã ${status} cho ${method} ${oasPath}`] };
    const schema = resp.content?.['application/json']?.schema;
    if (!schema) {
      const empty = body === undefined || body === '' || (typeof body === 'object' && body && Object.keys(body).length === 0);
      return { ok: empty, errors: empty ? [] : ['Hợp đồng không có thân phản hồi nhưng BE trả thân'] };
    }
    const v = this.compile(this.responseAjv, `resp:${status}:${method} ${oasPath}`, schema);
    const ok = v(body) as boolean;
    return { ok, undeclared, errors: (v.errors || []).map((e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`) };
  }
}

/** '/api/v1/documents/:id/submit' → '/documents/{id}/submit' */
export function expressToOas(routePath: string, prefix = '/api/v1'): string {
  let p = routePath.startsWith(prefix) ? routePath.slice(prefix.length) : routePath;
  p = p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  return p || '/';
}
