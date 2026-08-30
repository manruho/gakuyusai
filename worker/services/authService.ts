import type { SessionPayload } from '../../src/lib/types';

export function buildSessionPayload(
  role: 'staff' | 'pickup' | 'admin' | 'owner',
  username: string,
  context: { registerId?: 1 | 2 | 3 | 4; stationId?: 1 | 2 | 3 | 4 } = {},
): SessionPayload {
  return {
    role,
    username,
    ...context,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
}

type LoginThrottleState = {
  failedCount: number;
  lockedUntil: string | null;
  updatedAt: string;
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function shouldBypassStaffAuth(env: { PREVIEW_AUTH_BYPASS?: string; CF_PAGES_BRANCH?: string }): boolean {
  return env.PREVIEW_AUTH_BYPASS === 'true' && Boolean(env.CF_PAGES_BRANCH) && env.CF_PAGES_BRANCH !== 'main';
}

function getThrottleKey(subject: string, ip: string | null): string {
  return `${subject}:${ip ?? 'unknown'}`;
}

export async function getLoginThrottle(db: D1Database, subject: string, ip: string | null): Promise<LoginThrottleState | null> {
  const key = getThrottleKey(subject, ip);
  const rows = await db.prepare('SELECT failed_count as failedCount, locked_until as lockedUntil, updated_at as updatedAt FROM login_attempts WHERE throttle_key = ?').bind(key).all<LoginThrottleState>();
  return (rows.results ?? [])[0] ?? null;
}

export async function recordLoginFailure(db: D1Database, subject: string, ip: string | null): Promise<{ lockedUntil: string | null }> {
  const key = getThrottleKey(subject, ip);
  const now = new Date().toISOString();
  const nextLockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const results = await db.batch<LoginThrottleState>([
    db.prepare('DELETE FROM login_attempts WHERE updated_at < ?').bind(staleBefore),
    db.prepare(
      `INSERT INTO login_attempts (throttle_key, failed_count, locked_until, updated_at)
       VALUES (?, 1, NULL, ?)
       ON CONFLICT(throttle_key) DO UPDATE SET
         failed_count = CASE
           WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= excluded.updated_at THEN 1
           ELSE login_attempts.failed_count + 1
         END,
         locked_until = CASE
           WHEN login_attempts.locked_until IS NOT NULL AND login_attempts.locked_until <= excluded.updated_at THEN NULL
           WHEN login_attempts.failed_count + 1 >= ? THEN ?
           ELSE login_attempts.locked_until
         END,
         updated_at = excluded.updated_at
       RETURNING failed_count AS failedCount, locked_until AS lockedUntil, updated_at AS updatedAt`,
    )
      .bind(key, now, MAX_FAILED_ATTEMPTS, nextLockedUntil),
  ]);
  return { lockedUntil: results[1]?.results?.[0]?.lockedUntil ?? null };
}

export async function resetLoginThrottle(db: D1Database, subject: string, ip: string | null): Promise<void> {
  const key = getThrottleKey(subject, ip);
  await db.prepare('DELETE FROM login_attempts WHERE throttle_key = ?').bind(key).run();
}

export function isLoginLocked(state: LoginThrottleState | null): boolean {
  if (!state?.lockedUntil) return false;
  return new Date(state.lockedUntil).getTime() > Date.now();
}

export function buildLoginLockedMessage(lockedUntil: string | null): string {
  if (!lockedUntil) return 'ログイン試行回数が多すぎます。しばらくしてから再試行してください。';
  return `ログイン試行回数が多すぎます。${new Date(lockedUntil).toLocaleTimeString('ja-JP')} 以降に再試行してください。`;
}
