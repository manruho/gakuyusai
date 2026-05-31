import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password';
import { signSession, verifySession } from '../../src/lib/session';

describe('password', () => {
  it('hashPassword と verifyPassword は同じパスワードを検証できる', async () => {
    const hash = await hashPassword('secret-password', '11111111-1111-1111-1111-111111111111');
    await expect(verifyPassword('secret-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});

describe('session', () => {
  it('signSession と verifySession はペイロードを往復できる', async () => {
    const token = await signSession(
      {
        role: 'admin',
        username: 'admin',
        exp: Date.now() + 60_000,
      },
      'test-secret',
    );
    await expect(verifySession(token, 'test-secret')).resolves.toMatchObject({
      role: 'admin',
      username: 'admin',
    });
    await expect(verifySession(token, 'wrong-secret')).resolves.toBeNull();
  });
});
