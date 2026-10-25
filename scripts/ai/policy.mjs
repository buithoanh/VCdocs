import path from 'node:path';

const shellTool = name => /(?:^|__)(?:bash|shell|exec_command|terminal)(?:$|__)/i.test(name);
const patchTool = name => /(?:^|__)(?:apply_patch|patch|edit|write)(?:$|__)/i.test(name);

export function checkTool(event, root) {
  const name = event.tool_name ?? '';
  const input = event.tool_input ?? {};
  const cwd = path.resolve(event.cwd ?? root);
  if (cwd !== root && !cwd.startsWith(root + path.sep)) return 'Sai workspace; mở lại tại gốc VCworkspace.';
  // Some adapters put apply_patch payloads in `cmd`. Tool identity must decide
  // whether that field is executable shell or reviewable patch text.
  const command = shellTool(name) ? (input.command ?? input.cmd) : undefined;
  const patch = patchTool(name)
    ? (typeof input === 'string' ? input : (input.patch ?? input.input ?? input.cmd ?? ''))
    : '';
  const targets = [input.file_path, input.path, ...(String(patch).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm))].filter(Boolean).map(v => Array.isArray(v) ? v[1] : v);
  const inspected = typeof command === 'string' ? command : targets.join('\n');
  const secret = /(?:^|[\s/"'=])(?:\.env(?:\.[\w-]+)?|api\.env|[^\s/"']*sa[^\s/"']*\.json)(?=$|[\s/"'])|\.config\/gcloud|application_default_credentials|\.ssh\/|deploy\/secrets|security\s+find-/i;
  // Examples are public configuration, not credentials.
  const withoutExamples = inspected.replace(/(?:\.env|api\.env)\.example/g, 'PUBLIC_EXAMPLE');
  if (secret.test(withoutExamples)) return 'Không truy cập secret trong phiên code; dùng môi trường thử riêng.';
  if (typeof command === 'string') {
    const checks = [
      [/\b(?:npm|npx|yarn|bun|bunx)\b/, 'Dự án dùng pnpm 9.2.0.'],
      [/\b(?:gcloud|gsutil|terraform|kubectl|mongosh|mongo|mongorestore)\b/, 'Công cụ vận hành chỉ dùng trong phiên riêng.'],
      [/\b(?:curl|wget)\b[\s\S]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--request[=\s]+(?:POST|PUT|PATCH|DELETE)|--data|-d\s)/i, 'Không ghi API trực tiếp trong phiên code.'],
      [/\bgit\b[\s\S]*(?:--no-verify|reset\s+--hard|clean\s+-[\w]*[fd]|push\b[\s\S]*(?:--force|-f\b)|push\b[\s\S]*(?:main|dev)\b)/, 'Thao tác Git bị cấm; dùng nhánh công việc và PR.'],
      [/\bgh\b[\s\S]*\b(?:merge|delete|edit)\b|\bgh\s+api\b[\s\S]*(?:--method|-X)\s+(?:POST|PUT|PATCH|DELETE)/i, 'Thay đổi GitHub cần quy trình quản trị riêng.'],
      [/\b(?:dropDatabase|dropCollection)\s*\(|\bdrop\s+(?:database|table)\b|docker\s+compose[\s\S]*down[\s\S]*(?:-v|--volumes)/i, 'Không xoá dữ liệu/volume trong phiên code.'],
      [/GOOGLE_MODE\s*=\s*["']?real|NODE_ENV\s*=\s*["']?production/, 'Phiên code chỉ dùng Google giả và môi trường test.'],
      [/\bpnpm\b[\s\S]*\b(?:dev:api|khoi-tao|nap-so-do|nhan-cay-thu-muc)\b|(?:\bpnpm\b[\s\S]*(?:--filter\s+@vcdocs\/api|--dir\s+apps\/api)|\bcd\s+apps\/api[\s\S]*\bpnpm\b)[\s\S]*(?:dev|start)(?=\s|$)|^\s*pnpm\s+(?:run\s+)?(?:dev|start)(?=\s|$)/, 'Không tự khởi động BE có thể nạp .env thật; dùng test cô lập.'],
      [/\b(?:node|tsx)\s+(?:[^\s]*\/)?(?:main\.(?:js|ts)|apps\/api\/[^\s]*main\.(?:js|ts))\b/, 'Không khởi động API trực tiếp trong phiên code.'],
      [/\b(?:eval|base64)\b|\b(?:sh|bash|zsh)\s+-c\b|\b(?:python\S*|node)\s+(?:-c|-e|--eval)\b/, 'Lệnh thực thi gián tiếp cần script có thể review; không dùng để vượt guard.'],
    ];
    for (const [pattern, reason] of checks) if (pattern.test(command)) return reason;
  }
  if (patchTool(name) && /apps\/web\/src\/api\/schema\.d\.ts/.test(targets.join('\n'))) return 'Sinh lại schema bằng gen:api, không sửa tay.';
  return null;
}
