import type { SessionPayload } from '../../src/lib/types';

export function buildSessionPayload(role: 'admin' | 'owner', username: string): SessionPayload {
  return {
    role,
    username,
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

function getThrottleKey(username: string, ip: string | null): string {
  return `${username}:${ip ?? 'unknown'}`;
}

export async function getLoginThrottle(
  db: D1Database,
  username: string,
  ip: string | null,
): Promise<LoginThrottleState | null> {
  const key = getThrottleKey(username, ip);
  const rows = await db
    .prepare('SELECT failed_count as failedCount, locked_until as lockedUntil, updated_at as updatedAt FROM login_attempts WHERE throttle_key = ?')
    .bind(key)
    .all<LoginThrottleState>();
  return (rows.results ?? [])[0] ?? null;
}

export async function recordLoginFailure(
  db: D1Database,
  username: string,
  ip: string | null,
): Promise<{ lockedUntil: string | null }> {
  const key = getThrottleKey(username, ip);
  const current = await getLoginThrottle(db, username, ip);
  const failedCount = (current?.failedCount ?? 0) + 1;
  const now = new Date().toISOString();
  const lockedUntil = failedCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null;
  await db
    .prepare(
      `INSERT INTO login_attempts (throttle_key, failed_count, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(throttle_key) DO UPDATE SET
         failed_count = excluded.failed_count,
         locked_until = excluded.locked_until,
         updated_at = excluded.updated_at`,
    )
    .bind(key, failedCount, lockedUntil, now)
    .run();
  return { lockedUntil };
}

export async function resetLoginThrottle(db: D1Database, username: string, ip: string | null): Promise<void> {
  const key = getThrottleKey(username, ip);
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
