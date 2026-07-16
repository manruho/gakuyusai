import { shouldBypassStaffAuth } from '../worker/services/authService';
import { verifySession } from '../src/lib/session';
import type { SessionPayload } from '../src/lib/types';

type AuthEnv = {
  SESSION_SECRET?: string;
  PREVIEW_AUTH_BYPASS?: string;
  CF_PAGES_BRANCH?: string;
};

const protectedAreas: Array<{ prefix: string; roles: SessionPayload['role'][] }> = [
  { prefix: '/staff/register', roles: ['staff', 'admin', 'owner'] },
  { prefix: '/staff/stock', roles: ['admin', 'owner'] },
  { prefix: '/pickup', roles: ['pickup', 'admin', 'owner'] },
  { prefix: '/admin', roles: ['admin', 'owner'] },
];

function getArea(pathname: string) {
  return protectedAreas.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function homeForRole(role: SessionPayload['role']): string {
  if (role === 'staff') return '/staff/register/select';
  if (role === 'pickup') return '/pickup';
  return '/admin';
}

async function readSession(request: Request, env: AuthEnv): Promise<SessionPayload | null> {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    return await verifySession(decodeURIComponent(token), env.SESSION_SECRET ?? 'dev-secret');
  } catch {
    return null;
  }
}

export const onRequest: PagesFunction<AuthEnv> = async (context) => {
  const area = getArea(new URL(context.request.url).pathname);
  if (!area) return context.next();

  const session = shouldBypassStaffAuth(context.env)
    ? { role: 'staff' as const, username: 'preview-staff', exp: Date.now() + 60_000 }
    : await readSession(context.request, context.env);

  if (!session) {
    const loginUrl = new URL('/login', context.request.url);
    loginUrl.searchParams.set('returnTo', new URL(context.request.url).pathname);
    return Response.redirect(loginUrl.toString(), 302);
  }
  if (!area.roles.includes(session.role)) return Response.redirect(new URL(homeForRole(session.role), context.request.url).toString(), 302);
  return context.next();
};
