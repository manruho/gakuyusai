import { describe, expect, it } from 'vitest';
import { buildLoginLockedMessage, isLoginLocked, shouldBypassStaffAuth } from '../../worker/services/authService';

describe('login throttle', () => {
  it('locked_until が未来ならロック状態として扱う', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(
      isLoginLocked({
        failedCount: 5,
        lockedUntil: future,
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it('ロック文言を返す', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(buildLoginLockedMessage(future)).toContain('ログイン試行回数が多すぎます');
  });
});

describe('preview staff auth bypass', () => {
  it('preview の非 main ブランチだけで有効になる', () => {
    expect(
      shouldBypassStaffAuth({
        PREVIEW_AUTH_BYPASS: 'true',
        CF_PAGES_BRANCH: 'codex/register-safety',
      }),
    ).toBe(true);
  });

  it('main またはブランチ情報なしではフラグがあっても無効になる', () => {
    expect(
      shouldBypassStaffAuth({
        PREVIEW_AUTH_BYPASS: 'true',
        CF_PAGES_BRANCH: 'main',
      }),
    ).toBe(false);
    expect(shouldBypassStaffAuth({ PREVIEW_AUTH_BYPASS: 'true' })).toBe(false);
  });

  it('preview フラグがなければ非 main ブランチでも無効になる', () => {
    expect(shouldBypassStaffAuth({ CF_PAGES_BRANCH: 'codex/register-safety' })).toBe(false);
  });
});
