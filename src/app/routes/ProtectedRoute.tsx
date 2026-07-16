import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '../../lib/types';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; role: Exclude<Role, 'public'> }
  | { status: 'unauthenticated' }
  | { status: 'error' };

type Props = {
  allow: Array<Exclude<Role, 'public'>>;
  children: ReactNode;
};

function homeForRole(role: Exclude<Role, 'public'>) {
  if (role === 'staff') return '/staff/register/select';
  if (role === 'pickup') return '/pickup';
  return '/admin';
}

export function ProtectedRoute({ allow, children }: Props) {
  const location = useLocation();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/me')
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { ok: true; data: { role: Exclude<Role, 'public'> } } | { ok: false };
      })
      .then((json) => {
        if (!active) return;
        if (json?.ok) setAuth({ status: 'authenticated', role: json.data.role });
        else setAuth({ status: 'unauthenticated' });
      })
      .catch(() => {
        if (active) setAuth({ status: 'error' });
      });
    return () => { active = false; };
  }, [location.pathname]);

  if (auth.status === 'loading') {
    return <main className="page page-form"><p className="small">ログイン状態を確認しています…</p></main>;
  }
  if (auth.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (auth.status === 'error') {
    return <main className="page page-form"><p className="error">ログイン状態を確認できませんでした。ページを再読み込みしてください。</p></main>;
  }
  if (!allow.includes(auth.role)) {
    return <Navigate to={homeForRole(auth.role)} replace />;
  }
  return <>{children}</>;
}
