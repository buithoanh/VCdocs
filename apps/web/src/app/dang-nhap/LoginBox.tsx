'use client';

import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/api/client';
import { safeReturnTo } from '@/lib/returnTo';

const ERRORS: Record<string, string> = {
  domain: 'Không có quyền: chỉ tài khoản @vcprosperous.com được đăng nhập.',
  locked: 'Tài khoản đang bị khoá. Vui lòng liên hệ Quản trị hệ thống.',
  expired: 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại.',
  state: 'Lượt đăng nhập đã quá hạn hoặc bị gián đoạn, vui lòng bấm đăng nhập lại.',
  setup: 'Hệ thống chưa được khởi tạo. Vui lòng liên hệ Quản trị hệ thống.',
};

const IS_MOCK = process.env.NEXT_PUBLIC_MOCK === '1';

export function LoginBox() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const err = params.get('loi');
  const href = `${API_BASE}/auth/google?returnTo=${encodeURIComponent(returnTo)}`;

  function mockLogin() {
    // Chỉ dùng với máy chủ giả: Prism cần cookie vcdocs_sid bất kỳ.
    document.cookie = 'vcdocs_sid=phien-thu; path=/; SameSite=Lax';
    window.location.assign(returnTo);
  }

  return (
    <div className="login-box">
      <h1>VCdocs</h1>
      <p className="muted">Quản lý tài liệu – hồ sơ VC Phồn Vinh</p>
      {err && (
        <div className="alert alert-error" role="alert">
          {ERRORS[err] ?? 'Đăng nhập không thành công, vui lòng thử lại.'}
        </div>
      )}
      <a className="btn btn-primary btn-block" href={href}>
        Đăng nhập bằng tài khoản Google công ty
      </a>
      <p className="hint">Dùng tài khoản @vcprosperous.com. Không cần mật khẩu riêng.</p>
      {IS_MOCK && (
        <button className="btn btn-ghost btn-block" onClick={mockLogin}>
          Vào bằng phiên thử (máy chủ giả)
        </button>
      )}
    </div>
  );
}
