import type { SessionPayload } from '../../src/lib/types';

export function buildSessionPayload(role: 'admin' | 'owner', username: string): SessionPayload {
  return {
    role,
    username,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
}

