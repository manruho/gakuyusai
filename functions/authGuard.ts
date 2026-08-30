import { shouldBypassStaffAuth } from '../worker/services/authService';
import { verifySession } from '../src/lib/session';
import type { SessionPayload } from '../src/lib/types';

export type AuthEnv = {
  SESSION_SECRET?: string;
  PREVIEW_AUTH_BYPASS?: string;
  CF_PAGES_BRANCH?: string;
};

type Area = 'staff' | 'stock' | 'pickup' | 'admin';

const roles: Record<Area, SessionPayload['role'][]> = {
  staff: ['staff', 'admin', 'owner'],
  stock: ['admin', 'owner'],
  pickup: ['pickup', 'admin', 'owner'],
  admin: ['admin', 'owner'],
};

function homeForRole(role: SessionPayload['role']): string {
  if (role === 'staff') return '/staff/register/select';
  if (role === 'pickup') return '/pickup';
  return '/admin';
}

async function readSession(request: Request, env: AuthEnv): Promise<SessionPayload | null> {
  if (!env.SESSION_SECRET) return null;
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    return await verifySession(decodeURIComponent(token), env.SESSION_SECRET);
  } catch {
    return null;
  }
}

export async function guardPage(context: PagesFunctionContext<AuthEnv>, area: Area): Promise<Response> {
  const session = shouldBypassStaffAuth(context.env)
    ? { role: 'staff' as const, username: 'preview-staff', exp: Date.now() + 60_000 }
    : await readSession(context.request, context.env);
  if (!shouldBypassStaffAuth(context.env) && !context.env.SESSION_SECRET) {
    return new Response('SESSION_SECRET is not configured.', { status: 500 });
  }
  if (!session) {
    const loginUrl = new URL('/login', context.request.url);
    loginUrl.searchParams.set('returnTo', new URL(context.request.url).pathname);
    return Response.redirect(loginUrl.toString(), 302);
  }
  if (!roles[area].includes(session.role)) return Response.redirect(new URL(homeForRole(session.role), context.request.url).toString(), 302);
  return context.next();
}
