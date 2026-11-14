import { afterEach, describe, expect, it, vi } from 'vitest';
import { navFor } from './permissions';
import { enabledWorkspaceModules } from './workspace-modules';

afterEach(() => vi.unstubAllEnvs());

describe('phân hệ VCworkspace bật/tắt theo môi trường', () => {
  it('ngoài production không khai báo thì bật hết', () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_MODULES', undefined as unknown as string);
    expect(enabledWorkspaceModules()).toEqual(['drive', 'mail']);
    expect(navFor(['R6']).map((i) => i.href)).toEqual(expect.arrayContaining(['/bo-nho', '/email']));
  });

  it('production không khai báo thì ẩn Bộ nhớ và Email, giữ nghiệp vụ VCdocs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_MODULES', undefined as unknown as string);
    const hrefs = navFor(['R6']).map((i) => i.href);
    expect(hrefs).not.toContain('/bo-nho');
    expect(hrefs).not.toContain('/email');
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/tai-lieu', '/ho-so', '/phe-duyet']));
  });

  it('chỉ bật đúng phân hệ khai báo; chuỗi rỗng tắt hết; tên lạ bị bỏ qua', () => {
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_MODULES', 'drive, office');
    expect(enabledWorkspaceModules()).toEqual(['drive']);
    vi.stubEnv('NEXT_PUBLIC_WORKSPACE_MODULES', '');
    expect(enabledWorkspaceModules()).toEqual([]);
  });
});
