import { describe, expect, it } from 'vitest';
import { buildLoginLockedMessage, isLoginLocked } from '../../worker/services/authService';

describe('login throttle', () => {
  it('locked_until が未来ならロック状態として扱う', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isLoginLocked({ failedCount: 5, lockedUntil: future, updatedAt: new Date().toISOString() })).toBe(true);
  });

  it('ロック文言を返す', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(buildLoginLockedMessage(future)).toContain('ログイン試行回数が多すぎます');
  });
});
